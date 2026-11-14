import {isValidSin} from './identity.mjs';
import {businessIssues} from './business.mjs';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { ApiError, YEARS, PROVINCES, MARITAL_STATUSES, requireText, validateFields, validDate, profileFields, preparationIssues, filingInputIssues, summary, FIELD_CODE, PERSONAL_DETAIL_FIELDS, personalDetails } from './model.mjs';
import { Submissions, submissionSchema } from './submissions.mjs';
import { Settings } from './settings.mjs';
import {mkdirSync,chmodSync} from 'node:fs';
import {dirname,join} from 'node:path';

export class Store {
  constructor(path) {
    this.path=path;
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS people(id TEXT PRIMARY KEY,name TEXT NOT NULL,birth_date TEXT,province TEXT,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS returns(id TEXT PRIMARY KEY,person_id TEXT NOT NULL REFERENCES people(id),year INTEGER NOT NULL,revision INTEGER NOT NULL,fields TEXT NOT NULL,spouse_fields TEXT,calculation_id TEXT,reviewed_calculation_id TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(person_id,year));
      CREATE TABLE IF NOT EXISTS revisions(id TEXT PRIMARY KEY,return_id TEXT NOT NULL REFERENCES returns(id),revision INTEGER NOT NULL,fields TEXT NOT NULL,spouse_fields TEXT,actor TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(return_id,revision));
      CREATE TABLE IF NOT EXISTS calculations(id TEXT PRIMARY KEY,return_id TEXT NOT NULL REFERENCES returns(id),input_revision INTEGER NOT NULL,result TEXT NOT NULL,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS reviews(id TEXT PRIMARY KEY,return_id TEXT NOT NULL REFERENCES returns(id),calculation_id TEXT NOT NULL REFERENCES calculations(id),actor TEXT NOT NULL,created_at TEXT NOT NULL);`);
    const needsMigration=!this.db.prepare('PRAGMA table_info(returns)').all().some(c=>c.name==='filing_mode') || !(this.db.prepare("SELECT sql FROM sqlite_master WHERE name='submissions'").get()?.sql || '').includes("'cancelled'");
    if(path!==':memory:' && needsMigration && this.db.prepare('SELECT COUNT(*) AS n FROM returns').get().n>0){
      const directory=join(dirname(path),'backups');mkdirSync(directory,{recursive:true,mode:0o700});
      const backup=join(directory,`before-v0.3-${Date.now()}-${randomUUID()}.sqlite`);
      this.db.exec(`VACUUM INTO '${backup.replace(/'/g,"''")}'`);
    }
    if (!this.db.prepare('PRAGMA table_info(people)').all().some(column => column.name === 'residency')) this.db.exec("ALTER TABLE people ADD COLUMN residency TEXT NOT NULL DEFAULT 'Yes'");
    if (!this.db.prepare('PRAGMA table_info(people)').all().some(column => column.name === 'marital_status')) this.db.exec('ALTER TABLE people ADD COLUMN marital_status TEXT');
    if(!this.db.prepare('PRAGMA table_info(people)').all().some(c=>c.name==='personal_details')) {
      if(path!==':memory:' && this.db.prepare('SELECT count(*) n FROM people').get().n)this.backup('before-personal-profile');
      this.transaction(()=>{
        this.db.exec("ALTER TABLE people ADD COLUMN personal_details TEXT NOT NULL DEFAULT '{}'");
        // Copy only the latest year's identity. Never infer a legal name from a display label,
        // and never write profile defaults back into historical return snapshots.
        for(const person of this.db.prepare('SELECT id FROM people').all()) {
          const row=this.db.prepare('SELECT fields FROM returns WHERE person_id=? ORDER BY year DESC LIMIT 1').get(person.id);
          const fields=JSON.parse(row?.fields || '{}');
          const details=Object.fromEntries(Object.entries(PERSONAL_DETAIL_FIELDS).filter(([,code])=>typeof fields[code]==='string' && fields[code]).map(([key,code])=>[key,fields[code]]));
          this.db.prepare('UPDATE people SET personal_details=? WHERE id=?').run(JSON.stringify(details),person.id);
        }
      });
    }
    if(!this.db.prepare('PRAGMA table_info(people)').all().some(c=>c.name==='notes'))this.db.exec("ALTER TABLE people ADD COLUMN notes TEXT NOT NULL DEFAULT ''");
    const returnColumns=this.db.prepare('PRAGMA table_info(returns)').all().map(x=>x.name);
    for(const [column,definition] of Object.entries({filing_mode:"TEXT NOT NULL DEFAULT 'netfile'",amendment_baseline:'TEXT',prior_confirmation:'TEXT',prior_filed_at:'TEXT'}))if(!returnColumns.includes(column))this.db.exec(`ALTER TABLE returns ADD COLUMN ${column} ${definition}`);
    this.db.exec('PRAGMA busy_timeout=5000');
    const oldSubmissionSchema=this.db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='submissions'").get()?.sql;
    if(oldSubmissionSchema && !oldSubmissionSchema.includes("'cancelled'"))this.transaction(()=>{
      this.db.exec('ALTER TABLE submissions RENAME TO submissions_v2_backup');
      this.db.exec(submissionSchema);
      this.db.exec('INSERT INTO submissions SELECT * FROM submissions_v2_backup');
      this.db.exec('DROP TABLE submissions_v2_backup');
      this.db.exec(submissionSchema);
    });else this.db.exec(submissionSchema);
    this.submissions = new Submissions(this);
    this.settings = new Settings(this);
    this.db.exec('CREATE TABLE IF NOT EXISTS workspace_events(seq INTEGER PRIMARY KEY AUTOINCREMENT,entity TEXT NOT NULL,created_at TEXT NOT NULL)');
    for (const table of ['people','returns','calculations','reviews','submissions','settings']) for (const op of ['INSERT','UPDATE','DELETE']) {
      this.db.exec(`CREATE TRIGGER IF NOT EXISTS change_${table}_${op} AFTER ${op} ON ${table} BEGIN INSERT INTO workspace_events(entity,created_at) VALUES('${table}',strftime('%Y-%m-%dT%H:%M:%fZ','now')); END;`);
    }
  }
  backup(reason='before-filing'){
    if(this.path===':memory:')throw new ApiError(503,'A persistent workspace is required before filing.');
    const directory=join(dirname(this.path),'backups');
    const file=join(directory,`${String(reason).replace(/[^a-z0-9-]/gi,'').slice(0,40)}-${Date.now()}-${randomUUID()}.sqlite`);
    try{mkdirSync(directory,{recursive:true,mode:0o700});chmodSync(directory,0o700);this.db.prepare('VACUUM INTO ?').run(file);chmodSync(file,0o600);return file;}
    catch{throw new ApiError(503,'The workspace backup could not be saved. Nothing was submitted.');}
  }
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const value = fn(); this.db.exec('COMMIT'); return value; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  changeVersion() { return this.db.prepare('SELECT COALESCE(MAX(seq),0) AS version FROM workspace_events').get().version; }
  people() { return this.db.prepare('SELECT id,name,notes,birth_date AS birthDate,province,residency,marital_status AS maritalStatus,created_at AS createdAt,personal_details AS personalDetails FROM people ORDER BY created_at').all().map(({personalDetails:details,...person})=>({...person,...JSON.parse(details)})); }
  person(id) { const p = this.people().find(x => x.id === id); if (!p) throw new ApiError(404, 'Person not found.'); return p; }
  addPerson(input) {
    const name = requireText(input.name, 'Name');
    if (input.birthDate && !validDate(input.birthDate)) throw new ApiError(400, 'Birth date must be a valid YYYY-MM-DD date.');
    if (input.province && !PROVINCES.includes(input.province)) throw new ApiError(400, 'Select a valid province or territory.');
    if (input.residency !== undefined && !['Yes','No'].includes(input.residency)) throw new ApiError(400, 'Residency must be "Yes" or "No".');
    if (input.maritalStatus && !MARITAL_STATUSES.includes(input.maritalStatus)) throw new ApiError(400,'Select a valid marital status.');
    const notes=this.personNotes(input.notes??'');
    const details=personalDetails(input);
    const id = randomUUID();
    this.db.prepare('INSERT INTO people(id,name,birth_date,province,created_at,residency,marital_status,personal_details,notes) VALUES(?,?,?,?,?,?,?,?,?)').run(id, name, input.birthDate || null, input.province || null, new Date().toISOString(), input.residency || 'Yes',input.maritalStatus || null,JSON.stringify(details),notes);
    return this.person(id);
  }
  personNotes(value){if(value===null)return '';if(typeof value!=='string'||value.length>20000)throw new ApiError(400,'Person notes must be text up to20000 characters, or null to clear.');return value;}
  updatePerson(id,input){
    const person=this.person(id);
    const notes=input.notes===undefined?person.notes:this.personNotes(input.notes);
    if(input.expectedNotes!==undefined){if(input.notes===undefined||typeof input.expectedNotes!=='string')throw new ApiError(400,'expectedNotes requires notes and the exact previously saved text.');if(input.expectedNotes!==person.notes)throw new ApiError(409,'Notes changed in another session. Your draft has not overwritten the saved notes.');}
    const name=input.name===undefined?person.name:requireText(input.name,'Name');
    const birthDate=input.birthDate===undefined?person.birthDate:input.birthDate;
    const province=input.province===undefined?person.province:input.province;
    const residency=input.residency===undefined?person.residency:input.residency;
    const maritalStatus=input.maritalStatus===undefined?person.maritalStatus:input.maritalStatus;
    if(birthDate && !validDate(birthDate))throw new ApiError(400,'Use a valid birth date.');
    if(province && !PROVINCES.includes(province))throw new ApiError(400,'Use a valid province.');
    if(!['Yes','No'].includes(residency) || (maritalStatus && !MARITAL_STATUSES.includes(maritalStatus)))throw new ApiError(400,'Invalid residency or marital status.');
    const details=personalDetails(input,person);
    this.db.prepare('UPDATE people SET name=?,birth_date=?,province=?,residency=?,marital_status=?,personal_details=?,notes=? WHERE id=?').run(name,birthDate || null,province || null,residency,maritalStatus || null,JSON.stringify(details),notes,id);
    return this.person(id);
  }
  row(id) { const r = this.db.prepare('SELECT * FROM returns WHERE id=?').get(id); if (!r) throw new ApiError(404, 'Return not found.'); return r; }
  calculation(id) {
    if (!id) return null;
    const row = this.db.prepare('SELECT * FROM calculations WHERE id=?').get(id);
    return row ? { id: row.id, inputRevision: row.input_revision, createdAt: row.created_at, result: JSON.parse(row.result) } : null;
  }
  identityConflicts(row,fields){
    const raw=fields['TAXPY:00001:S'];if(!isValidSin(raw))return [];
    const sin=raw.replace(/[ -]/g,'');
    return this.db.prepare('SELECT id,person_id,fields FROM returns WHERE year=? AND id<>? AND person_id<>?').all(row.year,row.id,row.person_id)
      .filter(other=>String(JSON.parse(other.fields)['TAXPY:00001:S'] || '').replace(/[ -]/g,'')===sin)
      .map(other=>({returnId:other.id,personId:other.person_id,year:row.year,personName:this.person(other.person_id).name}));
  }
  view(r, full = true) {
    const calculation = this.calculation(r.calculation_id);
    const fields = JSON.parse(r.fields);
    const filing=this.submissions.state(r.id),identityConflicts=this.identityConflicts(r,fields);
    const spouseSource=this.spouseLinks?.assess(r.id)||{link:null,issues:[],advisories:[]};
    const decisions=this.decisions?.assess(r.id,fields,r.year) || {records:[],issues:[],advisories:[],accepted:[]};
    const state = r.reviewed_calculation_id && r.reviewed_calculation_id === r.calculation_id ? 'reviewed' : calculation ? 'calculated' : 'draft';
    return { id: r.id, personId: r.person_id, personName: this.person(r.person_id).name, year: r.year, revision: r.revision,
      state, inputCount: Object.keys(fields).length, summary: summary(calculation?.result),filingMode:filing.mode,initialFilingMode:r.filing_mode,
      priorFiling:r.filing_mode==='refile'?{confirmationNumber:r.prior_confirmation,filedAt:r.prior_filed_at,baselineSupplied:!!r.amendment_baseline,source:'user-reported; not a CRA acceptance recorded by this app'}:null,
      acknowledgements:this.acknowledgements?.assess({id:r.id,year:r.year,fields,spouseFields:r.spouse_fields?JSON.parse(r.spouse_fields):null}) || [],
      spouseSource:spouseSource.link,preparationDecisions:decisions.records,advisories:[...decisions.advisories,...spouseSource.advisories],filing,identityConflicts,filingInputIssues:[...filingInputIssues(fields,r.year),...(calculation?.result.allocationAdjustments||[]).filter(a=>Number.isFinite(a.effectiveAllocationPercentage)&&Math.abs(a.ownershipPercentage-a.effectiveAllocationPercentage)>0.0000001).map(a=>`${a.scope||'primary'} business ${a.businessId}: the NETFILE exporter cannot currently encode ${a.effectiveAllocationPercentage}% income/loss allocation separately from ${a.ownershipPercentage}% legal ownership. Line 9946 would be rejected by CRA. Preserve the chosen amounts; resolve the reporting method before filing.`),...identityConflicts.map(other=>`Another ${r.year} return for ${other.personName} uses this taxpayer SIN. Correct the taxpayer identity or clear the unused duplicate before filing.`)],
      issues: [...preparationIssues(fields,r.year,r.spouse_fields ? JSON.parse(r.spouse_fields) : null),...businessIssues(fields,{accepted:decisions.accepted}),...decisions.issues,...spouseSource.issues,...(r.spouse_fields?businessIssues(JSON.parse(r.spouse_fields)).map(x=>'Paired spouse: '+x):[]),...(calculation?.result.inputConflicts?.length?['Some nonzero inputs conflict with inactive sections. Review original cleanup before trusting this calculation.']:[])], parityVerified: false, filingReady: false,
      createdAt: r.created_at, updatedAt: r.updated_at,
      ...(full ? { fields, spouseFields: r.spouse_fields ? JSON.parse(r.spouse_fields) : null, calculation } : {}) };
  }
  list() { return this.db.prepare('SELECT * FROM returns ORDER BY year DESC,created_at').all().map(r => this.view(r, false)); }
  get(id) { return this.view(this.row(id)); }
  revision(row, actor) {
    this.db.prepare('INSERT INTO revisions VALUES(?,?,?,?,?,?,?)').run(randomUUID(), row.id, row.revision, row.fields, row.spouse_fields, actor, row.updated_at);
  }
  create(input, actor = 'local') {
    const person = this.person(input.personId);
    if (!YEARS.includes(input.year)) throw new ApiError(400, 'Supported tax years are 2019–2025.');
    const mode=input.filingMode || 'netfile';if(!['netfile','refile'].includes(mode))throw new ApiError(400,'filingMode must be netfile or refile.');
    if(input.priorFiledAt && !validDate(input.priorFiledAt))throw new ApiError(400,'Previous filing date must use YYYY-MM-DD.');
    if (this.db.prepare('SELECT id FROM returns WHERE person_id=? AND year=?').get(person.id, input.year)) throw new ApiError(409, 'This person already has a return for that year.');
    const fields = validateFields({ ...profileFields(person,input.year), ...validateFields(input.fields ?? {},'fields',input.year) },'fields',input.year);
    const spouse = input.spouseFields == null ? null : JSON.stringify(validateFields(input.spouseFields, 'spouseFields',input.year));
    const id = randomUUID(), now = new Date().toISOString();
    this.db.prepare('INSERT INTO returns(id,person_id,year,revision,fields,spouse_fields,calculation_id,reviewed_calculation_id,created_at,updated_at,filing_mode,prior_confirmation,prior_filed_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id, person.id, input.year, 1, JSON.stringify(fields), spouse, null, null, now, now,mode,input.priorConfirmation ? requireText(input.priorConfirmation,'Previous confirmation',100):null,input.priorFiledAt || null);
    this.revision(this.row(id), actor);
    return this.get(id);
  }
  update(id, input, actor = 'local', {forceRevision=false}={}) {
    const row = this.row(id);
    if (this.submissions.state(id).blocked) throw new ApiError(409, 'Resolve the pending transmission before editing this return.');
    if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision !== row.revision) throw new ApiError(409, 'The return changed. Fetch it again before updating.', { currentRevision: row.revision });
    const fields = JSON.stringify(validateFields(input.fields,'fields',row.year));
    const spouse = input.spouseFields === undefined ? row.spouse_fields : input.spouseFields == null ? null : JSON.stringify(validateFields(input.spouseFields, 'spouseFields',row.year));
    // Saving the same answers is not a new financial snapshot. Compare maps
    // independently of property order while preserving exact original values.
    const sameMap=(a,b)=>{
      if(a===null||b===null)return a===b;
      const left=JSON.parse(a),right=JSON.parse(b),keys=Object.keys(left);
      return keys.length===Object.keys(right).length&&keys.every(key=>Object.hasOwn(right,key)&&left[key]===right[key]);
    };
    if(!forceRevision&&sameMap(fields,row.fields)&&sameMap(spouse,row.spouse_fields))return this.get(id);
    this.db.prepare('UPDATE returns SET revision=revision+1,fields=?,spouse_fields=?,calculation_id=NULL,reviewed_calculation_id=NULL,updated_at=? WHERE id=?').run(fields, spouse, new Date().toISOString(), id);
    this.revision(this.row(id), actor);
    return this.get(id);
  }
  patch(id,input,actor='local'){
    const r=this.get(id);
    for(const key of Object.keys(input))if(!['expectedRevision','set','unset','spouseSet','spouseUnset'].includes(key))throw new ApiError(400,`Unknown field patch property: ${key}`);
    const set=input.set===undefined?{}:validateFields(input.set),spouseSet=input.spouseSet===undefined?{}:validateFields(input.spouseSet);
    for(const [name,values] of [['unset',input.unset],['spouseUnset',input.spouseUnset]]){
      if(values!==undefined && (!Array.isArray(values)||values.some(k=>typeof k!=='string'||!FIELD_CODE.test(k)||k.startsWith('METAD:'))))throw new ApiError(400,`${name} must be an array of valid, non-reserved field codes.`);
      const added=name==='unset'?set:spouseSet;
      if(values?.some(k=>Object.hasOwn(added,k)))throw new ApiError(400,`Do not set and unset the same field in ${name}.`);
    }
    const fields={...r.fields,...set};for(const key of input.unset || [])delete fields[key];
    let spouseFields=r.spouseFields;
    if(spouseFields!==null || Object.keys(spouseSet).length){spouseFields={...spouseFields,...spouseSet};for(const key of input.spouseUnset || [])delete spouseFields[key];}
    return this.update(id,{expectedRevision:input.expectedRevision,fields,spouseFields},actor);
  }
  setFilingMode(id,input,actor='local'){
    const r=this.row(id);if(input.expectedRevision!==r.revision)throw new ApiError(409,'The return changed. Refresh before changing filing type.');
    if(!['netfile','refile'].includes(input.filingMode))throw new ApiError(400,'Choose netfile or refile.');
    if(input.priorFiledAt && !validDate(input.priorFiledAt))throw new ApiError(400,'Previous filing date must use YYYY-MM-DD.');
    if(input.priorConfirmation)requireText(input.priorConfirmation,'Previous confirmation',100);
    if(this.submissions.state(id).blocked || this.submissions.list(id).some(x=>x.status==='accepted'))throw new ApiError(409,'An accepted or unresolved filing cannot be switched back to an initial return.');
    const confirmation=input.priorConfirmation===undefined?r.prior_confirmation:input.priorConfirmation || null;
    const filedAt=input.priorFiledAt===undefined?r.prior_filed_at:input.priorFiledAt || null;
    if(input.filingMode===r.filing_mode && confirmation===r.prior_confirmation && filedAt===r.prior_filed_at)return this.get(id);
    const result=this.update(id,{expectedRevision:r.revision,fields:JSON.parse(r.fields)},actor,{forceRevision:true});
    this.db.prepare('UPDATE returns SET filing_mode=?,prior_confirmation=?,prior_filed_at=?,amendment_baseline=? WHERE id=?').run(input.filingMode,confirmation,filedAt,input.filingMode===r.filing_mode?r.amendment_baseline:null,id);
    return this.get(result.id);
  }
  setBaseline(id,input,actor='local'){
    const r=this.get(id);if(r.filing.mode!=='refile')throw new ApiError(409,'Choose ReFILE before attaching an accepted request baseline.');
    if(input.expectedRevision!==r.revision)throw new ApiError(409,'The return changed. Refresh before attaching a baseline.');
    if(r.filing.blocked)throw new ApiError(409,'Resolve the pending transmission before changing the baseline.');
    if(this.row(id).amendment_baseline===input.payloadXml)return r;
    const updated=this.update(id,{expectedRevision:input.expectedRevision,fields:r.fields},actor,{forceRevision:true});
    this.db.prepare('UPDATE returns SET amendment_baseline=? WHERE id=?').run(input.payloadXml,id);
    return this.get(updated.id);
  }
  batch(input, actor) {
    if (!Array.isArray(input.returns) || input.returns.length < 1 || input.returns.length > 100) throw new ApiError(400, 'Provide 1–100 returns.');
    return this.transaction(() => input.returns.map(item => item.id ? this.update(item.id, item, actor) : this.create(item, actor)));
  }
  saveCalculation(id, revision, result) {
    return this.transaction(() => {
      const row = this.row(id);
      if (this.submissions.state(id).blocked) throw new ApiError(409, 'Resolve the pending transmission before recalculating.');
      if (row.revision !== revision) throw new ApiError(409, 'Inputs changed while calculating. Calculate the latest revision.');
      const calculationId = randomUUID();
      this.db.prepare('INSERT INTO calculations VALUES(?,?,?,?,?)').run(calculationId, id, revision, JSON.stringify(result), new Date().toISOString());
      this.db.prepare('UPDATE returns SET calculation_id=?,reviewed_calculation_id=NULL,updated_at=? WHERE id=?').run(calculationId, new Date().toISOString(), id);
      return this.get(id);
    });
  }
  review(id, input, actor) {
    return this.transaction(() => {
      const row = this.row(id);
      if (input.expectedRevision !== row.revision || !row.calculation_id || input.calculationId !== row.calculation_id) throw new ApiError(409, 'Review the current calculation before marking it reviewed.');
      if (this.get(id).issues.length) throw new ApiError(400, 'Resolve the preparation issues before marking this calculation reviewed.');
      if(this.calculation(row.calculation_id)?.result.inputConflicts?.length)throw new ApiError(400,'Resolve inactive-input conflicts before reviewing the calculation.');
      const now = new Date().toISOString();
      this.db.prepare('INSERT INTO reviews VALUES(?,?,?,?,?)').run(randomUUID(), id, row.calculation_id, actor, now);
      this.db.prepare('UPDATE returns SET reviewed_calculation_id=?,updated_at=? WHERE id=?').run(row.calculation_id, now, id);
      return this.get(id);
    });
  }
  history(id) {
    this.row(id);
    return { submissions:this.submissions.list(id), revisions: this.db.prepare('SELECT revision,fields,spouse_fields,actor,created_at AS createdAt FROM revisions WHERE return_id=? ORDER BY revision DESC').all(id).map(r => ({ ...r, fields: JSON.parse(r.fields), spouseFields: r.spouse_fields ? JSON.parse(r.spouse_fields) : null, spouse_fields: undefined })),
      calculations: this.db.prepare('SELECT id,input_revision AS inputRevision,created_at AS createdAt FROM calculations WHERE return_id=? ORDER BY created_at DESC').all(id),
      reviews: this.db.prepare('SELECT calculation_id AS calculationId,actor,created_at AS createdAt FROM reviews WHERE return_id=? ORDER BY created_at DESC').all(id) };
  }
  close() { this.db.close(); }
}
