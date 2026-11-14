import {partnershipSlips,writePartnershipSlip,removePartnershipSlip} from './partnership-slips.mjs';
import {ApiError,PROVINCES,validateFields,profileFields} from './model.mjs';
const direct={T4:new Set(['14','16','17','18','20','22','24','26','44','46','52']),T5:new Set(['10','11','13','18','24','25']),T4A:new Set(['22']),T4E:new Set(['14','22'])};
const additional={T4:new Set(['30','31','32','33','34','36','38','39','40','41','42','43','66','67','68','69','70','71','74','75','77','78','79','80','81','82','83','84','85','86','87','88','89','90','91','92','93','94','95']),T5:new Set(['14','15','16','17','19','30']),T4A:new Set(['197','202']),T4E:new Set(['36','37'])};
export const SLIP_TYPES=['T4','T5','T4A','T4E','T5013'];
const prefixes={T4:'T4SLI',T5:'T5SLI',T4A:'T4ASL',T4E:'T4ESL'};
const group=type=>{if(!SLIP_TYPES.includes(type))throw new ApiError(400,'Structured slips support T4, T5, T4A COVID benefits, T4E benefits and original yearly T5013 boxes; use exact fields for other slip types.');return prefixes[type];};
const slotsFor=type=>type==='T5'?3:type==='T4A'?12:6;
const slotCode=(prefix,kind,slot,id)=>`${prefix}:${String((kind==='O'?10000:20000)+slot)}:${kind}:${id}`;
export function slips(fields){
 const result=[];for(const type of SLIP_TYPES.filter(t=>t!=='T5013')){const prefix=group(type),loops=[...new Set(Object.keys(fields).filter(k=>k.startsWith(prefix+':') && /^\d+$/.test(k.split(':')[3] || '')).map(k=>k.split(':')[3]))].sort((a,b)=>Number(a)-Number(b));
 for(const id of loops){const raw=Object.fromEntries(Object.entries(fields).filter(([k])=>k.startsWith(prefix+':')&&k.split(':')[3]===id));const boxes={};for(const code of direct[type]){const key=`${prefix}:${code.padStart(5,'0')}:C:${id}`;if(fields[key]!==undefined)boxes[code]=fields[key];}
 if(type==='T4')for(const [box,code] of [['16A','00161'],['17A','00171']]){const value=fields[`${prefix}:${code}:C:${id}`];if(value!==undefined)boxes[box]=value;}
 if(type==='T4E' && fields[`${prefix}:00007:P:${id}`]!==undefined)boxes['7']=fields[`${prefix}:00007:P:${id}`];
 for(let slot=1;slot<=slotsFor(type);slot++){const key=slotCode(prefix,'O',slot,id),code=fields[key] ?? fields[key.replace(':O:',':T:')];if(code)boxes[code]=fields[slotCode(prefix,'C',slot,id)]??'';}
 result.push({type,id,issuer:fields[`${prefix}:01001:T:${id}`] || '',employmentProvince:fields[`${prefix}:00010:O:${id}`] || null,boxes,fields:raw});}}
 return [...result,...partnershipSlips(fields)];
}
export function writeSlip(fields,input,year=2021){
 if(input?.type==='T5013'){const result=writePartnershipSlip(fields,input,year);return {...result,fields:validateFields(result.fields,'fields',year)};}
 if(!input||typeof input!=='object'||Array.isArray(input))throw new ApiError(400,'Provide a slip object.');
 for(const key of Object.keys(input))if(!['expectedRevision','type','id','issuer','employmentProvince','boxes','replace'].includes(key))throw new ApiError(400,`Unknown slip property: ${key}`);
 if(input.replace!==undefined&&typeof input.replace!=='boolean')throw new ApiError(400,'Slip replace must be a Boolean.');

 const prefix=group(input.type),existing=slips(fields).filter(x=>x.type===input.type);
 const id=input.id===undefined?String(Math.max(0,...existing.map(x=>Number(x.id)))+1):String(input.id);
 if(!/^[1-9]\d{0,3}$/.test(id))throw new ApiError(400,'Slip id must be a positive integer up to9999.');
 if(!input.boxes || typeof input.boxes!=='object' || Array.isArray(input.boxes))throw new ApiError(400,'Provide a boxes object of decimal strings.');
 const next={...fields};
 if(input.replace===true)for(const k of Object.keys(next))if(k.startsWith(prefix+':') && k.split(':')[3]===id)delete next[k];
 if(input.type==='T4E' && input.issuer!==undefined && input.issuer!=='')throw new ApiError(400,'The original T4E model has no payer-name input; omit issuer for this slip.');
 if(input.type!=='T4E' && input.issuer!==undefined){if(typeof input.issuer!=='string' || input.issuer.length>160)throw new ApiError(400,'Issuer must be text.');next[`${prefix}:01001:T:${id}`]=input.issuer;}
 if(input.type==='T4' && input.employmentProvince!==undefined){if(!PROVINCES.includes(input.employmentProvince))throw new ApiError(400,'Choose a valid employment province.');next[`${prefix}:00010:O:${id}`]=input.employmentProvince;}
 const seenBoxes=new Set();
 for(const [rawBox,amount] of Object.entries(input.boxes)){
  const box=rawBox==='07'?'7':rawBox;
  if(seenBoxes.has(box))throw new ApiError(400,`Box ${box} was supplied more than once through alternate names.`);seenBoxes.add(box);
  if(input.type==='T4E' && box==='7'){
   if(typeof amount!=='string'||!/^\d+(?:\.\d+)?$/.test(amount)||Number(amount)>100)throw new ApiError(400,'T4E repayment rate (box 7) must be a percentage string from 0 to 100.');
   next[`${prefix}:00007:P:${id}`]=amount;continue;
  }
  if(input.type==='T4E' && box==='37' && year<2020)throw new ApiError(400,'T4E box37 is not consumed by the original2019 calculation; use the original2019 source questions.');
  if(input.type==='T4A' && ['197','202'].includes(box) && year<2020)throw new ApiError(400,'COVID benefit boxes 197/202 are not supported by the 2019 source module.');
  if(input.type==='T4' && ['16A','17A'].includes(box)){
    if(year<2024)throw new ApiError(400,'Second additional CPP/QPP boxes apply only to the verified 2024–2025 mappings.');
    if(typeof amount!=='string')throw new ApiError(400,`Box ${box} must be a decimal string.`);
    next[`${prefix}:${box==='16A'?'00161':'00171'}:C:${id}`]=amount;continue;
  }
  if(!direct[input.type].has(box)&&!additional[input.type].has(box))throw new ApiError(400,`Box ${box} is not verified for structured ${input.type} entry. Use an original field mapping.`);
  if(typeof amount!=='string')throw new ApiError(400,`Box ${box} must be a decimal string.`);
  if(['T4A','T4E'].includes(input.type)&&!/^\d+(?:\.\d+)?$/.test(amount))throw new ApiError(400,`Benefit box ${box} must be a nonnegative decimal string.`);
  if(direct[input.type].has(box)){next[`${prefix}:${box.padStart(5,'0')}:C:${id}`]=amount;continue;}
  const max=slotsFor(input.type),slots=Array.from({length:max},(_,i)=>i+1);
  let slot=slots.find(n=>{const k=slotCode(prefix,'O',n,id);return (next[k] ?? next[k.replace(':O:',':T:')])===box;});
  if(!slot)slot=slots.find(n=>{const k=slotCode(prefix,'O',n,id);return !next[k]&&!next[k.replace(':O:',':T:')];});
  if(!slot)throw new ApiError(400,'This slip has no free additional-box slots. Preserve existing boxes and add another original slip if appropriate.');
  const key=slotCode(prefix,'O',slot,id);delete next[key.replace(':O:',':T:')];next[key]=box;next[slotCode(prefix,'C',slot,id)]=amount;
  // Keep a preexisting convenience alias from the direct editor synchronized.
  const alias=`${prefix}:${box.padStart(5,'0')}:C:${id}`;if(Object.hasOwn(next,alias))next[alias]=amount;
 }
 if(input.type==='T4'){
   if(Number(next[`T4SLI:00014:C:${id}`]))next['EMPIN:00001:R']='Yes';
   if(Number(next[`T4SLI:00020:C:${id}`]))next['RPPLA:00001:R']='Yes';
   if(Number(next[`T4SLI:00044:C:${id}`]))next['UNION:00001:R']='Yes';
 }
 if(input.type==='T4E' && Number(next[`${prefix}:00014:C:${id}`])>0)next['EIINC:00001:R']='Yes';
 if(input.type==='T4A' && Object.entries(input.boxes).some(([box,value])=>['197','202'].includes(box)&&Number(value)>0))next['COVID:00001:R']='Yes';
 if(input.type==='T5' && Object.entries(input.boxes).some(([box,value])=>['10','11','13','14','15','18','24','25'].includes(box)&&Number(value)>0))next['INVIN:00001:R']='Yes';
 return {fields:validateFields(next,'fields',year),slipId:id};
}
export function removeSlip(fields,type,id){if(type==='T5013'){if(!/^[1-9]\d{0,3}$/.test(String(id)))throw new ApiError(400,'Invalid slip id.');return removePartnershipSlip(fields,String(id));}const prefix=group(type);if(!/^[1-9]\d{0,3}$/.test(String(id)))throw new ApiError(400,'Slip id must be a positive canonical integer up to9999.');return Object.fromEntries(Object.entries(fields).filter(([k])=>!(k.startsWith(prefix+':')&&k.split(':')[3]===String(id))));}

