import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {t5013Catalog} from '../server/t5013-boxes.mjs';
import {writeSlip,slips} from '../server/preparation.mjs';
import {NativeEngine} from '../server/engine.mjs';
import {NativeFiling} from '../server/filing-engine.mjs';
import {financialDifferences} from '../server/snapshot.mjs';
import {renderBusinessSchedules} from '../server/business-schedules.mjs';
const source=year=>({type:'T5013',issuer:'Synthetic partnership',partnershipNumber:'123456789',fiscalEnd:`${year}-12-31`,partnerCode:'2',allocationPercentage:'99.9',legalOwnershipPercentage:'50',industryCode:'713120',accountingMethod:'1',issuedSlipConfirmed:true,sourceReference:'Synthetic issued slip',boxes:{116:'-10000',118:'15000'}});
const base=year=>({'TAXPY:00031:D':'1988-01-01','TAXPY:00011:T':'Synthetic','TAXPY:00013:T':'Filer','TAXPY:00001:S':'123 456 782','RESID:00002:O':'BC',[year>=2023?'RESID:00301:R':'RESID:00001:R']:year>=2023?'1':'Yes','MARST:00001:O':'SING','IDENT:00011:R':'CANA','IDENT:00014:T':'Example Street','IDENT:00016:T':'Prince George','IDENT:00017:O':'BC','IDENT:00018:A':'V2L 0A1','EMPIN:00001:R':'Yes','T4SLI:00010:O:1':'BC','T4SLI:00014:C:1':'60000','T4SLI:00016:C:1':'0','T4SLI:00018:C:1':'0','T4SLI:00022:C:1':'10000','T4SLI:00024:C:1':'56300','T4SLI:00026:C:1':'60000'});
test('every original yearly monetary and descriptive box has a structured round-trip, including countries and direct040',()=>{
 for(let year=2019;year<=2025;year++){
  const c=t5013Catalog(year);assert.deepEqual(c.accountingMethods,{'1':'accrual','2':'cash'});
  for(const box of [...c.directBoxes,...c.numericBoxes]){
   const input=source(year);input.boxes={...input.boxes,[box]:'12.34'};
   if(box==='114'){input.boxes['115']='Synthetic other income';if(c.fields['01104'])input.covidAssistance='0';}
   const fields=writeSlip({},input,year).fields,read=slips(fields)[0];assert.equal(read.boxes[box],'12.34',`${year}:${box}`);
   if(box==='040')assert.equal(fields['T5013:00040:C:1'],'12.34');
  }
  for(const box of c.textBoxes){const input={...source(year),textBoxes:{[box]:'Synthetic description'},textBoxCountries:{[box]:'USA'}};const fields=writeSlip({},input,year).fields,read=slips(fields)[0];assert.equal(read.textBoxes[box],'Synthetic description');assert.equal(read.textBoxCountries[box],'USA');}
 }
});
test('source edits preserve other boxes, reconcile aliases, clear optional slots, enforce capacity and validate COVID treatment',()=>{
 const input={...source(2021),boxes:{...source(2021).boxes,'040':'3000','114':'1000','115':'CEWS assistance','128':'25'},covidAssistance:'1000',boxCountries:{'128':'USA'}};
 const fields=writeSlip({},input,2021).fields;
 assert.equal(slips(fields)[0].covidAssistance,'1000');assert.equal(slips(fields)[0].boxes['040'],'3000');assert.equal(slips(fields)[0].boxes['115'],'CEWS assistance');
 const changed=writeSlip(fields,{type:'T5013',id:'1',boxes:{116:'-11000','040':null,'128':null}},2021).fields;
 assert.equal(slips(changed)[0].boxes['040'],undefined);assert.equal(slips(changed)[0].boxCountries['128'],undefined);assert.equal(slips(changed)[0].boxes['115'],'CEWS assistance');assert.equal(slips(changed)[0].boxes['114'],'1000');
 assert.throws(()=>writeSlip({}, {...source(2021),boxes:{...source(2021).boxes,'114':'1000'}},2021),/115/);
 assert.throws(()=>writeSlip({}, {...source(2021),boxes:{...source(2021).boxes,'114':'1000','115':'Ordinary'}},2021),/covidAssistance/);
 assert.throws(()=>writeSlip(fields,{type:'T5013',id:'1',covidAssistance:'1000.01'},2021),/cannot exceed/);
 assert.throws(()=>writeSlip(fields,{type:'T5013',id:'1',boxes:{'40':'1','040':'2'}},2021),/duplicate aliases/);
 assert.throws(()=>writeSlip(fields,{type:'T5013',id:'1',boxes:{'999':'1'}},2021),/not available/);
 const mixed=writeSlip(fields,{type:'T5013',id:'1',boxes:{'105':'12.34'},textBoxes:{'105':'Country classification'}},2021).fields;assert.equal(slips(mixed)[0].boxes['105'],'12.34');assert.equal(slips(mixed)[0].textBoxes['105'],'Country classification');
 const before=JSON.stringify(fields);assert.throws(()=>writeSlip(fields,{type:'T5013',id:'1',boxes:Object.fromEntries(t5013Catalog(2021).numericBoxes.filter(b=>!['114','116','118'].includes(b)).slice(0,12).map(b=>[b,'1']))},2021),/capacity/);assert.equal(JSON.stringify(fields),before);
 const plain=writeSlip({}, {...source(2021),linkedBusinessId:null,boxes:{114:'100',115:'Ordinary other income'},covidAssistance:'0'},2021).fields;assert.equal(slips(plain)[0].boxes['116'],undefined);
});
test('original engines route COVID114 to business income once, ordinary114 to other income, and preserve040 without another deduction',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'all-t5013-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const e=new NativeEngine(resolve('.'),dir),f=new NativeFiling(resolve('.'),dir);await e.initialize();await f.initialize();
 for(let year=2019;year<=2025;year++){
  const c=t5013Catalog(year),covid=!!c.fields['01104'],input={...source(year),boxes:{...source(year).boxes,'040':'3000','114':'1000','115':covid?'Synthetic COVID subsidy':'Synthetic other income'},...(covid?{covidAssistance:'1000'}:{})};
  const fields=writeSlip(base(year),input,year).fields,r=await e.calculate({year,fields}),p=await f.prepare({year,fields});
  assert.equal(r.fields['T1GEN:00135:C'],covid?'-9000.00':'-10000.00',`${year}: business income`);
  assert.equal(Number(r.fields['T1GEN:00130:C']??0),covid?0:1000,`${year}: other income`);
  assert.equal(r.fields['T1GEN:00150:C'],'51000.00',`${year}: total includes subsidy once; no second CCA deduction`);
  assert.equal(p.schemaValidated,true,JSON.stringify(p.validationErrors));assert.deepEqual(financialDifferences(r.fields,p.calculationFields),[]);
  assert.match(p.payloadXml,new RegExp('<comm:FieldCode>9946</comm:FieldCode>\\s*<comm:FieldValue>'+(covid?'-9000':'-10000')+'</comm:FieldValue>'));
  const report=renderBusinessSchedules({year,revision:1,fields,calculation:{id:'synthetic',inputRevision:1,result:r}}).html;for(const text of ['Box040','3000 CAD','Box114','Box115'])assert.ok(report.includes(text),text);
  if(year===2022){const amendedFields=writeSlip(fields,{type:'T5013',id:'1',boxes:{114:'1001'},covidAssistance:'1001'},year).fields,amendment=await f.prepare({year,mode:'refile',fields:amendedFields,baselinePayloadXml:p.payloadXml});assert.equal(amendment.schemaValidated,true,JSON.stringify(amendment.validationErrors));assert.equal(amendment.baselineSupplied,true);assert.match(amendment.payloadXml,/<comm:FieldCode>9946<\/comm:FieldCode>\s*<comm:FieldValue>-8999<\/comm:FieldValue>/);}
  if(year===2021){const fractional=writeSlip(fields,{type:'T5013',id:'1',boxes:{116:'-10000.23',114:'1000.11'},covidAssistance:'1000.11'},year).fields,fp=await f.prepare({year,fields:fractional});assert.equal(fp.schemaValidated,true,JSON.stringify(fp.validationErrors));assert.match(fp.payloadXml,/<comm:FieldCode>9946<\/comm:FieldCode>\s*<comm:FieldValue>-9000<\/comm:FieldValue>/);}
  if(covid){const ordinary=writeSlip(fields,{type:'T5013',id:'1',covidAssistance:'0'},year).fields,o=await e.calculate({year,fields:ordinary});assert.equal(o.fields['T1GEN:00135:C'],'-10000.00');assert.equal(o.fields['T1GEN:00130:C'],'1000.00');}
 }
});

