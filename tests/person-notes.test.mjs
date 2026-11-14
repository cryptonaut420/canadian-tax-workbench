import test from 'node:test';import assert from 'node:assert/strict';import {Store} from '../server/store.mjs';import {startServer} from '../server/index.mjs';import {mkdtempSync,rmSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';
test('person notes persist separately, preserve whitespace, and reject stale/invalid changes atomically',()=>{
 const s=new Store(':memory:'),p=s.addPerson({name:'Synthetic',notes:'Line one\n  Line two'}),q=s.addPerson({name:'Other'}),r=s.create({personId:p.id,year:2021,fields:{}});const before=s.row(r.id);
 assert.equal(s.updatePerson(p.id,{notes:'Changed',expectedNotes:p.notes}).notes,'Changed');assert.equal(s.updatePerson(p.id,{name:'Renamed'}).notes,'Changed');
 assert.throws(()=>s.updatePerson(p.id,{notes:'Overwrite',expectedNotes:p.notes,name:'Lost'}),e=>e.status===409);assert.equal(s.person(p.id).name,'Renamed');assert.equal(s.person(p.id).notes,'Changed');assert.equal(s.person(q.id).notes,'');assert.deepEqual(s.row(r.id),before);
 for(const notes of [123,{},'x'.repeat(20001)])assert.throws(()=>s.updatePerson(p.id,{notes}));assert.equal(s.updatePerson(p.id,{notes:null,expectedNotes:'Changed'}).notes,'');s.db.close();
});
test('authenticated person API reads, saves, detects conflicts and persists notes after reopening',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'person-notes-'));const app=await startServer({port:0,dataDir:dir,token:'synthetic',engine:{async initialize(){return{};}},filing:{async initialize(){return{};}}});let closed=false;t.after(async()=>{if(!closed)await app.close();rmSync(dir,{recursive:true,force:true});});
 const p=app.store.addPerson({name:'Synthetic'}),path=app.baseURL+'/v1/people/'+p.id;
 const request=async(method,body)=>{const r=await fetch(path,{method,headers:{Authorization:'Bearer synthetic','Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,data:await r.json()};};
 assert.equal((await request('GET')).data.notes,'');assert.equal((await request('PATCH',{notes:'Private\nnotes',expectedNotes:''})).status,200);assert.equal((await request('PATCH',{notes:'Stale',expectedNotes:''})).status,409);assert.equal((await request('GET')).data.notes,'Private\nnotes');
 await app.close();closed=true;const reopened=new Store(join(dir,'workbench.sqlite'));assert.equal(reopened.person(p.id).notes,'Private\nnotes');reopened.db.close();
});
