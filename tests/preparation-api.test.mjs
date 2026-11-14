import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startServer} from '../server/index.mjs';
import {validateFields} from '../server/model.mjs';
import {financialDifferences} from '../server/snapshot.mjs';
const fakeEngine={async initialize(){return {engines:[]};},async calculate({fields}){return {fields:{...fields,'T1GEN:00484:C':'200.00'},lines:{}};},async carryForward({targetYear}){return {targetYear,fields:{'CARRY:00001:C':'60800.00'},identityFields:{},spouseFields:null,provenance:'Synthetic carryforward adapter test'};}};
async function setup(t){const dir=mkdtempSync(join(tmpdir(),'prep-api-'));let sends=0,terms=0;
 const filing={async initialize(){return {liveReady:true};},async fetchTerms({year,mode}){terms++;return {id:'synthetic-current-terms',text:'Synthetic terms',year,mode};},async prepare({live,termsId,fields}){return {calculationFields:{...fields,'T1GEN:00484:C':'200.00'},liveReady:live,schemaValidated:true,payloadXml:'<synthetic/>',validationErrors:[],terms:live?{id:termsId,text:'Synthetic terms'}:null};},async send({allowSend}){assert.equal(allowSend(),true);sends++;return {status:'accepted',confirmationNumber:'SYNTHETIC123'};},async inspectBaseline(){return {schemaValidated:true,taxYear:'2022',taxpayerSin:'046454286'};}};
 const s=await startServer({dataDir:dir,port:0,engine:fakeEngine,filing,token:'test'});t.after(async()=>{await s.close();rmSync(dir,{recursive:true,force:true});});
 const request=async(path,method='GET',body)=>{const r=await fetch(s.baseURL+path,{method,headers:{Authorization:'Bearer test','Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,data:await r.json()};};
 return {s,request,sends:()=>sends,terms:()=>terms};}
test('settings switch persists, remains offline by default, and invalidates stale confirmations',async t=>{
 const f=await setup(t);let settings=(await f.request('/v1/settings')).data;assert.equal(settings.liveSubmissions,false);
 assert.equal((await f.request('/v1/settings','PUT',{expectedRevision:settings.revision,originatingIP:'127.0.0.1'})).status,400);
 settings=(await f.request('/v1/settings','PUT',{expectedRevision:settings.revision,liveSubmissions:true,originatingIP:'8.8.8.8'})).data;
 assert.equal(settings.liveSubmissions,true);assert.equal(f.sends(),0);assert.equal(f.terms(),0,'a settings toggle must not make a CRA request');
 const p=f.s.store.addPerson({name:'Synthetic',birthDate:'1988-01-01',province:'BC',maritalStatus:'SING'});let r=f.s.store.create({personId:p.id,year:2022,fields:{'TAXPY:00011:T':'Synthetic','TAXPY:00013:T':'Filer','TAXPY:00001:S':'046454286','IDENT:00011:R':'CANA','IDENT:00014:T':'Example Street','IDENT:00016:T':'Prince George','IDENT:00017:O':'BC','IDENT:00018:A':'V2L 0A1','FILIN:99903:R':'No'}});
 r=(await f.request(`/v1/returns/${r.id}/calculate`,'POST',{expectedRevision:1})).data;
 await f.request(`/v1/returns/${r.id}/review`,'POST',{expectedRevision:1,calculationId:r.calculation.id});
 const terms=(await f.request(`/v1/returns/${r.id}/terms`,'POST',{})).data;
 const plan=(await f.request(`/v1/returns/${r.id}/prepare-submission`,'POST',{expectedRevision:1,calculationId:r.calculation.id,termsId:terms.id})).data;assert.equal(plan.liveReady,true);
 await f.request('/v1/settings','PUT',{expectedRevision:settings.revision,liveSubmissions:false});
 assert.equal((await f.request(`/v1/returns/${r.id}/submit`,'POST',{challengeId:plan.challengeId,idempotencyKey:plan.challengeId,confirmed:true,acceptedTerms:true,phrase:plan.phrase})).status,409);assert.equal(f.sends(),0);
});
test('new return defaults to NETFILE, can start ReFILE, and original baseline must match identity/year',async t=>{
 const f=await setup(t),p=f.s.store.addPerson({name:'Synthetic',birthDate:'1988-01-01',province:'BC',maritalStatus:'SING'});
 const normal=(await f.request('/v1/returns','POST',{personId:p.id,year:2021})).data;assert.equal(normal.filing.mode,'netfile');
 let amend=(await f.request('/v1/returns','POST',{personId:p.id,year:2022,filingMode:'refile',fields:{'TAXPY:00001:S':'046454286'},priorConfirmation:'External receipt',priorFiledAt:'2023-04-15'})).data;
 assert.equal(amend.filing.mode,'refile');assert.equal(amend.filing.submittedAt,null);assert.equal(amend.priorFiling.source.includes('user-reported'),true);
 const attached=await f.request(`/v1/returns/${amend.id}/baseline`,'POST',{expectedRevision:1,payloadXml:'<synthetic-validated-by-test-provider/>'});assert.equal(attached.status,200);assert.equal(attached.data.priorFiling.baselineSupplied,true);assert.equal(attached.data.revision,2);
 assert.equal((await f.request(`/v1/returns/${normal.id}/baseline`,'POST',{expectedRevision:1,payloadXml:'<wrong-year/>'})).status,422);
});
test('structured slips preserve slots; partial patches, identity copying and carryforward preserve annual data',async t=>{
 const f=await setup(t),p=f.s.store.addPerson({name:'Synthetic',birthDate:'1988-01-01',province:'BC',maritalStatus:'SING'});
 let r=f.s.store.create({personId:p.id,year:2021,fields:{'TAXPY:00011:T':'Source','TAXPY:00001:S':'046454286'}});
 let result=await f.request(`/v1/returns/${r.id}/slips`,'POST',{expectedRevision:r.revision,type:'T5',issuer:'Synthetic bank',boxes:{'13':'20.00','15':'1.96','16':'0.38'}});assert.equal(result.status,200);r=result.data.return;
 assert.equal(r.fields['T5SLI:10001:O:1'],'15');assert.equal(r.fields['T5SLI:20002:C:1'],'0.38');
 result=await f.request(`/v1/returns/${r.id}/slips`,'POST',{expectedRevision:r.revision,type:'T5',id:'1',boxes:{'15':'2.96'}});r=result.data.return;assert.equal(r.fields['T5SLI:20002:C:1'],'0.38');
 r=(await f.request(`/v1/returns/${r.id}/fields`,'PATCH',{expectedRevision:r.revision,set:{'RRSPD:00001:R':'Yes'}})).data;
 assert.equal((await f.request(`/v1/returns/${r.id}/fields`,'PATCH',{expectedRevision:1,set:{'RRSPD:00001:R':'No'}})).status,409);
 const copied=(await f.request('/v1/returns','POST',{personId:p.id,year:2022,copyIdentityFrom:r.id})).data;assert.equal(copied.fields['TAXPY:00011:T'],'Source');assert.equal(copied.fields['T5SLI:00013:C:1'],undefined);
 const target=f.s.store.transaction(()=>f.s.store.patch(copied.id,{expectedRevision:1,set:{'T4SLI:00014:C:1':'70000.00'}}));
 const proposed=(await f.request(`/v1/returns/${r.id}/carry-forward`,'POST',{expectedRevision:r.revision,dryRun:true})).data;assert.equal(proposed.existingTarget.id,target.id);assert.equal(proposed.fields['T4SLI:00014:C:1'],'70000.00');
 const merged=await f.request(`/v1/returns/${r.id}/carry-forward`,'POST',{expectedRevision:r.revision,dryRun:false,targetReturnId:target.id,expectedTargetRevision:target.revision});assert.equal(merged.status,201);assert.equal(merged.data.return.fields['CARRY:00001:C'],'60800.00');assert.equal(merged.data.return.fields['T4SLI:00014:C:1'],'70000.00');
 assert.equal((await f.request(`/v1/returns/${r.id}/slips`,'DELETE',{expectedRevision:r.revision,type:'T5',id:'1'})).data.return.fields['T5SLI:00013:C:1'],undefined);
});
test('source type validation rejects silent-zero aliases, invalid options, overflow and disguised percentages',()=>{
 assert.throws(()=>validateFields({'T4SLI:00014:T:1':'60000.00'},'fields',2021),/wrong storage type/);
 assert.throws(()=>validateFields({'RRSPD:00001:R':'true'},'fields',2021),/original option/);
 assert.throws(()=>validateFields({'T5SLI:30001:F:1':'150'},'fields',2021),/maximum/);
 assert.throws(()=>validateFields({'T4SLI:00014:C:1':'79228162514264337593543950336'}),/decimal range/);
 assert.throws(()=>validateFields({'ABCDE:00001:I':'2147483648'}),/integer range/);
 assert.throws(()=>validateFields({'T4SLI:00014:C:1':'1','T4SLI:00014:T:1':'1'}),/type aliases/);
 assert.deepEqual(financialDifferences({'T1GEN:00484:C':'200.00'},{'T1GEN:00484:C':'200'}),[]);
 assert.equal(financialDifferences({'T1GEN:00484:C':'200.00'},{'T1GEN:00484:C':'201.00'}).length,1);
});
test('trusted agent has full capabilities while transmission still requires a complete explicit plan',async t=>{
 const f=await setup(t);const connection=(await f.request('/v1/agent-connection')).data;assert.equal(connection.role,'agent');
 const call=async(path,method,body)=>{const r=await fetch(f.s.baseURL+path,{method,headers:{Authorization:'Bearer '+connection.token,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return{status:r.status,data:await r.json()};};
 const session=(await call('/v1/session','GET')).data;assert.equal(session.canReview,true);assert.equal(session.canSubmit,true);assert.equal(session.canRecordDecisions,true);assert.equal(session.requiresExplicitFilingConfirmation,true);
 assert.equal((await call('/v1/settings','PUT',{expectedRevision:1,liveSubmissions:false})).status,200);
 const p=f.s.store.addPerson({name:'Synthetic trusted agent',birthDate:'1988-01-01',province:'BC',maritalStatus:'SING'});let r=f.s.store.create({personId:p.id,year:2022});
 assert.equal((await call(`/v1/returns/${r.id}/decisions`,'POST',{expectedRevision:1,topic:'source-completeness',status:'confirmed',description:'Owner expressly confirmed available sources',sourceReference:'Synthetic owner instruction'})).status,200);
 r=f.s.store.saveCalculation(r.id,1,await fakeEngine.calculate({fields:r.fields}));assert.equal((await call(`/v1/returns/${r.id}/review`,'POST',{expectedRevision:1,calculationId:r.calculation.id})).status,200);
 assert.equal((await call(`/v1/returns/${r.id}/submit`,'POST',{})).status,409);assert.equal(f.sends(),0);assert.equal(f.terms(),0);
});
