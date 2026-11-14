import {filingAvailability} from './filing-availability.mjs';
import { randomUUID, createHash } from 'node:crypto';
import { ApiError } from './model.mjs';

export const digest = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
const unresolved = ['sending', 'unknown'];
const now = () => new Date().toISOString();

// Only a trusted transport may record CRA acceptance. Browser/agent inputs cannot
// supply response status or turn a calculation into a filed return.
export class Submissions {
  constructor(store) { this.store = store; this.db = store.db; }
  list(id) {
    return this.db.prepare(`SELECT id,return_id AS returnId,calculation_id AS calculationId,input_revision AS inputRevision,
      mode,status,requested_at AS requestedAt,completed_at AS completedAt,confirmation_number AS confirmationNumber,
      cra_date AS craDate,payload_hash AS payloadHash,actor,message FROM submissions WHERE return_id=? ORDER BY rowid DESC`).all(id);
  }
  state(id) {
    this.db.prepare("UPDATE submissions SET status='unknown',completed_at=?,message='The application stopped before acceptance could be established. Check CRA before resending.' WHERE return_id=? AND status='sending' AND requested_at<?").run(now(),id,new Date(Date.now()-5*60000).toISOString());
    const attempts = this.list(id), accepted = attempts.find(a => a.status === 'accepted'), pending = attempts.find(a => unresolved.includes(a.status)), row=this.store.row(id);
    return { mode: accepted || row.filing_mode==='refile' ? 'refile' : 'netfile', status: pending?.status || (accepted ? 'accepted' : attempts[0]?.status || (row.filing_mode==='refile'?'amendment-draft':'unfiled')),
      submittedAt: accepted?.completedAt || null, confirmationNumber: accepted?.confirmationNumber || null,
      availability:filingAvailability(row.year,accepted||row.filing_mode==='refile'?'refile':'netfile'),lastAccepted: accepted || null, latestAttempt: attempts[0] || null, blocked: !!pending, attempts };
  }
  acceptedPayload(id) {
    return this.db.prepare(`SELECT p.payload FROM submissions s JOIN submission_plans p ON s.plan_id=p.id WHERE s.return_id=? AND s.status='accepted' ORDER BY s.rowid DESC LIMIT 1`).get(id)?.payload || this.store.row(id).amendment_baseline || null;
  }
  receipt(id, attemptId) {
    const a=this.db.prepare('SELECT * FROM submissions WHERE return_id=? AND id=?').get(id,attemptId);
    if(!a)throw new ApiError(404,'Submission receipt not found.');
    return {format:'tax-workbench-receipt/v1',attempt:this.list(id).find(x=>x.id===attemptId),response:a.response ? JSON.parse(a.response) : null,dateSource:'Local attempt and receipt timestamps; no CRA submission date was supplied.'};
  }
  assertSnapshot(id, input) {
    const r = this.store.row(id);
    if (r.revision !== input.expectedRevision || !r.calculation_id || r.calculation_id !== input.calculationId) throw new ApiError(409, 'The return or calculation changed. Review the latest snapshot.');
    if (r.reviewed_calculation_id !== r.calculation_id) throw new ApiError(409, 'Mark the current calculation reviewed before preparing a submission.');
    if (this.store.get(id).issues.length) throw new ApiError(409, 'Resolve the return’s preparation issues before filing.');
    const filing = this.state(id);
    if (filing.blocked) throw new ApiError(409, 'A previous transmission has an unresolved outcome. Check CRA’s record before another attempt.');
    if (input.mode !== filing.mode) throw new ApiError(409, filing.mode === 'refile' ? 'This return was already accepted. Use ReFILE for an amendment.' : 'This return has no accepted NETFILE submission.');
    return r;
  }
  prepare(id, input, prepared, capability) {
    return this.store.transaction(() => {
      const r = this.assertSnapshot(id, input);
      const issues = prepared.validationErrors || [];
      const ready = capability.liveReady === true && prepared.liveReady !== false && prepared.schemaValidated === true && !issues.length;
      const challengeId = randomUUID(), expiresAt = new Date(Date.now() + 10 * 60000).toISOString();
      const phrase = `${input.mode === 'refile' ? 'REFILE' : 'FILE'} ${r.year}`;
      const payload = prepared.payloadXml || '';
      const plan = { challengeId, returnId:id, calculationId:r.calculation_id, inputRevision:r.revision, mode:input.mode,
        expiresAt, phrase, liveReady:ready, schemaValidated:prepared.schemaValidated === true, payloadHash:digest(Buffer.from(payload,'latin1')),
        validationErrors:issues, warnings:prepared.warnings || [], blockers:capability.blockers || [],
        priorSubmission:this.state(id).lastAccepted, terms:capability.terms || null };
      plan.settingsRevision=capability.settingsRevision ?? this.store.settings.get().revision;
      plan.originatingIP=capability.originatingIP || null;
      plan.requiredAcknowledgements=prepared.requiredAcknowledgements || [];
      this.db.prepare('INSERT INTO submission_plans VALUES(?,?,?,?,?,?,?,?,?,?)').run(challengeId,id,r.calculation_id,r.revision,input.mode,expiresAt,JSON.stringify(plan),payload,null,now());
      return plan;
    });
  }
  begin(id, input, actor) {
    return this.store.transaction(() => {
      if (typeof input.idempotencyKey !== 'string' || !/^[\w-]{12,100}$/.test(input.idempotencyKey)) throw new ApiError(400, 'Provide an idempotencyKey of 12–100 letters, digits, underscores or hyphens.');
      const previous = this.db.prepare('SELECT * FROM submissions WHERE return_id=? AND idempotency_key=?').get(id,input.idempotencyKey);
      if (previous) {
        if (previous.plan_id !== input.challengeId) throw new ApiError(409,'This idempotency key belongs to a different submission plan.');
        return { replay:true, attempt:this.list(id).find(a=>a.id===previous.id) };
      }
      const p = this.db.prepare('SELECT * FROM submission_plans WHERE id=? AND return_id=?').get(input.challengeId,id);
      if (!p || p.consumed_at || p.expires_at < now()) throw new ApiError(409,'The confirmation expired or was already used. Prepare a new submission.');
      const plan = JSON.parse(p.plan);
      const settings=this.store.settings.get();
      if(!settings.liveSubmissions || settings.revision!==plan.settingsRevision)throw new ApiError(409,'Live submission settings changed or are disabled. Prepare and confirm again.');
      this.assertSnapshot(id,{expectedRevision:p.input_revision,calculationId:p.calculation_id,mode:p.mode});
      if (input.confirmed !== true || input.phrase !== plan.phrase || input.acceptedTerms !== true) throw new ApiError(400,'Check the confirmation and terms boxes and type the exact confirmation phrase.');
      if (p.mode === 'refile' && input.confirmResubmission !== true) throw new ApiError(400,'Explicitly confirm that you intend to amend a previously accepted return using ReFILE.');
      const acknowledged=new Set(Array.isArray(input.acknowledgements)?input.acknowledgements:[]);
      if((plan.requiredAcknowledgements || []).some(a=>!acknowledged.has(a.id)))throw new ApiError(400,'Acknowledge every raised original-software confirmation before sending.');
      if (!plan.liveReady) throw new ApiError(501,'Live filing is not enabled. The offline plan and validation results are available for review.');
      const attemptId = randomUUID(), timestamp = now();
      this.db.prepare(`INSERT INTO submissions(id,return_id,calculation_id,input_revision,mode,status,requested_at,payload_hash,actor,idempotency_key,plan_id)
        VALUES(?,?,?,?,?,'sending',?,?,?,?,?)`).run(attemptId,id,p.calculation_id,p.input_revision,p.mode,timestamp,plan.payloadHash,actor,input.idempotencyKey,p.id);
      this.db.prepare('UPDATE submission_plans SET consumed_at=? WHERE id=?').run(timestamp,p.id);
      return { replay:false, attempt:this.list(id).find(a=>a.id===attemptId), payloadXml:p.payload, mode:p.mode,plan };
    });
  }
  finish(id, response) {
    return this.store.transaction(() => {
      const attempt = this.db.prepare('SELECT * FROM submissions WHERE id=?').get(id);
      if (!attempt || attempt.status !== 'sending') throw new ApiError(409,'The attempt is no longer awaiting a response.');
      const validAccepted = response.status === 'accepted' && typeof response.confirmationNumber === 'string' && !!response.confirmationNumber.trim();
      const status = validAccepted ? 'accepted' : response.status === 'cancelled' && response.networkAttempted===false ? 'cancelled' : response.status === 'rejected' ? 'rejected' : 'unknown';
      this.db.prepare(`UPDATE submissions SET status=?,completed_at=?,confirmation_number=?,cra_date=?,message=?,response=? WHERE id=?`)
        .run(status,now(),validAccepted ? response.confirmationNumber : null,response.craDate || null,String(response.message || (status==='unknown'?'Acceptance could not be confirmed. Do not resend automatically.':'')).slice(0,4000),JSON.stringify(response),id);
      return this.list(attempt.return_id).find(a=>a.id===id);
    });
  }
}

