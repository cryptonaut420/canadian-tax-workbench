import test from 'node:test';
import assert from 'node:assert/strict';
import {interviewCatalog,interviewDefinition,interviewPatch,suggestDefaults,applyInterviewDefaults,interviewValidation,validInterviewSin} from '../server/interview.mjs';

test('all original yearly interviews expose exact sections, prompts/options, field types and source identities',()=>{
 for(let year=2019;year<=2025;year++){
  const c=interviewCatalog(year,{}, {section:'MARSTA'});
  assert.ok(c.counts.topics>2400);assert.ok(c.counts.sections>=65);assert.match(c.sourceSha256,/^[a-f0-9]{64}$/);assert.ok(c.evidenceId.startsWith('ev_'));
  const field=c.topics.find(t=>t.id==='MARSTA0001').fields[0];assert.equal(field.code,'MARST:00001:O');assert.ok(field.options.some(x=>x.value==='MARR'));
  assert.match(c.topics[0].paragraphs[0],new RegExp(String(year)));assert.equal(c.coverage.completeInterviewParity,false);
 }
 assert.throws(()=>interviewCatalog(2018),/not found/);
 const searchable=interviewCatalog(2021,{}, {search:'volunteer',limit:2});assert.ok(searchable.total>2);assert.equal(searchable.topics.length,2);
 assert.equal(interviewCatalog(2021,{'MARST:00001:O':'MARR'},{topicId:'MARSTA0001',answered:'answered'}).topics.length,1);
});
test('branch routing keeps missing answers unknown and accepts only exact original option values',()=>{
 const initial=interviewCatalog(2021,{}, {topicId:'ADOPTI0001'}).topics[0];assert.equal(initial.nextUncertain,true);assert.equal(initial.nextTopic,null);
 const answered=interviewCatalog(2021,{'ADOPT:00001:R':'Yes'},{topicId:'ADOPTI0001'}).topics[0];assert.equal(answered.nextTopic,'ADOPTI0002');
 const p=interviewPatch(2021,{'MARST:00001:T':'SING','T4SLI:00014:C:1':'60000.00'},{'MARST:00001:O':'MARR'});
 assert.equal(p.fields['MARST:00001:O'],'MARR');assert.equal(p.fields['MARST:00001:T'],undefined);assert.equal(p.fields['T4SLI:00014:C:1'],'60000.00');
 assert.throws(()=>interviewPatch(2021,{}, {'MARST:00001:O':'Married'}),/original options/);
 assert.throws(()=>interviewPatch(2021,{}, {'MARST:00001:O':''}),/original options/);
 assert.equal(interviewPatch(2021,p.fields,{'MARST:00001:O':null}).fields['MARST:00001:O'],undefined);
 assert.throws(()=>interviewPatch(2021,{}, {'METAD:00001:I':'2020'}),/not an editable/);
 assert.throws(()=>interviewPatch(2021,{}, {'FILIN:99902:R':'Yes'}),/not an editable/);
});
test('repeating business questions require explicit instance and enforce original decimal/date constraints',()=>{
 const t=interviewCatalog(2021,{}, {topicId:'SELFEM4026'}).topics[0];assert.equal(t.fields[0].editable,false);assert.equal(t.fields[0].answerCode,null);
 assert.throws(()=>interviewPatch(2021,{}, {'BUSIN:00101:C':'1000.00'},{topicId:'SELFEM4026'}),/not an editable/);
 const p=interviewPatch(2021,{}, {'BUSIN:00101:C:1':'1000.01'},{topicId:'SELFEM4026',instances:[1]});assert.equal(p.fields['BUSIN:00101:C:1'],'1000.01');
 assert.throws(()=>interviewPatch(2021,{}, {'BUSIN:00101:C:1':'-0.01'},{topicId:'SELFEM4026',instances:[1]}),/original options/);
 assert.throws(()=>interviewPatch(2021,{}, {'PYCAP:00001:F':'1e2'},{topicId:'CGDEDU0013'}),/original options/);
 assert.throws(()=>interviewPatch(2021,{}, {'BUSIN:00022:D:1':'2023-01-01'},{topicId:'SELFEM4008',instances:[1]}),/original options/);
 const d=interviewDefinition(2021,'MARSTA0007');assert.equal(d.topic.fields.find(f=>f.code==='MARST:00012:O').attrs.SecondaryID,'MARST:00014:T');
 assert.equal(interviewCatalog(2021,{}, {topicId:'MARSTA0007',instances:[1]}).topics[0].fields.find(f=>f.code==='MARST:00012:O').editable,false);
});
test('default proposals are opt-in, never replace known answers, and exclude identity/family/income/consent/allocation',()=>{
 const f={'MARST:00001:O':'MARR','SPOUS:00051:C':'20000.00','VOLFF:00001:R':'Yes'};
 const proposals=suggestDefaults(2021,f).proposals;assert.ok(proposals.length>0);assert.ok(proposals.length<100);
 assert.ok(!proposals.some(p=>/^(TAXPY|IDENT|MARST|SPOUS|SPOCR|DEPEN|RESID|CARRY|FILIN|REFIL|T4SLI|BUSIN):/.test(p.code)));
 assert.ok(!proposals.some(p=>p.code==='VOLFF:00001:R'));assert.ok(!proposals.some(p=>/split|limit claim/i.test(p.title)));
 assert.throws(()=>applyInterviewDefaults(2021,f,{codes:[proposals[0].code]}),/Explicitly confirm/);
 const applied=applyInterviewDefaults(2021,f,{codes:[proposals[0].code],confirmed:true});assert.equal(applied.fields['SPOUS:00051:C'],'20000.00');assert.equal(applied.fields[proposals[0].code],proposals[0].value);
 assert.throws(()=>applyInterviewDefaults(2021,applied.fields,{codes:[proposals[0].code],confirmed:true}),/no longer proposed/);
 assert.ok(!suggestDefaults(2021,{}, {computedFields:{'EDSUP:00002:C':'150.00'}}).proposals.some(p=>p.code.startsWith('EDSUP:')));
});

