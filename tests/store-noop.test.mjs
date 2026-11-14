import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../server/store.mjs';

function fixture(t){
 const s=new Store(':memory:');t.after(()=>s.close());
 const p=s.addPerson({name:'Synthetic no-op filer',birthDate:'1988-01-01',province:'BC',maritalStatus:'SING'});
 let r=s.create({personId:p.id,year:2021,fields:{'T4SLI:00014:C:1':'60000.00'}});
 r=s.saveCalculation(r.id,r.revision,{year:2021,fields:{'T1GEN:00150:C':'60000.00'},lines:{'15000':'60000.00'}});
 r=s.review(r.id,{expectedRevision:r.revision,calculationId:r.calculation.id},'synthetic-human');
 return {s,r};
}
test('unchanged saves and empty patches preserve reviewed snapshots and do not manufacture revisions',t=>{
 const {s,r}=fixture(t),version=s.changeVersion();
 const reordered=Object.fromEntries(Object.entries(r.fields).reverse());
 for(const next of [s.update(r.id,{expectedRevision:r.revision,fields:reordered}),s.patch(r.id,{expectedRevision:r.revision,set:{},unset:['T4SLI:99999:C:1']})]){
  assert.equal(next.revision,r.revision);assert.equal(next.state,'reviewed');assert.equal(next.calculation.id,r.calculation.id);assert.equal(next.updatedAt,r.updatedAt);
 }
 assert.equal(s.history(r.id).revisions.length,1);assert.equal(s.changeVersion(),version);
 assert.throws(()=>s.update(r.id,{expectedRevision:0,fields:r.fields}),/changed/,'stale no-ops must still be rejected');
 const changed=s.patch(r.id,{expectedRevision:r.revision,set:{'T4SLI:00014:C:1':'60000.01'}});
 assert.equal(changed.revision,r.revision+1);assert.equal(changed.state,'draft');assert.equal(changed.calculation,null);
});
test('paired spouse updates and filing metadata changes still invalidate the reviewed snapshot',t=>{
 const {s,r}=fixture(t);
 const paired=s.update(r.id,{expectedRevision:r.revision,fields:r.fields,spouseFields:{}});
 assert.equal(paired.revision,r.revision+1);assert.equal(paired.calculation,null);
 const next=s.setFilingMode(r.id,{expectedRevision:paired.revision,filingMode:'refile',priorConfirmation:'synthetic-prior'});
 assert.equal(next.revision,paired.revision+1);assert.equal(next.initialFilingMode,'refile');
 const baseline=s.setBaseline(r.id,{expectedRevision:next.revision,payloadXml:'<synthetic/>-validated-by-api'});
 assert.equal(baseline.revision,next.revision+1);assert.equal(baseline.priorFiling.baselineSupplied,true);
});
