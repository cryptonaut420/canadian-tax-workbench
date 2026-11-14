import {ApiError,summary} from './model.mjs';

// Explicit provenance for a manually separate spouse return. Never infer a
// relationship from names, SINs or the number of people in a workspace.
function decimal(value){
 if(typeof value!=='string'||!/^[-]?\d+(?:\.\d+)?$/.test(value))return null;
 let [whole,fraction='']=value.split('.'),negative=whole.startsWith('-');
 whole=whole.replace('-','').replace(/^0+(?=\d)/,'');fraction=fraction.replace(/0+$/,'');
 return (negative&&(whole!=='0'||fraction)?'-':'')+whole+(fraction?'.'+fraction:'');
}
const sameAmount=(a,b)=>decimal(a)!==null&&decimal(a)===decimal(b);

export class SpouseLinks{
 constructor(store){
  this.store=store;this.db=store.db;
  this.db.exec(`CREATE TABLE IF NOT EXISTS spouse_income_links(
   target_return_id TEXT PRIMARY KEY REFERENCES returns(id),source_return_id TEXT NOT NULL REFERENCES returns(id),
   source_calculation_id TEXT NOT NULL REFERENCES calculations(id),copied_net_income TEXT NOT NULL,
   actor TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
   CHECK(target_return_id<>source_return_id));`);
  for(const op of ['INSERT','UPDATE','DELETE'])this.db.exec(`CREATE TRIGGER IF NOT EXISTS change_spouse_links_${op} AFTER ${op} ON spouse_income_links BEGIN INSERT INTO workspace_events(entity,created_at) VALUES('spouse_income_links',strftime('%Y-%m-%dT%H:%M:%fZ','now')); END;`);
 }
 get(id){
  this.store.row(id);
  return this.db.prepare(`SELECT target_return_id AS targetReturnId,source_return_id AS sourceReturnId,
   source_calculation_id AS sourceCalculationId,copied_net_income AS copiedNetIncome,actor,
   created_at AS createdAt,updated_at AS updatedAt FROM spouse_income_links WHERE target_return_id=?`).get(id)??null;
 }
 source(id){
  const row=this.store.row(id),calculation=this.store.calculation(row.calculation_id);
  return {row,calculation,netIncome:calculation?summary(calculation.result).netIncome:null};
 }
 assess(id){
  const link=this.get(id),issues=[],advisories=[];
  if(!link)return {link:null,issues,advisories};
  const target=this.store.row(id),targetFields=JSON.parse(target.fields),source=this.source(link.sourceReturnId);
  const current={...link,sourceYear:source.row.year,currentSourceRevision:source.row.revision,currentSourceCalculationId:source.calculation?.id??null,currentSourceNetIncome:source.netIncome};
  if(source.row.year!==target.year||source.row.person_id===target.person_id)issues.push('The linked spouse income source must be another person’s return for the same tax year.');
  else if(!source.calculation||source.calculation.inputRevision!==source.row.revision||decimal(source.netIncome)===null)issues.push('The linked spouse return changed or has no current calculation. Calculate that source return, then refresh its linked spouse income before review or filing.');
  else if(!sameAmount(targetFields['SPOUS:00051:C'],source.netIncome))issues.push('The linked spouse’s net income (line 23600) differs from this return. Refresh the spouse-income source and recalculate before review or filing.');
  else advisories.push('Spouse net income matches the current calculated linked return. If the source changes, this relationship is checked again before review and filing.');
  return {link:current,issues,advisories};
 }
 link(id,input,actor='local'){
  return this.store.transaction(()=>{
   const target=this.store.row(id);
   if(input.expectedRevision!==target.revision)throw new ApiError(409,'The target return changed. Refresh before linking spouse income.');
   if(typeof input.sourceReturnId!=='string'||!input.sourceReturnId)throw new ApiError(400,'Provide the explicit spouse sourceReturnId.');
   const source=this.source(input.sourceReturnId);
   if(source.row.id===target.id||source.row.person_id===target.person_id||source.row.year!==target.year)throw new ApiError(400,'Choose another person’s return for the same tax year as the spouse income source.');
   if(!source.calculation||source.calculation.inputRevision!==source.row.revision||source.calculation.id!==input.sourceCalculationId)throw new ApiError(409,'Calculate the current source return and provide its sourceCalculationId before copying spouse income.');
   if(decimal(source.netIncome)===null)throw new ApiError(422,'The source calculation does not supply an exact net-income amount on line 23600.');
   if(this.store.submissions.state(id).blocked)throw new ApiError(409,'Resolve the pending transmission before changing the spouse-income source.');
   const fields=JSON.parse(target.fields),old=this.get(id),now=new Date().toISOString();
   if(!sameAmount(fields['SPOUS:00051:C'],source.netIncome))this.store.update(id,{expectedRevision:target.revision,fields:{...fields,'SPOUS:00051:C':source.netIncome}},actor);
   if(!old||old.sourceReturnId!==source.row.id||old.sourceCalculationId!==source.calculation.id||!sameAmount(old.copiedNetIncome,source.netIncome)){
    this.db.prepare(`INSERT INTO spouse_income_links VALUES(?,?,?,?,?,?,?) ON CONFLICT(target_return_id) DO UPDATE SET source_return_id=excluded.source_return_id,source_calculation_id=excluded.source_calculation_id,copied_net_income=excluded.copied_net_income,actor=excluded.actor,updated_at=excluded.updated_at`).run(id,source.row.id,source.calculation.id,source.netIncome,actor,now,now);
    this.db.prepare('UPDATE returns SET reviewed_calculation_id=NULL,updated_at=? WHERE id=?').run(now,id);
   }
   return {return:this.store.get(id),...this.assess(id)};
  });
 }
 unlink(id,input,actor='local'){
  return this.store.transaction(()=>{
   const target=this.store.row(id);
   if(input.expectedRevision!==target.revision)throw new ApiError(409,'The return changed. Refresh before removing the spouse-income link.');
   if(this.store.submissions.state(id).blocked)throw new ApiError(409,'Resolve the pending transmission before removing the spouse-income source.');
   if(this.get(id)){
    this.db.prepare('DELETE FROM spouse_income_links WHERE target_return_id=?').run(id);
    this.db.prepare('UPDATE returns SET reviewed_calculation_id=NULL,updated_at=? WHERE id=?').run(new Date().toISOString(),id);
   }
   return {return:this.store.get(id),link:null,issues:[],advisories:['The source link was removed. The existing spouse-income amount remains as a manual input and requires independent verification.']};
  });
 }
}
