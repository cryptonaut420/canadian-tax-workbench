import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {businessCatalog,writeBusiness,businesses} from '../server/business.mjs';
const require=createRequire(import.meta.url),{JSDOM}=require(process.env.JSDOM_PATH || 'jsdom');
const fields={'EMPIN:00001:R':'Yes','TAXPY:00031:D':'1988-01-01','RESID:00001:R':'Yes','RESID:00002:O':'BC','MARST:00001:O':'SING','T4SLI:00014:C:1':'60000'};
let current={id:'11111111-1111-4111-8111-111111111111',personId:'p1',personName:'Synthetic filer',year:2021,revision:1,state:'reviewed',fields,spouseFields:null,issues:[],filingInputIssues:[],summary:{income:'60000',refund:'100.00',owing:'0.00'},calculation:{id:'c1',inputRevision:1,createdAt:'2026-11-13T00:00:00Z',result:{fields:{},lines:{},allocationAdjustments:[]}},filing:{mode:'netfile',status:'unfiled',attempts:[]},createdAt:'2026-11-13T00:00:00Z',updatedAt:'2026-11-13T00:00:00Z',preparationDecisions:[],advisories:[]};
let second={...current,id:'22222222-2222-4222-8222-222222222222',year:2020,revision:1,fields:{...fields},calculation:{...current.calculation,id:'c2'}};
const person={id:'p1',name:'Synthetic filer',birthDate:'1988-01-01',province:'BC',residency:'Yes'};
let puts=0,decisionPosts=[],previewRequests=[];const workspace=()=>({people:[person],returns:[current,second],years:[2019,2020,2021,2022,2023,2024,2025],engine:{},settings:{liveSubmissions:false},version:1});
const dom=new JSDOM(readFileSync('ui/index.html','utf8'),{url:'http://localhost/#token=synthetic',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;
w.confirm=()=>true;w.scrollTo=()=>{};w.HTMLElement.prototype.scrollIntoView=()=>{};w.URL.createObjectURL=()=> 'blob:synthetic';w.URL.revokeObjectURL=()=>{};
w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
w.fetch=async(path,options={})=>{
 const url=new URL(path,'http://localhost'),body=options.body?JSON.parse(options.body):null;let value;
 if(url.pathname==='/v1/workspace')value=workspace();
 else if(url.pathname==='/v1/changes')value={version:1,uiVersion:'synthetic'};
 else if(url.pathname==='/v1/people/p1'){Object.assign(person,body);value=person;}
 else if(url.pathname.endsWith('/decisions')){if(options.method==='POST'){decisionPosts.push(body);current={...current,preparationDecisions:[{...body,id:'d1',actor:'Owner',stale:false,createdAt:'2026-11-13T00:00:00Z'}],advisories:['Inventory is an owner-accepted estimate.']};}value={records:current.preparationDecisions};}
 else if(url.pathname.endsWith('/forms')){const y=url.pathname.includes(second.id)?2020:2021;value={inputRevision:1,recommended:['SYNTHETIC'],selectionSource:'native-print-list',forms:[{id:'SYNTHETIC',title:'Synthetic form',multiple:y===2021,pages:y===2021?[{page:1},{page:2},{page:3}]:[{page:1}]}]};}
 else if(url.pathname.endsWith('/preview')){previewRequests.push({year:url.pathname.includes(second.id)?2020:2021,page:Number(url.searchParams.get('page')),instance:Number(url.searchParams.get('instance'))});value={svg:'<svg xmlns="http://www.w3.org/2000/svg"/>',warnings:[],unresolved:[]};}
 else if(url.pathname.endsWith('/businesses'))value={catalog:businessCatalog(2021),businesses:businesses(current.fields)};
 else if(url.pathname.endsWith('/carry-forward'))value={fields:{},existingTarget:null};
 else if(url.pathname.endsWith(current.id)){if(options.method==='PUT'){puts++;current={...current,revision:current.revision+1,state:'draft',fields:body.fields,spouseFields:body.spouseFields,calculation:null};}value=current;}
 else if(url.pathname.endsWith(second.id))value=second;
 else throw Error('Unexpected mock route: '+url.pathname);
 return {ok:true,json:async()=>value};
};
const click=selector=>{const el=w.document.querySelector(selector);assert.ok(el,selector);el.click();};
const input=(selector,value)=>{const el=w.document.querySelector(selector);assert.ok(el,selector);el.value=value;el.dispatchEvent(new w.Event('input',{bubbles:true}));};
async function until(fn,label){const t=Date.now();while(!fn()){if(Date.now()-t>4000)throw Error('Timed out: '+label);await new Promise(r=>setTimeout(r,10));}}
try{
 await w.eval('(async()=>{'+readFileSync('ui/app.js','utf8')+'\n})()');
 current.issues=['Synthetic missing source'];click('[data-action="refresh"]');await until(()=>w.document.querySelector('#toast').textContent==='Workspace refreshed.','overview refresh');
 click('[data-action="person-filter"][data-id="p1"]');assert.ok(w.document.querySelector('#ledger-status'));assert.match(w.document.querySelector('.ledger-checks').textContent,/1 to check/);
 input('#ledger-status','attention');assert.equal(w.document.querySelectorAll('tbody tr').length,1);input('#ledger-status','');current.issues=[];
 click(`[data-action="select"][data-id="${current.id}"]`);await until(()=>w.document.querySelector('.return-meta'),'return');
 assert.equal(w.document.querySelector('[data-code="TAXPY:00001:S"]').type,'text');
 assert.equal(w.document.querySelector('[data-code="FILIN:99931:M"]').type,'text');
 click('[data-action="edit-person"]');await until(()=>w.document.querySelector('#modal').open,'person profile');
 assert.equal(w.document.querySelector('[name="sin"]').type,'text');assert.equal(w.document.querySelector('[name="netfileAccessCode"]').type,'text');
 const profile=w.document.querySelector('#modal-form');profile.elements.firstName.value='Synthetic legal';profile.elements.sin.value='123 456 782';profile.elements.city.value='Profile City';profile.elements.netfileAccessCode.value='AB12CD34';profile.querySelector('[type=submit]').click();
 await until(()=>!w.document.querySelector('#modal').open,'profile save');assert.equal(person.sin,'123 456 782');assert.equal(person.city,'Profile City');assert.equal(person.netfileAccessCode,'AB12CD34');assert.equal(current.fields['TAXPY:00001:S'],undefined);
 click('[data-action="edit-person"]');await until(()=>w.document.querySelector('#modal').open,'reopen person');assert.equal(w.document.querySelector('[name="sin"]').value,'123 456 782');assert.equal(w.document.querySelector('[name="netfileAccessCode"]').value,'AB12CD34');click('[data-action="close-modal"]');
 input('[data-code="T4SLI:00014:C:1"]','60000');click('[data-action="save"]');await until(()=>w.document.querySelector('#toast').textContent.includes('unchanged'),'no-op save');assert.equal(puts,0);assert.equal(current.state,'reviewed');
 input('[data-code="MARST:00001:O"]','MARR');assert.ok(w.document.querySelector('[data-code="SPOUS:00051:C"]'),'married status reveals spouse income immediately');input('[data-code="MARST:00001:O"]','SING');assert.equal(w.document.querySelector('[data-code="SPOUS:00051:C"]'),null);
 click('[data-action="tab"][data-tab="filing"]');input('[data-code="FILIN:99903:R"]','No');assert.ok(w.document.querySelector('[data-code="FILIN:99931:M"]'));assert.equal(w.document.querySelector('[data-code="FILIN:99931:M"]').type,'text');assert.equal(w.document.querySelectorAll('input[type="password"]').length,0);input('[data-code="FILIN:99903:R"]','Yes');assert.equal(w.document.querySelector('[data-code="FILIN:99931:M"]').type,'text');input('[data-code="FILIN:99903:R"]','');
 click('[data-action="tab"][data-tab="preview"]');await until(()=>w.document.querySelector('#preview-svg img'),'preview');const page=w.document.querySelector('#preview-page');page.value='3';page.dispatchEvent(new w.Event('change',{bubbles:true}));await until(()=>previewRequests.at(-1)?.page===3,'page3');
 click('[data-action="home"]');click('[data-action="person-filter"][data-id="p1"]');click(`[data-action="select"][data-id="${second.id}"]`);await until(()=>w.document.querySelector('h1')?.textContent.includes('2020'),'second return');click('[data-action="tab"][data-tab="preview"]');await until(()=>previewRequests.at(-1)?.year===2020,'second preview');assert.equal(previewRequests.at(-1).page,1);assert.equal(previewRequests.at(-1).instance,1);
 click('[data-action="home"]');click(`[data-action="select"][data-id="${current.id}"]`);await until(()=>w.document.querySelector('h1')?.textContent.includes('2021'),'first return again');
 input('[data-code="T4SLI:00014:C:1"]','61000');click('[data-action="carry-forward"]');await until(()=>w.document.querySelector('#modal').open,'carry modal');assert.equal(puts,1);assert.equal(current.fields['T4SLI:00014:C:1'],'61000','carry saves pending inputs');click('[data-action="close-modal"]');
 click('[data-action="preparation-decisions"]');await until(()=>w.document.querySelector('#modal').open,'decision modal');const f=w.document.querySelector('#modal-form');assert.equal(f.elements.status.value,'unresolved');f.elements.topic.value='inventory';f.elements.status.value='estimate-accepted';f.elements.description.value='Approximate stockpile value accepted by owner <script>never()</script>';f.elements.sourceReference.value='Owner statement';f.querySelector('[type=submit]').click();await until(()=>!w.document.querySelector('#modal').open,'save decision');assert.equal(decisionPosts.length,1);assert.equal(decisionPosts[0].status,'estimate-accepted');
 current={...current,calculation:{id:'c3',inputRevision:current.revision,createdAt:'2026-11-13T00:00:00Z',result:{fields:{},lines:{},allocationAdjustments:[]}}};w.document.querySelector('#toast').textContent='';click('[data-action="refresh"]');await until(()=>w.document.querySelector('#toast').textContent==='Workspace refreshed.','refresh');click('[data-action="tab"][data-tab="results"]');assert.match(w.document.querySelector('.preparation-summary').textContent,/Estimate accepted by owner/);assert.equal(w.document.querySelector('.preparation-summary script'),null);assert.match(w.document.querySelector('.preparation-summary').textContent,/Inventory is an owner-accepted estimate/);
 current.preparationDecisions[0].stale=true;current.preparationDecisions[0].sourceChanges=[{field:'MARST:00011:D:1',before:null,after:'2020-10-10'}];
 w.document.querySelector('#toast').textContent='';click('[data-action="refresh"]');await until(()=>w.document.querySelector('#toast').textContent==='Workspace refreshed.','stale decision refresh');
 click('[data-action="preparation-decisions"]');await until(()=>w.document.querySelector('#modal').open,'stale notes');
 assert.match(w.document.querySelector('#modal').textContent,/Status change date: Not entered → 2020-10-10/);
 click('#modal [data-action="revisit-decision"]');await until(()=>w.document.querySelector('#modal-form').elements.topic.value==='inventory','prefilled revisit');
 assert.equal(w.document.querySelector('#modal-form').elements.description.value,current.preparationDecisions[0].description);assert.equal(w.document.querySelector('#modal-form').elements.status.value,'estimate-accepted');assert.equal(decisionPosts.length,1,'revisit never silently acknowledges');click('[data-action="close-modal"]');
 current.fields=writeBusiness(current.fields,{id:'1',name:'Synthetic business',type:'OTHR',ownership:'SOLE',accounting:'ACCR',fiscalStart:'2021-01-01',fiscalEnd:'2021-12-31',sales:'10000',ccaClaim:{limited:'Yes',limit:'500.00'}},2021).fields;w.document.querySelector('#toast').textContent='';click('[data-action="refresh"]');await until(()=>w.document.querySelector('#toast').textContent==='Workspace refreshed.','refresh business');click('[data-action="tab"][data-tab="inputs"]');click('[data-action="edit-business"][data-id="1"]');await until(()=>w.document.querySelector('#modal').open,'business modal');const schedules=JSON.parse(w.document.querySelector('[name="businessSchedulesJson"]').value);assert.equal(schedules.ccaClaim.limit,'500.00');
 console.log('PASS: unchanged edits preserve review; dependent inputs update; previews reset across years; carryforward saves draft; source decisions distinguish estimates and escape text; original global CCA limit editable.');
}finally{w.close();}
