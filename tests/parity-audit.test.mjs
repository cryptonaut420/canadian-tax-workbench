import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {NativeEngine} from '../server/engine.mjs';
import {NativeFiling} from '../server/filing-engine.mjs';
import {profileFields} from '../server/model.mjs';
import {summary} from '../server/model.mjs';
import {formatMoney,renderPreview,renderPreviewWithBarcodes} from '../server/preview.mjs';
const base=(year,province='BC')=>({...profileFields({birthDate:'1988-01-01',province,residency:'Yes',maritalStatus:'SING'},year),
 'TAXPY:00001:S':'123 456 789','TAXPY:00011:T':'Synthetic','TAXPY:00013:T':'Filer','IDENT:00011:R':'CANA','IDENT:00014:T':'Example Street','IDENT:00016:T':'Example City','IDENT:00017:O':province,'IDENT:00018:A':'V2L 0A1'});
function fixture(year,province='BC') {return {...base(year,province),'T4SLI:00010:O:1':province,'T4SLI:00014:C:1':'60000.00',[`T4SLI:000${province==='QC'?'17':'16'}:C:1`]:'2900.00','T4SLI:00018:C:1':'889.54','T4SLI:00022:C:1':'10000.00','T4SLI:00024:C:1':'56300.00','T4SLI:00026:C:1':'60000.00'};}
test('headline totals read original numeric zero defaults and preserve positive income',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'headline-totals-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const engine=new NativeEngine(resolve('.'),dir);await engine.initialize();
 const zero=await engine.calculate({year:2021,fields:base(2021)});
 assert.equal(summary(zero).income,'0.00');assert.equal(summary(zero).netIncome,'0.00');
 for(const line of ['15000','23600','26000','42000','42800','43500','48400','48500']) {
  assert.equal(zero.lines[line],'0.00',line);assert.match(zero.lineFields[line],/^T1GEN:\d{5}:C$/);
 }
 const positive=await engine.calculate({year:2021,fields:fixture(2021)});
 assert.equal(summary(positive).income,'60000.00');assert.equal(positive.lines['15000'],positive.fields['T1GEN:00150:C']);
});
test('percentage inputs are native doubles rather than silently becoming zero in original getters',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'numeric-kinds-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const engine=new NativeEngine(resolve('.'),dir);await engine.initialize();
 for(let year=2019;year<=2025;year++) {
  const fields={...base(year),'T5SLI:00013:C:1':'1000.00','T5SLI:30001:P:1':'50'};
  const c=await engine.calculate({year,fields});assert.equal(c.fields['T1GEN:00121:C'],'500.00',String(year));assert.equal(c.fields['T5SLI:30001:F:1'],'50');
  assert.equal(c.convergence.passes,3);assert.equal(c.convergence.validationPasses,1);
 }
 for(const extra of [{'T4SLI:00014:C:1':'7922816251426433759354395033.51'},{'T5SLI:30001:P:1':'NaN'},{'T5SLI:30001:P:1':'1e309'},{'TAXPY:00001:I':'2147483648'},{'MARST:00032:B':'True'},{'T5SLI:00013:C:1':'1000','T5SLI:00013:F:1':'1'}])
  await assert.rejects(()=>engine.calculate({year:2021,fields:{...base(2021),...extra}}));
});
test('native preview preserves original raw-zero/sign and forced numeric zero conventions',()=>{
 assert.equal(formatMoney('0.004').zero,false,'nonzero source decimal must not be hidden after rounding');assert.equal(formatMoney('-0.004').text,'(0.00)');
 assert.equal(formatMoney('1.999',{noCents:true}).text,'1','NoCents uses original Decimal.Truncate');
 assert.equal(formatMoney('1.999',{split:true}).whole,'1');assert.equal(formatMoney('1.999',{split:true}).cents,'100','original split formatter rounds fractional cents separately');
 const page=renderPreview({year:2021,formId:'T2125FO',fields:{}}).svg;
 assert.match(page,/data-field="BUSIN:02201:I:M"[^]*?>0<\/text>/);
 assert.match(page,/data-field="BUSIN:02202:P:M"[^]*?>0<\/text>/);
 const small=renderPreview({year:2021,formId:'T1GENP6',fields:{'SCH01:00308:C':'0.004'}}).svg;
 assert.match(small,/data-field="SCH01:00308:C"/);
});
test('calculation and filing hosts agree on every calculated field across provinces, couples and business inputs',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'cross-host-parity-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const engine=new NativeEngine(resolve('.'),dir),filing=new NativeFiling(resolve('.'),dir);await engine.initialize();await filing.initialize();
 const cases=[...[2019,2021,2023,2024,2025].map(year=>({year,fields:fixture(year)})),{year:2021,fields:fixture(2021,'ON')},{year:2021,fields:fixture(2021,'QC')},
  {year:2021,fields:{...fixture(2021),'MARST:00001:O':'MARR','SPOCR:00001:R':'Yes'},spouseFields:{...base(2021),'MARST:00001:O':'MARR','T4SLI:00014:C:1':'20000.00','T4SLI:00016:C:1':'825.00'}},
  {year:2021,fields:{...base(2021),'SELFE:00001:R':'Yes','BUSIN:00001:R':'Yes','BUSIN:00021:T:1':'Synthetic practice','BUSIN:00032:R:1':'PROF','BUSIN:00038:R:1':'SOLE','BUSIN:00046:R:1':'ACCR','BUSIN:00022:D:1':'2021-01-01','BUSIN:00023:D:1':'2021-12-31','BUSIN:00101:C:1':'80000.00','BUSIN:00213:C:1':'8000.00'}},
  {year:2025,fields:{...fixture(2025),'T4SLI:00161:C:1':'100.00','T4SLI:00014:C:1':'75000.00','T4SLI:00026:C:1':'75000.00'}}];
 for(const request of cases){
  const c=await engine.calculate(request),f=await filing.prepare({...request,mode:'netfile'});
  assert.equal(f.converged,true,`${request.year}: ${f.validationErrors.join('; ')}`);
  assert.deepEqual(f.calculationFields,c.fields,`${request.year} ${request.fields['RESID:00002:O']} primary source/serialization host differs`);
  assert.deepEqual(f.calculationSpouseFields,c.spouseFields);
 }
});
test('original next-year carryforward preserves room, handles the 2023 mapping change, and excludes filing consent',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'native-carry-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const engine=new NativeEngine(resolve('.'),dir);await engine.initialize();
 for(let year=2019;year<=2024;year++){
  const fields={...base(year),'T4SLI:00014:C:1':'60000.00','CARRY:00001:C':'50000.00','CARRY:00011:R':'Yes','FILIN:99902:R':'Yes','FILIN:99931:M':'SYNTHETIC-ONLY'};
  const before=JSON.stringify(fields),result=await engine.carryForward({year,targetYear:year+1,fields});
  assert.equal(result.targetYear,year+1);assert.equal(result.fields['CARRY:00001:C'],'60800.00');
  assert.equal(result.identityFields['TAXPY:00031:D'],'1988-01-01');assert.equal(result.identityFields['TAXPY:00011:T'],'Synthetic');
  assert.ok(!Object.keys(result.fields).some(k=>/^(?:FILIN|REFIL|REFCH|METAD|T4SLI):/.test(k)));assert.equal(JSON.stringify(fields),before);
  assert.equal(result.fields[year+1>=2023?'RESID:00301:R':'RESID:00001:R'],year+1>=2023?'1':'Yes');
  assert.equal(result.calculationRequired,true);assert.equal(result.reviewRequired,true);
 }
 await assert.rejects(()=>engine.carryForward({year:2021,targetYear:2023,fields:base(2021)}),/immediately following/);
});
test('provincial line projection uses the active province instead of the last province in the assembly',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'province-lines-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const engine=new NativeEngine(resolve('.'),dir);await engine.initialize();
 const c=await engine.calculate({year:2021,fields:{...fixture(2021),'MARST:00001:O':'MARR','SPOUS:00051:C':'0.00','SPOCR:00001:R':'Yes'}});
 assert.equal(c.lineProvince,'BC');assert.equal(c.lines['58120'],'9479.00');assert.equal(c.lineFields['58120'],'BC428:05812:C');
 assert.equal(c.lines['58120'],c.fields['BC428:05812:C']);assert.equal(c.lineLabels['40500'],'Federal foreign tax credit');
 assert.ok(!Object.values(c.lineFields).some(code=>code.startsWith('YT428:')));
});
test('original orphan cleanup removes positive business amounts after an explicit No instead of filing stale income',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'native-clean-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const engine=new NativeEngine(resolve('.'),dir);await engine.initialize();
 const fields={...base(2021),'SELFE:00001:R':'No','BUSIN:00001:R':'No','BUSIN:00021:T:1':'Synthetic practice','BUSIN:00032:R:1':'PROF','BUSIN:00038:R:1':'SOLE','BUSIN:00046:R:1':'ACCR','BUSIN:00101:C:1':'80000.00','BUSIN:00213:C:1':'8000.00'};
 const before=JSON.stringify(fields),stale=await engine.calculate({year:2021,fields});assert.equal(stale.lines['13700'],'72000.00');
 const proposed=await engine.cleanInputs({year:2021,fields});assert.ok(proposed.primary.removedFields.includes('BUSIN:00101:C:1'));assert.equal(proposed.primary.fields['BUSIN:00101:C:1'],undefined);
 assert.equal(JSON.stringify(fields),before,'cleanup is a proposal on isolated data, never a source mutation');
 const cleaned=await engine.calculate({year:2021,fields:proposed.primary.fields});assert.equal(cleaned.lines['13700'],'0.00');
 const unknown={...fields};delete unknown['SELFE:00001:R'];delete unknown['BUSIN:00001:R'];
 const keep=await engine.cleanInputs({year:2021,fields:unknown});assert.equal(keep.primary.fields['BUSIN:00101:C:1'],'80000.00','unanswered must not be treated as No');
});

test('original yearly barcode data reaches native source PDF417 modules in the original condensed layout',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'native-preview-barcode-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const engine=new NativeEngine(resolve('.'),dir);await engine.initialize();
 const fields=fixture(2021),calculated=await engine.calculate({year:2021,fields});
 assert.ok(calculated.barcodeData.length>100);
 const page=await renderPreviewWithBarcodes({year:2021,formId:'T1CDSP1',fields:{...fields,...calculated.fields},barcodeData:calculated.barcodeData});
 assert.match(page.svg,/data-source-pdf417="Ordinary"/);assert.match(page.svg,/data-native-pdf417="0"/);
 assert.equal(page.barcodes.Ordinary.sourceEncoder,true);assert.ok(!page.warnings.some(w=>w.includes('barcodes are omitted')));
 assert.equal(page.parityVerified,false,'native encoder proof does not imply pixel/paper acceptance');
});
