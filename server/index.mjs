import {t5013Catalog} from './t5013-boxes.mjs';
import {amendmentReview} from './amendment-review.mjs';
import {assertFilingAvailable} from './filing-availability.mjs';
import {detectPublicIPv4} from './public-ip.mjs';
import {Acknowledgements,confirmationId} from './acknowledgements.mjs';
import {agentInstructions} from './agent-guide.mjs';
import {PdfExporter} from './pdf-export.mjs';
import {SpouseLinks} from './spouse-links.mjs';
import {PreparationDecisions} from './decisions.mjs';
import {renderBusinessSchedules} from './business-schedules.mjs';
import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync, chmodSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Store } from './store.mjs';
import { NativeEngine } from './engine.mjs';
import { ApiError, YEARS, validateFields } from './model.mjs';
import { openapi } from './openapi.mjs';
import { createHash } from 'node:crypto';
import { LiveFiling } from './live-filing.mjs';
import { validPublicIPv4 } from './settings.mjs';
import { slips, writeSlip, removeSlip, copyIdentity, readRrsp, writeRrsp } from './preparation.mjs';
import { financialDifferences } from './snapshot.mjs';
import {businessCatalog,businesses,writeBusiness,removeBusiness,businessIssues} from './business.mjs';
import {analyseCleanup} from './cleanup.mjs';
import {interviewCatalog,interviewPatch,suggestDefaults,applyInterviewDefaults,interviewValidation} from './interview.mjs';
import { previewCatalog, renderPreviewWithBarcodes } from './preview.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const APP_VERSION=JSON.parse(readFileSync(join(ROOT,'package.json'),'utf8')).version;
const assets = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'] };
const MAX_BODY = 2 * 1024 * 1024;

async function readBody(req) {
  if (!(req.headers['content-type'] || '').startsWith('application/json')) throw new ApiError(415, 'Use Content-Type: application/json.');
  let bytes = 0; const chunks=[];
  for await (const chunk of req) { bytes += chunk.length; if (bytes > MAX_BODY) throw new ApiError(413, 'Request body exceeds 2 MiB.'); chunks.push(Buffer.from(chunk)); }
  try { const parsed = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)) || '{}'); if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(); return parsed; }
  catch { throw new ApiError(400, 'Provide a valid JSON object.'); }
}

