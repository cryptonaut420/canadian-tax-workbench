import {ApiError,validDate} from './model.mjs';
export const ENHANCED_CCA_2024_INPUTS=Object.freeze({eligibilityConfirmed:'00001:B',acquiredDate:'00002:D',availableForUseDate:'00003:D',sourceReference:'00004:T',eligibilityBasis:'00005:T'});
const id=value=>{const s=String(value);if(!/^[1-9]\d{0,3}$/.test(s))throw new ApiError(400,'Enhanced CCA class and asset ids must be positive integers up to9999.');return s;};
export function readEnhancedCca2024(fields,businessId){
 const suffixes=[...new Set(Object.keys(fields).filter(k=>k.startsWith('WBCCA:')&&k.split(':')[3]===businessId).map(k=>k.split(':').slice(4).join(':')))];
 return suffixes.map(s=>({classId:s.split(':')[0],assetId:s.split(':')[1],...Object.fromEntries(Object.entries(ENHANCED_CCA_2024_INPUTS).map(([name,a])=>[name,name==='eligibilityConfirmed'?fields[`WBCCA:${a}:${businessId}:${s}`]==='true':fields[`WBCCA:${a}:${businessId}:${s}`]]))}));
}
export function validateEnhancedCca2024(fields,year){
 const keys=Object.keys(fields).filter(k=>k.startsWith('WBCCA:'));
 if(keys.length&&year!==2024)throw new ApiError(400,'The enhanced class50 adapter is restricted to2024;2025 includes the original rule.');
 for(const k of keys)if(!/^WBCCA:(?:00001:B|0000[23]:D|0000[45]:T):[1-9]\d{0,3}:[1-9]\d{0,3}:[1-9]\d{0,3}$/.test(k))throw new ApiError(400,'Unknown enhanced2024 CCA control.');
 for(const suffix of new Set(keys.map(k=>k.split(':').slice(3).join(':')))){
  const [b,c]=suffix.split(':');const f=(a)=>fields[`WBCCA:${a}:${suffix}`],original=(a)=>fields[`BUCCA:${a}:${suffix}`];
  if(!['true','false'].includes(f('00001:B')))throw new ApiError(400,'Explicitly set enhanced CCA eligibilityConfirmed.');
  for(const n of ['00002:D','00003:D'])if(!validDate(f(n))||f(n)<='2024-04-15'||f(n)>='2025-01-01')throw new ApiError(400,'Enhanced2024 CCA requires acquisition and available-for-use dates after2024-04-15 within2024.');
  if(f('00003:D')<f('00002:D'))throw new ApiError(400,'CCA available-for-use date cannot precede acquisition.');
  for(const n of ['00004:T','00005:T'])if(typeof f(n)!=='string'||!f(n).trim()||f(n).length>2000)throw new ApiError(400,'Enhanced CCA requires sourceReference and eligibilityBasis.');
  if(fields[`BUCCA:00021:O:${b}:${c}`]!=='50'||original('00128:R')!=='Yes'||original('00131:R')!=='AFT23'||original('00132:R')==='Yes')throw new ApiError(400,'Enhanced2024 CCA requires original class50 AIIP acquired after2023 without designated immediate expensing.');
  if(fields[`BUSIN:00022:D:${b}`]!=='2024-01-01'||fields[`BUSIN:00023:D:${b}`]!=='2024-12-31')throw new ApiError(400,'Enhanced2024 CCA currently requires a full calendar business year.');
  if(fields[`BUCCA:00040:R:${b}:${c}`]==='Yes'||Object.keys(fields).some(k=>k.startsWith('BUDSP:')&&k.split(':')[3]===b&&k.split(':')[4]===c&&(k.split(':').length===6||(k.split(':')[1]==='00001'&&fields[k]==='Yes'))))throw new ApiError(400,'Enhanced2024 CCA with dispositions needs a reviewed disposition allocation.');
  const cost=original('00122:C'),personal=original('00123:C')||'0';
  if(!/^\d+(?:\.\d{1,2})?$/.test(cost||'')||!/^\d+(?:\.\d{1,2})?$/.test(personal)||Number(cost)>9999999999999.99||Number(personal)>9999999999999.99||Number(cost)<=Number(personal))throw new ApiError(400,'Enhanced CCA needs positive original business-use acquisition costs with at most two decimals.');
 }
 return fields;
}
export function writeEnhancedCca2024(fields,input,businessId,year){
 if(input!==null&&(!Array.isArray(input)||input.length>1000))throw new ApiError(400,'enhancedCca2024 must be an array of up to1000 eligibility records, or null.');
 const next={...fields};for(const k of Object.keys(next))if(k.startsWith('WBCCA:')&&k.split(':')[3]===businessId)delete next[k];
 const seen=new Set();for(const item of input||[]){
  if(!item||typeof item!=='object'||Array.isArray(item))throw new ApiError(400,'Each enhanced CCA eligibility record must be an object.');
  const suffix=`${businessId}:${id(item.classId)}:${id(item.assetId)}`;if(seen.has(suffix))throw new ApiError(400,'Duplicate enhanced CCA eligibility record.');seen.add(suffix);
  for(const k of Object.keys(item))if(!Object.hasOwn(ENHANCED_CCA_2024_INPUTS,k)&&!['classId','assetId'].includes(k))throw new ApiError(400,`Unknown enhanced CCA input: ${k}.`);
  for(const [name,address] of Object.entries(ENHANCED_CCA_2024_INPUTS)){
   const v=item[name];if(name==='eligibilityConfirmed'?typeof v!=='boolean':typeof v!=='string')throw new ApiError(400,`Enhanced CCA requires explicit ${name}.`);
   next[`WBCCA:${address}:${suffix}`]=String(v);
  }
 }
 return validateEnhancedCca2024(next,year);
}
export function enhancedCca2024Issues(fields){return [...new Set(Object.entries(fields).filter(([k,v])=>/^WBCCA:00001:B:/.test(k)&&v!=='true').map(([k])=>`Business ${k.split(':')[3]}, CCA class ${k.split(':')[4]}, asset ${k.split(':')[5]}: confirm enhanced2024 class50 eligibility, acquisition/available-for-use dates, and arm’s-length/previous-use restrictions. The calculated enhanced allowance is provisional until confirmed.`))];}
