import test from 'node:test';import assert from 'node:assert/strict';import{mkdtempSync,rmSync}from'node:fs';import{tmpdir}from'node:os';import{join}from'node:path';import{startServer}from'../server/index.mjs';
test('contradictory inactive business amounts cannot be reviewed; original cleanup is explicit, revisioned and recalculated',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'cleanup-api-')),s=await startServer({dataDir:dir,port:0,token:'test'});t.after(async()=>{await s.close();rmSync(dir,{recursive:true,force:true});});
 const p=s.store.addPerson({name:'Synthetic',birthDate:'1988-01-01',province:'BC',maritalStatus:'SING'}),item=s.store.create({personId:p.id,year:2021,fields:{'SELFE:00001:R':'No','BUSIN:00001:R':'No','BUSIN:00021:T:1':'Synthetic practice','BUSIN:00032:R:1':'PROF','BUSIN:00038:R:1':'SOLE','BUSIN:00046:R:1':'ACCR','BUSIN:00101:C:1':'80000.00','BUSIN:00213:C:1':'8000.00'}});
 const request=async(action,body)=>{const r=await fetch(`${s.baseURL}/v1/returns/${item.id}/${action}`,{method:'POST',headers:{Authorization:'Bearer test','Content-Type':'application/json'},body:JSON.stringify(body)});return{status:r.status,data:await r.json()};};
 const calc=await request('calculate',{expectedRevision:1});assert.equal(calc.status,200);assert.ok(calc.data.calculation.result.inputConflicts.length>0);
 assert.equal((await request('review',{expectedRevision:1,calculationId:calc.data.calculation.id})).status,400);
 const proposal=(await request('cleanup',{expectedRevision:1})).data;assert.ok(proposal.primary.removedFields.includes('BUSIN:00101:C:1'));assert.equal(s.store.get(item.id).revision,1,'preview does not mutate');
 assert.equal((await request('cleanup',{expectedRevision:1,apply:true})).status,400);
 const applied=await request('cleanup',{expectedRevision:1,apply:true,confirmed:true});assert.equal(applied.data.return.revision,2);assert.equal(applied.data.return.fields['BUSIN:00101:C:1'],undefined);
 const next=await request('calculate',{expectedRevision:2});assert.equal(next.data.calculation.result.inputConflicts.length,0);assert.equal(next.data.summary.income,'0.00');assert.equal(s.store.history(item.id).revisions.length,2);
});
