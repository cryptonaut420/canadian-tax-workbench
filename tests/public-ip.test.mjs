import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {detectPublicIPv4,IP_PROVIDERS} from '../server/public-ip.mjs';
import {startServer} from '../server/index.mjs';

test('IP lookup uses fixed IPv4 TLS destinations, validates bounded responses and falls back without redirects',async()=>{
 const seen=[];
 const request=(url,options,callback)=>{seen.push({url,options});const req=new EventEmitter();req.destroy=()=>{};req.end=()=>queueMicrotask(()=>{const res=new EventEmitter();res.destroy=()=>{};res.statusCode=200;callback(res);res.emit('data',Buffer.from(seen.length===1?'127.0.0.1':'8.8.8.8\n'));res.emit('end');});return req;};
 const result=await detectPublicIPv4({request});assert.equal(result.originatingIP,'8.8.8.8');assert.equal(result.provider,IP_PROVIDERS[1]);assert.equal(seen.length,2);assert.ok(seen.every(s=>s.options.family===4&&!s.options.headers.Authorization));
 for(const body of ['192.168.1.1','::1','8.8.8.8\n1.1.1.1','x'.repeat(129)]){
  await assert.rejects(detectPublicIPv4({request:(_u,_o,callback)=>{const req=new EventEmitter();req.destroy=()=>{};req.end=()=>queueMicrotask(()=>{const res=new EventEmitter();res.statusCode=200;res.destroy=()=>{};callback(res);res.emit('data',Buffer.from(body));res.emit('end');});return req;}}),e=>e.status===502);
 }
});

async function setup(t,detector){
 const dir=mkdtempSync(join(tmpdir(),'public-ip-api-'));let lookups=0,preparations=0;const engine={async initialize(){return{};},async calculate({fields}){return{fields:{...fields,'T1GEN:00484:C':'200.00'},spouseFields:null,lines:{}};}};
 const i=await startServer({dataDir:dir,port:0,token:'test',publicIPDetector:async()=>{lookups++;return detector(i);},engine,filing:{async initialize(){return{liveReady:true};},async prepare({fields,originatingIP}){preparations++;return{schemaValidated:true,validationErrors:[],calculationFields:(await engine.calculate({fields})).fields,calculationSpouseFields:null,payloadXml:'<synthetic/>',liveReady:true,originatingIP};}}});
 t.after(async()=>{await i.close();rmSync(dir,{recursive:true,force:true});});
 const p=i.store.addPerson({name:'Synthetic',birthDate:'1988-01-01',province:'BC',maritalStatus:'SING'});let r=i.store.create({personId:p.id,year:2021,fields:{'TAXPY:00011:T':'Synthetic','TAXPY:00013:T':'Filer','TAXPY:00001:S':'046454286','IDENT:00011:R':'CANA','IDENT:00014:T':'Example Street','IDENT:00016:T':'Test City','IDENT:00017:O':'BC','IDENT:00018:A':'V2L 0A1','FILIN:99903:R':'No'}});r=i.store.saveCalculation(r.id,1,await engine.calculate({fields:r.fields}));i.store.review(r.id,{expectedRevision:1,calculationId:r.calculation.id},'synthetic');
 const call=async(path,body)=>{const res=await fetch(i.baseURL+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+i.agentToken,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});return{status:res.status,body:await res.json()};};
 return{i,r,call,lookups:()=>lookups,preparations:()=>preparations,snapshot:{expectedRevision:1,calculationId:r.calculation.id}};
}
test('automatic mode stays offline for checks and settings, refreshes each live plan, and invalidates an older plan when IP changes',async t=>{
 let address='8.8.8.8';const f=await setup(t,()=>({originatingIP:address}));
 assert.equal((await f.call('/v1/settings')).body.originatingIPMode,'automatic');await f.call('/v1/returns/'+f.r.id+'/validate',f.snapshot);assert.equal(f.lookups(),0);
 let settings=f.i.store.settings.get();f.i.store.settings.update({expectedRevision:settings.revision,liveSubmissions:true},'test');
 const a=await f.call('/v1/returns/'+f.r.id+'/prepare-submission',f.snapshot);assert.equal(a.status,200);assert.equal(a.body.originatingIP,'8.8.8.8');assert.equal(f.lookups(),1);
 address='1.1.1.1';const b=await f.call('/v1/returns/'+f.r.id+'/prepare-submission',f.snapshot);assert.equal(b.status,200);assert.equal(b.body.originatingIP,address);assert.equal(f.lookups(),2);
 assert.throws(()=>f.i.store.submissions.begin(f.r.id,{challengeId:a.body.challengeId,idempotencyKey:a.body.challengeId,confirmed:true,acceptedTerms:true,phrase:a.body.phrase},'test'),e=>e.status===409);
 assert.equal(f.i.store.submissions.list(f.r.id).length,0);assert.equal(f.i.store.get(f.r.id).state,'reviewed');
});
test('IP lookup failures and concurrent settings changes stop preparation before creating a live plan',async t=>{
 const f=await setup(t,i=>{i.store.settings.update({expectedRevision:i.store.settings.get().revision,liveSubmissions:false},'test');return{originatingIP:'8.8.8.8'};});
 f.i.store.settings.update({expectedRevision:1,liveSubmissions:true},'test');const res=await f.call('/v1/returns/'+f.r.id+'/prepare-submission',f.snapshot);assert.equal(res.status,409);assert.equal(f.preparations(),0);assert.equal(f.i.store.db.prepare('SELECT count(*) n FROM submission_plans').get().n,0);
});
test('explicit detection is read-only; manual mode does not look up an IP during live preparation',async t=>{
 const f=await setup(t,()=>({originatingIP:'8.8.8.8',provider:'synthetic'}));
 const before=f.i.store.settings.get();assert.equal((await f.call('/v1/settings/detect-ip',{})).body.originatingIP,'8.8.8.8');assert.deepEqual(f.i.store.settings.get(),before);
 f.i.store.settings.update({expectedRevision:before.revision,liveSubmissions:true,originatingIP:'1.1.1.1'},'test');
 assert.equal(f.i.store.settings.get().originatingIPMode,'manual');const res=await f.call('/v1/returns/'+f.r.id+'/prepare-submission',f.snapshot);assert.equal(res.status,200);assert.equal(res.body.originatingIP,'1.1.1.1');assert.equal(f.lookups(),1);
});
test('failed or timed-out automatic detection never falls back to a stale saved address',async t=>{
 const f=await setup(t,()=>{const e=Error('Synthetic detection failed');e.status=502;throw e;});
 f.i.store.settings.update({expectedRevision:1,liveSubmissions:true,originatingIP:'8.8.8.8',originatingIPMode:'automatic'},'test');
 const res=await f.call('/v1/returns/'+f.r.id+'/prepare-submission',f.snapshot);assert.equal(res.status,502);assert.equal(f.preparations(),0);assert.equal(f.i.store.db.prepare('SELECT count(*) n FROM submission_plans').get().n,0);
 let destroyed=0;await assert.rejects(detectPublicIPv4({timeout:5,request:()=>{const req=new EventEmitter();req.end=()=>{};req.destroy=()=>{destroyed++;};return req;}}),e=>e.status===502);assert.equal(destroyed,2);
});
