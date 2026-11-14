import test from 'node:test';import assert from 'node:assert/strict';import{mkdtempSync,rmSync}from'node:fs';import{join,resolve}from'node:path';import{tmpdir}from'node:os';
import{writeBusiness,businesses,removeBusiness}from'../server/business.mjs';import{NativeEngine}from'../server/engine.mjs';import{NativeFiling}from'../server/filing-engine.mjs';import{renderPreview}from'../server/preview.mjs';
import{financialDifferences}from'../server/snapshot.mjs';
const root=resolve('.');const base=year=>({'TAXPY:00031:D':'1988-01-01','TAXPY:00011:T':'Synthetic','TAXPY:00013:T':'Filer','TAXPY:00001:S':'046454286','RESID:00002:O':'BC',[year>=2023?'RESID:00301:R':'RESID:00001:R']:year>=2023?'1':'Yes','MARST:00001:O':'SING','IDENT:00011:R':'CANA','IDENT:00014:T':'Example Street','IDENT:00016:T':'Prince George','IDENT:00017:O':'BC','IDENT:00018:A':'V2L 0A1','EMPIN:00001:R':'Yes','T4SLI:00010:O:1':'BC','T4SLI:00014:C:1':'60000.00','T4SLI:00016:C:1':'3000.00','T4SLI:00018:C:1':'900.00','T4SLI:00022:C:1':'10000.00','T4SLI:00024:C:1':'55000.00','T4SLI:00026:C:1':'60000.00'});
const input=year=>({name:'Synthetic partnership',type:'OTHR',ownership:'PART',ownershipPercentage:'50',numberOfPartners:'2',accounting:'ACCR',fiscalStart:`${year}-01-01`,fiscalEnd:`${year}-12-31`,sales:'1000.00',expenses:{office:'11000.00'},allocation:{profitPercentage:'50',lossPercentage:'100',agreementConfirmed:true}});
test('50% ownership with agreed100% losses calculates and previews but blocks unsupported NETFILE export in2020–2025',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'allocation-native-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const engine=new NativeEngine(root,dir),filing=new NativeFiling(root,dir);await engine.initialize();await filing.initialize();
 for(let year=2020;year<=2025;year++){
  const {fields}=writeBusiness(base(year),input(year),year);const r=await engine.calculate({year,fields});
  assert.equal(Number(r.fields['BUSIN:09369:C:1']),-10000,`${year}: entity loss`);
  assert.equal(Number(r.fields['BUSIN:09946:C:1']),-10000,`${year}: allocated loss`);
  assert.equal(Number(r.fields['BUSIN:00040:F:1']),50,`${year}: actual ownership preserved for forms/wire`);
  assert.equal(Number(r.lines['15000']),50000,`${year}: only allocated loss reduces personal income`);
  assert.equal(r.allocationAdjustments[0].effectiveAllocationPercentage,100);
  const prepared=await filing.prepare({year,fields});assert.deepEqual(financialDifferences(r.fields,prepared.calculationFields),[],`${year}: submission arithmetic matches preview snapshot`);
  assert.equal(prepared.schemaValidated,true,`${year}: XML schema alone does not validate business arithmetic`);assert.ok(prepared.validationErrors.some(e=>e.includes('cannot currently represent')&&e.includes('9946')),`${year}: mismatched allocation must not be transmitted`);
  assert.equal(prepared.allocationAdjustments[0].ownershipPercentage,50);assert.ok(!prepared.payloadXml.includes('WBALC'));
  assert.match(prepared.payloadXml,/<sfd:BusinessOwnershipPercent>5000<\/sfd:BusinessOwnershipPercent>/);
  assert.match(prepared.payloadXml,/<comm:FieldCode>9946<\/comm:FieldCode>\s*<comm:FieldValue>-10000<\/comm:FieldValue>/);
  const preview=renderPreview({year,formId:'T2125FO',page:1,instance:1,fields:{...fields,...r.fields},printList:r.printList});assert.match(preview.svg,/>50(?:\.0+)?<\/text>/,'original T2125 preview retains50% ownership');
  const cleaned=await engine.cleanInputs({year,fields});assert.equal(cleaned.primary.fields['WBALC:00002:P:1'],'100');assert.ok(!cleaned.primary.removedFields.some(k=>k.startsWith('WBALC:')));
  const profit=writeBusiness(fields,{id:'1',sales:'31000.00'},year).fields;const p=await engine.calculate({year,fields:profit});assert.equal(Number(p.fields['BUSIN:09369:C:1']),20000);assert.equal(Number(p.fields['BUSIN:09946:C:1']),10000,`${year}: profit remains50%`);assert.equal(p.allocationAdjustments[0].effectiveAllocationPercentage,50);
 }
});
test('allocation agreement is explicit, revision-friendly, removable and isolated to its business',()=>{
 const fields=writeBusiness(base(2021),input(2021),2021).fields;assert.equal(businesses(fields)[0].allocation.lossPercentage,'100');assert.equal(fields['BUSIN:00040:P:1'],'50');
 const cleared=writeBusiness(fields,{id:'1',allocation:null},2021).fields;assert.ok(!Object.keys(cleared).some(k=>k.startsWith('WBALC:')));assert.equal(cleared['BUSIN:00040:P:1'],'50');
 assert.ok(!Object.keys(removeBusiness(fields,'1').fields).some(k=>k.startsWith('WBALC:')));
 assert.throws(()=>writeBusiness(base(2021),{...input(2021),allocation:{profitPercentage:'50',lossPercentage:'100',agreementConfirmed:false}},2021),/Confirm/);
 assert.throws(()=>writeBusiness(base(2021),{...input(2021),ownership:'SOLE'},2021),/partnership/);
});
test('separate allocation preserves sole-proprietor income, original CCA and loss-limited home-office carryforward',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'allocation-combined-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const engine=new NativeEngine(root,dir);await engine.initialize();
 for(const year of [2021,2025]){
  let fields=writeBusiness(base(year),{...input(year),homeOffice:{eligible:'Yes',businessArea:'100',totalArea:'1000',other:'12000.00'},...(year<=2021?{ccaClaim:{limited:'Yes',limit:'500.00'}}:{}),ccaClasses:[{id:'1',classNumber:'8',openingUcc:'5000.00',...(year<=2021?{hasAssetsRemaining:'Yes'}:{disposedAll:'No',claimMode:'PART',claimAmount:'500.00'})}]},year).fields;
  fields=writeBusiness(fields,{name:'Synthetic sole proprietor',type:'PROF',ownership:'SOLE',accounting:'ACCR',fiscalStart:`${year}-01-01`,fiscalEnd:`${year}-12-31`,sales:'25000.00',expenses:{office:'5000.00'}},year).fields;
  const r=await engine.calculate({year,fields});assert.equal(Number(r.fields['BUSIN:09946:C:1']),-10500);assert.equal(Number(r.fields['BUSIN:09936:C:1']),500);assert.equal(Number(r.fields['BUSIN:09945:C:1']||0),0);assert.equal(Number(r.fields['BUSIN:00427:C:1']),1200);assert.equal(Number(r.fields['BUSIN:09946:C:2']),20000);assert.equal(Number(r.lines['15000']),69500);assert.equal(r.allocationAdjustments.length,1);
  const inactive=await engine.cleanInputs({year,fields:{...fields,'SELFE:00001:R':'No','BUSIN:00001:R':'No'}});assert.equal(inactive.primary.fields['WBALC:00002:P:1'],undefined,'clearing inactive business must also clear its app allocation metadata');
 }
});
