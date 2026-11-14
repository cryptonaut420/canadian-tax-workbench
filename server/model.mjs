import {validatePartnershipSlips,partnershipSlipIssues} from './partnership-slips.mjs';
import {validateEnhancedCca2024} from './enhanced-cca.mjs';
import {validateHomeOfficeClaims} from './home-office.mjs';
import {validateInventoryAccounting} from './inventory.mjs';
import {isValidSin} from './identity.mjs';
export const YEARS = [2019, 2020, 2021, 2022, 2023, 2024, 2025];
export const PROVINCES = ['AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'QC', 'SK', 'YT'];
export const MARITAL_STATUSES = ['MARR','COLA','WIDO','DIVO','SEPA','SING'];
export const PERSONAL_DETAIL_FIELDS = Object.freeze({
  netfileAccessCode:'FILIN:99931:M',sin:'TAXPY:00001:S',firstName:'TAXPY:00011:T',middleName:'TAXPY:00012:T',lastName:'TAXPY:00013:T',
  addressCountry:'IDENT:00011:R',addressUnit:'IDENT:00012:T',streetNumber:'IDENT:00013:T',streetName:'IDENT:00014:T',
  poBox:'IDENT:00015:T',city:'IDENT:00016:T',mailingProvince:'IDENT:00017:O',postalCode:'IDENT:00018:A',careOf:'IDENT:00020:T'
});
export function personalDetails(input, current = {}) {
  const next={};
  for(const key of Object.keys(PERSONAL_DETAIL_FIELDS)) {
    const value=input[key]===undefined?current[key]:input[key];
    if(value===undefined || value===null || value===''){next[key]='';continue;}
    if(typeof value!=='string' || value.length>160 || /[\x00-\x1f]/.test(value))throw new ApiError(400,`${key} must be text of at most 160 characters.`);
    next[key]=value.trim();
  }
  if(next.netfileAccessCode&&!/^[A-Za-z0-9]{8}$/.test(next.netfileAccessCode))throw new ApiError(400,'NETFILE access code must contain exactly eight letters or digits, or be blank.');
  if(next.sin && !isValidSin(next.sin))throw new ApiError(400,'Check the profile SIN: its format or checksum is invalid.');
  if(next.addressCountry && !['CANA','USAM','OTHE'].includes(next.addressCountry))throw new ApiError(400,'Select a valid mailing address country.');
  if(next.mailingProvince && !PROVINCES.includes(next.mailingProvince))throw new ApiError(400,'Select a valid mailing province.');
  return next;
}

export const FIELD_CODE = /^[A-Z0-9]{5}:[0-9]{5}:[A-Z](?::[A-Za-z0-9_-]+)*$/;
export class ApiError extends Error {
  constructor(status, message, details) { super(message); this.status = status; this.details = details; }
}
export function requireText(value, label, limit = 160) {
  if (typeof value !== 'string' || !value.trim() || value.length > limit) throw new ApiError(400, `${label} must be a nonempty string of at most ${limit} characters.`);
  return value.trim();
}
export function validateFields(fields, label = 'fields', year) {
  if (!fields || typeof fields !== 'object' || Array.isArray(fields) || Object.keys(fields).length > 10000) throw new ApiError(400, `${label} must be an object with at most 10000 field values.`);
  const aliases=new Set();
  for (const [key, value] of Object.entries(fields)) {
    if (!FIELD_CODE.test(key) || key.startsWith('METAD:')) throw new ApiError(400, `Invalid or reserved field code: ${key}`);
    if (typeof value !== 'string' || value.length > 10000) throw new ApiError(400, `Field ${key} must be a string. Submit monetary values as decimal strings.`);
    const kind = key.split(':')[2];
    const parts=key.split(':'),identity=[parts[0],parts[1],...parts.slice(3)].join(':');
    if(aliases.has(identity))throw new ApiError(400,`Conflicting type aliases for ${identity}. Use one original field type per field.`);aliases.add(identity);
    if (kind === 'C' && !/^-?\d+(?:\.\d{1,28})?$/.test(value)) throw new ApiError(400, `Field ${key} requires a decimal string, such as "3166.45".`);
    if(kind==='C') {const normalized=value.includes('.')?value.replace(/0+$/,'').replace(/\.$/,''):value;const digits=normalized.replace('-','').replace('.','').replace(/^0+/,'') || '0';if(BigInt(digits)>79228162514264337593543950335n)throw new ApiError(400,`Field ${key} exceeds the exact .NET decimal range.`);}
    if (kind === 'I' && !/^-?\d+$/.test(value)) throw new ApiError(400, `Field ${key} requires an integer string.`);
    if(kind==='I' && (BigInt(value)<-2147483648n || BigInt(value)>2147483647n))throw new ApiError(400,`Field ${key} exceeds the 32-bit integer range.`);
    if (kind === 'B' && !['true', 'false'].includes(value)) throw new ApiError(400, `Field ${key} requires "true" or "false".`);
    if (kind === 'D' && !validDate(value)) throw new ApiError(400, `Field ${key} requires a valid YYYY-MM-DD date.`);
    if (['F','P'].includes(kind) && (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value) || !Number.isFinite(Number(value)))) throw new ApiError(400, `Field ${key} requires a finite numeric string.`);
    if(year){
      const registry=sourceRegistry(year),base=parts.slice(0,2).join(':')+'|'+(parts.length-3),expected=registry.originalKinds.get(base) || registry.kinds.get(base);
      const family=k=>['F','P'].includes(k)?'double':['C','I','D','B'].includes(k)?k:'string';
      if(expected && new Set([...expected].map(family)).size===1 && ![...expected].some(k=>family(k)===family(kind)))throw new ApiError(400,`Field ${key} has the wrong storage type. Use original type ${[...expected].join('/')}; wrong types can silently calculate as zero.`);
      const choices=registry.enums.get(base);if(choices && value!=='' && !choices.has(value))throw new ApiError(400,`Field ${key} must use an original option value: ${[...choices].join(', ')}.`);
    }
    if(['F','P'].includes(kind) && isPercentage(key,year) && Number(value)>100)throw new ApiError(400,`Field ${key} exceeds the original percentage editor’s maximum of100.`);
  }
  validatePartnershipSlips(fields,year,{requireGross:year!==undefined});
  const allocations=[...new Set(Object.keys(fields).filter(k=>k.startsWith('WBALC:')).map(k=>k.split(':')[3]))];
  for(const key of Object.keys(fields).filter(k=>k.startsWith('WBALC:'))){
    if(!/^WBALC:(?:0000[12]:P|00003:B):[1-9]\d{0,3}$/.test(key))throw new ApiError(400,'Unknown Workbench allocation control.');
    if(key.split(':')[2]==='P' && !(Number(fields[key])>=0.0001&&Number(fields[key])<=100))throw new ApiError(400,'Explicit allocation percentages must be from0.0001 through100.');
  }
  if(year)for(const id of allocations){
    if(fields[`WBALC:00003:B:${id}`]!=='true'||!fields[`WBALC:00001:P:${id}`]||!fields[`WBALC:00002:P:${id}`])throw new ApiError(400,'Confirm the agreed profit and loss allocation percentages explicitly.');
    if(fields[`BUSIN:00038:R:${id}`]!=='PART'||!(Number(fields[`BUSIN:00040:P:${id}`])>=0.0001))throw new ApiError(400,'Separate allocation requires a partnership and its actual ownership percentage.');
  }
  if(year){validateEnhancedCca2024(fields,year);validateHomeOfficeClaims(fields);validateInventoryAccounting(fields);}
  return Object.fromEntries(Object.entries(fields).map(([code,value])=>{
    if(code.split(':')[2]==='S' && /^\d{9}$/.test(value.replace(/[ -]/g,'')))value=value.replace(/[ -]/g,'').replace(/(\d{3})(\d{3})(\d{3})/,'$1 $2 $3');
    if(code.split(':')[2]==='A' && /^[a-z]\d[a-z] ?\d[a-z]\d$/i.test(value))value=value.replace(/ /g,'').toUpperCase().replace(/^(.{3})(.{3})$/,'$1 $2');
    return [code,value];
  }));
}
export function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  if(Number(value.slice(0,4))<1)return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function profileFields(person, year = 2021) {
  return { ...Object.fromEntries(Object.entries(PERSONAL_DETAIL_FIELDS).filter(([key])=>person[key]&&(key!=='netfileAccessCode'||year>=2020)).map(([key,code])=>[code,person[key]])), ...(person.birthDate ? { 'TAXPY:00031:D': person.birthDate } : {}),
    ...(person.maritalStatus ? {'MARST:00001:O':person.maritalStatus} : {}),
    ...(year >= 2023 ? (person.residency === 'No' ? {} : { 'RESID:00301:R':'1' }) : { 'RESID:00001:R':person.residency || 'Yes' }),
    ...(person.province ? { 'RESID:00002:O': person.province } : {}) };
}
export function preparationIssues(fields, year = 2021, spouseFields = null, pairedScope = false) {
  const issues = [];
  if (!fields['TAXPY:00031:D']) issues.push('Add the taxpayer’s birth date before interpreting age-dependent calculations.');
  else if(fields['TAXPY:00031:D']>`${year}-12-31`)issues.push('The taxpayer’s birth date is after this tax year. Correct the date before interpreting age-dependent calculations.');
  if (!fields['RESID:00002:O']) issues.push('Add the year-end province before interpreting provincial calculations.');
  if (year >= 2023) {
    if (!['1','2','3','4','5','6','7'].includes(fields['RESID:00301:R'])) issues.push('Specify this year’s residency scenario. For 2023 onward, the older Yes/No residency field does not supply current-year residency.');
    else if (fields['RESID:00301:R'] !== '1') issues.push('Verify the advanced residency scenario and its supporting fields; this interface currently verifies full-year Canadian residency only.');
  } else if (!['Yes', 'No'].includes(fields['RESID:00001:R'])) issues.push('Specify Canadian residency before interpreting the calculation.');
  if (!MARITAL_STATUSES.includes(fields['MARST:00001:O'])) issues.push('Specify marital status at the end of this tax year.');
  if (['MARR','COLA'].includes(fields['MARST:00001:O']) && !spouseFields && !Object.hasOwn(fields,'SPOUS:00051:C')) issues.push('Add the spouse’s net income (line 23600), or provide the paired spouse’s return inputs. Missing income must not be treated as a confirmed zero.');
  const hasT5ForeignTax = Object.entries(fields).some(([key,value]) => /^T5SLI:00016:C:\w+$/.test(key) && Number(value) > 0)
    || Object.entries(fields).some(([key,value]) => /^T5SLI:1000[123]:O:\w+$/.test(key) && value === '16' && Number(fields[key.replace(/1000([123]):O/, '2000$1:C')]) > 0);
  const foreignClaims = Object.entries(fields).filter(([key,value]) => /^FORTX:00025:C:\w+$/.test(key) && Number(value) > 0);
  if (hasT5ForeignTax && year<=2021 && (fields['FORTX:00001:R'] !== 'Yes' || !foreignClaims.length)) issues.push('T5 foreign tax is present. Review the separate foreign tax credit claim; entering the slip alone does not apply the credit.');
  if (hasT5ForeignTax && year>=2022 && fields['FORTR:00001:R']!=='Yes') issues.push('T5 foreign tax is present. Review the foreign-tax questions for this year. The original engine aggregates slip amounts automatically; do not enter those amounts again as additional foreign income or tax.');
  if(hasT5ForeignTax && year>=2022 && fields['FORTR:00001:R']==='Yes' && fields['FORTR:00032:R']!=='Yes' && !fields['FORTR:01201:T']?.trim())issues.push('Enter the pooled foreign-income country description. The original interview permits an explicit unknown when the source country is not known.');
  for (const [key] of year<=2021?foreignClaims:[]) {
    const index = key.split(':')[3];
    if (!fields[`FORTX:00021:T:${index}`]?.trim()) issues.push(`Verify the source country for foreign tax credit entry ${index}.`);
    if (!Object.hasOwn(fields, `FORTX:00023:C:${index}`)) issues.push(`Add net foreign non-business income for foreign tax credit entry ${index}.`);
  }
  const t4eIds=[...new Set(Object.keys(fields).filter(k=>k.startsWith('T4ESL:')).map(k=>k.split(':')[3]).filter(Boolean))];
  for(const id of t4eIds){
    const total=Number(fields[`T4ESL:00014:C:${id}`] || 0);
    if(total>0&&!Object.hasOwn(fields,`T4ESL:00007:P:${id}`))issues.push(`T4E ${id}: enter the repayment rate from box 7; do not assume zero.`);
    const included=Object.entries(fields).filter(([k,v])=>/^T4ESL:1000[1-6]:O:/.test(k)&&k.split(':')[3]===id&&['36','37'].includes(v)).reduce((sum,[k])=>sum+Number(fields[k.replace(':1000',':2000').replace(':O:',':C:')] || 0),0);
    if(included>total)issues.push(`T4E ${id}: benefits in boxes 36 and 37 are included in box 14 and cannot exceed that total.`);
  }
  if(Object.entries(fields).some(([k,v])=>/^RRSPD:0022[45]:C:\d+$/.test(k)&&Number(v)>0)&&!Object.hasOwn(fields,'CARRY:00001:C'))issues.push('Verify the RRSP deduction limit from CRA records. Contribution receipts alone do not establish available deduction room.');
  if (spouseFields !== null && !pairedScope) {
    issues.push(...preparationIssues(spouseFields,year,fields,true).map(issue=>`Paired spouse: ${issue}`));
    if (fields['RESID:00002:O'] && spouseFields['RESID:00002:O'] && fields['RESID:00002:O']!==spouseFields['RESID:00002:O']) issues.push('Paired returns require the same year-end province. Prepare separately with verified spouse net income when provinces differ.');
  }
  return issues;
}
export function summary(result) {
  const fields = result?.fields || {};
  const lines = result?.lines || {};
  const get = (line, raw) => lines[line] || fields[raw] || null;
  return {
    income: get('15000', 'T1GEN:00150:C'), netIncome: get('23600', 'T1GEN:00236:C'),
    taxableIncome: get('26000', 'T1GEN:00260:C'), cppCredit: get('30800', 'SCH01:00308:C'),
    enhancedCpp: get('22215', 'T1GEN:22215:C'), federalTax: get('42000', 'T1GEN:00420:C'),
    provincialTax: get('42800', 'T1GEN:00428:C'), totalPayable: get('43500', 'T1GEN:00435:C'),
    withheld: get('43700', 'T1GEN:00437:C'), refund: get('48400', 'T1GEN:00484:C'),
    owing: get('48500', 'T1GEN:00485:C')
  };
}
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {gunzipSync} from 'node:zlib';
const sourceRegistries=new Map();
function sourceRegistry(year){
 if(!sourceRegistries.has(year)){
  const kinds=new Map(),enums=new Map(),originalKinds=new Map();
  const add=(map,id,kind)=>{if(!map.has(id))map.set(id,new Set());map.get(id).add(kind);};
  const literals=JSON.parse(readFileSync(fileURLToPath(new URL(`../research/${year}/field-codes.json`,import.meta.url)),'utf8'));
  for(const code of literals){const p=code.split(':');add(kinds,p.slice(0,2).join(':')+'|'+Math.max(0,p.length-3),p[2]);}
  const interview=JSON.parse(gunzipSync(readFileSync(fileURLToPath(new URL(`../native-interview/${year}.json.gz`,import.meta.url)))));
  for(const section of interview.sections)for(const topic of section.topics)for(const field of topic.fields){const id=field.code.split(':').slice(0,2).join(':')+'|'+Number(field.loopDepth || 0);add(originalKinds,id,field.kind);
   if(['R','O'].includes(field.kind) && field.options?.length && field.options.every(o=>typeof o.value==='string'&&!o.value.includes('['))){if(!enums.has(id))enums.set(id,new Set());for(const o of field.options)enums.get(id).add(o.value);}
  }
  sourceRegistries.set(year,{kinds,originalKinds,enums});
 }
 return sourceRegistries.get(year);
}
function isPercentage(code,year){return code.split(':')[2]==='P' || !!(year && sourceRegistry(year).kinds.get(code.split(':').slice(0,2).join(':')+'|'+(code.split(':').length-3))?.has('P'));}


