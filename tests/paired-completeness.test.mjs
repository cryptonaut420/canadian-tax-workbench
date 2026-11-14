import test from 'node:test';
import assert from 'node:assert/strict';
import {preparationIssues} from '../server/model.mjs';
import {Store} from '../server/store.mjs';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const primary={'TAXPY:00031:D':'1988-01-01','RESID:00301:R':'1','RESID:00002:O':'BC','MARST:00001:O':'MARR'};
test('empty paired spouse cannot silently establish confirmed zero income or bypass preparation checks',t=>{
 const dir=mkdtempSync(join(tmpdir(),'paired-complete-')),store=new Store(join(dir,'workbench.sqlite'));t.after(()=>{store.close();rmSync(dir,{recursive:true,force:true});});
 const person=store.addPerson({name:'Synthetic',province:'BC',birthDate:'1988-01-01',maritalStatus:'MARR'});
 const r=store.create({personId:person.id,year:2025,fields:primary,spouseFields:{}});
 assert.ok(r.issues.some(x=>x.startsWith('Paired spouse: Add the taxpayer')));
 const calculated=store.saveCalculation(r.id,r.revision,{fields:{'T1GEN:00484:C':'200.00'},spouseFields:{},lines:{}});
 assert.throws(()=>store.review(r.id,{expectedRevision:r.revision,calculationId:calculated.calculation.id},'test'),/Resolve the preparation issues/);
});
test('paired completeness covers the spouse foreign tax claim and province without requiring a duplicate manual income',()=>{
 const spouse={...primary,'TAXPY:00031:D':'1989-02-03','T5SLI:10001:O:1':'16','T5SLI:20001:C:1':'1.00'};
 assert.ok(preparationIssues(primary,2025,spouse).some(x=>x.startsWith('Paired spouse: T5 foreign')));
 delete spouse['T5SLI:10001:O:1'];delete spouse['T5SLI:20001:C:1'];
 assert.deepEqual(preparationIssues(primary,2025,spouse),[]);
 assert.ok(preparationIssues(primary,2025,{...spouse,'RESID:00002:O':'AB'}).some(x=>x.includes('same year-end province')));
 assert.deepEqual(preparationIssues({...primary,'SPOUS:00051:C':'50000.00'},2025),[]);
});
