import {readFileSync} from 'node:fs';
import {ApiError} from './model.mjs';
const catalogs=JSON.parse(readFileSync(new URL('./t5013-catalog.json',import.meta.url),'utf8'));
export function t5013Catalog(year){const c=catalogs[year];if(!c)throw new ApiError(400,'T5013 year is not supported.');return {...c,numericSlotLimit:12,textSlotLimit:4};}
const k=(n,kind,id)=>`T5013:${n}:${kind}:${id}`;
const direct=['010','020','030','040'];
export function readT5013Boxes(fields,id){
 const boxes={},textBoxes={},boxCountries={},textBoxCountries={};
 for(const b of direct)if(fields[k('00'+b,'C',id)]!==undefined)boxes[b]=fields[k('00'+b,'C',id)];
 for(const [limit,codeBase,valueBase,countryBase,kind,out,countries]of [[12,10000,20000,30000,'C',boxes,boxCountries],[4,40000,50000,60000,'T',textBoxes,textBoxCountries]])for(let n=1;n<=limit;n++){
  const box=fields[k(codeBase+n,'O',id)]??fields[k(codeBase+n,'T',id)];if(!box)continue;
  out[box]=fields[k(valueBase+n,kind,id)]??'';
  if(fields[k(countryBase+n,'T',id)]!==undefined)countries[box]=fields[k(countryBase+n,'T',id)];
 }
 // Unambiguous descriptive boxes are also accepted/read through boxes.
 for(const [box,value]of Object.entries(textBoxes))if(box!=='105')boxes[box]=value;
 return {boxes,textBoxes,boxCountries,textBoxCountries};
}
export function writeT5013Boxes(next,input,id,year){
 const c=t5013Catalog(year),aliases=new Set();
 const put=(box,value,text=false)=>{
  if(typeof box!=='string'||!/^\d{1,3}$/.test(box))throw new ApiError(400,'Use numeric T5013 box codes, such as040 or115.');
  box=box.padStart(3,'0');const token=(text?'text:':'')+box;
  if(aliases.has(token))throw new ApiError(400,`T5013 box${box} was supplied through duplicate aliases.`);aliases.add(token);
  const isDirect=!text&&direct.includes(box),isText=text||(!isDirect&&!c.numericBoxes.includes(box)&&c.textBoxes.includes(box));
  if(!isDirect&&!(isText?c.textBoxes:c.numericBoxes).includes(box))throw new ApiError(400,`Box${box} is not available in the original ${year} T5013 model.`);
  if(value!==null&&typeof value!=='string')throw new ApiError(400,`Box${box} must be text or a decimal string; null explicitly removes an optional box.`);
  if(value===null&&['116','118'].includes(box))throw new ApiError(400,'Box118 is required for active-business slips and cannot be null; box116 cannot be cleared without replacing the source.');
  if(isDirect){const field=k('00'+box,'C',id);if(value===null)delete next[field];else next[field]=value;return;}
  const limit=isText?4:12,cb=isText?40000:10000,vb=isText?50000:20000,pb=isText?60000:30000,kind=isText?'T':'C';
  let country;
  for(let n=1;n<=limit;n++)if((next[k(cb+n,'O',id)]??next[k(cb+n,'T',id)])===box){country??=next[k(pb+n,'T',id)];for(const field of [k(cb+n,'O',id),k(cb+n,'T',id),k(vb+n,kind,id),k(pb+n,'T',id)])delete next[field];}
  if(value===null)return;
  const slot=Array.from({length:limit},(_,i)=>i+1).find(n=>!next[k(cb+n,'O',id)]&&!next[k(cb+n,'T',id)]);
  if(!slot)throw new ApiError(400,`Original T5013 capacity is ${limit} ${isText?'text':'numeric'} additional boxes per slip. No source was saved or silently split.`);
  next[k(cb+slot,'O',id)]=box;next[k(vb+slot,kind,id)]=value;if(country!==undefined)next[k(pb+slot,'T',id)]=country;
 };
 for(const [name,text]of [['boxes',false],['textBoxes',true]])if(input[name]!==undefined){if(!input[name]||typeof input[name]!=='object'||Array.isArray(input[name]))throw new ApiError(400,`${name} must be an object.`);for(const [box,value]of Object.entries(input[name])){
   // boxes115 and textBoxes115 refer to the same original slot.
   if(name==='textBoxes'&&box!=='105'&&Object.hasOwn(input.boxes??{},box)){if(input.boxes[box]!==value)throw new ApiError(400,`Conflicting text for box${box}.`);continue;}put(box,value,text);
 }}
 for(const [name,text]of [['boxCountries',false],['textBoxCountries',true]])if(input[name]!==undefined){if(!input[name]||typeof input[name]!=='object'||Array.isArray(input[name]))throw new ApiError(400,`${name} must be an object.`);for(let [box,value]of Object.entries(input[name])){
   box=box.padStart(3,'0');if(value!==null&&(typeof value!=='string'||! /^[A-Z]{3}$/.test(value)))throw new ApiError(400,'T5013 country codes must be three uppercase letters or null to clear.');
   const limit=text?4:12,cb=text?40000:10000,pb=text?60000:30000,slot=Array.from({length:limit},(_,i)=>i+1).find(n=>(next[k(cb+n,'O',id)]??next[k(cb+n,'T',id)])===box);
   if(!slot)throw new ApiError(400,`Country for box${box} needs its original ${text?'text':'numeric'} box entry.`);if(value===null)delete next[k(pb+slot,'T',id)];else next[k(pb+slot,'T',id)]=value;
 }}
}
