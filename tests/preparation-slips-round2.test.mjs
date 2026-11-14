import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {writeSlip,slips,removeSlip,writeRrsp,readRrsp} from '../server/preparation.mjs';
import {NativeEngine} from '../server/engine.mjs';
const root=resolve(import.meta.dirname,'..');
const amount=(r,line)=>r.lines[line]??r.fields[`T1GEN:${line==='11905'?'11905':String(Number(line)/100).padStart(5,'0')}:C`]??'0.00';
const base=year=>({'TAXPY:00031:D':'1988-01-01','RESID:00002:O':'BC',[year>=2023?'RESID:00301:R':'RESID:00001:R']:year>=2023?'1':'Yes','MARST:00001:O':'SING'});
async function native(t){const d=mkdtempSync(join(tmpdir(),'common-slips-'));t.after(()=>rmSync(d,{recursive:true,force:true}));const e=new NativeEngine(root,d);await e.initialize();return e;}
test('structured benefits use original slot storage, preserve other slips and read all twelve T4A slots',()=>{
 let fields={'T4SLI:00014:C:1':'20000','T4ASL:10012:O:3':'197','T4ASL:20012:C:3':'100'};
 fields=writeSlip(fields,{type:'T4A',id:'1',issuer:'Synthetic payer',boxes:{'197':'14000','202':'6000','22':'600'}},2020).fields;
 assert.equal(fields['T4ASL:10001:O:1'],'197');assert.equal(fields['T4ASL:10002:O:1'],'202');
 assert.equal(fields['T4ASL:20001:C:1'],'14000');assert.equal(fields['T4ASL:00197:C:1'],undefined);
 assert.equal(slips(fields).find(s=>s.type==='T4A'&&s.id==='3').boxes['197'],'100');
 fields=writeSlip(fields,{type:'T4E',boxes:{'07':'0','14':'12000','22':'900','37':'12000'}},2025).fields;
 const ei=slips(fields).find(s=>s.type==='T4E');assert.equal(ei.boxes['37'],'12000');assert.equal(ei.boxes['7'],'0');
 assert.equal(fields['T4ESL:00037:C:1'],undefined);assert.equal(fields['T4ESL:10001:O:1'],'37');
 assert.equal(fields['EIINC:00001:R'],'Yes');assert.equal(fields['COVID:00001:R'],'Yes');
 assert.equal(removeSlip(fields,'T4E','1')['T4SLI:00014:C:1'],'20000');
 assert.equal(slips(removeSlip(fields,'T4E','1')).some(s=>s.type==='T4E'),false);
 assert.throws(()=>writeSlip({}, {type:'T4A',boxes:{'197':'100'}},2019),/2019/);
 assert.throws(()=>writeSlip({}, {type:'T4E',boxes:{'7':'150'}},2025),/percentage/);
});
test('original COVID calculation counts CERB/CRB and withholding once in both relevant years',async t=>{
 const e=await native(t);
 for(const year of [2020,2021]){
  const fields=writeSlip(base(year),{type:'T4A',boxes:{'197':'14000','202':'6000','22':'600'}},year).fields;
  const r=await e.calculate({year,fields});assert.equal(amount(r,'13000'),'20000.00');assert.equal(amount(r,'15000'),'20000.00');assert.equal(amount(r,'43700'),'600.00');
 }
});
test('original maternity subset maps line11905 while EI total and withholding count once in every year',async t=>{
 const e=await native(t);
 for(let year=2019;year<=2025;year++){
  const fields=writeSlip(base(year),{type:'T4E',boxes:{'7':'0','14':'10000','22':'1000',[year===2019?'36':'37']:'10000'}},year).fields;
  const r=await e.calculate({year,fields});assert.equal(amount(r,'11900'),'10000.00',String(year));assert.equal(amount(r,'11905'),'10000.00',String(year));assert.equal(amount(r,'15000'),'10000.00');assert.equal(amount(r,'43700'),'1000.00');assert.equal(amount(r,'42200'),'0.00');
 }
});
test('RRSP receipt periods stay separate and original calculation enforces actual deduction room',async t=>{
 const e=await native(t);
 for(const year of [2019,2021,2025]){
  const f=writeSlip(base(year),{type:'T4',employmentProvince:'BC',boxes:{'14':'60000','16':'2900','18':'800','22':'10000','24':'50000','26':'60000'}},year).fields;
  const receipt={issuer:'Synthetic plan',lastTenMonths:'500',first60DaysFollowing:'100'};
  const missing=writeRrsp(f,{receipts:[receipt]},year);assert.equal(missing.fields['CARRY:00001:C'],undefined);assert.equal(missing.rrsp.deductionLimit,null);
  const low=writeRrsp(f,{deductionLimit:'300',receipts:[receipt]},year),a=await e.calculate({year,fields:low.fields});
  assert.equal(amount(a,'20800'),'300.00');assert.equal(a.fields['RRSPD:00073:C'],'600.00');assert.equal(low.fields['RRSPD:00015:C'],undefined,'do not misreport next-year January receipt as current-year previously reported contribution');
  const high=writeRrsp(f,{deductionLimit:'1000',carryForwardAmount:'125',receipts:[receipt]},year),b=await e.calculate({year,fields:high.fields});
  assert.equal(amount(b,'20800'),'475.00');assert.equal(high.fields['RRSPD:00029:R'],'Yes');
  assert.deepEqual(readRrsp(low.fields,year).receipts[0],{id:'1',issuer:'Synthetic plan',planNumber:null,contractNumber:null,lastTenMonths:'500',first60DaysFollowing:'100',annuitantCode:null});
 }
 assert.throws(()=>writeRrsp({}, {deductionLimit:'-1'},2025),/nonnegative/);
 assert.throws(()=>writeRrsp({}, {receipts:[{issuer:'x'.repeat(61)}]},2025),/60-character/);
 const before=writeRrsp({}, {deductionLimit:'1000',receipts:[{issuer:'A',lastTenMonths:'10'},{issuer:'B',lastTenMonths:'20'}]},2025).fields;
 const after=writeRrsp(before,{replaceReceipts:true,receipts:[{id:'1',issuer:'C',lastTenMonths:'30'}]},2025).fields;assert.equal(after['RRSPD:00221:T:2'],undefined);assert.equal(after['CARRY:00001:C'],'1000');
});
