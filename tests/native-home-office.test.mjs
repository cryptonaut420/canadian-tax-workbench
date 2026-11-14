import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {NativeEngine} from '../server/engine.mjs';
import {writeBusiness} from '../server/business.mjs';
import {writeHomeOfficeClaim} from '../server/home-office.mjs';

test('native pre-apportioned home expense follows original caps across all years without whole-home fabrication',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'workbench-preapportioned-')),engine=new NativeEngine(new URL('..',import.meta.url).pathname,dir);
 try{
  await engine.initialize();
  for(const year of [2019,2020,2021,2022,2023,2024,2025])for(const [sales,expectedNet,expectedDeduction,expectedUnused] of [['8000.00',6700,1300,0],['1000.00',0,1000,300],['0.00',0,0,1300]]){
   const base={'TAXPY:00031:D':'1988-01-01','RESID:00002:O':'BC','MARST:00001:O':'SING',...(year>=2023?{'RESID:00301:R':'1'}:{'RESID:00001:R':'Yes'})};
   const business=writeBusiness(base,{name:'Synthetic consulting',type:'OTHR',ownership:'SOLE',accounting:'ACCR',fiscalStart:`${year}-01-01`,fiscalEnd:`${year}-12-31`,sales},year);
   const fields=writeHomeOfficeClaim(business.fields,'1',{currentExpenses:'1200.00',priorUnusedExpenses:'100.00',eligibilityConfirmed:false,sourceReference:'Synthetic prepared household schedule',basis:'Explicit business-use amount; no fabricated floor area'});
   const result=await engine.calculate({year,fields});
   assert.equal(Number(result.fields['BUSIN:09945:C:1']??'0'),expectedDeduction,`${year} deduction`);
   assert.equal(Number(result.fields['BUSIN:00427:C:1']??'0'),expectedUnused,`${year} carryforward`);
   assert.equal(Number(result.fields['BUSIN:09946:C:1']??'0'),expectedNet,`${year} net`);
   assert.equal(result.fields['BUSIN:00403:I:1'],undefined);assert.equal(result.fields['BUSIN:00404:I:1'],undefined);
   assert.ok(!result.fields['BUSIN:00411:C:1']||Number(result.fields['BUSIN:00411:C:1'])===0);
  }
  const b=writeBusiness({'TAXPY:00031:D':'1988-01-01','RESID:00002:O':'BC','MARST:00001:O':'SING','RESID:00001:R':'Yes'},{name:'Synthetic loss business',type:'OTHR',ownership:'SOLE',accounting:'ACCR',fiscalStart:'2021-01-01',fiscalEnd:'2021-12-31',sales:'1000',expenses:{office:'8000'}},2021);
  const result=await engine.calculate({year:2021,fields:writeHomeOfficeClaim(b.fields,'1',{currentExpenses:'1200',priorUnusedExpenses:'100',eligibilityConfirmed:true,sourceReference:'Synthetic schedule',basis:'Confirmed prepared business-use costs'})});
  assert.equal(Number(result.fields['BUSIN:09946:C:1']??'0'),-7000);assert.equal(Number(result.fields['BUSIN:00427:C:1']??'0'),1300);assert.equal(Number(result.fields['BUSIN:09945:C:1']??'0'),0);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('prepared home-office unused expenses survive carryforward without fabricated whole-home inputs',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'workbench-home-carry-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const engine=new NativeEngine(new URL('..',import.meta.url).pathname,dir);await engine.initialize();
 for(const year of [2019,2021,2024]){
  let fields=writeBusiness({'TAXPY:00031:D':'1988-01-01','RESID:00002:O':'BC','MARST:00001:O':'SING',[year>=2023?'RESID:00301:R':'RESID:00001:R']:year>=2023?'1':'Yes'},{name:'Synthetic continuing practice',type:'OTHR',ownership:'SOLE',accounting:'ACCR',fiscalStart:`${year}-01-01`,fiscalEnd:`${year}-12-31`,sales:'1000',firstYear:'No',finalYear:'No'},year).fields;
  fields=writeHomeOfficeClaim(fields,'1',{currentExpenses:'1200.00',priorUnusedExpenses:'100.00',eligibilityConfirmed:true,sourceReference:'Synthetic prepared schedule',basis:'Synthetic business-use expenses'});
  const carried=await engine.carryForward({year,fields});assert.equal(carried.fields['WBHOM:00002:C:1'],'300.00');assert.equal(carried.fields['WBHOM:00001:C:1'],'0.00');assert.equal(carried.fields['WBHOM:00003:B:1'],'false');assert.equal(carried.fields['BUSIN:00401:R:1'],undefined);assert.equal(carried.fields['BUSIN:00403:I:1'],undefined);assert.equal(carried.homeOfficeCarryforwards[0].priorUnusedExpenses,300);
  const next=await engine.calculate({year:year+1,fields:{...carried.fields,'BUSIN:00101:C:1':'200.00'}});assert.equal(Number(next.fields['BUSIN:09945:C:1']),200);assert.equal(Number(next.fields['BUSIN:00427:C:1']),100);
  const ended=await engine.carryForward({year,fields:{...fields,'BUSIN:00031:R:1':'Yes'}});assert.ok(!Object.keys(ended.fields).some(k=>k.startsWith('WBHOM:')));
  const unanswered={...fields};delete unanswered['BUSIN:00031:R:1'];await assert.rejects(()=>engine.carryForward({year,fields:unanswered}),/final-year answer/);
 }
});

