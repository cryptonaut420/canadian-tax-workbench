import {partnershipEngineFields,partnershipSlips} from './partnership-slips.mjs';
import {writeEnhancedCca2024,readEnhancedCca2024,enhancedCca2024Issues} from './enhanced-cca.mjs';
import {HOME_OFFICE_CLAIM_FIELDS,readHomeOfficeClaim,writeHomeOfficeClaim,homeOfficeClaimIssues} from './home-office.mjs';
import {readInventoryAccounting,writeInventoryAccounting,inventoryAccountingIssues} from './inventory.mjs';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {ApiError,YEARS,validateFields,validDate} from './model.mjs';
import {additionCatalog,readAdditions,writeAdditions} from './cca.mjs';

// These are original input addresses, not formulas or computed-line overrides.
export const BUSINESS_INPUTS=Object.freeze({
 name:'00021:T',type:'00032:R',ownership:'00038:R',ownershipPercentage:'00040:P',numberOfPartners:'00041:I',accounting:'00046:R',fiscalStart:'00022:D',fiscalEnd:'00023:D',firstYear:'00030:R',finalYear:'00031:R',industryCode:'00035:O',service:'00036:T',businessNumber:'00037:M',partnershipNumber:'00039:M',
 unit:'00024:T',streetNumber:'00026:T',street:'00025:T',poBox:'00033:T',city:'00027:T',province:'00028:O',postalCode:'00029:A',
 sales:'00101:C',salesTaxIncluded:'00102:C',returnsAllowances:'00103:C',otherIncomeDescription:'00108:T',otherIncome:'00109:C',
 openingInventory:'00111:C',purchases:'00112:C',subcontractsForGoods:'00113:C',directWagesForGoods:'00114:C',otherGoodsCostDescription:'00115:T',otherGoodsCost:'00116:C',closingInventory:'00117:C'
});
export const BUSINESS_EXPENSES=Object.freeze({advertising:'00201:C',badDebts:'00202:C',businessTaxesLicences:'00203:C',deliveryFreight:'00205:C',fuel:'00206:C',insurance:'00207:C',interestBankCharges:'00208:C',repairs:'00209:C',managementFees:'00210:C',meals50:'00211:C',meals100:'00212:C',office:'00213:C',conventions:'00214:C',supplies:'00215:C',professionalFees:'00216:C',propertyTaxes:'00217:C',rent:'00218:C',wagesBenefits:'00219:C',travelMeals50:'00220:C',travelOther:'00221:C',utilities:'00222:C',otherDescription:'00223:T',other:'00224:C',meals80:'00226:C'});
export const BUSINESS_HOME=Object.freeze({eligible:'00401:R',carryforward:'00402:C',businessArea:'00403:I',totalArea:'00404:I',heat:'00405:C',electricity:'00406:C',insurance:'00407:C',maintenance:'00408:C',mortgageInterest:'00409:C',propertyTaxes:'00410:C',other:'00411:C',otherDescription:'00413:T'});
export const BUSINESS_CCA=Object.freeze({classNumber:'00021:O',openingUcc:'00022:C',motorVehicle:'00024:R',hasAdditions:'00025:R',hasAssetsRemaining:'00031:R',building:'00032:R',specialRate:'00033:P',homeOffice:'00038:R',disposedAll:'00040:R',claimMode:'00061:R',claimAmount:'00062:C'});
const sources=new Map();
function definitions(year){
 if(!YEARS.includes(year))throw new ApiError(400,'Choose a supported business tax year.');
 if(!sources.has(year)){
  const data=JSON.parse(gunzipSync(readFileSync(new URL(`../native-interview/${year}.json.gz`,import.meta.url))));
  const fields=new Map();
  for(const section of data.sections)for(const topic of section.topics)for(const field of topic.fields)if(/^(BUSIN|BUCCA|BUDSP|BUAGR|WBALC|WBHOM|WBINV|WBCCA):/.test(field.code))fields.set(field.code,{...field,topicId:topic.id,title:topic.title,paragraphs:topic.paragraphs});
  sources.set(year,{data,fields});
 }
 return sources.get(year);
}
export function businessCatalog(year){
 const {data,fields}=definitions(year);
 const describe=map=>Object.fromEntries(Object.entries(map).map(([name,address])=>{const code='BUSIN:'+address,field=fields.get(code);if(!field)throw new Error(`Original ${year} input not found: ${code}`);return [name,{code:code+':{business}',kind:field.kind,label:field.label,topicId:field.topicId,options:field.options?.map(({value,label})=>({value,label})),bounds:field.attrs}];}));
 return {year,sourceSha256:data.sourceSha256,evidenceId:data.evidenceId,inputs:describe(BUSINESS_INPUTS),expenses:describe(BUSINESS_EXPENSES),homeOffice:describe(BUSINESS_HOME),ccaClaim:year<=2021?{limited:{code:'BUCCA:00034:R:{business}',options:['Yes','No']},limit:{code:'BUCCA:00035:C:{business}'}}:null,ccaClasses:Object.fromEntries(Object.entries(BUSINESS_CCA).filter(([,address])=>fields.has('BUCCA:'+address)).map(([name,address])=>{const field=fields.get('BUCCA:'+address);return [name,{code:`BUCCA:${address}:{business}:{class}`,kind:field.kind,label:field.label,topicId:field.topicId,options:field.options?.map(({value,label})=>({value,label})),bounds:field.attrs}];})),ccaAdditions:additionCatalog(fields),homeOfficeClaim:{fields:Object.keys(HOME_OFFICE_CLAIM_FIELDS),description:"Explicit already-apportioned business costs; A current owner-authorized selected-treatment decision permits filing even if the separate direct eligibility flag is false. Mutually exclusive with original whole-home inputs."},inventoryAccounting:{signedCostOfGoods:true,sourceBasis:"Required explanation of source inventory accounting; accrual and original goods-cost schedule required."},enhancedCca2024:year===2024?{description:"Explicit original class50 asset eligibility records, acquisition/available-for-use dates and source basis. A current owner-authorized selected-treatment decision selects the claim for filing."}:null,limitations:['Separate agreed profit/loss percentages use the explicit Workbench allocation extension; legal ownership is preserved. This extends original GenuTax behavior and is not a claim of native application parity.','Expenses must use actual original categories. A combined deduction figure cannot be placed into an arbitrary category.','CCA classes and additions map original BUCCA interview fields, including year-specific accelerated allowances. Disposals require original BUDSP fields; a total CCA amount is not a writable override.','Business-use-of-home values are whole-home costs and original integer area ratio; engine limits deductions and carries unused amounts.']};
}
const positiveId=id=>{id=String(id);if(!/^[1-9]\d{0,3}$/.test(id))throw new ApiError(400,'Business id must be a positive integer up to9999.');return id;};
export function businesses(fields){
 const ids=[...new Set(Object.keys(fields).filter(k=>/^BUSIN:\d{5}:[A-Z]:[1-9]\d*$/.test(k)).map(k=>k.split(':')[3]))].sort((a,b)=>Number(a)-Number(b));
 const read=(map,id)=>Object.fromEntries(Object.entries(map).flatMap(([key,code])=>Object.hasOwn(fields,`BUSIN:${code}:${id}`)?[[key,fields[`BUSIN:${code}:${id}`]]]:[]));
 return ids.map(id=>({id,t5013SlipId:partnershipSlips(fields).find(s=>s.linkedBusinessId===id)?.id??null,...read(BUSINESS_INPUTS,id),allocation:fields[`WBALC:00003:B:${id}`]?{profitPercentage:fields[`WBALC:00001:P:${id}`],lossPercentage:fields[`WBALC:00002:P:${id}`],agreementConfirmed:fields[`WBALC:00003:B:${id}`]==='true'}:null,expenses:read(BUSINESS_EXPENSES,id),homeOffice:read(BUSINESS_HOME,id),homeOfficeClaim:readHomeOfficeClaim(fields,id),enhancedCca2024:readEnhancedCca2024(fields,id),inventoryAccounting:readInventoryAccounting(fields,id),ccaClaim:Object.fromEntries(Object.entries({limited:'00034:R',limit:'00035:C'}).flatMap(([name,address])=>Object.hasOwn(fields,`BUCCA:${address}:${id}`)?[[name,fields[`BUCCA:${address}:${id}`]]]:[])),ccaClasses:[...new Set(Object.keys(fields).filter(k=>k.startsWith('BUCCA:')&&k.split(':')[3]===id&&k.split(':').length===5).map(k=>k.split(':')[4]))].map(classId=>({id:classId,additions:readAdditions(fields,id,classId),...Object.fromEntries(Object.entries(BUSINESS_CCA).flatMap(([name,address])=>Object.hasOwn(fields,`BUCCA:${address}:${id}:${classId}`)?[[name,fields[`BUCCA:${address}:${id}:${classId}`]]]:[]))})),fields:Object.fromEntries(Object.entries(fields).filter(([k])=>/^(BUSIN|BUCCA|BUDSP|BUAGR|WBALC|WBHOM|WBINV|WBCCA):/.test(k)&&k.split(':')[3]===id))}));
}
function isObject(value){return value&&typeof value==='object'&&!Array.isArray(value);}
export function writeBusiness(fields,input,year){
 if(!isObject(input))throw new ApiError(400,'Provide a business object.');
 const existing=businesses(fields),id=input.id===undefined?String(Math.max(0,...existing.map(b=>Number(b.id)))+1):positiveId(input.id);
 positiveId(id);
 const prior=existing.find(b=>b.id===id),next={...fields};
 for(const key of Object.keys(input))if(!Object.hasOwn(BUSINESS_INPUTS,key)&&!['id','expectedRevision','expenses','homeOffice','ccaClasses','ccaClaim','allocation','replace','homeOfficeClaim','inventoryAccounting','enhancedCca2024'].includes(key))throw new ApiError(400,`Unknown business input: ${key}. Use original revenue, expenses and ownership; net/CCA overrides are not supported.`);
 if(input.replace===true)for(const key of Object.keys(next))if(/^(BUSIN|BUCCA|BUDSP|BUAGR|WBALC|WBHOM|WBINV|WBCCA):/.test(key)&&key.split(':')[3]===id)delete next[key];
 const {fields:defs}=definitions(year);
 const assign=(values,mapping)=>{
  if(values===undefined)return;
  if(!isObject(values))throw new ApiError(400,'Business expenses and homeOffice must be objects.');
  for(const [name,value] of Object.entries(values)){
   const address=mapping[name];if(!address)throw new ApiError(400,`Unknown business category: ${name}.`);
   const code=`BUSIN:${address}:${id}`,def=defs.get('BUSIN:'+address);
   if(!def)throw new ApiError(400,`This original input is unavailable for ${year}: ${name}.`);
   if(value===null){delete next[code];continue;}
   if(typeof value!=='string')throw new ApiError(400,`${name} must be a string; use decimal strings for amounts.`);
   if(address.endsWith(':C')&&(!/^\d+(?:\.\d{1,28})?$/.test(value)))throw new ApiError(400,`${name} requires a nonnegative decimal string.`);
   const maximum=Number(def.attrs?.MaxChars || def.attrs?.MaxLength);if(maximum&&value.length>maximum)throw new ApiError(400,`${name} exceeds the original maximum length of ${maximum}.`);
   if(['I','C','P','F'].includes(def.kind)){
    const numeric=Number(value);for(const [bound,operator] of [['MinValue','min'],['MaxValue','max']]){
     const raw=def.attrs?.[bound];if(raw===undefined||raw===''||!Number.isFinite(Number(raw)))continue;
     if((operator==='min'&&numeric<Number(raw))||(operator==='max'&&numeric>Number(raw)))throw new ApiError(400,`${name} is outside the original ${bound} of ${raw}.`);
    }
   }
   next[code]=value;
  }
 };
 assign(Object.fromEntries(Object.entries(input).filter(([k])=>Object.hasOwn(BUSINESS_INPUTS,k))),BUSINESS_INPUTS);assign(input.expenses,BUSINESS_EXPENSES);assign(input.homeOffice,BUSINESS_HOME);
 if(input.ccaClaim!==undefined){
  if(year>=2022)throw new ApiError(400,'From2022 use per-class claimMode/claimAmount instead of the older global CCA limit.');
  if(!isObject(input.ccaClaim))throw new ApiError(400,'ccaClaim must be an object.');
  for(const [key,value] of Object.entries(input.ccaClaim)){
   const address={limited:'00034:R',limit:'00035:C'}[key];if(!address)throw new ApiError(400,`Unknown CCA limit input: ${key}`);
   const code=`BUCCA:${address}:${id}`;if(value===null)delete next[code];else {if(typeof value!=='string'||(key==='limit'&&!/^\d+(?:\.\d{1,28})?$/.test(value)))throw new ApiError(400,'CCA claim limit requires a nonnegative decimal string.');next[code]=value;}
  }
 }
 if(input.ccaClasses!==undefined){
  if(!Array.isArray(input.ccaClasses)||input.ccaClasses.length>100)throw new ApiError(400,'ccaClasses must be an array of up to100 original class records.');
  const seen=new Set();
  for(const item of input.ccaClasses){
   if(!isObject(item))throw new ApiError(400,'Each CCA class must be an object.');
   const classId=positiveId(item.id);if(seen.has(classId))throw new ApiError(400,'Duplicate CCA class id.');seen.add(classId);
   for(const [key,value] of Object.entries(item)){
    if(key==='id'||key==='additions')continue;
    if(!Object.hasOwn(BUSINESS_CCA,key))throw new ApiError(400,`Unknown CCA input: ${key}. Use additions for original asset details; disposals require the original detailed interview.`);
    const address=BUSINESS_CCA[key];if(!defs.has('BUCCA:'+address))throw new ApiError(400,`CCA input ${key} is not an original option in ${year}; use the year-specific catalog.`);const code=`BUCCA:${address}:${id}:${classId}`;
    if(value===null){delete next[code];continue;}
    if(typeof value!=='string'||(address.endsWith(':C')&&!/^\d+(?:\.\d{1,28})?$/.test(value)))throw new ApiError(400,`${key} requires an original nonnegative string value.`);
    next[code]=value;
   }
   if(item.additions!==undefined)writeAdditions(next,item.additions,id,classId,defs);
   if(!next[`BUCCA:00021:O:${id}:${classId}`])throw new ApiError(400,'Each CCA class needs its original classNumber.');
  }
  if(input.ccaClasses.length)next[`BUCCA:00001:R:${id}`]='Yes';
 }
 if(input.allocation!==undefined){
  if(input.allocation===null){for(const key of Object.keys(next))if(key.startsWith('WBALC:')&&key.split(':')[3]===id)delete next[key];}
  else if(!isObject(input.allocation))throw new ApiError(400,'allocation must be an explicit agreement object or null.');
  if(input.allocation!==null){
   const a=input.allocation;
   if(a.agreementConfirmed!==true)throw new ApiError(400,'Confirm the agreed partnership allocation.');
   for(const [name,code] of [['profitPercentage','00001'],['lossPercentage','00002']]){if(typeof a[name]!=='string'||!/^\d+(?:\.\d+)?$/.test(a[name])||!(Number(a[name])>=0.0001&&Number(a[name])<=100))throw new ApiError(400,'Allocation percentages require explicit strings from0.0001 through100.');next[`WBALC:${code}:P:${id}`]=a[name];}
   next[`WBALC:00003:B:${id}`]='true';
  }
 }
 const get=address=>next[`BUSIN:${address}:${id}`];
 if(!prior||input.replace===true){for(const key of ['name','type','ownership','accounting','fiscalStart','fiscalEnd'])if(!get(BUSINESS_INPUTS[key]))throw new ApiError(400,`A new business needs an explicit ${key}.`);}
 if(get('00022:D')&&get('00023:D')){
  if(!validDate(get('00022:D'))||!validDate(get('00023:D'))||get('00022:D')>get('00023:D')||!get('00023:D').startsWith(String(year)+'-'))throw new ApiError(400,'Use a valid business fiscal period ending in the selected tax year.');
 }
 if(get('00038:R')==='PART'&&!(Number(get('00040:P'))>=0.0001&&Number(get('00040:P'))<=100))throw new ApiError(400,'Enter the actual positive partnership ownership percentage (at least0.0001 and up to100). Missing/zero makes the original engine use100%; it is not a profit/loss allocation override.');
 if(get('00401:R')==='Yes'){
  const area=get('00403:I'),total=get('00404:I');
  if(!/^\d+$/.test(area||'')||!/^\d+$/.test(total||'')||Number(area)<=0||Number(total)<=0||BigInt(area)>BigInt(total))throw new ApiError(400,'Eligible home office needs positive integer businessArea and totalArea, with business area no larger than total.');
 }
 const inventoryKeys=['openingInventory','purchases','subcontractsForGoods','directWagesForGoods','otherGoodsCost','closingInventory'];
 if(inventoryKeys.some(k=>Object.hasOwn(input,k)))next[`BUSIN:00110:R:${id}`]='Yes';
 if(input.enhancedCca2024!==undefined){for(const key of Object.keys(next))if(key.startsWith('WBCCA:')&&key.split(':')[3]===id)delete next[key];Object.assign(next,writeEnhancedCca2024(next,input.enhancedCca2024,id,year));}
 if(input.homeOfficeClaim!==undefined)Object.assign(next,writeHomeOfficeClaim(next,id,input.homeOfficeClaim));
 if(input.homeOfficeClaim===null)for(const key of Object.keys(next))if(key.startsWith('WBHOM:')&&key.split(':')[3]===id)delete next[key];
 if(input.inventoryAccounting!==undefined)Object.assign(next,writeInventoryAccounting(next,id,input.inventoryAccounting));
 if(input.inventoryAccounting===null)for(const key of Object.keys(next))if(key.startsWith('WBINV:')&&key.split(':')[3]===id)delete next[key];
 next['SELFE:00001:R']='Yes';next['BUSIN:00001:R']='Yes';
 return {fields:validateFields(next,'fields',year),businessId:id,warnings:businessIssues(next)};
}
export function removeBusiness(fields,id){
 id=positiveId(id);if(partnershipSlips(fields).some(s=>s.linkedBusinessId===id))throw new ApiError(400,'Unlink or remove the T5013 before removing its archived business.');return {fields:Object.fromEntries(Object.entries(fields).filter(([key])=>!(/^(BUSIN|BUCCA|BUDSP|BUAGR|WBALC|WBHOM|WBINV|WBCCA):/.test(key)&&key.split(':')[3]===id)))};
}
export function businessIssues(fields,{accepted=[]}={}){
 fields=partnershipEngineFields(fields);
 const acknowledged=(topic,id)=>accepted.some(r=>r.topic===topic&&r.businessId===id);
 const filtered=(prefix,topic)=>Object.fromEntries(Object.entries(fields).filter(([k])=>!k.startsWith(prefix+':')||!acknowledged(topic,k.split(':')[3])));
 const issues=[...homeOfficeClaimIssues(filtered('WBHOM','home-office')),...enhancedCca2024Issues(filtered('WBCCA','cca')),...inventoryAccountingIssues(filtered('WBINV','inventory'))];
 for(const b of businesses(fields)){
  if(b.ownership==='PART'&&!(Number(b.ownershipPercentage)>=0.0001&&Number(b.ownershipPercentage)<=100))issues.push(`Business ${b.id}: verify the actual positive partnership ownership percentage; the original engine treats missing/zero as100%.`);
  if(b.homeOffice.eligible==='Yes'&&!(Number(b.homeOffice.businessArea)>0&&Number(b.homeOffice.totalArea)>0&&Number(b.homeOffice.businessArea)<=Number(b.homeOffice.totalArea)))issues.push(`Business ${b.id}: verify the business-use-of-home area ratio before interpreting the deduction.`);
 }
 return issues;
}