export const submissionSchema = `
 CREATE TABLE IF NOT EXISTS submission_plans(id TEXT PRIMARY KEY,return_id TEXT NOT NULL REFERENCES returns(id),calculation_id TEXT NOT NULL REFERENCES calculations(id),input_revision INTEGER NOT NULL,mode TEXT NOT NULL,expires_at TEXT NOT NULL,plan TEXT NOT NULL,payload TEXT NOT NULL,consumed_at TEXT,created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS submissions(id TEXT PRIMARY KEY,return_id TEXT NOT NULL REFERENCES returns(id),calculation_id TEXT NOT NULL REFERENCES calculations(id),input_revision INTEGER NOT NULL,mode TEXT NOT NULL CHECK(mode IN ('netfile','refile')),status TEXT NOT NULL CHECK(status IN ('sending','accepted','rejected','unknown','cancelled')),requested_at TEXT NOT NULL,completed_at TEXT,confirmation_number TEXT,cra_date TEXT,payload_hash TEXT NOT NULL,actor TEXT NOT NULL,idempotency_key TEXT NOT NULL,plan_id TEXT NOT NULL REFERENCES submission_plans(id),message TEXT,response TEXT,UNIQUE(return_id,idempotency_key));
 CREATE UNIQUE INDEX IF NOT EXISTS one_unresolved_transmission ON submissions(return_id) WHERE status IN ('sending','unknown');
`;
