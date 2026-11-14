import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startServer} from '../server/index.mjs';
import {Store} from '../server/store.mjs';
const engine={async initialize(){return {engines:[]};},async calculate(){return {fields:{'T1GEN:00484:C':'234.54'},lines:{}};}};
async function setup(t,send){
 const dir=mkdtempSync(join(tmpdir(),'filing-flow-'));let sends=0;
 const filing={async initialize(){return {liveReady:true,terms:{text:'Synthetic terms. Never sent to CRA.'},blockers:[]};},async prepare(){return {schemaValidated:true,validationErrors:[],payloadXml:'<synthetic/>',calculationFields:{'T1GEN:00484:C':'234.54'}};},async send(input){sends++;return send(input);}};
 const service=await startServer({dataDir:dir,port:0,engine,filing,token:'test'});
 service.store.settings.update({expectedRevision:1,liveSubmissions:true,originatingIP:'8.8.8.8'},'synthetic-test');
 t.after(async()=>{await service.close();rmSync(dir,{recursive:true,force:true});});
 const req=async(path,body,method='POST')=>{const r=await fetch(service.baseURL+path,{method,headers:{Authorization:'Bearer test','Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,data:await r.json()};};
 const p=service.store.addPerson({name:'Synthetic filer',birthDate:'1988-01-01',province:'BC',maritalStatus:'SING'});
 let item=service.store.create({personId:p.id,year:2022,fields:{'TAXPY:00011:T':'Synthetic','TAXPY:00013:T':'Filer','TAXPY:00001:S':'046454286','IDENT:00011:R':'CANA','IDENT:00014:T':'Example Street','IDENT:00016:T':'Prince George','IDENT:00017:O':'BC','IDENT:00018:A':'V2L 0A1','FILIN:99903:R':'No'}});
 item=(await req(`/v1/returns/${item.id}/calculate`,{expectedRevision:1})).data;
 const snapshot=()=>({expectedRevision:item.revision,calculationId:item.calculation.id});
 const review=async()=>req(`/v1/returns/${item.id}/review`,snapshot());
 const prepare=async(mode='netfile')=>req(`/v1/returns/${item.id}/prepare-submission`,{...snapshot(),mode});
 const confirm=(plan,extras={})=>req(`/v1/returns/${item.id}/submit`,{challengeId:plan.challengeId,idempotencyKey:plan.challengeId,confirmed:true,acceptedTerms:true,phrase:plan.phrase,...extras});
 return {service,req,dir,item,review,prepare,confirm,sends:()=>sends};
}
test('accepted NETFILE receipt survives edits and restart; ReFILE requires extra checkbox and phrase',async t=>{
 const f=await setup(t,async()=>({status:'accepted',confirmationNumber:'TEST123456',message:'Synthetic acceptance'}));
 assert.equal((await f.prepare()).status,409);await f.review();const plan=(await f.prepare()).data;
 assert.equal((await f.confirm(plan,{confirmed:false})).status,400);assert.equal((await f.confirm(plan,{phrase:'FILE 2020'})).status,400);assert.equal(f.sends(),0);
 assert.equal((await f.confirm(plan)).data.attempt.status,'accepted');assert.equal(f.sends(),1);
 assert.equal((await f.confirm(plan)).data.replayed,true);assert.equal(f.sends(),1);
 const saved=f.service.store.get(f.item.id);assert.equal(saved.filing.mode,'refile');assert.ok(saved.filing.submittedAt);assert.equal(saved.filing.confirmationNumber,'TEST123456');
 assert.equal((await f.prepare('netfile')).status,409);const amendment=(await f.prepare('refile')).data;
 assert.equal((await f.confirm(amendment)).status,400);assert.equal((await f.confirm(amendment,{confirmResubmission:true})).data.attempt.status,'accepted');assert.equal(f.sends(),2);
 const edited=await f.req(`/v1/returns/${f.item.id}`,{expectedRevision:1,fields:{...f.item.fields,'T4SLI:00014:C:1':'61000.00'}},'PUT');assert.equal(edited.data.state,'draft');assert.equal(edited.data.filing.mode,'refile');assert.equal(edited.data.filing.attempts.length,2);
 const other=new Store(join(f.dir,'workbench.sqlite'));assert.equal(other.get(f.item.id).filing.confirmationNumber,'TEST123456');other.close();
});
test('uncertain outcome blocks duplicates and input edits; an idempotency key never sends twice',async t=>{
 let release;const gate=new Promise(r=>release=r);const f=await setup(t,async()=>{await gate;throw Error('Disconnected');});
 await f.review();const plan=(await f.prepare()).data;const pending=f.confirm(plan);
 const waitStart=Date.now();while(!f.sends()){if(Date.now()-waitStart>2000)throw Error('Synthetic transport did not start');await new Promise(r=>setTimeout(r,5));}
 assert.equal((await f.confirm(plan)).data.attempt.status,'sending');assert.equal((await f.prepare()).status,409);
 assert.equal((await f.req(`/v1/returns/${f.item.id}`,{expectedRevision:1,fields:f.item.fields},'PUT')).status,409);
 release();assert.equal((await pending).data.attempt.status,'unknown');assert.equal((await f.confirm(plan)).data.attempt.status,'unknown');assert.equal(f.sends(),1);assert.equal((await f.prepare()).status,409);
 const saved=f.service.store.get(f.item.id);assert.equal(saved.filing.submittedAt,null);assert.equal(saved.filing.blocked,true);
});
test('rejection stays unfiled; retry needs new confirmation; acceptance requires confirmation code',async t=>{
 let count=0;const f=await setup(t,async()=>++count===1?{status:'rejected',message:'Synthetic invalid input'}:{status:'accepted'});
 await f.review();const p=(await f.prepare()).data;assert.equal((await f.confirm(p)).data.attempt.status,'rejected');
 const s=f.service.store.get(f.item.id);assert.equal(s.filing.mode,'netfile');assert.equal(s.filing.submittedAt,null);
 const next=(await f.prepare()).data;assert.equal((await f.confirm(next)).data.attempt.status,'unknown');
});
test('confirmation expiry and snapshot binding; change feed observes a separate database connection',async t=>{
 const f=await setup(t,async()=>({status:'accepted',confirmationNumber:'TEST'}));await f.review();const p=(await f.prepare()).data;
 f.service.store.db.prepare("UPDATE submission_plans SET expires_at='2000-01-01' WHERE id=?").run(p.challengeId);assert.equal((await f.confirm(p)).status,409);
 const fresh=(await f.prepare()).data;const before=(await f.req('/v1/changes',undefined,'GET')).data.version;
 const other=new Store(join(f.dir,'workbench.sqlite'));other.transaction(()=>other.update(f.item.id,{expectedRevision:1,fields:{...f.item.fields,'T4SLI:00014:C:1':'61000.00'}},'other-session'));other.close();
 assert.ok((await f.req('/v1/changes',undefined,'GET')).data.version>before);assert.equal((await f.confirm(fresh)).status,409);assert.equal(f.sends(),0);
});