test('original boolean custom validation flags distinguish known errors, passes and unknown loop contexts',()=>{
 const field='CAPPR:00064:B:1';
 let r=interviewValidation(2021,{}, {topicId:'CAPGAI0222',computedFields:{[field]:'true'}});
 assert.equal(r.errors.length,1);assert.equal(r.errors[0].fieldCode,field);assert.match(r.errors[0].message,/number of years/);
 assert.equal(interviewValidation(2021,{}, {topicId:'CAPGAI0222',computedFields:{[field]:'false'}}).checks[0].status,'pass');
 assert.equal(interviewValidation(2021,{[field]:'false'}, {topicId:'CAPGAI0222'}).checks[0].status,'unknown','untrusted raw flag is not a passed calculated check');
 assert.equal(interviewValidation(2021,{}, {topicId:'CAPGAI0222',computedFields:{'CAPPR:00064:B':'true'}}).checks[0].status,'unknown','loop flags require actual instance context');
 r=interviewValidation(2021,{}, {topicId:'CAPGAI0222',computedFields:{[field]:'false','CAPPR:00064:B:2':'true'}});
 assert.equal(r.errors.length,1);assert.equal(r.errors[0].fieldCode,'CAPPR:00064:B:2');assert.equal(r.counts.passed,1);
});
test('explicit taxpayer scope and original intrinsic percentage/SIN validation cannot be bypassed',()=>{
 const source=interviewCatalog(2021,{}, {topicId:'EMPINC0001',taxpayer:'primary'}).topics[0].fields[0];assert.equal(source.editable,true);
 assert.equal(interviewCatalog(2021,{}, {topicId:'EMPINC0001',taxpayer:'spouse'}).topics[0].fields[0].editable,true);
 assert.equal(interviewCatalog(2021,{}, {topicId:'MARSTA0001',taxpayer:'spouse'}).topics[0].fields[0].editable,false);
 assert.equal(interviewCatalog(2021,{}, {topicId:'MARSTA0201'}).topics[0].fields[0].editable,true,'Taxpayer is a branch guard, not a field redirect');
 const primary=interviewCatalog(2021,{'MARST:00034:B':'true','MARST:00051:R':'No'}, {topicId:'MARSTA0201',taxpayer:'primary'}).topics[0];
 const spouse=interviewCatalog(2021,{'MARST:00034:B':'true','MARST:00051:R':'No'}, {topicId:'MARSTA0201',taxpayer:'spouse'}).topics[0];
 assert.equal(primary.nextTopic,'MARSTA1003');assert.notEqual(spouse.nextTopic,'MARSTA1003');assert.equal(spouse.branches.find(b=>b.attrs.Taxpayer==='1').matches,false);
 assert.throws(()=>interviewPatch(2021,{}, {'BUSIN:00040:P:1':'150'},{topicId:'SELFEM4018',instances:[1]}),/original options|maximum/);
 assert.equal(validInterviewSin('100 000 009'),true);assert.equal(validInterviewSin('123 456 789'),false);
 assert.throws(()=>interviewPatch(2021,{}, {'TAXPY:00001:S':'123456789'}),/checksum/);
});

