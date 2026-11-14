import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {ApiError,validateFields} from './model.mjs';
const root=join(dirname(fileURLToPath(import.meta.url)),'../native-interview');
const cache=new Map();
const simpleCode=/^[A-Z0-9]{5}:\d{5}:[A-Z]$/;
const supportedKinds=new Set(['C','I','B','F','D','R','O','T','A','S','P']);
const defaultSections=new Set(['DIGNEW','DONATE','EDUSUP','VOLFFI','HRENOV','HBUYAM','MEDICA','MOVING','POLITI','SRVAMT','STUCRE','UNIOND']);
const deniedDefaultPrefixes=new Set(['METAD','TAXPY','IDENT','MARST','SPOUS','SPOCR','DEPEN','CHCAR','CARRY','RRSPD','REFIL','FILIN','RESID','INTRO','COVID','WITBE','GSTCR','FORII','FORTX']);
function bundle(year){
 year=Number(year);if(!Number.isInteger(year)||year<2019||year>2025)throw new ApiError(404,'Interview year not found.');
 if(!cache.has(year)){
  const manifest=JSON.parse(readFileSync(join(root,'manifest.json'),'utf8')).find(x=>x.year===year),bytes=readFileSync(join(root,`${year}.json.gz`));
  if(createHash('sha256').update(bytes).digest('hex')!==manifest.bundleSha256)throw Error('Original interview bundle hash differs.');
  const b=JSON.parse(gunzipSync(bytes));b.topics=b.sections.flatMap(s=>s.topics);b.byId=new Map(b.topics.map(t=>[t.id,t]));b.manifest=manifest;cache.set(year,b);
 }return cache.get(year);
}
function checkContext(options){if(options.filingMode!==undefined && !['netfile','refile'].includes(options.filingMode))throw new ApiError(400,'Filing mode must be netfile or refile.');if(options.taxpayer!==undefined && !['primary','spouse'].includes(options.taxpayer))throw new ApiError(400,'Interview taxpayer must be primary or spouse.');if(options.instances!==undefined && (!Array.isArray(options.instances) || options.instances.some(x=>!/^\d+$/.test(String(x)) || Number(x)<1)))throw new ApiError(400,'Interview instances must be positive integer identifiers.');}
const key=code=>{const a=code.split(':');a.splice(2,1);return a.join(':');};
function lookup(fields){const entries=new Map(Object.entries(fields || {}).map(([k,v])=>[key(k),v]));return code=>entries.get(key(code));}
function expand(text,year,get){return String(text || '').replace(/\s+/g,' ').trim().replace(/\[([A-Z0-9]{5}:\d{5}:[A-Z](?::[^\]]+)?)\]/g,(match,code)=>code==='METAD:00001:I'?String(year):code==='METAD:90001:I'?String(year-1):code==='METAD:10001:I'?String(year+1):get(code)??match);}
function compareDecimal(a,b){
 const parse=value=>{const m=/^(-?)(\d+)(?:\.(\d+))?$/.exec(String(value));return m?{n:BigInt((m[1] || '')+m[2]+(m[3] || '')),scale:(m[3] || '').length}:null;};
 const x=parse(a),y=parse(b);if(!x||!y)return null;
 const scale=Math.max(x.scale,y.scale),u=x.n*10n**BigInt(scale-x.scale),v=y.n*10n**BigInt(scale-y.scale);return u===v?0:u<v?-1:1;
}
function conditionValue(condition,year,get,instances=[],taxpayer='primary'){
 const a=condition.attrs || condition;
 if(a.Taxpayer && a.Taxpayer!=='0'){if(!['1','2'].includes(a.Taxpayer))return null;if(Number(a.Taxpayer)!==(taxpayer==='spouse'?2:1))return false;}
 const test=(code,wanted,kind='Equals',depth=0)=>{
  if(!code)return null;
  depth=Number(depth || 0);if(depth>instances.length)return null;
  const actual=get(code+(depth?':'+instances.slice(0,depth).join(':'):''));
  const target=expand(wanted,year,get);if(actual===undefined || /\[[A-Z0-9]{5}:/.test(target))return null;
  const norm=x=>['true','false'].includes(String(x).toLowerCase())?String(x).toLowerCase():String(x);
  const numericEquality=['C','I','P','F'].includes(code.split(':')[2])?compareDecimal(actual,target):null;
  if(kind==='Equals')return numericEquality===null?norm(actual)===norm(target):numericEquality===0;
  if(kind==='NotEquals')return numericEquality===null?norm(actual)!==norm(target):numericEquality!==0;
  const numeric=compareDecimal(actual,target);let ordering=numeric;
  if(ordering===null && /^\d{4}-\d{2}-\d{2}$/.test(String(actual)) && /^\d{4}-\d{2}-\d{2}$/.test(target))ordering=actual===target?0:actual<target?-1:1;
  if(ordering===null)return null;
  return ({GreaterThan:ordering>0,LessThan:ordering<0,GreaterThanEquals:ordering>=0,LessThanEquals:ordering<=0})[kind]??null;
 };
 const first=test(a.FieldCode,a.WhenValue,a.Test,a.LoopDepth);
 if(!a.AndFieldCode)return first;
 const second=test(a.AndFieldCode,a.AndWhenValue,a.AndTest,a.AndLoopDepth);
 return first===false || second===false?false:first===true && second===true?true:null;
}
function nextTopic(topic,year,get,instances,taxpayer='primary'){
 const evaluations=topic.branches.map(b=>({...b,matches:conditionValue(b,year,get,instances,taxpayer)}));
 for(const branch of evaluations){if(branch.matches===null)return {nextTopic:null,nextUncertain:true,branches:evaluations};if(branch.matches)return {nextTopic:branch.target,nextUncertain:false,branches:evaluations};}
 return {nextTopic:topic.attrs.Next || null,nextUncertain:false,branches:evaluations};
}
function instancePath(options,depth){const p=options.instances || [];if(!Array.isArray(p) || p.some(x=>!/^\d+$/.test(String(x))||Number(x)<1))throw new ApiError(400,'Interview instances must be positive integer identifiers.');return p.length>=depth?p.slice(0,depth).map(String):null;}
function fieldView(field,topic,year,get,options){
 const depth=field.loopDepth || 0,path=instancePath(options,depth),answerCode=path?field.code+(depth?':'+path.join(':'):''):null;
 const ambiguousTaxpayer=topic.branches.some(b=>b.attrs.Taxpayer && !['0','1','2'].includes(b.attrs.Taxpayer));
 const wrongScope=options.taxpayer==='spouse' && topic.attrs.Spousal!=='true';
 const special=ambiguousTaxpayer || wrongScope || !!field.attrs.SecondaryID || (field.kind==='O' && field.options.length===0) || field.attrs.NoYear==='true' || !simpleCode.test(field.code) || !supportedKinds.has(field.kind);
 const consent=field.code.startsWith('FILIN:99902:');
 const value=answerCode?get(answerCode):undefined;
 return {code:field.code,answerCode,kind:field.kind,label:expand(field.label,year,get),options:field.options.map(o=>({value:o.value,label:expand(o.label,year,get)})),
  required:field.attrs.EntryRequired==='true',min:field.attrs.MinValue || null,max:field.attrs.MaxValue || (field.kind==='P'?'100':null),maxChars:Number(field.attrs.MaxChars)||null,intrinsicMaximum:field.kind==='P'?'100':null,
  minDate:field.attrs.MinDate || null,maxDate:field.attrs.MaxDate || null,loopDepth:depth,value:value??null,answered:value!==undefined && value!=='',
  editable:!!answerCode && !special && !consent,readonlyReason:wrongScope?'The original topic is not marked for the paired spouse. Use the explicitly scoped primary/direct editor for that person.':ambiguousTaxpayer?'This topic has an unported alternate-taxpayer branch. Its answers are read-only until the paired routing is verified.':consent?'CRA agreement is handled only by final filing confirmation.':special?'This original control needs additional linked or specialized behavior; inspect its definition or use a verified direct editor.':!answerCode?'Select an explicit loop instance before entering this repeated record.':null,
  secondaryField:field.attrs.SecondaryID || null,inputMask:field.attrs.InputMask || null,originalAttributes:field.attrs};
}
function summaries(b,fields,options){
 const get=lookup({...options.computedFields,...fields,...options.interviewConditions});
 return b.sections.map(s=>{
  const logical=b.logicalIndex.find(i=>i.section===s.id),condition=logical?.condition;
  const raw=condition?get(condition):undefined,relevance=!condition?'active':raw===undefined?'unknown':String(raw).toLowerCase()==='true'?'active':'not-applicable';
  const topics=s.topics.map(t=>topicView(t,b.year,get,options));
  return {id:s.id,title:expand(s.title,b.year,get),startTopic:logical?.topic || s.topics[0]?.id,condition:condition || null,relevance,
   topics:topics.length,answered:topics.filter(t=>t.status==='answered').length,partial:topics.filter(t=>t.status==='partial').length,unanswered:topics.filter(t=>t.status==='unanswered').length,informational:topics.filter(t=>t.status==='informational').length};
 });
}
function topicView(t,year,get,options){
 const fields=t.fields.map(f=>fieldView(f,t,year,get,options)),answerable=fields.filter(f=>f.editable),answered=answerable.filter(f=>f.answered).length;
 const status=!fields.length?'informational':!answerable.length?'needs-support':answered===answerable.length?'answered':answered?'partial':'unanswered';
 return {id:t.id,section:t.section,title:expand(t.title,year,get),paragraphs:t.paragraphs.map(p=>expand(p,year,get)),fields,status,
  loopDepth:Number(t.attrs.LoopDepth || 0),helpId:t.attrs.HelpID || null,spousal:t.attrs.Spousal==='true',previousTopic:t.attrs.Previous || null,
  ...nextTopic(t,year,get,options.instances || [],options.taxpayer || 'primary'),actions:t.actions,customValidationCount:t.customValidations.length,validationChecks:validationChecks(t,year,options,options.instances || null),
  confirmations:confirmationChecks(t,year,options,options.instances || null),deferredActions:deferredActions(t),
  warnings:[...(t.customValidations.length?['Original boolean validation flags are shown from the saved calculation. Recalculate after editing; missing flags remain unknown.']:[]),...(t.attrs.ClearOrphans?['This original checkpoint requests native orphan cleanup. The workspace must retain the before/after changes in revision history.']:[]),...(deferredActions(t).length?['Original record actions are retained for review and are not executed automatically.']:[]),...(fields.some(f=>!f.editable)?['Some original controls require an explicit instance, paired routing or specialized behavior.']:[])]};
}
export function interviewCatalog(year,fields={},options={}){
 checkContext(options);
 const b=bundle(year),get=lookup({...options.computedFields,...fields,...options.interviewConditions}),sections=summaries(b,fields,options);
 let topics=b.topics.filter(t=>!options.section || t.section===options.section);
 if(options.topicId)topics=topics.filter(t=>t.id===options.topicId);
 if(options.search){const q=String(options.search).toLowerCase();topics=topics.filter(t=>[t.id,t.title,...t.paragraphs,...t.fields.map(f=>f.code+' '+f.label)].some(x=>expand(x,b.year,get).toLowerCase().includes(q)));}
 topics=topics.map(t=>topicView(t,b.year,get,options));
 if(options.answered==='answered')topics=topics.filter(t=>t.status==='answered');
 if(options.answered==='unanswered')topics=topics.filter(t=>['unanswered','partial'].includes(t.status));
 if(options.relevance==='active')topics=topics.filter(t=>sections.find(s=>s.id===t.section)?.relevance!=='not-applicable');
 const total=topics.length,offset=Math.max(0,Number(options.offset)||0),limit=Math.min(100,Math.max(1,Number(options.limit)||20));
 return {year:b.year,taxpayer:options.taxpayer || 'primary',sourceSha256:b.sourceSha256,evidenceId:b.evidenceId,xmlSha256:b.xmlSha256,sections,topics:topics.slice(offset,offset+limit),total,offset,limit,
  counts:{sections:b.manifest.sections,topics:b.manifest.topics,fieldDefinitions:b.manifest.fields},
  coverage:{originalDefinitionsPreserved:true,fieldTypesOptionsBounds:true,customValidationComplete:false,booleanValidationFlagInterpretation:true,completeInterviewParity:false,
   note:'Original source prompts, options and branches are preserved. Unknown branch inputs remain unknown; navigation is not a proof of return completeness. Slip dialogs, action handlers and every custom validation are not fully ported.'},
  defaultProposalCount:suggestDefaults(year,fields,options).proposals.length};
}
export function interviewDefinition(year,topicId){const b=bundle(year),topic=b.byId.get(topicId);if(!topic)throw new ApiError(404,'Original interview topic not found.');return {year:b.year,topic,sourceSha256:b.sourceSha256,evidenceId:b.evidenceId};}
export function suggestDefaults(year,fields={},options={}){
 checkContext(options);
 const b=bundle(year),get=lookup({...options.computedFields,...fields,...options.interviewConditions}),seen=new Set(),proposals=[];
 for(const s of b.sections){if(!defaultSections.has(s.id)||(options.section && s.id!==options.section))continue;
  for(const t of s.topics)for(const f of t.fields){
   if(/spouse|common-law|depend[ae]nt|child|parent|marital|resident|born|death|deceased|election|elect to|authoriz|consent|carry|unused/i.test(t.title+' '+t.paragraphs.join(' ')))continue;
   if(f.loopDepth || deniedDefaultPrefixes.has(f.code.split(':')[0]) || seen.has(f.code) || get(f.code)!==undefined)continue;
   const view=fieldView(f,t,b.year,get,options);if(!view.editable)continue;
   const prefix=f.code.split(':')[0]+':';
   if(Object.entries({...options.computedFields,...fields}).some(([k,v])=>k.startsWith(prefix) && k!==f.code && (/^-?\d+(\.\d+)?$/.test(v)?compareDecimal(v,'0')!==0:['Yes','true'].includes(v))))continue;
   let value,reason;
   if(f.kind==='R' && Number(f.code.split(':')[1])<=2 && f.options.length===2 && f.options.some(x=>x.value==='Yes') && f.options.some(x=>x.value==='No')){value='No';reason='Optional credit/expense question. Apply only after confirming it did not apply to this year.';}
   else if(['C','I'].includes(f.kind) && Number(f.code.split(':')[1])<100 && /paid|expenses|dues|subscriptions/i.test(t.paragraphs.join(' ')) && !/limit|split|portion|transfer|carry|carried|prior|previous|elect/i.test(t.title+' '+t.paragraphs.join(' ')) && f.attrs.EntryRequired!=='true' && (!f.attrs.MinValue || compareDecimal(f.attrs.MinValue,'0')===0)){value='0';reason='Optional empty credit/expense amount. Zero means explicitly none, not missing information.';}
   else continue;
   seen.add(f.code);proposals.push({code:f.code,value,section:s.id,sectionTitle:s.title,topicId:t.id,title:expand(t.title,b.year,get),question:t.paragraphs.map(p=>expand(p,b.year,get)).join('\n'),reason});
  }
 }
 return {year:b.year,requiresConfirmation:true,proposals,note:'These are proposed answers, not facts about the taxpayer. No proposal is applied automatically. Identity, family, residency, income, carryforward and filing consent are excluded.'};
}
export function interviewPatch(year,fields,answers,options={}){
 checkContext(options);
 const b=bundle(year);validateFields(fields);
 if(!answers || typeof answers!=='object' || Array.isArray(answers))throw new ApiError(400,'Interview answers must map field codes to strings or null.');
 const get=lookup({...options.computedFields,...fields,...options.interviewConditions}),next={...fields},changes=[],cleanupCommands=[];
 for(const [code,supplied] of Object.entries(answers)){
  let value=supplied;
  if(typeof value==='string' && code.split(':')[2]==='S' && value.trim()){const digits=value.replace(/[ -]/g,'');if(!/^\d{9}$/.test(digits))throw new ApiError(400,'Social insurance numbers require nine digits.');if(!validInterviewSin(digits))throw new ApiError(400,'The social insurance number failed the original checksum validation.');value=digits.replace(/(\d{3})(\d{3})(\d{3})/,'$1 $2 $3');}
  if(typeof value==='string' && code.split(':')[2]==='A'){const postal=value.replace(/ /g,'').toUpperCase();if(/^[A-Z]\d[A-Z]\d[A-Z]\d$/.test(postal))value=postal.slice(0,3)+' '+postal.slice(3);}
  const matches=[];
  for(const t of b.topics){if(options.topicId && t.id!==options.topicId)continue;if(options.section && t.section!==options.section)continue;
   for(const f of t.fields){const view=fieldView(f,t,b.year,get,options);if(view.answerCode===code && view.editable)matches.push({f,t,view});}
  }
  if(!matches.length)throw new ApiError(400,`Field ${code} is not an editable original question in this interview context.`);
  if(value!==null){
   if(typeof value!=='string')throw new ApiError(400,`Answer ${code} must be a string or null.`);
   validateFields({[code]:value});
   const valid=matches.some(({f,view})=>{
    if(view.required && value==='')return false;
    if(view.options.length && !view.options.some(o=>o.value===value))return false;
    if(view.maxChars && value.length>view.maxChars)return false;
    if(view.min!==null && (f.kind==='F'?Number(value)<Number(expand(view.min,b.year,get)):compareDecimal(value,expand(view.min,b.year,get))<0))return false;
    if(view.max!==null && (f.kind==='F'?Number(value)>Number(expand(view.max,b.year,get)):compareDecimal(value,expand(view.max,b.year,get))>0))return false;
    if(f.kind==='D' && view.minDate && /^\d{4}-\d{2}-\d{2}$/.test(expand(view.minDate,b.year,get)) && value<expand(view.minDate,b.year,get))return false;
    if(f.kind==='D' && view.maxDate && /^\d{4}-\d{2}-\d{2}$/.test(expand(view.maxDate,b.year,get)) && value>expand(view.maxDate,b.year,get))return false;
    return true;
   });
   if(!valid)throw new ApiError(400,`Answer ${code} does not match its original options, range or length constraints.`);
  }
  const before=get(code);if(value===null)delete next[code];else next[code]=value;
  // Remove an alternative type tag for the same physical field when present.
  for(const k of Object.keys(next))if(k!==code && key(k)===key(code))delete next[k];
  if(before!==value && !(before===undefined && value===null)){
   changes.push({code,before:before??null,after:value});
   for(const {t} of matches)if(t.attrs.ClearOrphans==='true' && options.taxpayer!=='spouse' && !cleanupCommands.some(c=>c.topicId===t.id))cleanupCommands.push({command:'ClearOrphans',topicId:t.id,taxpayer:options.taxpayer || 'primary',changedField:code,sourceAttribute:'Topic.ClearOrphans=true',originalWhen:'On rendering the original primary-taxpayer checkpoint (GenuTax.aa.d IL_001c71..IL_001cfe).',requestedWhen:'After this explicitly saved workspace answer, with before/after revision history; no cleanup is executed by this pure patch function.'});
  }
 }
 validateFields(next);return {fields:next,changes,requiresOrphanCleanup:cleanupCommands.length>0,cleanupCommands,warnings:['Answers changed. Recalculate before interpreting original validation flags; action handlers and all paired routing are not fully ported. Native filing validation remains required.']};
}
export function applyInterviewDefaults(year,fields,{codes,confirmed=false,...options}={}){
 if(confirmed!==true)throw new ApiError(400,'Explicitly confirm the selected proposed defaults.');
 if(!Array.isArray(codes) || !codes.length || codes.length>500)throw new ApiError(400,'Select 1–500 proposed default field codes.');
 const proposed=new Map(suggestDefaults(year,fields,options).proposals.map(p=>[p.code,p.value]));
 if(codes.some(c=>!proposed.has(c)))throw new ApiError(409,'A selected default is no longer proposed. Refresh and review the current proposals.');
 return interviewPatch(year,fields,Object.fromEntries(codes.map(c=>[c,proposed.get(c)])),options);
}

// Exact GenuTax.u.a(string) checksum rule in the shipped executable (token
// 0x060001f4). No additional guessed SIN-prefix policy is applied here.
export function validInterviewSin(value){
 const digits=String(value).replace(/ /g,'');if(!/^\d{9}$/.test(digits))return false;
 let sum=0;for(let i=0;i<8;i++){let n=Number(digits[i]);if(i%2===1)n*=2;sum+=Math.floor(n/10)+n%10;}
 return Number(digits[8])===(10-sum%10)%10;
}
function validationChecks(topic,year,options,instances){
 const get=lookup(options.computedFields || {}),depth=Number(topic.attrs.LoopDepth || 0);
 return topic.customValidations.map(v=>{
  const raw=v.attrs.FieldID || '',code=instances && instances.length>=depth?raw+(depth?':'+instances.slice(0,depth).join(':'):''):depth?null:raw;
  const value=code?get(code):undefined,status=raw.split(':')[2]!=='B'?'unknown':value===true || String(value).toLowerCase()==='true'?'error':value===false || String(value).toLowerCase()==='false'?'pass':'unknown';
  return {topicId:topic.id,section:topic.section,fieldCode:code || raw,instances:instances || null,message:expand(v.text,year,lookup({...options.computedFields,...options.fields})),status,
   applicability:'unknown',blocking:status==='error',source:'Original calculated boolean validation flag',loopContextKnown:!!code};
 });
}
function sectionRoute(bundle,section,fields,options){
 const get=lookup({...options.computedFields,...fields,...options.interviewConditions,...(options.filingMode?{'FILIN:20001:R':options.filingMode==='refile'?'No':'Yes'}:{})}),index=bundle.logicalIndex.find(e=>e.section===section.id),start=index?.topic || section.topics[0]?.id;
 if(index?.condition && String(get(index.condition)).toLowerCase()==='false')return {visited:new Set(),possible:new Set(),complete:true};
 const visited=new Set();let id=start,complete=false;
 for(let i=0;id && i<1000;i++){
  const t=bundle.byId.get(id);if(!t || t.section!==section.id){complete=true;break;}
  if(visited.has(id))break;visited.add(id);
  const next=nextTopic(t,bundle.year,get,options.instances || [],options.taxpayer || 'primary');
  if(next.nextUncertain)break;
  if(!next.nextTopic){complete=true;break;}id=next.nextTopic;
 }
 // Explore every possible ordered branch after an unknown answer. A definite
 // later condition cuts off fallthrough, while a known-false condition never
 // makes its target reachable. This preserves uncertain paths without treating
 // demonstrably excluded pages (e.g. ReFILE on NETFILE) as applicable errors.
 const possible=new Set(),pending=[start];
 while(pending.length){
  const candidate=pending.pop(),t=bundle.byId.get(candidate);
  if(!t || t.section!==section.id || possible.has(candidate))continue;
  possible.add(candidate);let fallthrough=true;
  for(const branch of t.branches){
   const matches=conditionValue(branch,bundle.year,get,options.instances || [],options.taxpayer || 'primary');
   if(matches!==false && branch.target)pending.push(branch.target);
   if(matches===true){fallthrough=false;break;}
  }
  if(fallthrough && t.attrs.Next)pending.push(t.attrs.Next);
 }
 return {visited,possible,complete};
}
export function interviewValidation(year,fields={},options={}){
 checkContext(options);
 const b=bundle(year),checks=[],confirmations=[],allEntries=Object.keys({...options.computedFields,...fields});
 for(const section of b.sections){
  if(options.section && section.id!==options.section)continue;
  const route=sectionRoute(b,section,fields,options);
  for(const t of section.topics){
   if(options.topicId && t.id!==options.topicId)continue;
   if(options.taxpayer==='spouse' && t.attrs.Spousal!=='true')continue;
   const depth=Number(t.attrs.LoopDepth || 0);
   let contexts=[[]];
   if(depth){
    if(options.instances?.length>=depth)contexts=[options.instances.slice(0,depth).map(String)];
    else {
     const groups=new Set([...t.fields.map(f=>f.code.split(':')[0]),...t.customValidations.map(v=>(v.attrs.FieldID || '').split(':')[0])]);
     const found=new Map();
     for(const code of allEntries){const parts=code.split(':');if(groups.has(parts[0]) && parts.length>=3+depth && parts.slice(3,3+depth).every(x=>/^\d+$/.test(x)))found.set(parts.slice(3,3+depth).join(':'),parts.slice(3,3+depth));}
     contexts=found.size?[...found.values()]:[null];
    }
   }
   for(const instances of contexts){
    const localOptions={...options,fields},reports=validationChecks(t,b.year,localOptions,instances);
    const active=route.visited.has(t.id)?'active':route.possible.has(t.id)?'unknown':'inactive';
    confirmations.push(...confirmationChecks(t,b.year,localOptions,instances).map(c=>({...c,applicability:active,requiresAcknowledgement:c.requiresAcknowledgement && active!=='inactive'})));
    for(const report of reports){
     report.applicability=active;report.blocking=report.status==='error' && active!=='inactive';checks.push(report);
    }
   }
  }
 }
 const unique=new Map();for(const c of checks.filter(c=>c.blocking))unique.set(c.fieldCode+'|'+c.message,c);
 return {year:b.year,taxpayer:options.taxpayer || 'primary',checks,confirmations,errors:[...unique.values()],unknown:checks.filter(c=>c.status==='unknown' && c.applicability!=='inactive'),counts:{checks:checks.length,errors:unique.size,unknown:checks.filter(c=>c.status==='unknown' && c.applicability!=='inactive').length,inactive:checks.filter(c=>c.applicability==='inactive').length,passed:checks.filter(c=>c.status==='pass' && c.applicability!=='inactive').length},
  complete:false,evidenceId:'ev_2739b6dcf018fa721d969d5bb913595605dfb71ace9de869c6bafc2dcf55b609',sourceSha256:b.sourceSha256,
  warnings:['Checks read original boolean flags from the current saved calculation. Missing flags or loop contexts remain unknown. This report does not replace native filing eligibility checks.']};
}

function deferredActions(topic){
 const actions=topic.definition.children.filter(n=>['Action','DeleteLoop'].includes(n.tag));
 return actions.map(n=>({kind:n.tag,attributes:n.attrs,definition:n,executed:false}));
}
function confirmationChecks(topic,year,options,instances){
 const definitions=topic.definition.children.filter(n=>n.tag==='Confirmation');
 if(!definitions.length)return [];
 return validationChecks({...topic,customValidations:definitions},year,options,instances).map(c=>({...c,status:c.status==='error'?'confirmation':c.status,blocking:false,requiresAcknowledgement:c.status==='error',source:'Original calculated confirmation flag; user acknowledgement is not assumed.'}));
}