test('prepared home carryforward follows original renumbered business loops and paired taxpayer scope',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'workbench-home-remap-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const engine=new NativeEngine(new URL('..',import.meta.url).pathname,dir);await engine.initialize();
 const base={'TAXPY:00031:D':'1988-01-01','RESID:00002:O':'BC','MARST:00001:O':'MARR','RESID:00001:R':'Yes'};
 let fields=writeBusiness(base,{id:'1',name:'Synthetic ended practice',type:'OTHR',ownership:'SOLE',accounting:'ACCR',fiscalStart:'2021-01-01',fiscalEnd:'2021-12-31',sales:'1000',firstYear:'No',finalYear:'Yes'},2021).fields;
 fields=writeBusiness(fields,{id:'2',name:'Synthetic continuing practice',type:'OTHR',ownership:'SOLE',accounting:'ACCR',fiscalStart:'2021-01-01',fiscalEnd:'2021-12-31',sales:'1000',firstYear:'No',finalYear:'No'},2021).fields;
 fields=writeHomeOfficeClaim(fields,'2',{currentExpenses:'1200',priorUnusedExpenses:'100',eligibilityConfirmed:true,sourceReference:'Synthetic prepared schedule',basis:'Synthetic business-use expenses'});
 let spouse=writeBusiness(base,{id:'1',name:'Synthetic spouse practice',type:'OTHR',ownership:'SOLE',accounting:'ACCR',fiscalStart:'2021-01-01',fiscalEnd:'2021-12-31',sales:'1000',firstYear:'No',finalYear:'No'},2021).fields;
 spouse=writeHomeOfficeClaim(spouse,'1',{currentExpenses:'1400',priorUnusedExpenses:'50',eligibilityConfirmed:true,sourceReference:'Synthetic spouse schedule',basis:'Synthetic spouse business-use expenses'});
 const carried=await engine.carryForward({year:2021,fields,spouseFields:spouse});assert.equal(carried.fields['BUSIN:00021:R:1']??carried.fields['BUSIN:00021:T:1'],'Synthetic continuing practice');assert.equal(carried.fields['WBHOM:00002:C:1'],'300.00');assert.equal(carried.fields['WBHOM:00002:C:2'],undefined);assert.equal(carried.spouseFields['WBHOM:00002:C:1'],'450.00');assert.deepEqual(carried.homeOfficeCarryforwards.map(x=>[x.scope,x.sourceBusinessId,x.targetBusinessId,x.priorUnusedExpenses]),[['primary','2','1',300],['spouse','1','1',450]]);
});
