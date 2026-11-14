import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {NativeEngine} from '../server/engine.mjs';
import {businessCatalog,businesses,writeBusiness,removeBusiness,businessIssues} from '../server/business.mjs';
const root=new URL('..',import.meta.url).pathname;
const input=year=>({name:'Synthetic consulting',type:'OTHR',ownership:'SOLE',accounting:'ACCR',fiscalStart:`${year}-01-01`,fiscalEnd:`${year}-12-31`,sales:'80000.00',expenses:{office:'8000.00'}});
const base=year=>({'TAXPY:00031:D':'1988-01-01','RESID:00002:O':'BC','MARST:00001:O':'SING',...(year>=2023?{'RESID:00301:R':'1'}:{'RESID:00001:R':'Yes'})});
test('structured business maps original inputs across years, preserves records and rejects fabricated net/CCA overrides',()=>{
 for(const year of [2019,2020,2021,2022,2023,2024,2025]){
  const catalog=businessCatalog(year);assert.equal(catalog.inputs.sales.code,'BUSIN:00101:C:{business}');assert.equal(catalog.expenses.meals50.code,'BUSIN:00211:C:{business}');assert.ok(catalog.evidenceId);
  const a=writeBusiness({'T4SLI:00014:C:1':'1000.00'},input(year),year);assert.equal(a.businessId,'1');assert.equal(a.fields['BUSIN:00213:C:1'],'8000.00');
  const b=writeBusiness(a.fields,{...input(year),name:'Synthetic partnership',ownership:'PART',ownershipPercentage:'50'},year);assert.equal(b.businessId,'2');assert.equal(b.fields['T4SLI:00014:C:1'],'1000.00');
  const edited=writeBusiness(b.fields,{id:'1',expenses:{office:'7000.00'}},year);assert.equal(businesses(edited.fields).find(x=>x.id==='1').expenses.office,'7000.00');assert.equal(edited.fields['BUSIN:00040:P:2'],'50');
  const removed=removeBusiness({...edited.fields,'BUCCA:00022:C:1:1':'10000.00','BUAGR:00021:T:1:1':'Synthetic agreement'},'1');assert.equal(removed.fields['BUCCA:00022:C:1:1'],undefined);assert.equal(removed.fields['BUAGR:00021:T:1:1'],undefined);assert.equal(removed.fields['BUSIN:00021:T:2'],'Synthetic partnership');
 }
 assert.throws(()=>writeBusiness({}, {...input(2021),netIncome:'72000.00'},2021),/Unknown business input/);
 assert.throws(()=>writeBusiness({}, {...input(2021),expenses:{totalDeductions:'8000.00'}},2021),/Unknown business category/);
 assert.throws(()=>writeBusiness({}, {...input(2021),ownership:'PART'},2021),/positive partnership/);
 assert.throws(()=>writeBusiness({}, {...input(2021),ownership:'PART',ownershipPercentage:'0'},2021),/positive partnership/);
 assert.throws(()=>writeBusiness({}, {...input(2021),ownership:'PART',ownershipPercentage:'0.00001'},2021),/positive partnership/);
 assert.throws(()=>writeBusiness({}, {...input(2021),name:'x'.repeat(61)},2021),/maximum length/);
 assert.throws(()=>writeBusiness({}, {...input(2021),numberOfPartners:'100'},2021),/MaxValue/);
 assert.throws(()=>writeBusiness({}, {...input(2021),homeOffice:{eligible:'Yes',businessArea:'100',totalArea:'0'}},2021),/home office/);
 assert.throws(()=>writeBusiness({}, {...input(2021),expenses:{office:'-100.00'}},2021),/nonnegative/);
 assert.equal(businessIssues({'BUSIN:00038:R:1':'PART'}).length,1);
});
test('native original business, ownership, meals and home-office limit calculations match mapped source inputs in every year',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'workbench-business-')),engine=new NativeEngine(root,dir);try{
  await engine.initialize();
  for(const year of [2019,2020,2021,2022,2023,2024,2025]){
   const primary=writeBusiness(base(year),{...input(year),expenses:{office:'8000.00',meals50:'1000.00'},homeOffice:{eligible:'Yes',businessArea:'100',totalArea:'1000',other:'12000.00',otherDescription:'Synthetic annual rent'},...(year<=2021?{ccaClaim:{limited:'Yes',limit:'500.00'}}:{}),ccaClasses:[{id:'1',classNumber:'8',openingUcc:'10000.00',...(year<=2021?{hasAssetsRemaining:'Yes'}:{disposedAll:'No',claimMode:'PART',claimAmount:'500.00'})}]},year);
   const paired=writeBusiness(primary.fields,{...input(year),ownership:'PART',ownershipPercentage:'50'},year);
   const result=await engine.calculate({year,fields:paired.fields});
   assert.equal(Number(result.fields['BUSIN:09946:C:1']),69800,`${year}: 80000-8000-500meals-500CCA-1200home`);
   assert.equal(Number(result.fields['BUSIN:09946:C:2']),36000,`${year}: original partnership50%`);
   assert.equal(Number(result.fields['BUSIN:09945:C:1']),1200);assert.equal(Number(result.fields['BUSIN:09936:C:1']),500);
  }
  const loss=writeBusiness(base(2021),{...input(2021),sales:'1000.00',homeOffice:{eligible:'Yes',businessArea:'100',totalArea:'1000',other:'12000.00'}},2021);
  const result=await engine.calculate({year:2021,fields:loss.fields});assert.equal(Number(result.fields['BUSIN:09946:C:1']),-7000);assert.equal(Number(result.fields['BUSIN:00427:C:1']),1200);assert.equal(Number(result.fields['BUSIN:09945:C:1']||0),0);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
