import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {NativeEngine} from '../server/engine.mjs';

const mappings=JSON.parse(readFileSync(new URL('../research/input-mappings.json',import.meta.url)));
test('all original interviews use the recorded marital/spouse options and 2023 residency categories',()=>{
  assert.deepEqual(mappings.years.map(x=>x.year),[2019,2020,2021,2022,2023,2024,2025]);
  for(const year of mappings.years){
    assert.match(year.resourceAssemblySha256,/^[0-9a-f]{64}$/);assert.match(year.evidenceId,/^ev_/);
    const marital=year.topics.find(x=>x.id==='MARSTA0001').fields[0];
    assert.equal(marital.code,'MARST:00001:O');assert.deepEqual(marital.options.map(x=>x.value),['MARR','COLA','WIDO','DIVO','SEPA','SING']);
    assert.ok(year.topics.find(x=>x.id==='SPOUSE0001').fields.some(x=>x.code==='SPOUS:00031:D'));
    assert.equal(year.topics.find(x=>x.id==='SPOUSE0002').fields[0].code,'SPOUS:00051:C');
    if(year.year>=2023)assert.deepEqual(year.topics.flatMap(x=>x.fields).find(x=>x.code==='RESID:00301:R').options.map(x=>x.value),['1','2','3','4','5','6','7']);
  }
});

test('native spouse credit consumes manual net income and coupled returns mirror actual net income/DOB',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'tax-spouse-map-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const engine=new NativeEngine(resolve('.'),dir);await engine.initialize();
  const fixture=JSON.parse(readFileSync(new URL('../examples/synthetic-2021.json',import.meta.url)));
  const base={...fixture.fields,'MARST:00001:O':'MARR','MARST:00002:R':'No','SPOCR:00001:R':'Yes','SPOUS:00031:D':'1989-02-03'};
  const zero=await engine.calculate({year:2021,fields:{...base,'SPOUS:00051:C':'0.00'}});
  const high=await engine.calculate({year:2021,fields:{...base,'SPOUS:00051:C':'20000.00'}});
  assert.equal(zero.lines['30300'],'13808.00');assert.equal(high.lines['30300'],'0.00');
  const spouse={...fixture.fields,'TAXPY:00031:D':'1989-02-03','MARST:00001:O':'MARR','MARST:00002:R':'No',
    'T4SLI:00014:C:1':'20000.00','T4SLI:00016:C:1':'825.00','T4SLI:00018:C:1':'316.00','T4SLI:00022:C:1':'1000.00'};
  const coupled=await engine.calculate({year:2021,fields:base,spouseFields:spouse});
  assert.equal(coupled.fields['SPOUS:00101:C'],coupled.spouseFields['T1GEN:00236:C']);
  assert.equal(coupled.fields['SPOUS:00101:C'],'19924.31');
  assert.equal(coupled.fields['SPOUS:00031:D'],'1989-02-03');
  assert.equal(coupled.spouseFields['SPOUS:00031:D'],fixture.fields['TAXPY:00031:D']);
});
