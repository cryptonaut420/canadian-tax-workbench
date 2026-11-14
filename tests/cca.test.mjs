import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {NativeEngine} from '../server/engine.mjs';import {writeBusiness,businesses,businessCatalog} from '../server/business.mjs';
const root=new URL('..',import.meta.url).pathname;
const business=y=>({name:'Synthetic CCA asset',type:'OTHR',ownership:'SOLE',accounting:'ACCR',fiscalStart:`${y}-01-01`,fiscalEnd:`${y}-12-31`,sales:'80000'});
const addition=y=>({id:'1',description:'Synthetic equipment',cost:'1000.00',personalPortion:'0',acceleratedInvestment:'Yes',...(y===2019?{acquiredAfterNovember2018:'Yes'}:{}),...(y>=2022?{acquiredYear:y===2022?'Yes':y===2023?'AFT22':y===2024?'AFT23':'AFT24',immediateExpensing:'No'}:{}),...(y===2025?{reacceleratedInvestment:'Yes'}:{})});
test('CCA additions have original year-specific catalogs, validation and replacement semantics',()=>{
 assert.ok(businessCatalog(2025).ccaAdditions.reacceleratedInvestment);assert.equal(businessCatalog(2024).ccaAdditions.reacceleratedInvestment,undefined);
 const b=writeBusiness({}, {...business(2025),ccaClasses:[{id:'1',classNumber:'8',openingUcc:'10000',additions:[addition(2025)]}]},2025);
 assert.deepEqual(businesses(b.fields)[0].ccaClasses[0].additions,[addition(2025)]);
 assert.equal(b.fields['BUCCA:00122:C:1:1:1'],'1000.00');assert.equal(b.fields['BUCCA:00025:R:1:1'],'Yes');
 const cleared=writeBusiness(b.fields,{id:'1',ccaClasses:[{id:'1',additions:[]}]},2025);assert.deepEqual(businesses(cleared.fields)[0].ccaClasses[0].additions,[]);assert.equal(cleared.fields['BUCCA:00025:R:1:1'],'No');
 for(const bad of [{cost:'-1'},{personalPortion:'1001'},{acquiredYear:'Yes'},{description:''}])assert.throws(()=>writeBusiness({}, {...business(2025),ccaClasses:[{id:'1',classNumber:'8',additions:[{...addition(2025),...bad}]}]},2025),/CCA/);
 assert.throws(()=>writeBusiness({}, {...business(2024),ccaClasses:[{id:'1',classNumber:'8',additions:[addition(2025)]}]},2024),/CCA/);
});
test('native original class8 applies accelerated, phased and reaccelerated additions in all supported years',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'workbench-cca-')),engine=new NativeEngine(root,dir);
 try{await engine.initialize();for(const y of [2019,2020,2021,2022,2023,2024,2025]){
 const b=writeBusiness({'TAXPY:00031:D':'1988-01-01','RESID:00002:O':'BC','MARST:00001:O':'SING'}, {...business(y),ccaClasses:[{id:'1',classNumber:'8',openingUcc:'10000',...(y<=2021?{hasAssetsRemaining:'Yes'}:{disposedAll:'No',claimMode:'FULL'}),additions:[addition(y)]}]},y);
 const result=await engine.calculate({year:y,fields:b.fields});assert.equal(Number(result.fields['BUSIN:09936:C:1']),y===2024?2200:2300,`${y} CCA`);assert.equal(Number(result.fields['BUCCA:00310:C:1:1']),y===2024?8800:8700,`${y} closing UCC`);
 }}finally{rmSync(dir,{recursive:true,force:true});}
});
