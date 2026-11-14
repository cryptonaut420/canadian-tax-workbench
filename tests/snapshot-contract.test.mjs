import test from 'node:test';
import assert from 'node:assert/strict';
import {financialDifferences} from '../server/snapshot.mjs';
const fields={'T1GEN:00484:C':'200.00'};
test('financial agreement fails closed when either calculation snapshot is missing or malformed',()=>{
 for(const invalid of [undefined,null,[],false,'not a field map']){
  assert.equal(financialDifferences(fields,invalid).length,1);
  assert.equal(financialDifferences(invalid,fields).length,1);
  assert.equal(financialDifferences(invalid,invalid).length,1);
 }
 assert.equal(financialDifferences(undefined,undefined).length,1,'an omitted property cannot prove primary agreement');
 assert.deepEqual(financialDifferences(null,null,{optional:true}),[]);
 assert.deepEqual(financialDifferences(undefined,undefined,{optional:true}),[]);
 assert.equal(financialDifferences(fields,undefined,{optional:true}).length,1,'an existing spouse requires the matching spouse snapshot');
 assert.equal(financialDifferences(undefined,fields,{optional:true}).length,1);
 assert.deepEqual(financialDifferences(fields,{'T1GEN:00484:C':'200'}),[]);
 assert.equal(financialDifferences(fields,{}).length,1);
});
