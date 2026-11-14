import test from'node:test';import assert from'node:assert/strict';import{mkdtempSync,rmSync}from'node:fs';import{join,resolve}from'node:path';import{tmpdir}from'node:os';
import{NativeFiling}from'../server/filing-engine.mjs';import{financialDifferences}from'../server/snapshot.mjs';import{NativeEngine}from'../server/engine.mjs';import{writeBusiness}from'../server/business.mjs';import{writeInventoryAccounting,readInventoryAccounting,validateInventoryAccounting}from'../server/inventory.mjs';
const make=year=>writeBusiness({'TAXPY:00031:D':'1988-01-01','MARST:00001:O':'SING','RESID:00002:O':'BC',[year>=2023?'RESID:00301:R':'RESID:00001:R']:year>=2023?'1':'Yes'},{name:'Synthetic inventory',province:'BC',type:'OTHR',ownership:'SOLE',accounting:'ACCR',fiscalStart:`${year}-01-01`,fiscalEnd:`${year}-12-31`,sales:'1000.00',openingInventory:'100.00',purchases:'10.00',closingInventory:'200.00'},year).fields;
const choice={signedCostOfGoods:true,sourceBasis:'Synthetic unit-test inventory ledger; not a filing record.'};
test('signed goods cost is explicit, preserves source inputs, and flows into original tax arithmetic all years',async t=>{
 let dir=mkdtempSync(join(tmpdir(),'inventory-native-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));let engine=new NativeEngine(resolve('.'),dir);await engine.initialize();
 for(let year=2019;year<=2025;year++){
  const fields=make(year),ordinary=await engine.calculate({year,fields});assert.equal(Number(ordinary.fields['BUSIN:09369:C:1']),1000);
  const selected=writeInventoryAccounting(fields,'1',choice);validateInventoryAccounting(selected);const r=await engine.calculate({year,fields:selected});
  assert.equal(Number(r.fields['BUSIN:08518:C:1']),-90,`${year}: signed cost`);assert.equal(Number(r.fields['BUSIN:09369:C:1']),1090,`${year}: stock increase offsets expenses`);if(year>=2021)assert.equal(Number(r.lines['13500']),1090);assert.equal(r.fields['BUSIN:00117:C:1'],'200.00');
  assert.equal(readInventoryAccounting(selected,'1').sourceBasis,choice.sourceBasis);assert.ok(!Object.keys(writeInventoryAccounting(selected,'1',null)).some(k=>k.startsWith('WBINV:')));
 }
});
test('signed inventory rejects missing confirmation, basis, cash accounting and malformed controls',()=>{
 const f=make(2025);assert.throws(()=>writeInventoryAccounting(f,'1',{...choice,signedCostOfGoods:false}),/confirm/);assert.throws(()=>writeInventoryAccounting(f,'1',{...choice,sourceBasis:''}),/basis/);assert.throws(()=>writeInventoryAccounting({...f,'BUSIN:00046:R:1':'CASH'},'1',choice),/accrual/);assert.throws(()=>validateInventoryAccounting({...f,'WBINV:99999:B:1':'true'}),/Unknown/);
});

test('signed inventory stays identical in offline filing and survives original EDI serialization',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'inventory-filing-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const engine=new NativeEngine(resolve('.'),dir),filing=new NativeFiling(resolve('.'),dir);await engine.initialize();await filing.initialize();
 for(const year of [2024,2025]){
  let fields={...make(year),'TAXPY:00011:T':'Synthetic','TAXPY:00013:T':'Filer','TAXPY:00001:S':'123 456 782','IDENT:00011:R':'CANA','IDENT:00014:T':'Example Street','IDENT:00016:T':'Prince George','IDENT:00017:O':'BC','IDENT:00018:A':'V2L 0A1'};
  fields=writeInventoryAccounting(fields,'1',choice);const r=await engine.calculate({year,fields}),p=await filing.prepare({year,fields});
  assert.deepEqual(financialDifferences(r.fields,p.calculationFields),[]);assert.equal(p.schemaValidated,true,JSON.stringify(p.validationErrors));assert.match(p.payloadXml,/<comm:FieldCode>8518<\/comm:FieldCode>\s*<comm:FieldValue>-90<\/comm:FieldValue>/);assert.ok(!p.payloadXml.includes('WBINV'));assert.equal(p.inventoryAdjustments[0].signedCostOfGoods,-90);
 }
});
