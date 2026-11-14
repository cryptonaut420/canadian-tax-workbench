import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {NativeEngine} from '../server/engine.mjs';import {writeBusiness} from '../server/business.mjs';
import {writeEnhancedCca2024,readEnhancedCca2024,validateEnhancedCca2024,enhancedCca2024Issues} from '../server/enhanced-cca.mjs';
const root=new URL('..',import.meta.url).pathname;
const eligibility={classId:'1',assetId:'1',eligibilityConfirmed:false,acquiredDate:'2024-05-01',availableForUseDate:'2024-05-01',sourceReference:'Synthetic acquisition invoice',eligibilityBasis:'Synthetic qualifying class50 AIIP; review previous-use and arm-length restrictions.'};
function source(){return writeBusiness({'TAXPY:00031:D':'1988-01-01','RESID:00002:O':'BC','MARST:00001:O':'SING'},{name:'Synthetic enhanced CCA',type:'OTHR',ownership:'SOLE',accounting:'ACCR',fiscalStart:'2024-01-01',fiscalEnd:'2024-12-31',sales:'80000',ccaClasses:[{id:'1',classNumber:'50',openingUcc:'2000',disposedAll:'No',claimMode:'FULL',additions:[{id:'1',description:'Synthetic computer',cost:'1000',personalPortion:'0',acceleratedInvestment:'Yes',acquiredYear:'AFT23',immediateExpensing:'No'}]}]},2024).fields;}
test('enhanced2024 CCA requires original qualifying assets and explicit source-backed eligibility',()=>{
 const f=writeEnhancedCca2024(source(),[eligibility],'1',2024);assert.deepEqual(readEnhancedCca2024(f,'1'),[eligibility]);assert.equal(enhancedCca2024Issues(f).length,1);
 const confirmed=writeEnhancedCca2024(f,[{...eligibility,eligibilityConfirmed:true}],'1',2024);assert.deepEqual(enhancedCca2024Issues(confirmed),[]);
 assert.equal(Object.keys(writeEnhancedCca2024(f,null,'1',2024)).some(k=>k.startsWith('WBCCA:')),false);
 for(const patch of [{acquiredDate:'2024-04-15'},{availableForUseDate:'2024-04-30'},{sourceReference:''},{eligibilityConfirmed:undefined},{claimAmount:'10000'}])assert.throws(()=>writeEnhancedCca2024(source(),[{...eligibility,...patch}],'1',2024),/CCA|Enhanced/);
 assert.throws(()=>writeEnhancedCca2024(source(),[eligibility],'1',2025),/restricted/);
 assert.throws(()=>validateEnhancedCca2024({...f,'BUCCA:00021:O:1:1':'8'},2024),/class50/);
 assert.throws(()=>validateEnhancedCca2024({...f,'BUCCA:00040:R:1:1':'Yes'},2024),/disposition/);
 assert.doesNotThrow(()=>validateEnhancedCca2024({...f,'BUDSP:00001:R:1:1':'No','BUDSP:00012:R:1:1':'LEAV'},2024));
 assert.throws(()=>validateEnhancedCca2024({...f,'BUDSP:00021:T:1:1:1':'Disposed computer'},2024),/disposition/);
});
test('2024 enhanced class50 adapter preserves original claim limits and UCC while handling provisional eligibility',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'workbench-enhancedcca-')),engine=new NativeEngine(root,dir);try{await engine.initialize();
 const original=source();const before=await engine.calculate({year:2024,fields:original});assert.equal(Number(before.fields['BUSIN:09936:C:1']),1650);
 const enhanced=writeEnhancedCca2024(original,[eligibility],'1',2024);const result=await engine.calculate({year:2024,fields:enhanced});
 assert.equal(Number(result.fields['BUSIN:09936:C:1']),2100);assert.equal(Number(result.fields['BUCCA:00310:C:1:1']),900);
 const limited=await engine.calculate({year:2024,fields:{...enhanced,'BUCCA:00061:R:1:1':'PART','BUCCA:00062:C:1:1':'1800'}});assert.equal(Number(limited.fields['BUSIN:09936:C:1']),1800);assert.equal(Number(limited.fields['BUCCA:00310:C:1:1']),1200);
 const noClaim=await engine.calculate({year:2024,fields:{...enhanced,'BUCCA:00061:R:1:1':'NONE'}});assert.equal(Number(noClaim.fields['BUSIN:09936:C:1']||0),0);assert.equal(Number(noClaim.fields['BUCCA:00310:C:1:1']),3000);
 const carried=await engine.carryForward({year:2024,fields:{...enhanced,'BUSIN:00031:R:1':'No'}});assert.equal(Number(carried.fields['BUCCA:00022:C:1:1']),900,'enhanced closing UCC becomes the actual next-year opening pool');assert.ok(!Object.keys(carried.fields).some(k=>k.startsWith('WBCCA:')),'2024 eligibility metadata must not activate a second enhancement in 2025');
 }finally{rmSync(dir,{recursive:true,force:true});}
});
