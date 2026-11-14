import {financialDifferences} from './snapshot.mjs';
export async function analyseCleanup(engine,item,result){
 if(!engine.cleanInputs)return {proposal:null,conflicts:[]};
 const proposal=await engine.cleanInputs({year:item.year,fields:item.fields,spouseFields:item.spouseFields});
 const conflicts=[];let hasDates=false;
 for(const [scope,before,changes] of [['primary',item.fields,proposal.primary],['spouse',item.spouseFields,proposal.spouse]]){
  if(!changes || !before)continue;
  for(const code of [...changes.removedFields,...changes.changedFields]){
   const kind=code.split(':')[2],old=before[code],after=changes.fields[code];
   if(kind==='D' && old && old!==after)hasDates=true;
   if(['C','F','P'].includes(kind) && financialDifferences({[code]:old},{[code]:'0'}).length && financialDifferences({[code]:old},{[code]:after ?? '0'}).length)conflicts.push({scope,field:code,before:old,after:after ?? null});
  }
 }
 if(hasDates){
  const baseline=result || await engine.calculate({year:item.year,fields:item.fields,spouseFields:item.spouseFields});
  const cleaned=await engine.calculate({year:item.year,fields:proposal.primary.fields,spouseFields:proposal.spouse?.fields || null});
  for(const [scope,before,after,optional] of [['primary',baseline.fields,cleaned.fields,false],['spouse',baseline.spouseFields,cleaned.spouseFields,true]]){
   for(const change of financialDifferences(before,after,{optional}))conflicts.push({scope,field:change.field,before:change.reviewed,after:change.prepared});
  }
 }
 return {proposal,conflicts};
}
