import {ApiError} from './model.mjs';

// An explicit Workbench extension: these are already apportioned business-use
// costs, never whole-home expenses or a fabricated floor-area ratio.
export const HOME_OFFICE_CLAIM_FIELDS=Object.freeze({currentExpenses:'00001:C',priorUnusedExpenses:'00002:C',eligibilityConfirmed:'00003:B',sourceReference:'00004:T',basis:'00005:T'});
const validId=id=>/^[1-9]\d{0,3}$/.test(String(id));
const amount=value=>{
 if(typeof value!=='string'||!/^\d+(?:\.\d{1,2})?$/.test(value))return false;
 const [whole,fraction='']=value.split('.');return BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0'))<=999999999999999n;
};
const key=(name,id)=>`WBHOM:${HOME_OFFICE_CLAIM_FIELDS[name]}:${id}`;

export function readHomeOfficeClaim(fields,id){
 if(!Object.keys(fields).some(code=>code.startsWith('WBHOM:')&&code.split(':')[3]===String(id)))return null;
 return Object.fromEntries(Object.entries(HOME_OFFICE_CLAIM_FIELDS).map(([name])=>[name,name==='eligibilityConfirmed'?fields[key(name,id)]==='true':fields[key(name,id)]]));
}

export function validateHomeOfficeClaims(fields){
 const controls=Object.keys(fields).filter(code=>code.startsWith('WBHOM:'));
 for(const code of controls)if(!/^WBHOM:(?:0000[12]:C|00003:B|0000[45]:T):[1-9]\d{0,3}$/.test(code))throw new ApiError(400,'Unknown Workbench pre-apportioned home-office control.');
 for(const id of new Set(controls.map(code=>code.split(':')[3]))){
  if(!fields[`BUSIN:00021:T:${id}`])throw new ApiError(400,'A pre-apportioned home-office claim requires an existing named business.');
  for(const name of ['currentExpenses','priorUnusedExpenses'])if(!amount(fields[key(name,id)]))throw new ApiError(400,`${name} requires an explicit nonnegative decimal string with at most two decimal places.`);
  if(!['true','false'].includes(fields[key('eligibilityConfirmed',id)]))throw new ApiError(400,'Explicitly set home-office eligibilityConfirmed; unresolved eligibility may remain provisional for comparison.');
  for(const name of ['sourceReference','basis'])if(typeof fields[key(name,id)]!=='string'||!fields[key(name,id)].trim()||fields[key(name,id)].length>2000)throw new ApiError(400,`Home-office ${name} requires a nonempty description of at most 2000 characters.`);
  if(fields[`BUSIN:00401:R:${id}`]==='Yes'||Object.entries(fields).some(([code,value])=>/^BUSIN:004(?:02|0[5-9]|1[01]):C:/.test(code)&&code.split(':')[3]===id&&Number(value)!==0))throw new ApiError(400,'Use either whole-home costs with an area ratio or a pre-apportioned home-office claim; remove the other claim to avoid double counting.');
 }
 return fields;
}

export function writeHomeOfficeClaim(fields,id,input){
 if(!validId(id))throw new ApiError(400,'Business id must be a positive integer up to9999.');
 const next={...fields};
 for(const code of Object.keys(next))if(code.startsWith('WBHOM:')&&code.split(':')[3]===String(id))delete next[code];
 if(input===null)return next;
 if(!input||typeof input!=='object'||Array.isArray(input))throw new ApiError(400,'homeOfficeClaim must be an explicit pre-apportioned claim object or null.');
 for(const name of Object.keys(input))if(!Object.hasOwn(HOME_OFFICE_CLAIM_FIELDS,name))throw new ApiError(400,`Unknown pre-apportioned home-office input: ${name}.`);
 if(typeof input.eligibilityConfirmed!=='boolean')throw new ApiError(400,'homeOfficeClaim.eligibilityConfirmed must be an explicit boolean.');
 for(const name of Object.keys(HOME_OFFICE_CLAIM_FIELDS))next[key(name,id)]=name==='eligibilityConfirmed'?String(input[name]):input[name];
 return validateHomeOfficeClaims(next);
}

export function homeOfficeClaimIssues(fields){
 const issues=[];
 for(const id of new Set(Object.keys(fields).filter(code=>code.startsWith('WBHOM:')).map(code=>code.split(':')[3])))if(fields[key('eligibilityConfirmed',id)]!=='true')issues.push(`Business ${id}: the pre-apportioned home-office deduction is provisional. Confirm eligible expenses, business-use basis and any household/spouse arrangement before reviewing or filing.`);
 return issues;
}
