import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {NativeEngine} from '../server/engine.mjs';
import {NativeFiling} from '../server/filing-engine.mjs';
import {profileFields} from '../server/model.mjs';

const profile=year=>profileFields({birthDate:'1990-01-01',province:'BC',residency:'Yes',maritalStatus:'MARR'},year);
const base=year=>({...profile(year),'SPOUS:00051:C':'100000.00','EMPIN:00001:R':'Yes','T4SLI:00010:O:1':'BC','T4SLI:00014:C:1':'60000.00','T4SLI:00016:C:1':'3000.00','T4SLI:00018:C:1':'900.00','T4SLI:00022:C:1':'10000.00','T4SLI:00024:C:1':'55000.00','T4SLI:00026:C:1':'60000.00'});
async function setup(t){const dir=mkdtempSync(join(tmpdir(),'native-family-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const engine=new NativeEngine(resolve('.'),dir);await engine.initialize();return {engine,dir};}

test('original RRSP receipt periods and room limits work across all bundled filing years',async t=>{
 const {engine}=await setup(t);
 for(let year=2019;year<=2025;year++){
  const fields={...base(year),'RRSPD:00001:R':'Yes','RRSPD:00029:R':'No','CARRY:00001:C':'10000.00','RRSPD:00221:T:1':'Synthetic receipt','RRSPD:00224:C:1':'500.00','RRSPD:00225:C:1':'100.00'};
  const r=await engine.calculate({year,fields});
  assert.equal(Number(r.lines['20800']),600,`${year}: both contribution periods reported once`);
  assert.equal(Number(r.fields['RRSPD:00073:C']),600);
  if(year<=2020){assert.equal(r.lineFields['20800'],'T1GEN:00208:C');assert.equal(r.lineLabels['20800'],'RRSP deduction');assert.ok(Object.keys(r.lines).length>200);assert.ok(!Object.values(r.lineFields).some(code=>code.startsWith('YT428:')));}
  const limited=await engine.calculate({year,fields:{...fields,'CARRY:00001:C':'400.00'}});
  assert.equal(Number(limited.lines['20800']),400,`${year}: actual deduction limit caps selected deduction`);
  assert.equal(Number(limited.fields['RRSPD:00023:C']),600,`${year}: full reported contributions remain recorded despite the cap`);
 }
});

test('two-employer CPP/EI overpayments, RPP and union amounts use original aggregate rules',async t=>{
 const {engine}=await setup(t);
 const fields={...profile(2023),'SPOUS:00051:C':'100000.00','EMPIN:00001:R':'Yes','RPPLA:00001:R':'Yes','UNION:00001:R':'Yes','RRSPD:00001:R':'Yes','RRSPD:00029:R':'No','CARRY:00001:C':'10000.00','RRSPD:00221:T:1':'Synthetic receipt','RRSPD:00224:C:1':'500.00','RRSPD:00225:C:1':'100.00'};
 for(const [id,values]of [['1',['40000','2200','650','2000','6000','40000','40000','400']],['2',['30000','1700','480','1000','4000','30000','30000','100']]]){
  for(const [i,box]of ['14','16','18','20','22','24','26','44'].entries())fields[`T4SLI:000${box}:C:${id}`]=values[i];
  fields[`T4SLI:00010:O:${id}`]='BC';
 }
 const r=await engine.calculate({year:2023,fields});
 for(const [line,expected]of Object.entries({'15000':70000,'20700':3000,'20800':600,'21200':500,'22215':631,'23600':65269,'30800':3123.45,'31200':1002.45,'44800':145.55,'45000':127.55,'43700':10000}))assert.equal(Number(r.lines[line]),expected,line);
});

test('CPP2 deduction and maternity EI information are preserved without double-counting income',async t=>{
 const {engine,dir}=await setup(t);
 const full={...base(2024),'T4SLI:00014:C:1':'80000.00','T4SLI:00016:C:1':'3867.50','T4SLI:00161:C:1':'188.00','T4SLI:00018:C:1':'1049.12','T4SLI:00024:C:1':'63200.00','T4SLI:00026:C:1':'73200.00'};
 const cpp2=await engine.calculate({year:2024,fields:full});assert.equal(Number(cpp2.lines['22215']),838);assert.equal(Number(cpp2.lines['30800']),3217.5);assert.equal(Number(cpp2.lines['23600']),79162);
 const maternity={...base(2025),'T4SLI:00014:C:1':'23000.00','T4SLI:00016:C:1':'1150.00','T4SLI:00018:C:1':'80.00','T4SLI:00022:C:1':'2500.00','T4SLI:00024:C:1':'5000.00','T4SLI:00026:C:1':'23000.00','EIINC:00001:R':'Yes','T4ESL:00014:C:1':'24000.00','T4ESL:00022:C:1':'1400.00','T4ESL:00007:P:1':'0','T4ESL:10001:O:1':'37','T4ESL:20001:C:1':'24000.00'};
 const result=await engine.calculate({year:2025,fields:maternity});
 for(const [line,expected]of Object.entries({'10100':23000,'11900':24000,'11905':24000,'15000':47000,'23500':0,'42200':0,'43700':3900}))assert.equal(Number(result.lines[line]),expected,line);
 const filing=new NativeFiling(resolve('.'),dir);await filing.initialize();const prepared=await filing.prepare({year:2025,mode:'netfile',fields:maternity});assert.deepEqual(prepared.calculationFields,result.fields);
});

test('foreign tax credit switches from manual country claims to original slip aggregation in 2022',async t=>{
 const {engine}=await setup(t);
 for(let year=2019;year<=2025;year++){
  const fields={...base(year),'INVIN:00001:R':'Yes','T5SLI:10001:O:1':'15','T5SLI:20001:C:1':'100.00','T5SLI:10002:O:1':'16','T5SLI:20002:C:1':'15.00'};
  const original=await engine.calculate({year,fields});
  if(year<=2021){
   assert.equal(Number(original.lines['40500'] ?? original.fields['SCH01:00014:C'] ?? '0.00'),0,`${year}: foreign slip alone does not populate country claim`);
   const claimed=await engine.calculate({year,fields:{...fields,'FORTX:00001:R':'Yes','FORTX:00021:T:1':'Synthetic Country','FORTX:00023:C:1':'100.00','FORTX:00025:C:1':'15.00'}});
   assert.ok(Number(claimed.lines['40500'] ?? claimed.fields['SCH01:00014:C'] ?? '0.00')>0);assert.equal(Number(claimed.fields['SCH01:00431:C']),15);
  }else{
   assert.equal(Number(original.fields['FORTR:00012:C']),15,`${year}: tax aggregates from T5 slots`);
   assert.equal(Number(original.fields['FORTR:00013:C']),100,`${year}: gross foreign income aggregates once`);
   assert.ok(Number(original.lines['40500'] ?? original.fields['SCH01:00014:C'] ?? '0.00')>0);
   const reviewed={...fields,'FORTR:00001:R':'Yes','FORTR:00003:R':'No','FORTR:00011:R':'No','FORTR:00020:R':'No','FORTR:00032:R':'No','FORTR:01201:T':'unknown'};
   const complete=await engine.calculate({year,fields:reviewed});assert.equal(complete.lines['40500'],original.lines['40500']);
   const clean=await engine.cleanInputs({year,fields:reviewed});assert.deepEqual(clean.primary.removedFields,[]);assert.deepEqual(clean.primary.changedFields,[]);
   const noTax=await engine.calculate({year,fields:{...reviewed,'T5SLI:20002:C:1':'0.00'}});assert.equal(Number(noTax.lines['40500']),0);assert.ok(Number(noTax.lines['43500'])>Number(complete.lines['43500']));
  }
 }
});
