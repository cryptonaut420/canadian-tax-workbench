import test from 'node:test';
import assert from 'node:assert/strict';
import {readHomeOfficeClaim,writeHomeOfficeClaim,validateHomeOfficeClaims,homeOfficeClaimIssues} from '../server/home-office.mjs';
const fields={'BUSIN:00021:T:1':'Synthetic consulting','BUSIN:00101:C:1':'80000.00'};
const claim={currentExpenses:'1200.00',priorUnusedExpenses:'100.00',eligibilityConfirmed:false,sourceReference:'Synthetic household schedule, row12',basis:'Already apportioned eligible costs; no whole-home input supplied'};
test('pre-apportioned claims retain provenance and provisional eligibility without fabricating original inputs',()=>{
 const next=writeHomeOfficeClaim(fields,'1',claim);
 assert.deepEqual(readHomeOfficeClaim(next,'1'),claim);assert.equal(homeOfficeClaimIssues(next).length,1);
 assert.equal(next['BUSIN:00403:I:1'],undefined);assert.equal(next['BUSIN:00411:C:1'],undefined);assert.deepEqual(fields,{'BUSIN:00021:T:1':'Synthetic consulting','BUSIN:00101:C:1':'80000.00'});
 assert.equal(homeOfficeClaimIssues(writeHomeOfficeClaim(fields,'1',{...claim,eligibilityConfirmed:true})).length,0);
 assert.deepEqual(writeHomeOfficeClaim(next,'1',null),fields);
});
test('reject incomplete, malformed, contradictory or untraceable claims including direct field bypasses',()=>{
 for(const change of [{currentExpenses:'-1.00'},{currentExpenses:1200},{currentExpenses:'1.001'},{sourceReference:''},{basis:''},{eligibilityConfirmed:'true'},{priorUnusedExpenses:undefined},{netIncome:'100'}])assert.throws(()=>writeHomeOfficeClaim(fields,'1',{...claim,...change}));
 assert.throws(()=>writeHomeOfficeClaim({},'1',claim),/named business/);
 assert.throws(()=>writeHomeOfficeClaim({...fields,'BUSIN:00401:R:1':'Yes'},'1',claim),/either/);
 assert.throws(()=>writeHomeOfficeClaim({...fields,'BUSIN:00402:C:1':'100'},'1',claim),/either/);
 assert.throws(()=>writeHomeOfficeClaim({...fields,'BUSIN:00405:C:1':'100'},'1',claim),/either/);
 const next=writeHomeOfficeClaim(fields,'1',claim);delete next['WBHOM:00003:B:1'];assert.throws(()=>validateHomeOfficeClaims(next),/Explicitly/);
 assert.throws(()=>validateHomeOfficeClaims({...fields,'WBHOM:00001:T:1':'1200'}),/Unknown/);
});
