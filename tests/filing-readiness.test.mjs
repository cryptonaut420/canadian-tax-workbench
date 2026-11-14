import test from 'node:test';import assert from 'node:assert/strict';import{filingInputIssues,preparationIssues}from'../server/model.mjs';import{Store}from'../server/store.mjs';import{DatabaseSync}from'node:sqlite';import{mkdtempSync,rmSync,statSync}from'node:fs';import{tmpdir}from'node:os';import{join}from'node:path';
const fields={'TAXPY:00011:T':'Synthetic','TAXPY:00013:T':'Filer','TAXPY:00001:S':'046454286','IDENT:00011:R':'CANA','IDENT:00014:T':'Example Street','IDENT:00016:T':'Prince George','IDENT:00017:O':'BC','IDENT:00018:A':'V2L 0A1','FILIN:99903:R':'No'};
test('filing identity checklist finds missing facts without blocking a calculation-only draft',()=>{
 const empty=filingInputIssues({},2021);assert.ok(empty.some(x=>x.includes('first name')));assert.ok(empty.some(x=>x.includes('SIN')));assert.ok(empty.some(x=>x.includes('mailing-address')));assert.ok(empty.some(x=>x.includes('first-ever')));
 assert.deepEqual(filingInputIssues(fields,2021),[]);assert.ok(filingInputIssues({...fields,'TAXPY:00001:S':'123456789'},2021).some(x=>x.includes('checksum')));
 assert.ok(filingInputIssues({...fields,'IDENT:00018:A':'bad'},2021).some(x=>x.includes('postal')));
 assert.ok(!preparationIssues({'TAXPY:00031:D':'1988-01-01','RESID:00001:R':'Yes','RESID:00002:O':'BC','MARST:00001:O':'SING'},2021).length);
});
test('private SQLite backup restores a consistent pre-send snapshot independently of later edits',t=>{
 const dir=mkdtempSync(join(tmpdir(),'readiness-backup-')),s=new Store(join(dir,'workbench.sqlite'));t.after(()=>{s.close();rmSync(dir,{recursive:true,force:true});});
 const p=s.addPerson({name:'Synthetic',birthDate:'1988-01-01',province:'BC',maritalStatus:'SING'}),r=s.create({personId:p.id,year:2021,fields});
 const snapshot=s.backup('before-filing');assert.equal(statSync(snapshot).mode&0o777,0o600);assert.equal(statSync(join(dir,'backups')).mode&0o777,0o700);
 s.update(r.id,{expectedRevision:1,fields:{...r.fields,'T4SLI:00014:C:1':'10000.00'}});
 const db=new DatabaseSync(snapshot,{readOnly:true});try{assert.equal(db.prepare('SELECT revision FROM returns WHERE id=?').get(r.id).revision,1);assert.equal(JSON.parse(db.prepare('SELECT fields FROM returns WHERE id=?').get(r.id).fields)['T4SLI:00014:C:1'],undefined);assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');}finally{db.close();}
});

test('backup failure stops a live attempt before transport and leaves no ambiguous pending submission',async t=>{
 const {startServer}=await import('../server/index.mjs');const dir=mkdtempSync(join(tmpdir(),'backup-before-send-'));let sends=0;
 const engine={async initialize(){return {available:true};},async calculate({fields}){return {fields:{...fields,'T1GEN:00484:C':'200.00'},lines:{}};}};
 const filing={async initialize(){return {liveReady:true};},async prepare({fields}){return {calculationFields:{...fields,'T1GEN:00484:C':'200.00'},schemaValidated:true,liveReady:true,payloadXml:'<synthetic/>',validationErrors:[],terms:{text:'Synthetic terms'}};},async send(){sends++;return {status:'accepted',confirmationNumber:'SYNTHETIC123'};}};
 const app=await startServer({dataDir:dir,port:0,engine,filing,token:'test'});t.after(async()=>{await app.close();rmSync(dir,{recursive:true,force:true});});
 const p=app.store.addPerson({name:'Synthetic',birthDate:'1988-01-01',province:'BC',maritalStatus:'SING'});let item=app.store.create({personId:p.id,year:2021,fields});
 app.store.settings.update({expectedRevision:app.store.settings.get().revision,liveSubmissions:true,originatingIP:'8.8.8.8'},'test');
 item=app.store.saveCalculation(item.id,item.revision,await engine.calculate({fields:item.fields}));app.store.review(item.id,{expectedRevision:item.revision,calculationId:item.calculation.id},'human-test');
 const call=async(action,body)=>{const r=await fetch(`${app.baseURL}/v1/returns/${item.id}/${action}`,{method:'POST',headers:{Authorization:'Bearer test','Content-Type':'application/json'},body:JSON.stringify(body)});return {status:r.status,data:await r.json()};};
 const plan=(await call('prepare-submission',{expectedRevision:item.revision,calculationId:item.calculation.id})).data;assert.equal(plan.liveReady,true);
 const {writeFileSync}=await import('node:fs');writeFileSync(join(dir,'obstruction'),'x');app.store.path=join(dir,'obstruction','workbench.sqlite');
 const response=await call('submit',{challengeId:plan.challengeId,idempotencyKey:plan.challengeId,confirmed:true,acceptedTerms:true,phrase:plan.phrase});assert.equal(response.status,503);assert.match(response.data.error,/Nothing was submitted/);assert.equal(sends,0);assert.equal(app.store.submissions.list(item.id).length,0);
});

test('a filing adapter missing calculation fields cannot claim matching snapshots or enable transmission',async t=>{
 const {startServer}=await import('../server/index.mjs');const dir=mkdtempSync(join(tmpdir(),'snapshot-required-'));let sends=0;
 const engine={async initialize(){return {available:true};},async calculate({fields}){return {fields:{...fields,'T1GEN:00484:C':'200.00'},lines:{}};}};
 const filing={async initialize(){return {liveReady:true};},async prepare(){return {schemaValidated:true,liveReady:true,payloadXml:'<synthetic/>',validationErrors:[],terms:{text:'Synthetic terms'}};},async send(){sends++;return {status:'accepted',confirmationNumber:'SYNTHETIC123'};}};
 const app=await startServer({dataDir:dir,port:0,engine,filing,token:'test'});t.after(async()=>{await app.close();rmSync(dir,{recursive:true,force:true});});
 const p=app.store.addPerson({name:'Synthetic',birthDate:'1988-01-01',province:'BC',maritalStatus:'SING'});let r=app.store.create({personId:p.id,year:2021,fields});
 app.store.settings.update({expectedRevision:app.store.settings.get().revision,liveSubmissions:true,originatingIP:'8.8.8.8'},'synthetic');
 r=app.store.saveCalculation(r.id,r.revision,await engine.calculate({fields:r.fields}));app.store.review(r.id,{expectedRevision:r.revision,calculationId:r.calculation.id},'synthetic-human');
 const response=await fetch(`${app.baseURL}/v1/returns/${r.id}/prepare-submission`,{method:'POST',headers:{Authorization:'Bearer test','Content-Type':'application/json'},body:JSON.stringify({expectedRevision:r.revision,calculationId:r.calculation.id})});
 assert.equal(response.status,200);const plan=await response.json();assert.equal(plan.liveReady,false);assert.ok(plan.validationErrors.some(x=>x.includes('differs from the reviewed snapshot')));assert.equal(sends,0);
});

test('named business statements require a nonplaceholder six-digit industry classification before filing',()=>{for(const code of [undefined,'','000000','54151','ABC123']){const source={...fields,'BUSIN:00021:T:1':'Synthetic business',...(code!==undefined?{'BUSIN:00035:O:1':code}:{})};assert.ok(filingInputIssues(source,2019).some(x=>x.includes('NAICS')));}assert.deepEqual(filingInputIssues({...fields,'BUSIN:00021:T:1':'Synthetic business','BUSIN:00035:O:1':'541514'},2019),[]);});
