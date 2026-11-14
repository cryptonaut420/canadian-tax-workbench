import {Store} from '../server/store.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {writeSlip,slips,removeSlip} from '../server/preparation.mjs';
import {writeBusiness,businesses,removeBusiness,businessIssues} from '../server/business.mjs';
import {validateFields} from '../server/model.mjs';
import {partnershipEngineFields} from '../server/partnership-slips.mjs';
import {NativeEngine} from '../server/engine.mjs';
import {NativeFiling} from '../server/filing-engine.mjs';
import {financialDifferences} from '../server/snapshot.mjs';
import {renderBusinessSchedules} from '../server/business-schedules.mjs';
import {startServer} from '../server/index.mjs';

const base=year=>({'TAXPY:00031:D':'1988-01-01','TAXPY:00011:T':'Synthetic','TAXPY:00013:T':'Filer','TAXPY:00001:S':'123 456 782','RESID:00002:O':'BC',[year>=2023?'RESID:00301:R':'RESID:00001:R']:year>=2023?'1':'Yes','MARST:00001:O':'SING','IDENT:00011:R':'CANA','IDENT:00014:T':'Example Street','IDENT:00016:T':'Prince George','IDENT:00017:O':'BC','IDENT:00018:A':'V2L 0A1','EMPIN:00001:R':'Yes','T4SLI:00010:O:1':'BC','T4SLI:00014:C:1':'60000.00','T4SLI:00016:C:1':'0.00','T4SLI:00018:C:1':'0.00','T4SLI:00022:C:1':'10000.00','T4SLI:00024:C:1':'56300.00','T4SLI:00026:C:1':'60000.00'});
const business=year=>({name:'Synthetic partnership',type:'OTHR',industryCode:'713120',ownership:'PART',ownershipPercentage:'50',numberOfPartners:'2',accounting:'ACCR',fiscalStart:`${year}-01-01`,fiscalEnd:`${year}-12-31`,sales:'1000.00',expenses:{office:'11000.00'},allocation:{profitPercentage:'50',lossPercentage:'100',agreementConfirmed:true}});
const slip=year=>({type:'T5013',issuer:'Synthetic partnership',partnershipNumber:'123456789',fiscalEnd:`${year}-12-31`,partnerCode:'2',allocationPercentage:'100',industryCode:'713120',accountingMethod:'2',linkedBusinessId:'1',issuedSlipConfirmed:true,sourceReference:'Synthetic issued slip fixture',boxes:{'116':'-10000.00','118':'1000.00'}});
test('T5013 replaces linked partnership calculation once using original yearly calculations and NETFILE serialization, 2019–2025',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'partnership-slip-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const e=new NativeEngine(resolve('.'),dir),f=new NativeFiling(resolve('.'),dir);await e.initialize();await f.initialize();
 for(let year=2019;year<=2025;year++){
  const original=writeBusiness(base(year),business(year),year).fields;
  const fields=writeSlip(original,slip(year),year).fields;
  assert.equal(fields['BUSIN:00040:P:1'],'50');assert.equal(fields['WBALC:00002:P:1'],'100');
  assert.equal(businesses(fields)[0].t5013SlipId,'1');assert.deepEqual(businessIssues(fields),[]);
  const r=await e.calculate({year,fields}),p=await f.prepare({year,fields});
  assert.equal(r.fields['T1GEN:00135:C'],'-10000.00',`${year}: no second ownership/allocation multiplication`);
  assert.equal(r.fields['T1GEN:00150:C'],'50000.00',`${year}: loss counted exactly once`);
  assert.equal(Number(r.fields['T1GEN:00122:C']??0),0,`${year}: active partner not misclassified`);
  assert.equal(r.fields['BUSIN:09946:C:1'],undefined,`${year}: archived books not calculated again`);
  assert.equal(r.allocationAdjustments.length,0);assert.equal(r.partnershipSlips[0].legalOwnershipPercentage,'50');
  assert.equal(p.schemaValidated,true,`${year}: original schema`);assert.deepEqual(p.validationErrors,[]);
  assert.deepEqual(financialDifferences(r.fields,p.calculationFields),[],`${year}: snapshot/export parity`);
  const statements=p.payloadXml.match(/<sfd:BusinessActivityData>[\s\S]*?<\/sfd:BusinessActivityData>/g)??[];assert.equal(statements.length,1);
  assert.match(statements[0],/<sfd:PartnershipNumber>123456789<\/sfd:PartnershipNumber>/);
  assert.match(statements[0],/<comm:FieldCode>9946<\/comm:FieldCode>\s*<comm:FieldValue>-10000<\/comm:FieldValue>/);
  assert.ok(!statements[0].includes('<comm:FieldCode>9368</comm:FieldCode>'),'no duplicate expense claim');
  assert.ok(!p.payloadXml.includes('WBT13'));assert.ok(!r.printList.some(s=>s.startsWith('T2125FO:')),'no stale detailed business form');
  const report=renderBusinessSchedules({year,revision:1,fields,calculation:{id:'synthetic',inputRevision:1,result:r}}).html;assert.match(report,/T5013 allocated business/);assert.match(report,/-10000.00 CAD/);assert.match(report,/50%/);
  const cleaned=await e.cleanInputs({year,fields});assert.equal(cleaned.primary.fields['BUSIN:00213:C:1'],'11000.00');assert.equal(cleaned.primary.fields['WBT13:00001:I:1'],'1');assert.ok(!cleaned.primary.removedFields.some(k=>k.startsWith('WBALC:')));
  // Removing an unfiled source selection restores the preserved original books.
  const restored=removeSlip(fields,'T5013','1');assert.equal(restored['BUSIN:00040:P:1'],'50');assert.equal(restored['WBALC:00002:P:1'],'100');
  // The source amount is already allocated even in profitable years.
  const profit=writeSlip(fields,{type:'T5013',id:'1',allocationPercentage:'50',boxes:{'116':'10000.00','118':'15000.00'}},year).fields;
  const pr=await e.calculate({year,fields:profit});assert.equal(pr.fields['T1GEN:00135:C'],'10000.00');assert.equal(pr.fields['T1GEN:00150:C'],'70000.00');
 }
});
test('issued-source, identity, duplicate-business, period and source preservation safeguards',()=>{
 const original=writeBusiness(base(2021),business(2021),2021).fields;
 for(const change of [{issuedSlipConfirmed:false},{sourceReference:''},{fiscalEnd:'2020-12-31'},{partnerCode:'0'},{partnershipNumber:'123456789RZ0001'},{allocationPercentage:'101'},{boxes:{116:'-10000.001',118:'1000'}},{linkedBusinessId:null},{legalOwnershipPercentage:'100'}])assert.throws(()=>writeSlip(original,{...slip(2021),...change},2021));
 const fields=writeSlip(original,slip(2021),2021).fields;
 assert.throws(()=>writeSlip(fields,{...slip(2021),id:'2'},2021),/duplicate links|already have/);
 assert.throws(()=>removeBusiness(fields,'1'),/Unlink or remove/);
 assert.throws(()=>validateFields({...fields,'WBT13:99999:T:1':'x'},'fields',2021),/Unknown T5013/);
 assert.throws(()=>writeSlip({...original,'BUSIN:00401:R:1':'Yes'},slip(2021),2021),/partner-level/);
 assert.deepEqual(original,writeBusiness(base(2021),business(2021),2021).fields,'failed preparation did not mutate sources');
 const read=slips(fields).find(s=>s.type==='T5013');assert.equal(read.legalOwnershipPercentage,'50');assert.equal(read.boxes['116'],'-10000.00');
 assert.equal(partnershipEngineFields(fields,2021)['BUSIN:00021:T:1'],undefined);
});
test('agent API reads, edits and removes a linked slip with revision checks and current documentation',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'t5013-api-'));
 const engine={async initialize(){return{};},async calculate(){return{fields:{},lines:{}};}};
 const filing={async initialize(){return{};}};
 const service=await startServer({port:0,dataDir:dir,engine,filing,token:'synthetic'});t.after(async()=>{await service.close();rmSync(dir,{recursive:true,force:true});});
 const request=async(path,method='GET',body)=>{const r=await fetch(service.baseURL+path,{method,headers:{Authorization:'Bearer synthetic','Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return{status:r.status,data:await r.json()};};
 const person=service.store.addPerson({name:'Synthetic filer',birthDate:'1988-01-01',province:'BC',maritalStatus:'SING'});
 const original=writeBusiness(base(2021),business(2021),2021).fields;
 const item=service.store.create({personId:person.id,year:2021,fields:original});const path=`/v1/returns/${item.id}/slips`;
 const saved=await request(path,'POST',{expectedRevision:1,...slip(2021)});assert.equal(saved.status,200);assert.equal(saved.data.return.revision,2);
 assert.equal((await request(path)).data.slips.find(s=>s.type==='T5013').linkedBusinessId,'1');assert.equal((await request(path)).data.slips.find(s=>s.type==='T5013').boxes['118'],'1000.00');
 assert.equal((await request(path,'POST',{expectedRevision:1,type:'T5013',id:'1',boxes:{116:'-9999.99'}})).status,409);
 assert.equal((await request(path,'POST',{expectedRevision:2,type:'T5013',id:'1',boxes:{116:'-9999.99',118:'1000.00'}})).status,200);
 const current=(await request(path)).data;assert.equal(current.slips.find(s=>s.type==='T5013').boxes['118'],'1000.00');
 const docs=(await request('/v1/openapi.json')).data;assert.ok(docs.paths['/v1/returns/{id}/slips'].post.requestBody.content['application/json'].schema.properties.type.enum.includes('T5013'));
 assert.match((await request('/v1/agent-instructions')).data.instructions,/issued T5013|actual issued slip/i);
 const removed=await request(path,'DELETE',{expectedRevision:3,type:'T5013',id:'1'});assert.equal(removed.status,200);assert.equal(removed.data.return.fields['BUSIN:00040:P:1'],'50');assert.equal(removed.data.return.fields['WBALC:00002:P:1'],'100');
});
test('99.9% and0.1% issued loss allocations preserve50% ownership and do not reapply percentages, 2021–2025',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'t5013-fraction-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const e=new NativeEngine(resolve('.'),dir),f=new NativeFiling(resolve('.'),dir);await e.initialize();await f.initialize();
 for(let year=2021;year<=2025;year++){
  const books=writeBusiness(base(year),{...business(year),allocation:{profitPercentage:'50',lossPercentage:'99.9',agreementConfirmed:true}},year).fields;
  const fields=writeSlip(books,{...slip(year),allocationPercentage:'99.9',boxes:{116:'-9990.00',118:'1000.00'}},year).fields;
  const calculated=await e.calculate({year,fields}),prepared=await f.prepare({year,fields});
  assert.equal(calculated.fields['T1GEN:00135:C'],'-9990.00');assert.equal(calculated.fields['T1GEN:00150:C'],'50010.00');
  assert.equal(calculated.partnershipSlips[0].legalOwnershipPercentage,'50');assert.equal(calculated.partnershipSlips[0].allocationPercentage,'99.9');
  assert.match(prepared.payloadXml,/<sfd:BusinessOwnershipPercent>9990<\/sfd:BusinessOwnershipPercent>/,'native T5013 percentage is the slip allocation, not an assertion of changed equity');
  assert.equal(prepared.schemaValidated,true);assert.deepEqual(prepared.validationErrors,[]);assert.deepEqual(financialDifferences(calculated.fields,prepared.calculationFields),[]);
  const other=writeSlip(base(year),{...slip(year),linkedBusinessId:null,legalOwnershipPercentage:'50',allocationPercentage:'0.1',boxes:{116:'-10.00',118:'1.00'}},year).fields;
  const small=await e.calculate({year,fields:other}),wire=await f.prepare({year,fields:other});
  assert.equal(small.fields['T1GEN:00135:C'],'-10.00');assert.equal(wire.schemaValidated,true);assert.deepEqual(wire.validationErrors,[]);assert.match(wire.payloadXml,/<sfd:BusinessOwnershipPercent>0010<\/sfd:BusinessOwnershipPercent>/);
 }
});
test('required gross input rejects missing/null atomically and keeps explicit zero distinct across all yearly serializers',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'t5013-required-gross-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const e=new NativeEngine(resolve('.'),dir),f=new NativeFiling(resolve('.'),dir);await e.initialize();await f.initialize();
 for(let year=2019;year<=2025;year++){
  const books=writeBusiness(base(year),business(year),year).fields;
  assert.throws(()=>writeSlip(books,{...slip(year),boxes:{116:'-9990.00'}},year),/box118.*required/);
  const fields=writeSlip(books,{...slip(year),boxes:{116:'-9990.00',118:'0.00'}},year).fields;
  assert.throws(()=>writeSlip(fields,{type:'T5013',id:'1',boxes:{118:null}},year),/cannot be null/);
  const patch=writeSlip(fields,{type:'T5013',id:'1',boxes:{116:'-9989.99'}},year).fields;assert.equal(slips(patch).find(s=>s.type==='T5013').boxes['118'],'0.00','partial updates retain the explicitly supplied gross');
  const r=await e.calculate({year,fields}),p=await f.prepare({year,fields});assert.equal(p.schemaValidated,true);assert.deepEqual(p.validationErrors,[]);assert.deepEqual(financialDifferences(r.fields,p.calculationFields),[]);assert.match(p.payloadXml,/<comm:FieldCode>8299<\/comm:FieldCode>\s*<comm:FieldValue>0<\/comm:FieldValue>/);
  const legacy={...fields};for(const k of Object.keys(legacy))if(/^T5013:100\d{2}:[OT]:1$/.test(k)&&legacy[k]==='118'){delete legacy[k.replace('100','200').replace(/:[OT]:/,':C:')];delete legacy[k];}
  assert.throws(()=>validateFields(legacy,'fields',year),/box118.*required/);
  const blocked=await f.prepare({year,fields:legacy});assert.equal(blocked.schemaValidated,false);assert.ok(blocked.validationErrors.some(s=>s.includes('box118')&&s.includes('required')));assert.equal(blocked.payloadXml,null,'no $1 placeholder or absent-gross filing payload is emitted');
 }
});
test('duplicate active-business boxes and unrepresentable allocation precision are rejected without changing source inputs',()=>{
 const fields=writeSlip(writeBusiness(base(2021),business(2021),2021).fields,slip(2021),2021).fields;
 assert.throws(()=>validateFields({...fields,'T5013:10003:O:1':'116','T5013:20003:C:1':'-10000.00'},'fields',2021),/duplicate box116/);
 assert.throws(()=>writeSlip(fields,{type:'T5013',id:'1',allocationPercentage:'99.999'},2021),/two meaningful decimal/);
 assert.throws(()=>writeSlip(fields,{type:'T5013',id:'1',allocationPercentage:'0.000001'},2021),/two meaningful decimal/);
 assert.equal(slips(writeSlip(fields,{type:'T5013',id:'1',allocationPercentage:'99.9000'},2021).fields).find(s=>s.type==='T5013').allocationPercentage,'99.9000');
 assert.equal(slips(fields).find(s=>s.type==='T5013').boxes['116'],'-10000.00');
});
test('legacy incomplete slips remain readable and repairable, with a filing issue instead of a GET failure',t=>{
 const s=new Store(':memory:');t.after(()=>s.close());const p=s.addPerson({name:'Synthetic legacy'});const fields=writeSlip(writeBusiness(base(2021),business(2021),2021).fields,slip(2021),2021).fields;const r=s.create({personId:p.id,year:2021,fields});
 const legacy={...fields};delete legacy['T5013:10002:O:1'];delete legacy['T5013:20002:C:1'];s.db.prepare('UPDATE returns SET fields=? WHERE id=?').run(JSON.stringify(legacy),r.id);
 const read=s.get(r.id);assert.ok(read.filingInputIssues.some(s=>s.includes('required box118')));assert.equal(read.fields['BUSIN:00213:C:1'],'11000.00');
 const fixed=writeSlip(read.fields,{type:'T5013',id:'1',boxes:{118:'1234.56'}},2021);const updated=s.update(r.id,{expectedRevision:read.revision,fields:fixed.fields});assert.ok(!updated.filingInputIssues.some(s=>s.includes('required box118')));assert.equal(slips(updated.fields).find(s=>s.type==='T5013').boxes['118'],'1234.56');const partial=s.patch(r.id,{expectedRevision:updated.revision,set:{'T5013:10001:O:1':'116','T5013:20001:C:1':'-9900.00'}});assert.equal(slips(partial.fields).find(s=>s.type==='T5013').boxes['118'],'1234.56');
});
test('native filing independently blocks duplicate source slots and lossy allocation precision',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'t5013-native-guard-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const f=new NativeFiling(resolve('.'),dir);await f.initialize();const fields=writeSlip(writeBusiness(base(2021),business(2021),2021).fields,slip(2021),2021).fields;
 for(const [extra,message]of [[{'T5013:10003:O:1':'116','T5013:20003:C:1':'-10000.00'},'duplicate box116'],[{'T5013:00005:P:1':'99.999'},'two meaningful decimal']]){const p=await f.prepare({year:2021,fields:{...fields,...extra}});assert.equal(p.schemaValidated,false);assert.equal(p.payloadXml,null);assert.ok(p.validationErrors.some(s=>s.includes(message)));}
});
