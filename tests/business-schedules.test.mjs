import test from 'node:test';
import assert from 'node:assert/strict';
import {renderBusinessSchedules} from '../server/business-schedules.mjs';
const item=result=>({year:2024,revision:3,fields:{'BUSIN:00021:T:1':'Synthetic <consulting>'},calculation:{id:'calc-3',inputRevision:3,result}});
test('business review schedules show all adjustment families and safely escape source material',()=>{
 const shared={businessId:'1',scope:'primary'};
 const output=renderBusinessSchedules(item({homeOfficeClaims:[{...shared,currentExpenses:1200,priorUnusedExpenses:100,incomeBeforeHomeOffice:1000,deduction:1000,unusedExpenses:300,eligibilityConfirmed:false,sourceReference:'<img src=x onerror=alert(1)>',basis:'Prepared business-use amount'}],inventoryAdjustments:[{...shared,signedCostOfGoods:-90,sourceBasis:'Stock schedule'}],ccaAdjustments:[{...shared,classId:'1',assetId:'2',eligibleCost:1000,classCcaClaim:500,closingUcc:500,eligibilityConfirmed:true,acquiredDate:'2024-04-01',availableForUseDate:'2024-04-02',sourceReference:'Invoice',eligibilityBasis:'Qualifying synthetic asset'}],allocationAdjustments:[{...shared,ownershipPercentage:50,profitPercentage:50,lossPercentage:100,effectiveAllocationPercentage:100,partnershipIncomeBeforePartnerAdjustments:-1000}]}));
 assert.equal(output.inputRevision,3);assert.equal(output.calculationId,'calc-3');assert.equal(output.year,2024);
 for(const text of ['not CRA forms','1200 CAD','100 CAD','300 CAD','-90 CAD','Total CCA claim','50%','100%','Not yet selected for filing','&lt;img','&lt;consulting&gt;','Do not add repeated class'])assert.ok(output.html.includes(text),text);
 assert.ok(!/<(?:script|img|style)\b/i.test(output.html));assert.ok(!/\bon\w+=/i.test(output.html.replaceAll('&lt;img src=x onerror=alert(1)&gt;','')));
});
test('business schedules require a current calculation and describe empty adjustments',()=>{
 assert.throws(()=>renderBusinessSchedules({year:2024}),/Calculate/);
 const stale=item({});stale.revision=4;assert.throws(()=>renderBusinessSchedules(stale),/Recalculate/);
 assert.match(renderBusinessSchedules(item({})).html,/No supplementary business adjustments/);
});

test('current owner-selected claims are displayed as selected for filing without inventing an independent eligibility check',()=>{const d=item({homeOfficeClaims:[{businessId:'1',scope:'primary',eligibilityConfirmed:false,currentExpenses:1200}]});d.preparationDecisions=[{topic:'home-office',businessId:'1',status:'selected-treatment',stale:false,description:'Owner directs filing this claim'}];const html=renderBusinessSchedules(d).html;assert.match(html,/Selected for filing — owner authorized/);assert.ok(!html.includes('Provisional'));assert.equal(d.calculation.result.homeOfficeClaims[0].eligibilityConfirmed,false);});
