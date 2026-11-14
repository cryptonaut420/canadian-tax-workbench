import test from 'node:test';import assert from 'node:assert/strict';import {mkdtempSync,rmSync}from'node:fs';import{tmpdir}from'node:os';import{join,resolve}from'node:path';
import{NativeFiling}from'../server/filing-engine.mjs';import{filingAvailability,assertFilingAvailable}from'../server/filing-availability.mjs';
import{Store}from'../server/store.mjs';import{amendmentReview}from'../server/amendment-review.mjs';import{startServer}from'../server/index.mjs';
const fields={'TAXPY:00001:S':'123 456 782','TAXPY:00031:D':'1988-01-01','TAXPY:00011:T':'Synthetic','TAXPY:00013:T':'Filer','MARST:00001:O':'MARR','SPOUS:00001:S':'987 654 321','SPOUS:00031:D':'1987-01-01','SPOUS:00011:T':'Synthetic spouse','SPOUS:00051:C':'50000.00','RESID:00001:R':'Yes','RESID:00002:O':'BC','IDENT:00011:R':'CANA','IDENT:00014:T':'Example Street','IDENT:00016:T':'Prince George','IDENT:00017:O':'BC','IDENT:00018:A':'V2L 0A1','T4SLI:00010:O:1':'BC','T4SLI:00014:C:1':'60000.00','T4SLI:00022:C:1':'10000.00'};
test('spouse-only changes are present in original ReFILE XML even when the tax-line difference list is empty',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'spouse-amend-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const n=new NativeFiling(resolve('.'),dir);await n.initialize();
 for(let year=2022;year<=2025;year++){
  const source={...fields,...(year>=2023?{'RESID:00301:R':'1'}:{})},base=await n.prepare({year,fields:source});assert.equal(base.schemaValidated,true);
  const changed={...source,'SPOUS:00051:C':'50123.45'},r=await n.prepare({year,mode:'refile',fields:changed,baselinePayloadXml:base.payloadXml});
  assert.equal(r.schemaValidated,true);assert.deepEqual(r.validationErrors,[]);assert.equal(r.baselineSupplied,true);assert.match(r.payloadXml,/<tp:SpouseNetIncomeAmount>50123<\/tp:SpouseNetIncomeAmount>/);assert.match(r.payloadXml,/<comm:SoftwareID>113S<\/comm:SoftwareID>/);
  assert.equal(r.calculationFields['SPOUS:00051:C'],'50123.45','full cents retained in preparation; whole-dollar XML follows the original serializer');
  const again=await n.prepare({year,mode:'refile',fields:{...changed,'SPOUS:00051:C':'50234.56'},baselinePayloadXml:r.payloadXml});assert.equal(again.schemaValidated,true);assert.deepEqual(again.validationErrors,[]);assert.match(again.payloadXml,/<tp:SpouseNetIncomeAmount>50235<\/tp:SpouseNetIncomeAmount>/);
 }
});
test('current service window permits initial2021 and amendments2022–2025, without treating2021 as another initial filing',()=>{
 assert.equal(filingAvailability(2021,'netfile').supported,true);assert.equal(filingAvailability(2021,'refile').supported,false);assert.throws(()=>assertFilingAvailable(2021,'refile'),/Change my return/);for(let year=2022;year<=2025;year++)assert.equal(assertFilingAvailable(year,'refile').supported,true);
});
test('amendment comparison retains filed spouse income and receipt when new source changes leave headline tax unchanged',t=>{
 const s=new Store(':memory:');t.after(()=>s.close());const p=s.addPerson({name:'Synthetic filer',birthDate:'1988-01-01',province:'BC',maritalStatus:'MARR'});
 let r=s.create({personId:p.id,year:2022,fields:{'SPOUS:00051:C':'50000.00'}});const result={fields:{'T1GEN:00150:C':'60000.00','T1GEN:00484:C':'100.00'},lines:{'15000':'60000.00','48400':'100.00'}};r=s.saveCalculation(r.id,1,result);
 s.db.prepare('INSERT INTO submission_plans VALUES(?,?,?,?,?,?,?,?,?,?)').run('p',r.id,r.calculation.id,1,'netfile','2099-01-01','{}','<synthetic accepted request/>',null,'2026-01-01T00:00:00Z');
 s.db.prepare('INSERT INTO submissions(id,return_id,calculation_id,input_revision,mode,status,requested_at,completed_at,confirmation_number,payload_hash,actor,idempotency_key,plan_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run('a',r.id,r.calculation.id,1,'netfile','accepted','2026-01-01T00:00:00Z','2026-01-01T00:00:01Z','SYNTHETIC','hash','test','key','p');
 const changed=s.update(r.id,{expectedRevision:1,fields:{...r.fields,'SPOUS:00051:C':'50123.45'}});s.saveCalculation(r.id,changed.revision,result);
 const review=amendmentReview(s,r.id);assert.deepEqual(review.spouseNetIncome,{field:'SPOUS:00051:C',filed:'50000.00',current:'50123.45'});assert.equal(review.filedTotals.refund,review.currentTotals.refund);assert.ok(review.sourceChanges.some(c=>c.field==='SPOUS:00051:C'));assert.equal(review.accepted.confirmationNumber,'SYNTHETIC');assert.equal(review.availability.supported,true);assert.equal(s.submissions.acceptedPayload(r.id),'<synthetic accepted request/>');assert.equal(s.submissions.state(r.id).mode,'refile');
});
test('unsupported amendment requests fail before terms, IP detection or serializer calls',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'refile-window-'));let prepares=0,terms=0,ip=0;
 const engine={async initialize(){return{};},async calculate(){return{fields:{},lines:{}};}},filing={async initialize(){return{liveReady:true};},async prepare(){prepares++;return{};},async fetchTerms(){terms++;return{};}};
 const service=await startServer({port:0,dataDir:dir,token:'synthetic',engine,filing,publicIPDetector:async()=>{ip++;return{originatingIP:'8.8.8.8'};}});t.after(async()=>{await service.close();rmSync(dir,{recursive:true,force:true});});
 const p=service.store.addPerson({name:'Synthetic older amendment'});let r=service.store.create({personId:p.id,year:2021,filingMode:'refile'});r=service.store.saveCalculation(r.id,1,{fields:{},lines:{}});
 for(const action of ['validate','prepare-submission']){const res=await fetch(`${service.baseURL}/v1/returns/${r.id}/${action}`,{method:'POST',headers:{Authorization:'Bearer synthetic','Content-Type':'application/json'},body:JSON.stringify({expectedRevision:r.revision,calculationId:r.calculation.id,mode:'refile'})});assert.equal(res.status,422);assert.match((await res.json()).error,/Change my return/);}
 assert.equal(prepares,0);assert.equal(terms,0);assert.equal(ip,0);
});
