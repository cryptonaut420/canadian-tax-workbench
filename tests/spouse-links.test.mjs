import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../server/store.mjs';
import {SpouseLinks} from '../server/spouse-links.mjs';
function fixture(t){
 const s=new Store(':memory:');s.spouseLinks??=new SpouseLinks(s);t.after(()=>s.close());
 const p=s.addPerson({name:'Synthetic primary',birthDate:'1988-01-01',province:'BC',maritalStatus:'MARR'}),q=s.addPerson({name:'Synthetic spouse',birthDate:'1989-01-01',province:'BC',maritalStatus:'MARR'});
 const target=s.create({personId:p.id,year:2025,fields:{'SPOUS:00051:C':'40000.00'}}),source=s.create({personId:q.id,year:2025,fields:{'SPOUS:00051:C':'60000.00'}});
 const result=s.saveCalculation(source.id,source.revision,{fields:{'T1GEN:00236:C':'50000.50'},lines:{'23600':'50000.50'}});
 return {s,target,source:result,p,q};
}
test('explicit spouse-income source copies exact current income, tracks changes and accepts same-value recalculation',t=>{
 const {s,target,source}=fixture(t),beforeVersion=s.changeVersion();
 const linked=s.spouseLinks.link(target.id,{expectedRevision:target.revision,sourceReturnId:source.id,sourceCalculationId:source.calculation.id},'synthetic-agent');
 assert.equal(linked.return.fields['SPOUS:00051:C'],'50000.50');assert.equal(linked.return.revision,target.revision+1);assert.equal(linked.issues.length,0);assert.ok(s.changeVersion()>beforeVersion);
 const again=s.saveCalculation(source.id,source.revision,{fields:{'T1GEN:00236:C':'50000.500'},lines:{'23600':'50000.500'}});
 assert.equal(s.spouseLinks.assess(target.id).issues.length,0,'recalculation with same monetary value is current');
 const changed=s.update(source.id,{expectedRevision:source.revision,fields:{...source.fields,'T4SLI:00014:C:1':'70000.00'}});
 assert.match(s.spouseLinks.assess(target.id).issues[0],/changed or has no current/);
 const recalculated=s.saveCalculation(source.id,changed.revision,{fields:{'T1GEN:00236:C':'70000.00'},lines:{'23600':'70000.00'}});
 assert.match(s.spouseLinks.assess(target.id).issues[0],/differs/);
 const refresh=s.spouseLinks.link(target.id,{expectedRevision:linked.return.revision,sourceReturnId:source.id,sourceCalculationId:recalculated.calculation.id});
 assert.equal(refresh.return.fields['SPOUS:00051:C'],'70000.00');assert.equal(refresh.issues.length,0);
 const detached=s.spouseLinks.unlink(target.id,{expectedRevision:refresh.return.revision});
 assert.equal(detached.link,null);assert.equal(detached.return.fields['SPOUS:00051:C'],'70000.00');assert.equal(s.spouseLinks.assess(target.id).issues.length,0);
});
test('same-value links preserve math snapshots but invalidate review, and reject wrong people, years or stale source identities',t=>{
 const {s,target,source,p}=fixture(t);
 const equal=s.update(target.id,{expectedRevision:target.revision,fields:{...target.fields,'SPOUS:00051:C':'50000.50'}});
 const calculated=s.saveCalculation(equal.id,equal.revision,{fields:{'T1GEN:00150:C':'60000.00'},lines:{'15000':'60000.00'}});
 const reviewed=s.review(calculated.id,{expectedRevision:calculated.revision,calculationId:calculated.calculation.id},'synthetic-human');
 const linked=s.spouseLinks.link(target.id,{expectedRevision:reviewed.revision,sourceReturnId:source.id,sourceCalculationId:source.calculation.id});
 assert.equal(linked.return.revision,reviewed.revision);assert.equal(linked.return.calculation.id,reviewed.calculation.id);assert.equal(linked.return.state,'calculated');
 assert.throws(()=>s.spouseLinks.link(target.id,{expectedRevision:linked.return.revision,sourceReturnId:target.id,sourceCalculationId:reviewed.calculation.id}),/another person/);
 assert.throws(()=>s.spouseLinks.link(target.id,{expectedRevision:linked.return.revision,sourceReturnId:source.id,sourceCalculationId:'stale'}),/current source/);
 const otherYear=s.create({personId:p.id,year:2024});assert.throws(()=>s.spouseLinks.link(otherYear.id,{expectedRevision:otherYear.revision,sourceReturnId:source.id,sourceCalculationId:source.calculation.id}),/same tax year/);
 assert.throws(()=>s.spouseLinks.unlink(target.id,{expectedRevision:0}),/changed/);
});
