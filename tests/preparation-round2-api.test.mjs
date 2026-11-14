import test from 'node:test';import assert from 'node:assert/strict';import {mkdtempSync,rmSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {startServer} from '../server/index.mjs';import {preparationIssues} from '../server/model.mjs';
test('structured RRSP, benefit slips and business API preserve revisions and expose year-specific metadata',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'prep-round2-'));const instance=await startServer({dataDir:dir,port:0,token:'test',engine:{async initialize(){return {available:true};}},filing:{async initialize(){return {liveReady:false};}}});t.after(async()=>{await instance.close();rmSync(dir,{recursive:true,force:true});});
 const call=async(path,method='GET',body)=>{const r=await fetch(instance.baseURL+path,{method,headers:{Authorization:'Bearer test','Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};};
 const p=instance.store.addPerson({name:'Synthetic',birthDate:'1988-01-01',province:'BC',maritalStatus:'SING'});let item=instance.store.create({personId:p.id,year:2025});
 const base=`/v1/returns/${item.id}`;
 let r=await call(base+'/rrsp','POST',{expectedRevision:1,deductionLimit:'5000.00',receipts:[{issuer:'Synthetic issuer',lastTenMonths:'500.00',first60DaysFollowing:'100.00'}]});assert.equal(r.status,200);item=r.data.return;assert.equal(item.revision,2);assert.equal(r.data.rrsp.receipts.length,1);
 assert.equal((await call(base+'/rrsp','POST',{expectedRevision:1,deductionLimit:'9999.00'})).status,409);
 r=await call(base+'/slips','POST',{expectedRevision:2,type:'T4E',boxes:{14:'24000.00',22:'1200.00',7:'0',37:'24000.00'}});assert.equal(r.status,200);item=r.data.return;
 assert.deepEqual((await call(base+'/slips')).data.slips[0].boxes,{'14':'24000.00','22':'1200.00','7':'0','37':'24000.00'});
 for(let year=2019;year<=2025;year++){r=await call(`/v1/business-mappings/${year}`);assert.equal(r.status,200,JSON.stringify(r.data));assert.equal(r.data.year,year);assert.ok(r.data.expenses.office);}
 r=await call(base+'/businesses','POST',{expectedRevision:item.revision,name:'Synthetic practice',type:'PROF',ownership:'SOLE',accounting:'ACCR',fiscalStart:'2025-01-01',fiscalEnd:'2025-12-31',sales:'80000.00',expenses:{office:'8000.00'}});assert.equal(r.status,200,JSON.stringify(r.data));item=r.data.return;assert.equal((await call(base+'/businesses')).data.businesses[0].sales,'80000.00');
 assert.equal((await call(base+'/businesses','POST',{expectedRevision:item.revision,id:'1',netIncome:'1.00'})).status,400);
 r=await call(base+'/businesses','DELETE',{expectedRevision:item.revision,id:'1'});assert.equal(r.status,200);assert.equal((await call(base+'/businesses')).data.businesses.length,0);
});
test('yearly foreign-credit checks do not request obsolete manual FORTX inputs after2021',()=>{
 const base={'TAXPY:00031:D':'1988-01-01','RESID:00001:R':'Yes','RESID:00002:O':'BC','MARST:00001:O':'SING','T5SLI:10001:O:1':'15','T5SLI:20001:C:1':'20.00','T5SLI:10002:O:1':'16','T5SLI:20002:C:1':'3.00'};
 assert.ok(preparationIssues(base,2021).some(x=>x.includes('separate foreign tax credit')));
 assert.deepEqual(preparationIssues({...base,'FORTR:00001:R':'Yes','FORTR:01201:T':'unknown'},2022),[]);
 const newer=preparationIssues({...base,'FORTR:00001:R':'No'},2022);assert.ok(newer.some(x=>x.includes('automatically')));assert.ok(!newer.some(x=>x.includes('does not apply the credit')));
});
test('benefit inclusion and RRSP completeness never silently assume missing facts are zero',()=>{
 const base={'TAXPY:00031:D':'1988-01-01','RESID:00301:R':'1','RESID:00002:O':'BC','MARST:00001:O':'SING'};
 assert.ok(preparationIssues({...base,'T4ESL:00014:C:1':'24000.00'},2025).some(x=>x.includes('box 7')));
 assert.ok(preparationIssues({...base,'T4ESL:00014:C:1':'100.00','T4ESL:00007:P:1':'0','T4ESL:10001:O:1':'37','T4ESL:20001:C:1':'101.00'},2025).some(x=>x.includes('cannot exceed')));
 assert.ok(preparationIssues({...base,'RRSPD:00224:C:1':'600.00'},2025).some(x=>x.includes('RRSP deduction limit')));
 assert.deepEqual(preparationIssues({...base,'RRSPD:00224:C:1':'600.00','CARRY:00001:C':'1000.00'},2025),[]);
});
