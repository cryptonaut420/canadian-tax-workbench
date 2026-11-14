import {createHash,randomUUID} from 'node:crypto';
import {ApiError} from './model.mjs';

export const DECISION_TOPICS=['home-office','inventory','cca','carryforward','filing-origin','marital-status','capital-loss','source-completeness','partnership-allocation'];
export const DECISION_STATUSES=['confirmed','estimate-accepted','selected-treatment','unresolved','note'];
const businessTopics=new Set(['home-office','inventory','cca','partnership-allocation']);
// Scope acknowledgements to the actual source inputs, not a result/refund target.
function scopeFields(topic,businessId,fields){
 return Object.entries(fields).filter(([code])=>{
  const [group,number,,business]=code.split(':');
  if(businessTopics.has(topic)&&business!==businessId)return false;
  if(topic==='home-office')return group==='WBHOM'||(group==='BUSIN'&&/^004/.test(number));
  if(topic==='inventory')return group==='WBINV'||(group==='BUSIN'&&(/^(0011[0-7]|00046)$/.test(number)));
  if(topic==='cca')return ['BUCCA','BUDSP','WBCCA'].includes(group)||(group==='BUSIN'&&['00022','00023'].includes(number));
  if(topic==='partnership-allocation')return group==='WBALC'||(group==='BUSIN'&&['00038','00040','00041'].includes(number));
  if(topic==='marital-status')return group==='MARST'||(group==='SPOUS'&&['00001','00031','00051'].includes(number));
  if(topic==='capital-loss')return /^(CAP|SCH03)/.test(group);
  if(topic==='carryforward')return /^(CARRY|LOSSC)/.test(group)||(['BUCCA','WBHOM'].includes(group)&&['00022','00002'].includes(number));
  // These describe the evidence supplied/filing origin, rather than approving a changing amount.
  return false;
 }).sort(([a],[b])=>a.localeCompare(b));
}
function fingerprint(topic,businessId,year,fields){return createHash('sha256').update(JSON.stringify({topic,businessId,year,fields:scopeFields(topic,businessId,fields)})).digest('hex');}

export class PreparationDecisions{
 constructor(store){
  this.store=store;
  store.db.exec(`CREATE TABLE IF NOT EXISTS preparation_decisions(id TEXT PRIMARY KEY,return_id TEXT NOT NULL REFERENCES returns(id),topic TEXT NOT NULL,business_id TEXT,status TEXT NOT NULL,description TEXT NOT NULL,source_reference TEXT NOT NULL,input_hash TEXT NOT NULL,actor TEXT NOT NULL,created_at TEXT NOT NULL);
   CREATE INDEX IF NOT EXISTS decision_return ON preparation_decisions(return_id);
   CREATE TRIGGER IF NOT EXISTS change_decisions_insert AFTER INSERT ON preparation_decisions BEGIN INSERT INTO workspace_events(entity,created_at) VALUES('preparation_decisions',strftime('%Y-%m-%dT%H:%M:%fZ','now')); END;`);
  store.decisions=this;
 }
 history(id){this.store.row(id);return this.store.db.prepare('SELECT id,topic,business_id AS businessId,status,description,source_reference AS sourceReference,input_hash AS inputHash,actor,created_at AS createdAt FROM preparation_decisions WHERE return_id=? ORDER BY rowid DESC').all(id);}
 assess(id,fields,year){
  const seen=new Set(),records=[];
  for(const record of this.history(id)){
   const key=record.topic+':'+(record.businessId||'');if(seen.has(key))continue;seen.add(key);
   const stale=record.inputHash!==fingerprint(record.topic,record.businessId,year,fields);const {inputHash,...publicRecord}=record;
   let sourceChanges=null;
   if(stale){
    const previous=this.store.db.prepare('SELECT fields FROM revisions WHERE return_id=? ORDER BY revision DESC').all(id).map(r=>JSON.parse(r.fields)).find(f=>fingerprint(record.topic,record.businessId,year,f)===inputHash);
    if(previous){const before=Object.fromEntries(scopeFields(record.topic,record.businessId,previous)),after=Object.fromEntries(scopeFields(record.topic,record.businessId,fields));sourceChanges=[...new Set([...Object.keys(before),...Object.keys(after)])].sort().filter(k=>before[k]!==after[k]).map(field=>({field,before:before[field]??null,after:after[field]??null}));}
   }
   records.push({...publicRecord,stale,sourceChanges});
  }
  const issues=[],advisories=[],accepted=[];
  for(const r of records){
   const label=r.topic+(r.businessId?' · business '+r.businessId:'');
   if(r.stale)issues.push(`Preparation decision ${label}: the source inputs changed. Revisit the recorded decision before review or filing.`);
   else if(r.status==='unresolved')issues.push(`Preparation decision ${label}: ${r.description}`);
   else if(['estimate-accepted','selected-treatment'].includes(r.status)){
    advisories.push(`${label}: ${r.description} This records the owner's selected position or estimate, not independent verification.`);accepted.push({topic:r.topic,businessId:r.businessId});
   }
   else if(r.status==='confirmed')accepted.push({topic:r.topic,businessId:r.businessId});
  }
  return {records,issues,advisories,accepted};
 }
 record(id,input,actor='desktop'){
  const row=this.store.row(id);
  if(input.expectedRevision!==row.revision)throw new ApiError(409,'The return changed. Refresh before recording a preparation decision.');
  if(this.store.submissions.state(id).blocked)throw new ApiError(409,'Resolve the pending transmission before changing preparation decisions.');
  const topic=input.topic,status=input.status,businessId=input.businessId==null?null:String(input.businessId);
  if(!DECISION_TOPICS.includes(topic)||!DECISION_STATUSES.includes(status))throw new ApiError(400,'Choose a supported preparation topic and decision status.');
  if(businessTopics.has(topic)?!businessId||!/^[1-9]\d{0,3}$/.test(businessId):businessId!==null)throw new ApiError(400,'Business preparation topics need a business ID; other topics have no business ID.');
  for(const name of ['description','sourceReference'])if(typeof input[name]!=='string'||!input[name].trim()||input[name].length>4000)throw new ApiError(400,`${name} must describe the decision/source in at most 4000 characters.`);
  const fields=JSON.parse(row.fields);if(businessId&&!fields[`BUSIN:00021:T:${businessId}`])throw new ApiError(400,'Choose an existing named business.');
  return this.store.transaction(()=>{
   this.store.db.prepare('INSERT INTO preparation_decisions VALUES(?,?,?,?,?,?,?,?,?,?)').run(randomUUID(),id,topic,businessId,status,input.description.trim(),input.sourceReference.trim(),fingerprint(topic,businessId,row.year,fields),actor,new Date().toISOString());
   this.store.db.prepare('UPDATE returns SET reviewed_calculation_id=NULL,updated_at=? WHERE id=?').run(new Date().toISOString(),id);
   return this.assess(id,fields,row.year);
  });
 }
}
