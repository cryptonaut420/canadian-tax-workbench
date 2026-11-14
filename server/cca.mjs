import {ApiError} from './model.mjs';

// Original GenuTax CCA addition interview inputs. Each is a third-level asset record.
export const CCA_ADDITION_INPUTS=Object.freeze({description:'00121:T',cost:'00122:C',personalPortion:'00123:C',salesTax:'00125:R',acquiredAfterNovember2018:'00127:R',acceleratedInvestment:'00128:R',acquiredYear:'00131:R',immediateExpensing:'00132:R',reacceleratedInvestment:'00141:R'});
const id=value=>{const s=String(value);if(!/^[1-9]\d{0,3}$/.test(s))throw new ApiError(400,'CCA asset id must be a positive integer up to9999.');return s;};
export function additionCatalog(defs){return Object.fromEntries(Object.entries(CCA_ADDITION_INPUTS).filter(([,a])=>defs.has('BUCCA:'+a)).map(([name,a])=>{const d=defs.get('BUCCA:'+a);return [name,{code:`BUCCA:${a}:{business}:{class}:{asset}`,kind:d.kind,label:d.label,options:d.options?.map(({value,label})=>({value,label})),bounds:d.attrs}];}));}
export function readAdditions(fields,businessId,classId){
 const prefix=`${businessId}:${classId}:`;
 const ids=[...new Set(Object.keys(fields).filter(k=>k.startsWith('BUCCA:')&&k.split(':').slice(3).join(':').startsWith(prefix)&&k.split(':').length===6&&Object.values(CCA_ADDITION_INPUTS).includes(k.split(':').slice(1,3).join(':'))).map(k=>k.split(':')[5]))].sort((a,b)=>Number(a)-Number(b));
 return ids.map(assetId=>({id:assetId,...Object.fromEntries(Object.entries(CCA_ADDITION_INPUTS).flatMap(([name,a])=>Object.hasOwn(fields,`BUCCA:${a}:${businessId}:${classId}:${assetId}`)?[[name,fields[`BUCCA:${a}:${businessId}:${classId}:${assetId}`]]]:[]))}));
}
export function writeAdditions(fields,items,businessId,classId,defs){
 if(!Array.isArray(items)||items.length>1000)throw new ApiError(400,'CCA additions must be an array of up to1000 original asset records.');
 // Supplying additions replaces this class's asset list, preserving other classes.
 for(const k of Object.keys(fields))if(k.startsWith('BUCCA:')&&k.split(':').length===6&&k.split(':')[3]===businessId&&k.split(':')[4]===classId&&Object.values(CCA_ADDITION_INPUTS).includes(k.split(':').slice(1,3).join(':')))delete fields[k];
 const seen=new Set();
 for(const item of items){
  if(!item||typeof item!=='object'||Array.isArray(item))throw new ApiError(400,'Each CCA addition must be an object.');
  const assetId=id(item.id);if(seen.has(assetId))throw new ApiError(400,'Duplicate CCA asset id.');seen.add(assetId);
  for(const [name,value] of Object.entries(item)){
   if(name==='id')continue;
   const a=CCA_ADDITION_INPUTS[name],d=a&&defs.get('BUCCA:'+a);
   if(!d)throw new ApiError(400,`CCA addition input ${name} is unavailable in this tax year.`);
   if(typeof value!=='string'||(a.endsWith(':C')&&!/^\d+(?:\.\d{1,28})?$/.test(value)))throw new ApiError(400,`CCA addition ${name} requires a nonnegative decimal or original string value.`);
   if(d.options?.length&&!d.options.some(o=>o.value===value))throw new ApiError(400,`Invalid original CCA addition option for ${name}.`);
   if(d.attrs?.MaxChars&&value.length>Number(d.attrs.MaxChars))throw new ApiError(400,`CCA addition ${name} exceeds ${d.attrs.MaxChars} characters.`);
   fields[`BUCCA:${a}:${businessId}:${classId}:${assetId}`]=value;
  }
  if(!item.description?.trim()||item.cost===undefined)throw new ApiError(400,'Each CCA addition needs its description and actual cost.');
  if(Number(item.personalPortion||0)>Number(item.cost))throw new ApiError(400,'CCA addition personal portion cannot exceed its total cost.');
 }
 fields[`BUCCA:00025:R:${businessId}:${classId}`]=items.length?'Yes':'No';
}