// Completeness of ordinary filing identity, separate from draft calculation.
export function filingInputIssues(fields,year){
 const issues=[...partnershipSlipIssues(fields)];const required=(code,message)=>{if(!fields[code]?.trim())issues.push(message);};
 required('TAXPY:00011:T','Add the taxpayer’s legal first name.');required('TAXPY:00013:T','Add the taxpayer’s legal last name.');
 if(!fields['TAXPY:00001:S'])issues.push('Add the taxpayer’s SIN before filing.');else if(!isValidSin(fields['TAXPY:00001:S']))issues.push('Check the taxpayer’s SIN: its format or checksum is invalid.');
 required('IDENT:00011:R','Select the mailing-address country.');
 if(!fields['IDENT:00011:R']||fields['IDENT:00011:R']==='CANA'){
  if(!fields['IDENT:00014:T']?.trim()&&!fields['IDENT:00015:T']?.trim())issues.push('Add the mailing street or P.O. box.');
  required('IDENT:00016:T','Add the mailing city.');required('IDENT:00017:O','Select the mailing province.');
  if(!/^[A-Z]\d[A-Z] ?\d[A-Z]\d$/i.test(fields['IDENT:00018:A'] || ''))issues.push('Add a valid Canadian mailing postal code.');
 }
 if(!['Yes','No'].includes(fields['FILIN:99903:R']))issues.push('Answer whether this is the taxpayer’s first-ever return; this is separate from a new return for this year.');
 if(fields['SPOUS:00001:S'] && !isValidSin(fields['SPOUS:00001:S']))issues.push('Check the spouse’s SIN: its format or checksum is invalid. If it is unknown, leave it blank rather than inventing a number.');
 for(const [code,name] of Object.entries(fields))if(/^BUSIN:00021:T:[1-9]\d{0,3}$/.test(code)&&name.trim()){
  const id=code.split(':')[3],industry=fields[`BUSIN:00035:O:${id}`];
  if(!/^[1-9][0-9]{5}$/.test(industry||''))issues.push(`Business ${id} (${name}): enter the current six-digit NAICS industry code before filing. Missing or placeholder codes are rejected by CRA.`);
 }
 const nac=fields['FILIN:99931:M'];if(year>=2020&&fields['FILIN:99903:R']==='No'&&nac&&!/^[A-Za-z0-9]{8}$/.test(nac))issues.push('The optional NETFILE access code must contain eight letters or digits.');
 return issues;
}
