import {readT5013Boxes,writeT5013Boxes,t5013Catalog} from './t5013-boxes.mjs';
import {ApiError,validDate} from './model.mjs';

// Native T5013 source fields recovered from the yearly modules. These are slip
// inputs, not computed T2125 overrides. The native engine supplies T1/CPP/XML.
const metadata='WBT13:';
const businessGroups=new Set(['BUSIN','BUCCA','BUDSP','BUAGR','WBALC','WBHOM','WBINV','WBCCA']);
const key=(address,id)=>`T5013:${address}:${id}`;
const meta=(address,id)=>`${metadata}${address}:${id}`;
const ids=fields=>[...new Set(Object.keys(fields).filter(k=>/^T5013:\d{5}:[A-Z]:[1-9]\d{0,3}$/.test(k)).map(k=>k.split(':')[3]))];
export function partnershipSlips(fields={}){
 return ids(fields).map(id=>{
  const source=readT5013Boxes(fields,id),boxes=source.boxes;
  return {type:'T5013',id,issuer:fields[key('01001:T',id)]??'',partnershipNumber:fields[key('00001:M',id)]??fields[key('00001:T',id)]??'',fiscalEnd:fields[key('01004:D',id)]??'',partnerCode:fields[key('00002:O',id)]??fields[key('00002:T',id)]??'',allocationPercentage:fields[key('00005:P',id)]??fields[key('00005:F',id)]??'',industryCode:fields[key('01102:O',id)]??fields[key('01102:T',id)]??'',accountingMethod:fields[key('01103:O',id)]??fields[key('01103:T',id)]??'',linkedBusinessId:fields[meta('00001:I',id)]??null,sourceReference:fields[meta('00002:T',id)]??'',issuedSlipConfirmed:fields[meta('00003:B',id)]==='true',legalOwnershipPercentage:fields[meta('00004:P',id)]??null,...source,covidAssistance:fields[key('01104:C',id)]??null,recipientCountry:fields[key('00003:M',id)]??'',recipientType:fields[key('00004:O',id)]??'',taxShelterNumber:fields[key('01005:M',id)]??''};
 });
}
export function validatePartnershipSlips(fields,year,{requireGross=false}={}){
 const slips=partnershipSlips(fields),linked=new Set();
 for(const code of Object.keys(fields).filter(k=>k.startsWith(metadata)))if(!/^WBT13:(?:00001:I|00002:T|00003:B|00004:P):[1-9]\d{0,3}$/.test(code))throw new ApiError(400,'Unknown T5013 source control.');
 for(const code of Object.keys(fields).filter(k=>k.startsWith(metadata)))if(!slips.some(s=>s.id===code.split(':')[3]))throw new ApiError(400,'T5013 source controls require an existing slip.');
 for(const s of slips){
  if(requireGross){
   if(Object.hasOwn(s.boxes,'116')&&!Object.hasOwn(s.boxes,'118'))throw new ApiError(400,`T5013 ${s.id}: box118 gross business income is required. Enter it from the corrected issued slip; missing is not zero.`);
   const seen=new Set();for(let n=1;n<=12;n++){const box=fields[key(`${10000+n}:O`,s.id)]??fields[key(`${10000+n}:T`,s.id)];if(box){if(seen.has(box))throw new ApiError(400,`T5013 ${s.id}: duplicate box${box} slots would be added together by the native engine. Correct the source slots before calculating.`);seen.add(box);}}
   if(Object.hasOwn(s.boxes,'116')&&s.allocationPercentage&&!/^\d+(?:\.\d{1,2}0*)?$/.test(s.allocationPercentage))throw new ApiError(400,'The personal NETFILE allocation field supports at most two meaningful decimal places. Do not silently round the issued slip percentage.');
  }
  const hasSourceControls=Object.keys(fields).some(k=>k.startsWith(metadata)&&k.split(':')[3]===s.id);
  if(!hasSourceControls){
   // Even advanced raw inputs must not duplicate an existing business.
   if(Object.hasOwn(s.boxes,'116'))for(const [code,name]of Object.entries(fields).filter(([k])=>/^BUSIN:00021:T:/.test(k))){const b=code.split(':')[3],bn=fields[`BUSIN:00039:M:${b}`],norm=v=>String(v||'').trim().toLowerCase().replace(/[^a-z0-9]/g,'');if((bn&&bn===s.partnershipNumber)||(norm(name)&&norm(name)===norm(s.issuer)))throw new ApiError(400,'Link the T5013 to the existing partnership business using the structured slips API; raw duplicate sources cannot both be calculated.');}
   continue;
  }
  if(!s.issuedSlipConfirmed||!s.sourceReference.trim())throw new ApiError(400,'Confirm an actual issued T5013 and provide its source reference; an allocation agreement alone is not a slip.');
  if(!s.issuer.trim()||s.issuer.length>60||!/^\d{9}$/.test(s.partnershipNumber)||/^0+$/.test(s.partnershipNumber))throw new ApiError(400,'T5013 requires the partnership name (up to60 characters) and actual nine-digit partnership BN.');
  if(!validDate(s.fiscalEnd)||(year&&!s.fiscalEnd.startsWith(`${year}-`)))throw new ApiError(400,'The T5013 fiscal period must end in this tax year.');
  if(!/^[0-6]$/.test(s.partnerCode))throw new ApiError(400,'T5013 box002 partner code must be0 through6 from the issued slip.');
  if(s.linkedBusinessId&&s.partnerCode!=='2')throw new ApiError(400,'Only an active general-partner slip (code2) may replace the linked active business.');
  const businessIncome=['116','120','122','124','126'].some(b=>Object.hasOwn(s.boxes,b));
  if((businessIncome||s.accountingMethod)&&!['1','2'].includes(s.accountingMethod))throw new ApiError(400,'T5013 business income requires accounting method1 accrual or2 cash.');
  if((businessIncome||s.industryCode)&&(!/^\d{6}$/.test(s.industryCode)||/^0+$/.test(s.industryCode)))throw new ApiError(400,'T5013 business income requires the actual six-digit NAICS code.');
  if((businessIncome||s.allocationPercentage)&&(!/^\d+(?:\.\d{1,6})?$/.test(s.allocationPercentage)||Number(s.allocationPercentage)>100))throw new ApiError(400,'Enter box005 net income/loss allocation percentage from0 through100, with at most two meaningful decimal places for NETFILE. This is separate from equity ownership.');
  if(s.legalOwnershipPercentage!==null&&(!/^\d+(?:\.\d+)?$/.test(s.legalOwnershipPercentage)||!(Number(s.legalOwnershipPercentage)>0&&Number(s.legalOwnershipPercentage)<=100)))throw new ApiError(400,'Legal ownership must be a positive percentage up to100.');
  const catalog=t5013Catalog(year??2021);
  if(!Object.keys(s.boxes).length&&!Object.keys(s.textBoxes).length)throw new ApiError(400,'Enter actual issued T5013 boxes.');
  if(s.recipientCountry&&!/^[A-Z]{3}$/.test(s.recipientCountry))throw new ApiError(400,'Recipient country must be a three-letter country code.');
  if(s.recipientType&&!['1','3','4'].includes(s.recipientType))throw new ApiError(400,'T5013 recipient type must be1,3 or4.');
  for(const [box,value]of Object.entries(s.boxes)){
   const isText=catalog.textBoxes.includes(box)&&!catalog.numericBoxes.includes(box);
   if(!catalog.directBoxes.includes(box)&&!catalog.numericBoxes.includes(box)&&!isText)throw new ApiError(400,`T5013 box${box} is not available for ${year}.`);
   if(isText){if(!value.trim()||value.length>2000)throw new ApiError(400,`T5013 text box${box} needs a description up to2000 characters.`);}
   else if(!/^-?\d+(?:\.\d{1,2})?$/.test(value)||(['040','118'].includes(box)&&Number(value)<0))throw new ApiError(400,`T5013 box${box} requires a decimal string with at most two decimal places.`);
  }
  for(const [box,value]of Object.entries(s.textBoxes))if(!catalog.textBoxes.includes(box)||!value.trim()||value.length>2000)throw new ApiError(400,`Invalid T5013 text box${box}.`);
  if(Object.hasOwn(s.boxes,'114')&&Number(s.boxes['114'])!==0&&!s.textBoxes['115']?.trim())throw new ApiError(400,'T5013 box114 requires the actual box115 description.');
  if(s.covidAssistance!==null){if(!catalog.fields['01104'])throw new ApiError(400,'COVID assistance is not available in this yearly T5013 model.');if(!/^\d+(?:\.\d{1,2})?$/.test(s.covidAssistance)||Number(s.covidAssistance)>Math.max(0,Number(s.boxes['114']??0)))throw new ApiError(400,'COVID assistance included in box114 must be nonnegative and cannot exceed box114.');}
  if(requireGross&&catalog.fields['01104']&&Number(s.boxes['114']??0)!==0&&s.covidAssistance===null)throw new ApiError(400,'Specify covidAssistance included in box114 explicitly (0 for ordinary other income). Do not infer from the description.');
  if(s.linkedBusinessId&&!Object.hasOwn(s.boxes,'116'))throw new ApiError(400,'A linked active-business replacement requires box116 and box118; other slip sources must not suppress business books.');
  if(slips.some(other=>other.id!==s.id&&other.partnershipNumber===s.partnershipNumber&&other.fiscalEnd===s.fiscalEnd))throw new ApiError(400,'This partnership and fiscal period already have a T5013 source. Edit the existing slip rather than counting an original and amendment twice.');
  if(s.linkedBusinessId!==null){
   if(!/^[1-9]\d{0,3}$/.test(s.linkedBusinessId)||linked.has(s.linkedBusinessId)||fields[`BUSIN:00038:R:${s.linkedBusinessId}`]!=='PART')throw new ApiError(400,'Link each T5013 to one existing partnership business; duplicate links are not permitted.');
   linked.add(s.linkedBusinessId);
   if(s.legalOwnershipPercentage!==fields[`BUSIN:00040:P:${s.linkedBusinessId}`]&&Number(s.legalOwnershipPercentage)!==Number(fields[`BUSIN:00040:P:${s.linkedBusinessId}`]))throw new ApiError(400,'T5013 legal ownership must match the linked business; changing ownership requires an explicit source correction.');
   const bn=fields[`BUSIN:00039:M:${s.linkedBusinessId}`];if(bn&&bn!==s.partnershipNumber)throw new ApiError(400,'T5013 partnership BN does not match the linked business.');
   // Partner-level expenses and home-office deductions need their own verified
   // adapter. Never silently drop them or claim partnership CCA a second time.
   const b=s.linkedBusinessId;
   if(fields[`BUSIN:00401:R:${b}`]==='Yes'||Object.keys(fields).some(k=>k.startsWith('WBHOM:')&&k.split(':')[3]===b)||['00300','00301','00302','00303'].some(n=>Number(fields[`BUSIN:${n}:C:${b}`]||0)!==0))throw new ApiError(400,'The linked business has partner-level adjustments or home-office inputs. Preserve them and resolve their T5013 treatment before switching sources.');
  }
  const norm=v=>String(v||'').trim().toLowerCase().replace(/[^a-z0-9]/g,'');
  for(const [code,name]of Object.entries(fields).filter(([k])=>/^BUSIN:00021:T:/.test(k))){const b=code.split(':')[3];if(b===s.linkedBusinessId)continue;const bn=fields[`BUSIN:00039:M:${b}`];if((bn&&bn===s.partnershipNumber)||(norm(name)&&norm(name)===norm(s.issuer)))throw new ApiError(400,'This partnership is also entered as a business. Link the T5013 to that business to prevent double counting.');}
 }
 return slips;
}
export function partnershipEngineFields(fields,year){
 if(fields==null)return fields;
 const linked=new Set(validatePartnershipSlips(fields,year).map(s=>s.linkedBusinessId).filter(Boolean));
 return Object.fromEntries(Object.entries(fields).filter(([code])=>!code.startsWith(metadata)&&!(businessGroups.has(code.split(':')[0])&&linked.has(code.split(':')[3]))));
}
export function partnershipSlipReport(fields={},scope='primary'){
 return partnershipSlips(fields).filter(s=>s.issuedSlipConfirmed).map(s=>({...s,grossIncomeProvided:Object.hasOwn(s.boxes,'118'),scope,source:'Original yearly T5013 calculation and NETFILE serializer',replacesBusinessCalculation:!!s.linkedBusinessId}));
}
export function writePartnershipSlip(fields,input,year){
 const allowed=['expectedRevision','type','id','issuer','partnershipNumber','fiscalEnd','partnerCode','allocationPercentage','industryCode','accountingMethod','linkedBusinessId','sourceReference','issuedSlipConfirmed','legalOwnershipPercentage','boxes','textBoxes','boxCountries','textBoxCountries','covidAssistance','recipientCountry','recipientType','taxShelterNumber','replace'];
 for(const k of Object.keys(input))if(!allowed.includes(k))throw new ApiError(400,`Unknown T5013 property: ${k}`);
 if(input.replace!==undefined&&typeof input.replace!=='boolean')throw new ApiError(400,'Slip replace must be a Boolean.');
 const id=String(input.id??Math.max(0,...ids(fields).map(Number))+1);if(!/^[1-9]\d{0,3}$/.test(id))throw new ApiError(400,'Slip id must be a positive integer up to9999.');
 const next={...fields};if(input.replace===true)for(const k of Object.keys(next))if((k.startsWith('T5013:')||k.startsWith(metadata))&&k.split(':')[3]===id)delete next[k];
 const map={issuer:'01001:T',partnershipNumber:'00001:M',fiscalEnd:'01004:D',partnerCode:'00002:O',allocationPercentage:'00005:P',industryCode:'01102:O',accountingMethod:'01103:O',covidAssistance:'01104:C',recipientCountry:'00003:M',recipientType:'00004:O',taxShelterNumber:'01005:M'};
 for(const [name,code]of Object.entries(map))if(Object.hasOwn(input,name)){if(typeof input[name]!=='string')throw new ApiError(400,`${name} must be a string.`);for(const k of Object.keys(next))if(k.startsWith('T5013:'+code.split(':')[0]+':')&&k.split(':')[3]===id)delete next[k];next[key(code,id)]=input[name];}
 for(const [name,code]of [['linkedBusinessId','00001:I'],['sourceReference','00002:T'],['legalOwnershipPercentage','00004:P']])if(Object.hasOwn(input,name)){if(input[name]===null)delete next[meta(code,id)];else{if(typeof input[name]!=='string'||input[name].length>2000)throw new ApiError(400,`${name} must be text or null.`);next[meta(code,id)]=input[name];}}
 if(input.issuedSlipConfirmed!==undefined){if(typeof input.issuedSlipConfirmed!=='boolean')throw new ApiError(400,'issuedSlipConfirmed must be a Boolean.');next[meta('00003:B',id)]=String(input.issuedSlipConfirmed);}
 writeT5013Boxes(next,input,id,year);

 const b=next[meta('00001:I',id)];if(b&&!Object.hasOwn(next,meta('00004:P',id)))next[meta('00004:P',id)]=fields[`BUSIN:00040:P:${b}`]??'';
 next['PARTN:00001:R']='Yes';validatePartnershipSlips(next,year,{requireGross:true});return {fields:next,slipId:id};
}
export function removePartnershipSlip(fields,id){return Object.fromEntries(Object.entries(fields).filter(([k])=>!((k.startsWith('T5013:')||k.startsWith(metadata))&&k.split(':')[3]===id)));}

export function partnershipSlipIssues(fields={}){
 const issues=[];
 for(const s of partnershipSlips(fields)){
  if(Object.hasOwn(s.boxes,'116')&&!Object.hasOwn(s.boxes,'118'))issues.push(`T5013 ${s.id}: add required box118 gross business income from the corrected issued slip. Missing is not a confirmed zero; existing source records have been preserved.`);
  const seen=new Set();for(let n=1;n<=12;n++){const box=fields[key(`${10000+n}:O`,s.id)]??fields[key(`${10000+n}:T`,s.id)];if(box){if(seen.has(box))issues.push(`T5013 ${s.id}: duplicate box${box} slots must be corrected; the native engine would add them together.`);seen.add(box);}}
  if(Object.hasOwn(s.boxes,'116')&&s.allocationPercentage&&!/^\d+(?:\.\d{1,2}0*)?$/.test(s.allocationPercentage))issues.push(`T5013 ${s.id}: the allocation percentage exceeds the personal NETFILE field's two meaningful decimal places. Verify the issued source without silently rounding it.`);
 }
 return issues;
}
