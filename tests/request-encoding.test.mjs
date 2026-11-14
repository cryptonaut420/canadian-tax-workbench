import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startServer} from '../server/index.mjs';

test('API preserves UTF-8 names split between HTTP chunks and rejects malformed UTF-8 without persisting a corrupted name',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'request-encoding-'));
 const i=await startServer({dataDir:dir,port:0,token:'test',engine:{async initialize(){return{};}},filing:{async initialize(){return{};}}});
 t.after(async()=>{await i.close();rmSync(dir,{recursive:true,force:true});});
 const name='Élodie Québec',body=Buffer.from(JSON.stringify({name})),split=body.indexOf(Buffer.from('É'))+1;
 const call=chunks=>new Promise((resolve,reject)=>{const req=http.request(i.baseURL+'/v1/people',{method:'POST',headers:{Authorization:'Bearer test','Content-Type':'application/json'}},res=>{const out=[];res.on('data',c=>out.push(c));res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(Buffer.concat(out))}));});req.on('error',reject);let index=0;const write=()=>{if(index===chunks.length){req.end();return;}req.write(chunks[index++]);setImmediate(write);};write();});
 const good=await call([body.subarray(0,split),body.subarray(split)]);assert.equal(good.status,201);assert.equal(good.body.name,name);
 const invalid=await call([Buffer.from('{"name":"'),Buffer.from([0xc3,0x28]),Buffer.from('"}')]);assert.equal(invalid.status,400);assert.equal(i.store.people().length,1);
});