export async function startServer({ dataDir = process.env.TAX_WORKBENCH_DATA_DIR || join(ROOT, '.data'), port = Number(process.env.PORT || 4317), engine: suppliedEngine, filing: suppliedFiling, pdfRenderer, publicIPDetector=detectPublicIPv4, token: suppliedToken, root = ROOT } = {}) {
  process.umask(0o077);
  mkdirSync(dataDir, { recursive: true, mode: 0o700 }); chmodSync(dataDir, 0o700);
  const tokenPath = join(dataDir, 'api-token');
  const token = suppliedToken || (existsSync(tokenPath) ? readFileSync(tokenPath, 'utf8').trim() : randomBytes(32).toString('hex'));
  if (!suppliedToken && !existsSync(tokenPath)) writeFileSync(tokenPath, token, { mode: 0o600 });
  const agentTokenPath=join(dataDir,'agent-token');
  const agentToken=existsSync(agentTokenPath)?readFileSync(agentTokenPath,'utf8').trim():randomBytes(32).toString('hex');
  if(!existsSync(agentTokenPath))writeFileSync(agentTokenPath,agentToken,{mode:0o600});
  const store = new Store(join(dataDir, 'workbench.sqlite'));
  new PreparationDecisions(store);
  new Acknowledgements(store);
  store.spouseLinks=new SpouseLinks(store);
  const pdfExporter=new PdfExporter({store,dataDir,...(pdfRenderer!==undefined?{renderer:pdfRenderer}:{})});
  const engine = suppliedEngine || new NativeEngine(root, dataDir);
  const filing = suppliedFiling || new LiveFiling(root,dataDir);
  const interviewContextCache=new Map();
  function assertCurrentSnapshot(item){
    const current=store.get(item.id);
    const metadata=r=>JSON.stringify([r.issues,r.filingInputIssues,r.advisories,r.filing,r.preparationDecisions,r.spouseSource,r.acknowledgements]);
    if(current.revision!==item.revision || current.calculation?.id!==item.calculation?.id || current.updatedAt!==item.updatedAt || metadata(current)!==metadata(item))throw new ApiError(409,'The return or a linked source changed during this check. Refresh and run the current snapshot again.');
  }

  async function interviewContext(item){
    const saved=item.calculation;
    if(!saved || saved.inputRevision!==item.revision)return {};
    if(saved.result.interviewConditions)return saved.result;
    if(!engine.calculate)return {};
    if(interviewContextCache.has(saved.id))return interviewContextCache.get(saved.id);
    const current=await engine.calculate({year:item.year,fields:item.fields,spouseFields:item.spouseFields});
    if(financialDifferences(saved.result.fields,current.fields).length || financialDifferences(saved.result.spouseFields,current.spouseFields,{optional:true}).length)throw new ApiError(409,'Recalculate the return before checking interview context: its saved financial result differs.');
    if(interviewContextCache.size>=48)interviewContextCache.clear();
    interviewContextCache.set(saved.id,current);return current;
  }

  let filingCapability;
  try { filingCapability = await filing.initialize(); }
  catch { filingCapability = {liveReady:false,blockers:['The filing validator could not start.']}; }
  const capability=()=>{const settings=store.settings.get();return {...filingCapability,enabled:settings.liveSubmissions,liveReady:filingCapability.liveReady===true&&settings.liveSubmissions&&(settings.originatingIPMode==='automatic'||validPublicIPv4(settings.originatingIP)),settingsRevision:settings.revision,originatingIP:settings.originatingIP,blockers:[...(filingCapability.blockers || []),...(!settings.liveSubmissions?['Live CRA submissions are switched off in Settings.']:[]),...(settings.originatingIPMode!=='automatic'&&!validPublicIPv4(settings.originatingIP)?['Detect your public IPv4 automatically or enter it in Settings before preparing a live transmission.']:[])]};};
  const uiVersion = () => createHash('sha256').update(['index.html','app.js','style.css'].map(p=>readFileSync(join(root,'ui',p))).join('')).digest('hex').slice(0,20);
  let engineHealth;
  try { engineHealth = await engine.initialize(); }
  catch (error) { engineHealth = { available: false, error: error.message, wineRequired: false, calculationParityVerified: false, engines: [] }; }
  let baseURL;
  const respond = (res, status, value, headers = {}) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
    res.end(JSON.stringify(value));
  };
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    try {
      const pathname = new URL(req.url, 'http://localhost').pathname;
      const allowedHosts = new Set([new URL(baseURL).host]);
      if (!allowedHosts.has(req.headers.host)) throw new ApiError(403, 'Unexpected Host header.');
      if (req.headers.origin && req.headers.origin !== baseURL) throw new ApiError(403, 'Requests from other origins are not allowed.');
      if (req.method === 'GET' && assets[pathname]) {
        const [name, type] = assets[pathname];
        res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-store' });
        res.end(readFileSync(join(root, 'ui', name))); return;
      }
      if (req.method === 'GET' && pathname === '/health') { respond(res, 200, { ok: true, app: 'Tax Workbench' }); return; }
      const authorization = req.headers.authorization || '';
      const actual = Buffer.from(authorization);
      const matches=value=>{const expected=Buffer.from(`Bearer ${value}`);return expected.length===actual.length&&timingSafeEqual(expected,actual);};
      const role=matches(token)?'owner':matches(agentToken)?'agent':null;
      if(!role)throw new ApiError(401,'A local API bearer token is required.');

      const actor = String(req.headers['x-agent-name'] || (role==='agent'?'authorized-agent':'desktop')).slice(0, 80);
      if(req.method==='GET' && pathname==='/v1/agent-instructions'){respond(res,200,{version:APP_VERSION,role:'agent',instructions:agentInstructions(baseURL,agentToken,existsSync(join(dataDir,'owner-instructions.md'))?readFileSync(join(dataDir,'owner-instructions.md'),'utf8'):'')});return;}
      if(req.method==='GET'&&pathname==='/v1/session'){respond(res,200,{role,canPrepare:true,canReview:true,canSubmit:true,canRecordDecisions:true,canAcknowledge:true,requiresExplicitFilingConfirmation:true});return;}
      if(req.method==='GET'&&pathname==='/v1/agent-connection'){respond(res,200,{baseURL,token:agentToken,role:'agent',scopes:['read','prepare','calculate','validate','decisions','acknowledgements','review','settings','terms','prepare-submission','submit'],description:'Trusted agent with full API capability. Record user-authorized facts and reviews; transmission still requires explicit filing confirmation and live settings.'});return;}
      if (req.method === 'GET' && pathname === '/v1/workspace') { respond(res, 200, { version:store.changeVersion(),uiVersion:uiVersion(),people: store.people(), returns: store.list(), engine: engineHealth, filing:capability(),pdfExport:{available:!!pdfExporter.renderer,format:'application/pdf',savedCalculationRequired:true},settings:store.settings.get(), years: YEARS }); return; }
      if(req.method==='GET' && pathname==='/v1/settings'){respond(res,200,{...store.settings.get(),capability:capability()});return;}
      if(req.method==='POST'&&pathname==='/v1/settings/detect-ip'){await readBody(req);respond(res,200,await publicIPDetector());return;}
      if(req.method==='PUT' && pathname==='/v1/settings'){respond(res,200,store.settings.update(await readBody(req),actor));return;}
      if (req.method === 'GET' && pathname === '/v1/changes') { respond(res,200,{version:store.changeVersion(),uiVersion:uiVersion()}); return; }
      if (req.method === 'GET' && pathname === '/v1/engine') { respond(res, 200, engineHealth); return; }
      if (req.method === 'GET' && pathname === '/v1/openapi.json') { respond(res, 200, openapi(baseURL)); return; }
      if (req.method === 'POST' && pathname === '/v1/people') { const input = await readBody(req); respond(res, 201, store.addPerson(input)); return; }
      const personMatch=pathname.match(/^\/v1\/people\/([a-f0-9-]+)$/);
      if(personMatch&&req.method==='GET'){respond(res,200,store.person(personMatch[1]));return;}
      if(personMatch&&req.method==='PATCH'){const input=await readBody(req);respond(res,200,store.transaction(()=>store.updatePerson(personMatch[1],input)));return;}
      if (req.method === 'GET' && pathname === '/v1/returns') { respond(res, 200, store.list()); return; }
      if (req.method === 'POST' && pathname === '/v1/returns') {
        const input = await readBody(req);
        if(input.copyIdentityFrom){const source=store.get(input.copyIdentityFrom);if(source.personId!==input.personId)throw new ApiError(400,'Copy identity only between the same person’s returns.');input.fields=copyIdentity(source,store.person(input.personId),input.year,input.fields || {});}
        respond(res, 201, store.transaction(() => store.create(input, actor))); return;
      }
      if (req.method === 'POST' && pathname === '/v1/returns/batch') { respond(res, 200, { returns: store.batch(await readBody(req), actor) }); return; }
      const fieldMatch = pathname.match(/^\/v1\/fields\/(\d{4})$/);
      const mappingMatch=pathname.match(/^\/v1\/input-mappings\/(\d{4})$/);
      if(req.method==='GET' && mappingMatch){
        const year=Number(mappingMatch[1]);if(!YEARS.includes(year))throw new ApiError(404,'Year not found.');
        const m=JSON.parse(readFileSync(join(root,'research/input-mappings.json'),'utf8'));
        respond(res,200,{year,description:'Verified selected source inputs; not a complete tax interview or proof of input completeness.',maritalStatus:m.maritalStatus,maritalChanges:m.maritalChanges,spouse:m.spouse,coupledReturns:m.coupledReturns,
          residency:year>=2023?m.residency2023Onward:{field:'RESID:00001:R',options:['Yes','No'],provinceField:'RESID:00002:O'},
          t5AdditionalBoxes:{boxCode:'T5SLI:1000{slot}:O:{slip}',amount:'T5SLI:2000{slot}:C:{slip}',slots:[1,2,3],description:'For box 15 foreign income / 16 foreign tax paid, use the original additional-box slots, not only direct 00015/00016 literals. Preserve other occupied slots.'}});return;
      }
      if (req.method === 'GET' && fieldMatch) {
        const year = Number(fieldMatch[1]); if (!YEARS.includes(year)) throw new ApiError(404, 'Year not found.');
        respond(res, 200, { year, fieldCodes: JSON.parse(readFileSync(join(root, 'research', String(year), 'field-codes.json'), 'utf8')), description: 'Discovered literals include both inputs and computed fields.' }); return;
      }
      const foreignMapping=pathname.match(/^\/v1\/foreign-tax-mappings\/(2019|202[0-5])$/);
      if(req.method==='GET'&&foreignMapping){respond(res,200,JSON.parse(readFileSync(join(root,'research/foreign-tax-mappings.json'),'utf8')).find(x=>x.year===Number(foreignMapping[1])));return;}
      const businessMapping=pathname.match(/^\/v1\/business-mappings\/(2019|202[0-5])$/);
      if(req.method==='GET'&&businessMapping){respond(res,200,businessCatalog(Number(businessMapping[1])));return;}
      const match = pathname.match(/^\/v1\/returns\/([a-f0-9-]+)(?:\/(calculate|review|history|export|submit|filing|prepare-submission|validate|forms|preview|receipt|fields|slips|copy-year|filing-mode|baseline|terms|interview|interview-defaults|restore|checks|carry-forward|cleanup|rrsp|businesses|business-schedules|decisions|acknowledgements|spouse-source|pdf|print-report|amendment))?$/);
      if (match) {
        const [, id, action] = match;
        if (req.method === 'GET' && !action) { respond(res, 200, store.get(id)); return; }
        if (req.method === 'PUT' && !action) { const input = await readBody(req); respond(res, 200, store.transaction(() => store.update(id, input, actor))); return; }
        if(req.method==='PATCH' && action==='fields'){const input=await readBody(req);respond(res,200,store.transaction(()=>store.patch(id,input,actor)));return;}
        if(action==='cleanup'&&req.method==='POST'){
          const input=await readBody(req),item=store.get(id);if(input.expectedRevision!==item.revision)throw new ApiError(409,'Refresh the inputs before reviewing inactive data.');
          if(!engine.cleanInputs)throw new ApiError(503,'Original inactive-input cleanup is unavailable.');
          const proposal=await engine.cleanInputs({year:item.year,fields:item.fields,spouseFields:item.spouseFields});
          if(input.apply!==true){respond(res,200,{...proposal,dryRun:true,inputRevision:item.revision});return;}
          if(input.confirmed!==true)throw new ApiError(400,'Confirm that the proposed inactive-input removals match your answers.');
          respond(res,200,{return:store.transaction(()=>store.update(id,{expectedRevision:input.expectedRevision,fields:proposal.primary.fields,spouseFields:proposal.spouse?.fields || null},actor)),cleanup:proposal});return;
        }
        if(action==='acknowledgements'){
          const item=store.get(id);if(req.method==='GET'){respond(res,200,{records:store.acknowledgements.assess(item)});return;}
          if(req.method==='POST'){const input=await readBody(req),context=await interviewContext(item);assertCurrentSnapshot(item);if(!item.calculation||item.calculation.inputRevision!==item.revision)throw new ApiError(409,'Calculate the current inputs first.');const checks=interviewValidation(item.year,item.fields,{computedFields:item.calculation.result.fields,interviewConditions:context.interviewConditions,taxpayer:'primary',filingMode:item.filing.mode});const spouse=item.spouseFields?interviewValidation(item.year,item.spouseFields,{computedFields:item.calculation.result.spouseFields,interviewConditions:context.spouseInterviewConditions,taxpayer:'spouse',filingMode:item.filing.mode}):null;const confirmations=[...checks.confirmations.map(c=>({...c,scope:'primary'})),...(spouse?.confirmations||[]).map(c=>({...c,scope:'spouse'}))].filter(c=>c.requiresAcknowledgement).map(c=>({id:confirmationId(c,c.scope),text:c.message}));respond(res,200,{records:store.acknowledgements.record(item,input,confirmations,actor)});return;}
        }
        if(req.method==='GET'&&action==='checks'){
          const item=store.get(id),context=await interviewContext(item);assertCurrentSnapshot(item);const calculationCurrent=!!item.calculation&&item.calculation.inputRevision===item.revision;
          const check=scope=>store.acknowledgements.decorate(item,interviewValidation(item.year,scope==='spouse'?item.spouseFields:item.fields,{computedFields:calculationCurrent?(scope==='spouse'?item.calculation.result.spouseFields:item.calculation.result.fields):undefined,interviewConditions:scope==='spouse'?context.spouseInterviewConditions:context.interviewConditions,taxpayer:scope,filingMode:item.filing.mode}),scope);
          respond(res,200,{inputRevision:item.revision,calculationId:item.calculation?.id||null,calculationCurrent,requiresCalculation:!calculationCurrent,filingInputIssues:item.filingInputIssues,preparationIssues:item.issues,acknowledgements:item.acknowledgements,interview:check('primary'),spouse:item.spouseFields?check('spouse'):null});return;
        }
        if(action==='businesses'){
          if(req.method==='GET'){const item=store.get(id);respond(res,200,{year:item.year,inputRevision:item.revision,businesses:businesses(item.fields).map(b=>({...b,filingDecisions:item.preparationDecisions.filter(d=>d.businessId===b.id&&!d.stale&&['confirmed','selected-treatment','estimate-accepted'].includes(d.status))})),catalog:businessCatalog(item.year)});return;}
          if(['POST','DELETE'].includes(req.method)){
            const input=await readBody(req),item=store.get(id),prepared=req.method==='POST'?writeBusiness(item.fields,input,item.year):removeBusiness(item.fields,input.id);
            const updated=store.transaction(()=>store.update(id,{expectedRevision:input.expectedRevision,fields:prepared.fields},actor));respond(res,200,{return:updated,businessId:prepared.businessId,warnings:businessIssues(updated.fields,{accepted:updated.preparationDecisions.filter(d=>!d.stale&&['confirmed','selected-treatment','estimate-accepted'].includes(d.status))})});return;
          }
        }
        if(action==='rrsp'){
          if(req.method==='GET'){const item=store.get(id);respond(res,200,{...readRrsp(item.fields,item.year),inputRevision:item.revision});return;}
          if(req.method==='POST'){
            const input=await readBody(req),item=store.get(id);const prepared=writeRrsp(item.fields,input,item.year);
            respond(res,200,{return:store.transaction(()=>store.update(id,{expectedRevision:input.expectedRevision,fields:prepared.fields},actor)),rrsp:prepared.rrsp});return;
          }
        }
        if(action==='slips'){
          if(req.method==='GET'){respond(res,200,{returnId:id,revision:store.row(id).revision,slips:slips(store.get(id).fields),t5013Catalog:t5013Catalog(store.row(id).year)});return;}
          if(['POST','DELETE'].includes(req.method)){
            const input=await readBody(req);const item=store.get(id);
            const prepared=req.method==='DELETE'?{fields:removeSlip(item.fields,input.type,input.id)}:writeSlip(item.fields,input,item.year);
            const updated=store.transaction(()=>store.update(id,{expectedRevision:input.expectedRevision,fields:prepared.fields},actor));
            respond(res,200,{return:updated,slipId:prepared.slipId || input.id});return;
          }
        }
        if(action==='copy-year'&&req.method==='POST'){
          const input=await readBody(req),item=store.get(id);
          if(input.expectedRevision!==item.revision)throw new ApiError(409,'The source return changed. Refresh before copying identity.');
          if(!YEARS.includes(input.targetYear))throw new ApiError(400,'Choose a supported targetYear.');
          const fields=copyIdentity(item,store.person(item.personId),input.targetYear,input.fields || {});
          if(input.dryRun===true){respond(res,200,{targetYear:input.targetYear,fields,description:'Identity/address and profile defaults only; annual slips, deductions, carryforwards and filing consent are not copied.'});return;}
          respond(res,201,store.transaction(()=>store.create({personId:item.personId,year:input.targetYear,fields,filingMode:input.filingMode || 'netfile'},actor)));return;
        }
        if(action==='carry-forward'&&req.method==='POST'){
          const input=await readBody(req),item=store.get(id);
          if(input.expectedRevision!==item.revision)throw new ApiError(409,'The source return changed. Refresh before carrying forward.');
          if(!engine.carryForward)throw new ApiError(503,'Native carryforward is unavailable.');
          const targetYear=input.targetYear || item.year+1;
          if(!YEARS.includes(targetYear)||targetYear!==item.year+1)throw new ApiError(400,'Original carryforward supports the next tax year only.');
          validateFields(item.fields,'fields',item.year);
          if(item.spouseFields)validateFields(item.spouseFields,'spouseFields',item.year);
          const sourceCleanup=await analyseCleanup(engine,item,item.calculation?.result);
          if(sourceCleanup.conflicts.length)throw new ApiError(422,'Correct inactive source amounts or review cleanup before carrying forward.');
          const carried=await engine.carryForward({year:item.year,targetYear,fields:item.fields,spouseFields:item.spouseFields});
          const proposed=validateFields({...copyIdentity(item,store.person(item.personId),targetYear),...carried.identityFields,...carried.fields},'fields',targetYear);
          const targetRow=store.db.prepare('SELECT id FROM returns WHERE person_id=? AND year=?').get(item.personId,targetYear);
          const target=targetRow?store.get(targetRow.id):null;
          const conflicts=target?Object.entries(proposed).filter(([key,value])=>Object.hasOwn(target.fields,key)&&target.fields[key]!==value).map(([field,proposedValue])=>({scope:'primary',field,existingValue:target.fields[field],proposedValue})):[];
          const proposedSpouse=carried.spouseFields?{...carried.spouseIdentityFields,...carried.spouseFields}:null;
          if(target?.spouseFields&&proposedSpouse)for(const [field,proposedValue]of Object.entries(proposedSpouse))if(Object.hasOwn(target.spouseFields,field)&&target.spouseFields[field]!==proposedValue)conflicts.push({scope:'spouse',field,existingValue:target.spouseFields[field],proposedValue});
          const spouseFields=proposedSpouse?validateFields({...proposedSpouse,...target?.spouseFields},'spouseFields',targetYear):target?.spouseFields || null;
          const fields=validateFields({...proposed,...target?.fields,...validateFields(input.fields || {},'fields',targetYear)},'fields',targetYear);
          if(input.dryRun!==false){respond(res,200,{...carried,fields,spouseFields,conflicts,existingTarget:target?{id:target.id,revision:target.revision,filing:target.filing}:null,dryRun:true,description:'Original yearly carryforward rules with separately copied identity. Existing next-year values are preserved; conflicts are reported for review.'});return;}
          if(store.row(id).revision!==item.revision)throw new ApiError(409,'The source changed during carryforward. Review a fresh proposal.');
          if(target && (input.targetReturnId!==target.id || input.expectedTargetRevision!==target.revision))throw new ApiError(409,'Review the existing next-year draft and supply its targetReturnId and expectedTargetRevision before merging.');
          const next=store.transaction(()=>target?store.update(target.id,{expectedRevision:input.expectedTargetRevision,fields,spouseFields},actor):store.create({personId:item.personId,year:targetYear,fields,spouseFields,filingMode:input.filingMode || 'netfile'},actor));
          respond(res,201,{return:next,provenance:carried.provenance});return;
        }
        if(action==='filing-mode'&&req.method==='PUT'){const input=await readBody(req);respond(res,200,store.transaction(()=>store.setFilingMode(id,input,actor)));return;}
        if(action==='baseline'&&req.method==='POST'){
          const input=await readBody(req),item=store.get(id);
          if(input.expectedRevision!==item.revision)throw new ApiError(409,'The return changed. Refresh before validating an accepted-request baseline.');
          if(typeof input.payloadXml!=='string')throw new ApiError(400,'Provide the original accepted SOAP request as payloadXml.');
          if(!filing.inspectBaseline)throw new ApiError(503,'Baseline validation is unavailable.');
          const baseline=await filing.inspectBaseline(input.payloadXml,{year:item.year});
          const sin=(item.fields['TAXPY:00001:S'] || '').replace(/[ -]/g,'');
          if(!baseline.schemaValidated || String(baseline.taxYear)!==String(item.year) || !sin || baseline.taxpayerSin?.replace(/[ -]/g,'')!==sin)throw new ApiError(422,'The original request must pass schema validation and match this return’s tax year and taxpayer SIN.');
          respond(res,200,store.transaction(()=>store.setBaseline(id,input,actor)));return;
        }
        if(action==='restore'&&req.method==='POST'){
          const input=await readBody(req),r=store.db.prepare('SELECT * FROM revisions WHERE return_id=? AND revision=?').get(id,input.revision);
          if(!r)throw new ApiError(404,'Saved input revision not found.');
          respond(res,200,store.transaction(()=>store.update(id,{expectedRevision:input.expectedRevision,fields:JSON.parse(r.fields),spouseFields:r.spouse_fields?JSON.parse(r.spouse_fields):null},actor)));return;
        }
        if(action==='interview'||action==='interview-defaults'){
          const item=store.get(id),q=new URL(req.url,baseURL).searchParams;
          const taxpayer=q.get('taxpayer') || 'primary';if(!['primary','spouse'].includes(taxpayer))throw new ApiError(400,'Choose primary or spouse taxpayer.');
          if(taxpayer==='spouse'&&!item.spouseFields)throw new ApiError(409,'Add the paired spouse’s return inputs before opening their interview.');
          const activeFields=taxpayer==='spouse'?item.spouseFields:item.fields;
          const calculationCurrent=!!item.calculation && item.calculation.inputRevision===item.revision,context=await interviewContext(item);
          const options={taxpayer,section:q.get('section') || undefined,search:q.get('search') || undefined,answered:q.get('answered') || undefined,relevance:q.get('relevance') || undefined,offset:Number(q.get('offset') || 0),limit:Number(q.get('limit') || 20),instances:q.get('instances')?q.get('instances').split(','):[],computedFields:calculationCurrent?(taxpayer==='spouse'?item.calculation.result.spouseFields:item.calculation.result.fields):undefined,interviewConditions:taxpayer==='spouse'?context.spouseInterviewConditions:context.interviewConditions,filingMode:item.filing.mode};
          if(req.method==='GET'){assertCurrentSnapshot(item);const catalog=action==='interview'?interviewCatalog(item.year,activeFields,options):suggestDefaults(item.year,activeFields,options);if(catalog.topics)catalog.topics=catalog.topics.map(t=>store.acknowledgements.decorate(item,t,taxpayer));respond(res,200,{...catalog,taxpayer,inputRevision:item.revision,calculationCurrent,requiresCalculation:!calculationCurrent});return;}
          if(req.method==='POST'){
            const input=await readBody(req);if(input.expectedRevision!==item.revision)throw new ApiError(409,'Refresh the interview before saving answers.');
            const context={...options,section:input.section || options.section,topicId:input.topicId,instances:input.instances || options.instances};
            const prepared=action==='interview'?interviewPatch(item.year,activeFields,input.answers,context):applyInterviewDefaults(item.year,activeFields,{...context,codes:input.codes,confirmed:input.confirmed});
            let fields=taxpayer==='spouse'?item.fields:prepared.fields,spouseFields=taxpayer==='spouse'?prepared.fields:item.spouseFields,cleanup=null;
            if(prepared.requiresOrphanCleanup){
              if(!engine.cleanInputs)throw new ApiError(503,'This original interview step requires inactive-data cleanup, but the native cleaner is unavailable.');
              cleanup=await engine.cleanInputs({year:item.year,fields,spouseFields});fields=cleanup.primary.fields;spouseFields=cleanup.spouse?.fields || null;
            }
            const updated=store.transaction(()=>store.update(id,{expectedRevision:input.expectedRevision,fields,spouseFields},actor));
            respond(res,200,{return:updated,changes:prepared.changes,warnings:prepared.warnings,cleanup,cleanupCommands:prepared.cleanupCommands});return;
          }
        }
        if (req.method === 'GET' && action === 'history') { respond(res, 200, store.history(id)); return; }
        if(req.method==='GET' && action==='receipt'){store.row(id);respond(res,200,store.submissions.receipt(id,new URL(req.url,baseURL).searchParams.get('attemptId')));return;}
        if(req.method==='GET'&&['pdf','print-report'].includes(action)){const q=new URL(req.url,baseURL).searchParams,options={...(q.has('expectedRevision')?{expectedRevision:q.get('expectedRevision')}:{}),...(q.has('calculationId')?{calculationId:q.get('calculationId')}:{})};if(action==='print-report'){const {item,report}=await pdfExporter.report(id,options);pdfExporter.assertCurrent(item);res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; frame-ancestors 'none'",'X-Input-Revision':String(report.inputRevision),'X-Calculation-Id':report.calculationId});res.end(report.html);return;}const result=await pdfExporter.export(id,options);const ascii=result.filename.replace(/[^\x20-\x7e]/g,'_');res.writeHead(200,{'Content-Type':'application/pdf','Cache-Control':'no-store','Content-Disposition':`attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(result.filename)}`,'Content-Length':result.bytes.length,'X-Input-Revision':String(result.inputRevision),'X-Calculation-Id':result.calculationId,'X-Form-Page-Count':String(result.manifest.length)});res.end(result.bytes);return;}
        if(action==='spouse-source'){if(req.method==='GET'){respond(res,200,store.spouseLinks.assess(id));return;}if(req.method==='POST'){respond(res,200,store.spouseLinks.link(id,await readBody(req),actor));return;}if(req.method==='DELETE'){respond(res,200,store.spouseLinks.unlink(id,await readBody(req),actor));return;}}
        if(action==='decisions'){const item=store.get(id);if(req.method==='GET'){respond(res,200,{...store.decisions.assess(id,item.fields,item.year),history:store.decisions.history(id).map(({inputHash,...r})=>r)});return;}if(req.method==='POST'){store.decisions.record(id,await readBody(req),actor);respond(res,200,{return:store.get(id)});return;}}
        if(req.method==='GET'&&action==='business-schedules'){respond(res,200,renderBusinessSchedules(store.get(id)));return;}
        if(req.method==='GET' && ['forms','preview'].includes(action)) {
          const item=store.get(id);
          if(!item.calculation) throw new ApiError(409,'Calculate the saved return before previewing forms.');
          const fields={...item.fields,...item.calculation.result.fields};
          if(action==='forms'){respond(res,200,{...previewCatalog(item.year,fields,item.calculation.result.printList),inputRevision:item.calculation.inputRevision,calculationId:item.calculation.id});return;}
          const query=new URL(req.url,baseURL).searchParams;
          try { respond(res,200,{...await renderPreviewWithBarcodes({year:item.year,formId:query.get('formId'),page:Number(query.get('page') || 1),instance:Number(query.get('instance') || 1),fields,printList:item.calculation.result.printList,barcodeData:item.calculation.result.barcodeData}),inputRevision:item.calculation.inputRevision,calculationId:item.calculation.id}); }
          catch(error){throw new ApiError(error.status || 400,error.message);}
          return;
        }
        if(req.method==='GET'&&action==='amendment'){respond(res,200,amendmentReview(store,id));return;}
        if (req.method === 'GET' && action === 'filing') { store.row(id);respond(res,200,{...store.submissions.state(id),capability:capability()});return; }
        if(action==='terms'&&req.method==='POST'){
          const input=await readBody(req),item=store.get(id),settings=store.settings.get(),mode=input.mode || item.filing.mode;
          if(!settings.liveSubmissions)throw new ApiError(409,'Switch on live CRA submissions in Settings before requesting current CRA terms.');
          if(!['netfile','refile'].includes(mode))throw new ApiError(400,'Choose netfile or refile.');
          assertFilingAvailable(item.year,mode);
          if(!filing.fetchTerms)throw new ApiError(503,'Current CRA terms retrieval is unavailable.');
          respond(res,200,await filing.fetchTerms({year:item.year,mode}));return;
        }
        if (req.method === 'GET' && action === 'export') { const item = store.get(id); respond(res, 200, { format: 'tax-workbench-export/v1', exportedAt: new Date().toISOString(), return: item }, { 'Content-Disposition': `attachment; filename="return-${item.year}-${item.id}.json"` }); return; }
        if (req.method === 'POST' && action === 'calculate') {
          const input = await readBody(req), item = store.get(id);
          if (input.expectedRevision !== item.revision) throw new ApiError(409, 'Fetch the latest return revision before calculating.');
          validateFields(item.fields,'fields',item.year);if(item.spouseFields)validateFields(item.spouseFields,'spouseFields',item.year);
          if (engineHealth.available === false) throw new ApiError(503, engineHealth.error || 'Native engine unavailable.');
          const result = await engine.calculate({ year: item.year, fields: item.fields, spouseFields: item.spouseFields });
          result.inputConflicts=(await analyseCleanup(engine,item,result)).conflicts;
          respond(res, 200, store.saveCalculation(id, item.revision, result)); return;
        }
        if (req.method === 'POST' && action === 'review') { respond(res, 200, store.review(id, await readBody(req), actor)); return; }
        if (req.method === 'POST' && ['validate','prepare-submission'].includes(action)) {
          const input = await readBody(req), item = store.get(id);
          if(!item.calculation || item.calculation.inputRevision!==item.revision)throw new ApiError(409,'Calculate the saved return before validating or preparing a submission.');
          if (input.expectedRevision !== item.revision || input.calculationId !== item.calculation.id) throw new ApiError(409,'Validate the latest calculated input revision.');
          const mode = input.mode || item.filing.mode;
          if (!['netfile','refile'].includes(mode)) throw new ApiError(400,'Use netfile or refile mode.');
          assertFilingAvailable(item.year,mode);
          if(action==='prepare-submission' && mode!==item.filing.mode)throw new ApiError(409,item.filing.mode==='refile'?'This return requires ReFILE. Prepare an amendment confirmation.':'This is an initial NETFILE return. Change its filing type before preparing an amendment.');
          validateFields(item.fields,'fields',item.year);if(item.spouseFields)validateFields(item.spouseFields,'spouseFields',item.year);
          let settings=store.settings.get();
          const live=action==='prepare-submission' && settings.liveSubmissions;
          if(live&&settings.originatingIPMode==='automatic'){const detected=await publicIPDetector();assertCurrentSnapshot(item);if(!validPublicIPv4(detected.originatingIP))throw new ApiError(502,'IP lookup did not return a public IPv4. No return was sent.');if(store.settings.get().revision!==settings.revision)throw new ApiError(409,'Settings changed during IP detection. Prepare again.');if(detected.originatingIP!==settings.originatingIP)settings=store.settings.update({expectedRevision:settings.revision,originatingIP:detected.originatingIP,originatingIPMode:'automatic'},actor);}
          const prepared = await filing.prepare({year:item.year,fields:item.fields,spouseFields:item.spouseFields,mode,baselinePayloadXml:mode==='refile'?store.submissions.acceptedPayload(id):null,live,originatingIP:settings.originatingIP,termsId:input.termsId});
          if(item.issues.length || item.filingInputIssues.length){prepared.validationErrors=[...item.issues,...item.filingInputIssues,...(prepared.validationErrors || [])];prepared.liveReady=false;}
          const differences=[...financialDifferences(item.calculation.result.fields,prepared.calculationFields),...financialDifferences(item.calculation.result.spouseFields,prepared.calculationSpouseFields,{optional:true}).map(x=>({...x,field:'spouse/'+x.field}))];
          if(differences.length){prepared.validationErrors=[...(prepared.validationErrors || []),'The filing calculation differs from the reviewed snapshot. Recalculate and review the return before filing.'];prepared.liveReady=false;}
          prepared.financialDifferences=differences;
          const cleanup=await analyseCleanup(engine,item,item.calculation.result);
          prepared.inputConflicts=cleanup.conflicts;
          prepared.inactiveInputChanges=cleanup.proposal?[...cleanup.proposal.primary.removedFields,...cleanup.proposal.primary.changedFields,...(cleanup.proposal.spouse?.removedFields || []).map(k=>'spouse/'+k),...(cleanup.proposal.spouse?.changedFields || []).map(k=>'spouse/'+k)]:[];
          if(prepared.inactiveInputChanges.length){prepared.validationErrors=[...(prepared.validationErrors || []),'Original inactive-data cleanup would change saved source inputs. Correct the answers or review cleanup before filing.'];prepared.liveReady=false;}
          const checks=interviewValidation(item.year,item.fields,{computedFields:prepared.calculationFields || item.calculation.result.fields,interviewConditions:prepared.interviewConditions,taxpayer:'primary',filingMode:mode});
          const spouseChecks=item.spouseFields?interviewValidation(item.year,item.spouseFields,{computedFields:prepared.calculationSpouseFields || item.calculation.result.spouseFields,interviewConditions:prepared.spouseInterviewConditions,taxpayer:'spouse',filingMode:mode}):null;
          prepared.interviewChecks={primary:store.acknowledgements.decorate(item,checks,'primary'),spouse:store.acknowledgements.decorate(item,spouseChecks,'spouse')};
          prepared.requiredAcknowledgements=[...checks.confirmations.map(c=>({...c,scope:'primary'})),...(spouseChecks?.confirmations || []).map(c=>({...c,scope:'spouse'}))].filter(c=>c.requiresAcknowledgement).map(c=>({id:`${c.scope}:${c.topicId}:${c.fieldCode}:${(c.instances || []).join('-')}`,text:c.message}));
          prepared.originalConfirmations=prepared.requiredAcknowledgements;prepared.recordedAcknowledgements=store.acknowledgements.assess(item);prepared.requiredAcknowledgements=store.acknowledgements.pending(item,prepared.requiredAcknowledgements);
          const knownErrors=[...checks.errors,...(spouseChecks?.errors || [])];
          if(knownErrors.length){prepared.validationErrors=[...(prepared.validationErrors || []),...knownErrors.map(e=>`${e.topicId}: ${e.message}`)];prepared.liveReady=false;}
          assertCurrentSnapshot(item);
          if (action==='validate') { const {payloadXml,...report}=prepared; respond(res,200,{...report,inputRevision:item.revision,calculationId:item.calculation.id,mode,liveReady:false,capability:capability()});return; }
          const currentSettings=store.settings.get();if(currentSettings.revision!==settings.revision)throw new ApiError(409,'Settings changed during preparation. Prepare again.');
          respond(res,200,store.submissions.prepare(id,{...input,mode},prepared,{...capability(),terms:prepared.terms || null}));return;
        }
        if (req.method === 'POST' && action === 'submit') {
          const input=await readBody(req);
          // Idempotency must work after a successful send even if live mode was
          // switched off afterwards. Replays never run another network action.
          const replay=store.db.prepare('SELECT id,plan_id FROM submissions WHERE return_id=? AND idempotency_key=?').get(id,input.idempotencyKey || '');
          if(replay){if(replay.plan_id!==input.challengeId)throw new ApiError(409,'Idempotency key belongs to another plan.');respond(res,200,{attempt:store.submissions.list(id).find(a=>a.id===replay.id),replayed:true});return;}
          if (!filing.send || capability().liveReady !== true) throw new ApiError(409,'Live CRA submissions are off or the filing IP is missing. Check Settings.');
          const planRow=store.db.prepare('SELECT * FROM submission_plans WHERE id=? AND return_id=?').get(input.challengeId,id);
          if(!planRow)throw new ApiError(409,'Prepare a reviewed filing before confirmation.');
          const plan=JSON.parse(planRow.plan);
          if(filing.assertCanSend)await filing.assertCanSend({payloadXml:planRow.payload,payloadHash:plan.payloadHash,year:store.row(id).year,mode:plan.mode,terms:plan.terms,originatingIP:plan.originatingIP});
          store.backup('before-filing');
          const begun=store.submissions.begin(id,input,actor);
          if (begun.replay) { respond(res,200,{attempt:begun.attempt,replayed:true});return; }
          let response;
          try { response=await filing.send({payloadXml:begun.payloadXml,payloadHash:begun.attempt.payloadHash,year:store.row(id).year,mode:begun.mode,terms:begun.plan.terms,originatingIP:begun.plan.originatingIP,allowSend:()=>{const s=store.settings.get(),current=store.get(id),row=store.row(id);return s.liveSubmissions && s.revision===begun.plan.settingsRevision && Date.parse(begun.plan.expiresAt)>Date.now() && current.revision===begun.attempt.inputRevision && current.calculation?.id===begun.attempt.calculationId && row.reviewed_calculation_id===begun.attempt.calculationId && current.issues.length===0 && current.filingInputIssues.length===0;}}); }
          catch(error) { response=error.notSent?{status:'cancelled',networkAttempted:false,message:error.message}:{status:'unknown',message:'The connection ended without a confirmed CRA acknowledgement. Do not resend automatically.'}; }
          respond(res,200,{attempt:store.submissions.finish(begun.attempt.id,response)});return;
        }
      }
      throw new ApiError(404, 'Endpoint not found.');
    } catch (error) {
      const status = error.status || 500;
      respond(res, status, { error: status === 500 ? 'Internal server error.' : error.message, ...(error.details ? { details: error.details } : {}) });
      if (status === 500) console.error(error.stack);
    }
  });
  await new Promise((resolvePromise, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolvePromise); });
  baseURL = `http://127.0.0.1:${server.address().port}`;
  writeFileSync(join(dataDir, 'connection.json'), JSON.stringify({ baseURL, token, pid: process.pid }, null, 2), { mode: 0o600 });
  return { server, store, engine, baseURL, token, agentToken, dataDir, close: () => new Promise(resolvePromise => server.close(() => { store.close(); resolvePromise(); })) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const instance = await startServer();
  console.log(JSON.stringify({ event: 'ready', baseURL: instance.baseURL, dataDir: instance.dataDir }));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await instance.close(); process.exit(0); });
}
