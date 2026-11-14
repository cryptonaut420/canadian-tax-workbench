import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Store } from '../server/store.mjs';
import { startServer } from '../server/index.mjs';
import { NativeEngine } from '../server/engine.mjs';
import { summary, preparationIssues } from '../server/model.mjs';

const fixture = { 'T4SLI:00010:O:1':'BC', 'T4SLI:00014:C:1':'60000.00', 'T4SLI:00016:C:1':'2900.00', 'T4SLI:00018:C:1':'889.54', 'T4SLI:00022:C:1':'10000.00', 'T4SLI:00024:C:1':'56300.00', 'T4SLI:00026:C:1':'60000.00' };
function temporary(t) { const dir = mkdtempSync(join(tmpdir(), 'tax-workbench-test-')); t.after(() => rmSync(dir, { recursive:true, force:true })); return dir; }
const fakeEngine = { async initialize() { return { runtime:'test', wineRequired:false, engines:[] }; }, async calculate(input) { return { year:input.year, fields:{ 'T1GEN:00150:C':'60000.00','T1GEN:00484:C':'100.00' }, lines:{}, engineSha256:'test', filingReady:false, parityVerified:false }; } };

test('atomic multi-year batch, revision conflicts, review invalidation, and persistence', t => {
  const dir=temporary(t), path=join(dir,'test.sqlite'), store=new Store(path);
  const person=store.addPerson({name:'Synthetic filer',birthDate:'1988-01-01',province:'BC',maritalStatus:'SING'});
  const returns=store.batch({returns:[2020,2021,2022].map(year=>({personId:person.id,year,fields:fixture}))},'test-agent');
  assert.equal(returns.length,3); assert.equal(returns[1].fields['TAXPY:00031:D'],'1988-01-01');
  assert.throws(()=>store.batch({returns:[{personId:person.id,year:2023,fields:{}},{personId:person.id,year:2021,fields:{}}]},'test-agent'),/already has/);
  assert.equal(store.list().length,3,'failed batch must roll back its earlier insert');
  const item=returns[1];
  assert.throws(()=>store.update(item.id,{expectedRevision:0,fields:fixture}),/changed/);
  const calculated=store.saveCalculation(item.id,1,{fields:{'T1GEN:00484:C':'100.00'},lines:{}});
  const reviewed=store.review(item.id,{expectedRevision:1,calculationId:calculated.calculation.id},'human');
  assert.equal(reviewed.state,'reviewed');assert.equal(reviewed.filingReady,false);
  const updated=store.transaction(()=>store.update(item.id,{expectedRevision:1,fields:{...item.fields,'T4SLI:00014:C:1':'61000.00'}},'test-agent'));
  assert.equal(updated.revision,2);assert.equal(updated.state,'draft');assert.equal(updated.calculation,null);
  assert.throws(()=>store.saveCalculation(item.id,1,{fields:{},lines:{}}),/Inputs changed/);
  assert.equal(store.history(item.id).calculations.length,1,'previous snapshot remains in history');
  store.close();const reopened=new Store(path);assert.equal(reopened.get(item.id).revision,2);assert.equal(reopened.history(item.id).revisions.length,2);reopened.close();
});

test('HTTP authentication, input types, batch API, immutable calculation/review flow', async t => {
  const dir=temporary(t), service=await startServer({dataDir:dir,port:0,token:'test-token',engine:fakeEngine});t.after(()=>service.close());
  async function request(path,method='GET',body,auth=true,extra={}){const response=await fetch(service.baseURL+path,{method,headers:{...(auth?{Authorization:'Bearer test-token'}:{}),'Content-Type':'application/json',...extra},body:body===undefined?undefined:JSON.stringify(body)});return {status:response.status,data:await response.json()};}
  assert.equal((await request('/v1/workspace','GET',undefined,false)).status,401);
  assert.equal((await request('/v1/workspace','GET',undefined,true,{Origin:'https://unrelated.example'})).status,403);
  const person=(await request('/v1/people','POST',{name:'Test person',birthDate:'1988-01-01',province:'BC',maritalStatus:'SING'})).data;
  assert.equal((await request('/v1/returns','POST',{personId:person.id,year:2021,fields:{'T4SLI:00014:C:1':60000}})).status,400);
  const response=await request('/v1/returns/batch','POST',{returns:[{personId:person.id,year:2021,fields:fixture}]});assert.equal(response.status,200);const item=response.data.returns[0];
  assert.equal((await request(`/v1/returns/${item.id}/calculate`,'POST',{expectedRevision:0})).status,409);
  const result=await request(`/v1/returns/${item.id}/calculate`,'POST',{expectedRevision:1});assert.equal(result.status,200);assert.equal(result.data.summary.refund,'100.00');
  const review=await request(`/v1/returns/${item.id}/review`,'POST',{expectedRevision:1,calculationId:result.data.calculation.id});assert.equal(review.data.state,'reviewed');
  const update=await request(`/v1/returns/${item.id}`,'PUT',{expectedRevision:1,fields:{...item.fields,'T4SLI:00014:C:1':'61000.00'}});assert.equal(update.data.state,'draft');
  assert.equal((await request(`/v1/returns/${item.id}/submit`,'POST',{})).status,409);
  const contract=(await request('/v1/openapi.json')).data;assert.equal(contract.openapi,'3.1.0');assert.ok(contract.paths['/v1/returns/batch']);
  assert.equal((await request('/v1/input-mappings/2023')).data.maritalStatus.field,'MARST:00001:O');
  assert.equal((await request('/v1/input-mappings/2018')).status,404);
  const exported=(await request(`/v1/returns/${item.id}/export`)).data;assert.equal(exported.format,'tax-workbench-export/v1');assert.equal(exported.return.revision,2);
});

