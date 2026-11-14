import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {Store} from '../server/store.mjs';
import {reconcileSavedReceipt} from '../server/receipt-reconciliation.mjs';
test('offline receipt reconciliation preserves original evidence, timestamps and accepted baseline without adding a send',async()=>{
 const s=new Store(':memory:');try{
 const p=s.addPerson({name:'Synthetic receipt',birthDate:'1988-01-01',province:'BC',maritalStatus:'SING'});let r=s.create({personId:p.id,year:2021});r=s.saveCalculation(r.id,1,{fields:{},lines:{}});
 // Persist the same plan/attempt relationship created by a real send; all data synthetic.
 s.db.prepare('INSERT INTO submission_plans VALUES(?,?,?,?,?,?,?,?,?,?)').run('synthetic-plan',r.id,r.calculation.id,1,'netfile','2099-01-01','{}','<synthetic baseline/>',null,'2026-01-01T00:00:00Z');
 const xml='<synthetic saved response/>',response={httpStatus:200,status:'unknown',rawResponseXml:xml,rawResponseBase64:Buffer.from(xml,'latin1').toString('base64'),responseSha256:createHash('sha256').update(xml).digest('hex'),receivedAt:'2026-01-01T00:00:01Z'};
 s.db.prepare('INSERT INTO submissions(id,return_id,calculation_id,input_revision,mode,status,requested_at,completed_at,payload_hash,actor,idempotency_key,plan_id,response) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run('synthetic-attempt',r.id,r.calculation.id,1,'netfile','unknown','2026-01-01T00:00:00Z','2026-01-01T00:00:01Z','synthetic-hash','test','synthetic-key','synthetic-plan',JSON.stringify(response));
 let parsed=0;const filing={async parseResponse(saved,{year}){parsed++;assert.equal(saved,xml);assert.equal(year,2021);return{schemaValidated:true,status:'accepted',confirmationCode:'SYNTH12345',messages:['Synthetic accepted'],receivedAt:'2099-01-01'};}};
 const result=await reconcileSavedReceipt(s,filing,'synthetic-attempt','test');assert.equal(result.status,'accepted');assert.equal(result.confirmationNumber,'SYNTH12345');assert.equal(result.completedAt,response.receivedAt);assert.equal(s.submissions.state(r.id).mode,'refile');assert.equal(s.submissions.state(r.id).blocked,false);assert.equal(s.submissions.acceptedPayload(r.id),'<synthetic baseline/>');assert.equal(s.submissions.list(r.id).length,1);
 const audit=s.db.prepare('SELECT * FROM receipt_reconciliations').get();assert.deepEqual(JSON.parse(audit.prior_response),response);assert.equal(JSON.parse(audit.reconciled_response).receivedAt,response.receivedAt);assert.equal(parsed,1);
 await assert.rejects(reconcileSavedReceipt(s,filing,'synthetic-attempt'),/Only a saved unknown/);
 s.db.prepare("UPDATE submissions SET status='unknown',response=? WHERE id='synthetic-attempt'").run(JSON.stringify({...response,responseSha256:'tampered'}));await assert.rejects(reconcileSavedReceipt(s,filing,'synthetic-attempt'),/integrity/);assert.equal(parsed,1);
 s.db.prepare("UPDATE submissions SET status='unknown',response=? WHERE id='synthetic-attempt'").run(JSON.stringify(response));
 const rejected=await reconcileSavedReceipt(s,{async parseResponse(){return{schemaValidated:true,status:'rejected',errorCodes:['180002'],messages:['Synthetic industry error']};}},'synthetic-attempt','test');assert.equal(rejected.status,'rejected');assert.equal(rejected.confirmationNumber,null);assert.equal(s.submissions.state(r.id).mode,'netfile');assert.equal(s.submissions.state(r.id).blocked,false);assert.equal(s.submissions.acceptedPayload(r.id),null);assert.equal(s.submissions.list(r.id).length,1);
 }finally{s.close();}
});