export function copyIdentity(source,person,targetYear,overrides={}){
 // Copy only established source identity/address fields. Annual slips, deductions,
 // carryforwards, consent, filing receipts and computed outputs are never inferred.
 const allowed=new Set(['TAXPY:00001:S','TAXPY:00011:T','TAXPY:00012:T','TAXPY:00013:T','TAXPY:00031:D','IDENT:00011:R','IDENT:00012:T','IDENT:00013:T','IDENT:00014:T','IDENT:00015:T','IDENT:00016:T','IDENT:00017:O','IDENT:00018:A','IDENT:00019:T','IDENT:00020:T']);
 return validateFields({...profileFields(person,targetYear),...Object.fromEntries(Object.entries(source.fields).filter(([k])=>allowed.has(k))),...validateFields(overrides)});
}

// These are source receipt inputs from RRSPDE0204/0205, not computed Schedule 7
// totals. In particular 00225 is the following year's first 60 days; 00015 is a
// different question about the current year's first 60 days already reported.
const receiptFields={issuer:['00221','T',60],planNumber:['00222','T',30],contractNumber:['00223','T',30],lastTenMonths:['00224','C'],first60DaysFollowing:['00225','C'],annuitantCode:['00226','O']};
const rrspControls={deductionLimit:'CARRY:00001:C',unusedContributions:'CARRY:00002:C',carryForwardAmount:'RRSPD:00028:C'};
const receiptKey=(field,id)=>`RRSPD:${receiptFields[field][0]}:${receiptFields[field][1]}:${id}`;
export function readRrsp(fields,year){
 const ids=[...new Set(Object.keys(fields).filter(k=>/^RRSPD:0022[1-6]:[TCO]:[1-9]\d*$/.test(k)).map(k=>k.split(':')[3]))].sort((a,b)=>Number(a)-Number(b));
 return {year,...Object.fromEntries(Object.entries(rrspControls).map(([name,code])=>[name,fields[code]??null])),carryForwardAnswer:fields['RRSPD:00029:R']??null,receipts:ids.map(id=>({id,...Object.fromEntries(Object.keys(receiptFields).map(name=>[name,fields[receiptKey(name,id)]??null]))})),notes:['Use the deduction limit and unused contributions from CRA records; receipt amounts do not establish available room.','lastTenMonths and first60DaysFollowing refer to the contribution periods printed on the receipt. First 60 days of the current tax year previously reported are a separate original interview question.']};
}
export function writeRrsp(fields,input,year){
 if(!input||typeof input!=='object'||Array.isArray(input))throw new ApiError(400,'Provide an RRSP object.');
 for(const key of Object.keys(input))if(!['expectedRevision',...Object.keys(rrspControls),'receipts','replaceReceipts'].includes(key))throw new ApiError(400,`Unknown RRSP property: ${key}`);
 if(input.replaceReceipts!==undefined&&typeof input.replaceReceipts!=='boolean')throw new ApiError(400,'replaceReceipts must be a Boolean.');
 if(input.replaceReceipts===true&&input.receipts===undefined)throw new ApiError(400,'Provide the explicit receipts list when replacing receipts.');

 const next={...fields};
 for(const [name,code] of Object.entries(rrspControls))if(Object.hasOwn(input,name)){
  const value=input[name];
  if(value===null){delete next[code];if(name==='carryForwardAmount')delete next['RRSPD:00029:R'];continue;}
  if(typeof value!=='string'||!/^\d+(?:\.\d+)?$/.test(value))throw new ApiError(400,`${name} must be a nonnegative decimal string or null to clear.`);
  next[code]=value;
  if(name==='carryForwardAmount')next['RRSPD:00029:R']=Number(value)>0?'Yes':'No';
 }
 if(input.receipts!==undefined){
  if(!Array.isArray(input.receipts)||input.receipts.length>100)throw new ApiError(400,'Provide up to 100 RRSP receipt records.');
  if(input.replaceReceipts===true)for(const key of Object.keys(next))if(/^RRSPD:0022[1-6]:[TCO]:\d+$/.test(key))delete next[key];
  const seen=new Set();
  for(const receipt of input.receipts){
   if(!receipt||typeof receipt!=='object'||Array.isArray(receipt))throw new ApiError(400,'Each RRSP receipt must be an object.');
   for(const key of Object.keys(receipt))if(key!=='id'&&!Object.hasOwn(receiptFields,key))throw new ApiError(400,`Unknown RRSP receipt property: ${key}`);
   const existing=readRrsp(next,year).receipts;
   const id=receipt.id===undefined?String(Math.max(0,...existing.map(r=>Number(r.id)))+1):String(receipt.id);
   if(!/^[1-9]\d{0,3}$/.test(id)||seen.has(id))throw new ApiError(400,'Each RRSP receipt needs a unique positive id up to 9999.');seen.add(id);
   for(const [name,[,kind,maxChars]] of Object.entries(receiptFields))if(Object.hasOwn(receipt,name)){
    const value=receipt[name],code=receiptKey(name,id);
    if(value===null){delete next[code];continue;}
    if(typeof value!=='string')throw new ApiError(400,`${name} must be text or a decimal string.`);
    if(kind==='C'&&!/^\d+(?:\.\d+)?$/.test(value))throw new ApiError(400,`${name} must be a nonnegative decimal string.`);
    if(maxChars&&value.length>maxChars)throw new ApiError(400,`${name} exceeds the original ${maxChars}-character receipt limit.`);
    if(name==='annuitantCode'&&!['','1','2'].includes(value))throw new ApiError(400,'Choose the original annuitant code 1 or 2, or leave unanswered.');
    next[code]=value;
   }
  }
  if(readRrsp(next,year).receipts.length)next['RRSPD:00001:R']='Yes';
  // Do not automatically answer No or clear legacy aggregate inputs: removing a
  // receipt is not proof there were no contributions in another source record.
 }
 return {fields:validateFields(next,'fields',year),rrsp:readRrsp(next,year)};
}