test('input edits racing an in-flight calculation reject its stale result', async t => {
  const dir=temporary(t);let release, started;
  const ready=new Promise(resolve=>started=resolve), gate=new Promise(resolve=>release=resolve);
  const engine={...fakeEngine,async calculate(input){started();await gate;return fakeEngine.calculate(input);}};
  const service=await startServer({dataDir:dir,port:0,token:'race-test',engine});t.after(()=>service.close());
  const person=service.store.addPerson({name:'Concurrent test',birthDate:'1988-01-01',province:'BC',maritalStatus:'SING'}), item=service.store.create({personId:person.id,year:2021,fields:fixture});
  const pending=fetch(`${service.baseURL}/v1/returns/${item.id}/calculate`,{method:'POST',headers:{Authorization:'Bearer race-test','Content-Type':'application/json'},body:JSON.stringify({expectedRevision:1})});
  await ready;service.store.transaction(()=>service.store.update(item.id,{expectedRevision:1,fields:{...item.fields,'T4SLI:00014:C:1':'61000.00'}}));release();
  const response=await pending;assert.equal(response.status,409);assert.equal(service.store.get(item.id).calculation,null);
});

test('real native .NET engine computes synthetic 2021 CPP and settlement without Wine', async t => {
  const dir=temporary(t), engine=new NativeEngine(resolve('.'),dir);const health=await engine.initialize();
  assert.equal(health.wineRequired,false);assert.equal(health.cppArithmetic,'passed');assert.equal(health.engines.filter(x=>x.loaded).length,7);
  const result=await engine.calculate({year:2021,fields:{...fixture,'TAXPY:00031:D':'1988-01-01','RESID:00001:R':'Yes','RESID:00002:O':'BC'},spouseFields:null});
  assert.equal(result.wineRequired,false);assert.equal(result.lines['10100'],'60000.00');assert.equal(result.lines['30800'],'2633.94');assert.equal(result.lines['22215'],'266.06');
  assert.equal(summary(result).provincialTax,'2747.43');assert.equal(summary(result).refund,'491.48');assert.equal(result.parityVerified,false);
  const investment = {...fixture,'TAXPY:00031:D':'1988-01-01','RESID:00001:R':'Yes','RESID:00002:O':'BC','MARST:00001:O':'SING',
    'T5SLI:10001:O:1':'15','T5SLI:20001:C:1':'1.96','T5SLI:10002:O:1':'16','T5SLI:20002:C:1':'0.38'};
  const unclaimed = await engine.calculate({year:2021,fields:investment});
  assert.ok(preparationIssues(investment).some(s=>s.includes('separate foreign tax credit')));
  const claimedFields = {...investment,'FORTX:00001:R':'Yes','FORTX:00023:C:1':'1.96','FORTX:00025:C:1':'0.38'};
  assert.ok(preparationIssues(claimedFields).some(s=>s.includes('source country')));
  claimedFields['FORTX:00021:T:1']='United States';
  assert.equal(preparationIssues(claimedFields).length,0);
  const claimed = await engine.calculate({year:2021,fields:claimedFields});
  assert.equal(claimed.lines['43100'],'0.38','foreign tax must map to non-business, not business');
  assert.equal(claimed.lines['43300'],'1.96');
  assert.equal(claimed.fields['FORTX:00203:C'],'0.22');
  assert.equal(claimed.fields['FORTX:00405:C'],'0.09');
  assert.equal(Math.round((Number(summary(claimed).refund)-Number(summary(unclaimed).refund))*100),31);
});
