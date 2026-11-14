import {createHash,randomUUID} from 'node:crypto';
import {ApiError} from './model.mjs';

// Reparse only an existing server-recorded HTTPS response. This never sends,
// imports caller-supplied acceptance, or retries an unresolved transmission.
export async function reconcileSavedReceipt(store,filing,attemptId,actor='authorized-agent'){
 const row=store.db.prepare('SELECT s.*,r.year FROM submissions s JOIN returns r ON r.id=s.return_id WHERE s.id=?').get(attemptId);
 if(!row||row.status!=='unknown')throw new ApiError(409,'Only a saved unknown receipt can be reconciled.');
 const original=JSON.parse(row.response||'null');
 if(original?.httpStatus!==200||!original.rawResponseBase64||!original.responseSha256)throw new ApiError(409,'No complete saved CRA response is available. Check CRA before retrying.');
 const bytes=Buffer.from(original.rawResponseBase64,'base64');
 if(createHash('sha256').update(bytes).digest('hex')!==original.responseSha256)throw new ApiError(409,'Saved receipt integrity check failed.');
 if(typeof original.rawResponseXml!=='string'||!bytes.equals(Buffer.from(original.rawResponseXml,'latin1')))throw new ApiError(409,'Saved XML differs from its original response bytes.');
 const parsed=await filing.parseResponse(original.rawResponseXml,{year:row.year});
 if(parsed.schemaValidated!==true||!['accepted','rejected'].includes(parsed.status)||(parsed.status==='accepted'&&!parsed.confirmationCode?.trim()))throw new ApiError(409,'The saved response does not validate as a definitive acceptance or rejection. Do not resend automatically.');
 const response={...original,...parsed,confirmationNumber:parsed.status==='accepted'?parsed.confirmationCode:null,message:parsed.messages?.join('\n')||original.message,receivedAt:original.receivedAt,reconciledAt:new Date().toISOString()};
 return store.transaction(()=>{
  const current=store.db.prepare('SELECT status,response FROM submissions WHERE id=?').get(attemptId);
  if(current.status!=='unknown'||current.response!==row.response)throw new ApiError(409,'The receipt changed during reconciliation.');
  store.db.exec('CREATE TABLE IF NOT EXISTS receipt_reconciliations(id TEXT PRIMARY KEY,submission_id TEXT NOT NULL REFERENCES submissions(id),prior_response TEXT NOT NULL,reconciled_response TEXT NOT NULL,actor TEXT NOT NULL,created_at TEXT NOT NULL)');
  store.db.prepare('INSERT INTO receipt_reconciliations VALUES(?,?,?,?,?,?)').run(randomUUID(),attemptId,row.response,JSON.stringify(response),actor,response.reconciledAt);
  store.db.prepare("UPDATE submissions SET status=?,confirmation_number=?,message=?,response=? WHERE id=?").run(parsed.status,response.confirmationNumber,response.message,JSON.stringify(response),attemptId);
  return store.submissions.list(row.return_id).find(a=>a.id===attemptId);
 });
}