test('original confirmation/action metadata never silently accepts warnings or deletes records',()=>{
 const t=interviewCatalog(2021,{}, {topicId:'ADOPTI0004',computedFields:{'ADOPT:00010:B':'true'}}).topics[0];
 assert.equal(t.confirmations[0].status,'confirmation');assert.equal(t.confirmations[0].requiresAcknowledgement,true);assert.equal(t.confirmations[0].blocking,false);
 assert.throws(()=>interviewPatch(2021,{}, {'MARST:00001:O':'MARR'},{taxpayer:'spouses'}),/primary or spouse/);
 assert.throws(()=>interviewCatalog(2021,{}, {instances:[0]}),/positive integer/);
});

test('only original ClearOrphans checkpoints request cleanup and unchanged answers never trigger it',()=>{
 const source={'CHCAR:00001:R':'Yes','BUSIN:00101:C:1':'80000.00'};
 const change=interviewPatch(2021,source,{'CHCAR:00001:R':'No'},{topicId:'CHCARE0001'});
 assert.equal(change.requiresOrphanCleanup,true);assert.equal(change.cleanupCommands[0].topicId,'CHCARE0001');assert.equal(change.cleanupCommands[0].sourceAttribute,'Topic.ClearOrphans=true');
 assert.equal(change.fields['BUSIN:00101:C:1'],'80000.00','pure patch never guesses destructive native cleanup');
 assert.equal(interviewPatch(2021,source,{'CHCAR:00001:R':'Yes'},{topicId:'CHCARE0001'}).requiresOrphanCleanup,false);
 assert.equal(interviewPatch(2021,{}, {'SELFE:00001:R':'No'},{topicId:'SELFEM0001'}).requiresOrphanCleanup,false,'do not invent a command absent from source');
});

test('known NETFILE branch excludes ReFILE validation despite earlier unknown navigation; real ReFILE stays blocked',()=>{
 for(let year=2019;year<=2025;year++){
  const computedFields={'FILIN:20003:B':'true'};
  const initial=interviewValidation(year,{'FILIN:20001:R':'Yes'},{section:'FILING',computedFields});
  const refile=initial.checks.find(c=>c.topicId==='FILING2002');assert.ok(refile,`${year} original check exists`);assert.equal(refile.status,'error');assert.equal(refile.applicability,'inactive');assert.equal(initial.errors.length,0);
  for(const choice of ['No',undefined]){
   const f=choice?{'FILIN:20001:R':choice}:{};const r=interviewValidation(year,f,{section:'FILING',computedFields});assert.ok(r.errors.some(c=>c.topicId==='FILING2002'),`${year} ReFILE or uncertain mode must retain error`);
  }
 }
});

test('excluded original confirmation pages never request acknowledgement; uncertain applicable prompts remain',()=>{
 const computedFields={'ADOPT:00010:B':'true'};
 const active=interviewValidation(2021,{}, {section:'ADOPTI',computedFields});
 assert.ok(active.confirmations.some(c=>c.requiresAcknowledgement));
 const netfile=interviewValidation(2025,{'FILIN:20001:R':'Yes'},{section:'FILING',computedFields:{'FILIN:20003:B':'true'}});
 assert.equal(netfile.counts.errors,0);assert.ok(netfile.counts.inactive>0);
});

test('known inactive section excludes its confirmation without guessing an answer',()=>{
 const r=interviewValidation(2021,{}, {section:'ADOPTI',computedFields:{'INTRO:00167:B':'false','ADOPT:00010:B':'true'}});
 const c=r.confirmations.find(c=>c.fieldCode==='ADOPT:00010:B');assert.ok(c);assert.equal(c.applicability,'inactive');assert.equal(c.requiresAcknowledgement,false);assert.equal(r.counts.unknown,0);
});

test('authoritative filing mode prevents stale NETFILE answers from hiding an actual ReFILE confirmation error',()=>{
 const fields={'FILIN:20001:R':'Yes'},computedFields={'FILIN:20003:B':'true'};
 const refile=interviewValidation(2025,fields,{section:'FILING',computedFields,filingMode:'refile'});assert.ok(refile.errors.some(c=>c.topicId==='FILING2002'));
 const netfile=interviewValidation(2025,{'FILIN:20001:R':'No'},{section:'FILING',computedFields,filingMode:'netfile'});assert.equal(netfile.errors.length,0);assert.equal(fields['FILIN:20001:R'],'Yes');
 assert.throws(()=>interviewValidation(2025,fields,{filingMode:'other'}),/Filing mode/);
});

test('typed engine section visibility takes precedence over supplied derived flags',()=>{
 const r=interviewValidation(2019,{'MARST:00032:B':'true'}, {section:'SPOUSE',computedFields:{'SPOUS:01101:B':'true'},interviewConditions:{'MARST:00032:B':'false'}});
 assert.ok(r.confirmations.length);assert.ok(r.confirmations.every(c=>!c.requiresAcknowledgement));assert.equal(r.counts.unknown,0);
});
