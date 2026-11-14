import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {NativeEngine} from '../server/engine.mjs';
import {Store} from '../server/store.mjs';
import {preparationIssues,profileFields} from '../server/model.mjs';
test('2019–2025 native modules preserve every original byte except the architecture flag',{skip:!existsSync('/var/www/genutax-cpp-patch/app-original/GT2019Calculations.dll')},()=>{
 for(const m of JSON.parse(readFileSync('engines/manifest.json'))){
  const source=readFileSync(`/var/www/genutax-cpp-patch/app-original/${m.file}`),native=readFileSync(`engines/${m.file}`);
  assert.equal(source.length,native.length);source.writeUInt32LE(m.cliFlags,m.flagOffset);assert.deepEqual(source,native,String(m.year));
 }
});
test('each year uses its own residency input; legacy newer-year drafts need correction',()=>{
 const dir=mkdtempSync(join(tmpdir(),'year-mapping-'));const store=new Store(join(dir,'db.sqlite'));
 try{const p=store.addPerson({name:'Synthetic full-year resident',birthDate:'1988-01-01',province:'BC',maritalStatus:'SING'});
 for(let year=2019;year<=2025;year++){const r=store.create({personId:p.id,year});assert.equal(r.fields[year>=2023?'RESID:00301:R':'RESID:00001:R'],year>=2023?'1':'Yes');assert.equal(r.issues.length,0);}
 assert.ok(preparationIssues({'TAXPY:00031:D':'1988-01-01','RESID:00002:O':'BC','RESID:00001:R':'Yes'},2023).some(s=>s.includes('older Yes/No')));
 assert.equal(profileFields({...p,residency:'No'},2024)['RESID:00301:R'],undefined,'never guess a nonresident scenario');
 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
test('seven yearly engines produce stable native calculations and original print lists',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'yearly-native-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const engine=new NativeEngine(resolve('.'),dir);await engine.initialize();
 for(let year=2019;year<=2025;year++){
  const fields={...profileFields({birthDate:'1988-01-01',province:'BC',maritalStatus:'SING',residency:'Yes'},year),
   'T4SLI:00010:O:1':'BC','T4SLI:00014:C:1':'60000.00','T4SLI:00016:C:1':'2900.00','T4SLI:00018:C:1':'889.54','T4SLI:00022:C:1':'10000.00','T4SLI:00024:C:1':'56300.00','T4SLI:00026:C:1':'60000.00'};
  const result=spawnSync('dotnet',[engine.dll,'verify-stability'],{input:JSON.stringify({year,fields}),encoding:'utf8',env:{...process.env,...engine.env},maxBuffer:16*1024*1024});
  assert.equal(result.status,0,result.stderr);const data=JSON.parse(result.stdout);
  assert.equal(data.stability.stable,true,`${year}: ${data.stability.changedFields.join(', ')}`);
  assert.ok(data.printList.length>0);assert.ok(data.printList.some(s=>s.startsWith('T1')));assert.ok(Number(data.fields['T1GEN:00428:C'])>0,`${year} must include BC tax`);
 }
});

test('native typed visibility supplies omitted false section conditions without changing financial fields',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'native-visibility-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const engine=new NativeEngine(resolve('.'),dir);await engine.initialize();
 const result=await engine.calculate({year:2019,fields:{'TAXPY:00031:D':'1988-01-01','RESID:00001:R':'Yes','RESID:00002:O':'BC','MARST:00001:O':'SING','MARST:00002:R':'Yes','MARST:00011:D:1':'2020-10-10','MARST:00012:O:1':'MARR'}});
 assert.equal(result.interviewConditions['MARST:00032:B'],'false');assert.ok(Object.keys(result.interviewConditions).length>10);assert.equal(result.spouseInterviewConditions,null);assert.ok(!Object.hasOwn(result.fields,'MARST:00032:B'),'visibility is separate from sparse calculation snapshot');assert.equal(result.convergence.stable,true);
});