test('authenticated API advertises the yearly box catalog and saves a complete corrected slip atomically',async t=>{
 const {startServer}=await import('../server/index.mjs');const dir=mkdtempSync(join(tmpdir(),'t5013-all-api-'));
 const service=await startServer({port:0,dataDir:dir,token:'synthetic',engine:{async initialize(){return{};}},filing:{async initialize(){return{};}}});t.after(async()=>{await service.close();rmSync(dir,{recursive:true,force:true});});
 const person=service.store.addPerson({name:'Synthetic filer'}),item=service.store.create({personId:person.id,year:2021,fields:base(2021)}),path=service.baseURL+`/v1/returns/${item.id}/slips`;
 const request=async(method,body)=>{const r=await fetch(path,{method,headers:{Authorization:'Bearer synthetic','Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,data:await r.json()};};
 const catalog=(await request('GET')).data.t5013Catalog;assert.ok(catalog.numericBoxes.includes('114'));assert.ok(catalog.textBoxes.includes('115'));assert.ok(catalog.directBoxes.includes('040'));assert.equal(catalog.accountingMethods['1'],'accrual');
 const saved=await request('POST',{...source(2021),expectedRevision:1,boxes:{...source(2021).boxes,'040':'3000','114':'1000','115':'Synthetic COVID subsidy'},covidAssistance:'1000'});assert.equal(saved.status,200);assert.equal(saved.data.return.revision,2);
 const read=(await request('GET')).data.slips.find(s=>s.type==='T5013');assert.equal(read.boxes['040'],'3000');assert.equal(read.textBoxes['115'],'Synthetic COVID subsidy');assert.equal(read.covidAssistance,'1000');
 const rejected=await request('POST',{type:'T5013',id:'1',expectedRevision:2,covidAssistance:'1001'});assert.equal(rejected.status,400);assert.equal(service.store.get(item.id).revision,2);assert.equal(service.store.get(item.id).fields['T5013:01104:C:1'],'1000');
});
