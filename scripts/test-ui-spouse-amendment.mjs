import {writeSlip,slips,removeSlip} from '../server/preparation.mjs';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {businessCatalog,writeBusiness,businesses} from '../server/business.mjs';
const require=createRequire(import.meta.url),{JSDOM}=require(process.env.JSDOM_PATH || 'jsdom');
const fields={'EMPIN:00001:R':'Yes','TAXPY:00031:D':'1988-01-01','RESID:00001:R':'Yes','RESID:00002:O':'BC','MARST:00001:O':'SING','T4SLI:00014:C:1':'60000'};
let current={id:'11111111-1111-4111-8111-111111111111',personId:'p1',personName:'Synthetic filer',year:2021,revision:1,state:'reviewed',fields,spouseFields:null,issues:[],filingInputIssues:[],summary:{income:'60000',refund:'100.00',owing:'0.00'},calculation:{id:'c1',inputRevision:1,createdAt:'2026-11-13T00:00:00Z',result:{fields:{},lines:{},allocationAdjustments:[]}},filing:{mode:'netfile',status:'unfiled',attempts:[]},createdAt:'2026-11-13T00:00:00Z',updatedAt:'2026-11-13T00:00:00Z',preparationDecisions:[],advisories:[]};
let second={...current,id:'22222222-2222-4222-8222-222222222222',year:2020,revision:1,fields:{...fields},calculation:{...current.calculation,id:'c2'}};
const person={id:'p1',name:'Synthetic filer',birthDate:'1988-01-01',province:'BC',residency:'Yes'};
let puts=0,decisionPosts=[],previewRequests=[];const workspace=()=>({people:[person,{...person,id:'p2',name:'Synthetic spouse'}],returns:[current,source],years:[2019,2020,2021,2022,2023,2024,2025],engine:{},settings:{liveSubmissions:false},version:1});
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
 else if(url.pathname.endsWith('/spouse-source')){current={...current,revision:current.revision+1,state:'draft',calculation:null,fields:{...current.fields,'SPOUS:00051:C':source.summary.netIncome},spouseSource:{sourceReturnId:source.id,currentSourceNetIncome:source.summary.netIncome}};value={return:current};}
 else if(url.pathname.endsWith('/amendment'))value={inputRevision:current.revision,accepted:{inputRevision:1},availability:{supported:true,message:'ReFILE is available after assessment.'},spouseNetIncome:{filed:'40000.00',current:current.fields['SPOUS:00051:C']},filedTotals:{income:'60000',refund:'100.00',owing:'0.00'},currentTotals:null,note:'Original receipt is preserved.',calculationCurrent:false};
 else if(url.pathname.endsWith('/source'))value=source;
 else if(url.pathname.endsWith('/slips')){if(options.method==='POST'){current={...current,fields:writeSlip(current.fields,body,2021).fields,revision:current.revision+1,calculation:null};value={return:current};}else if(options.method==='DELETE'){current={...current,fields:removeSlip(current.fields,body.type,body.id),revision:current.revision+1,calculation:null};value={return:current};}else value={slips:slips(current.fields)};}
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
const source={...current,id:'source',personId:'p2',personName:'Synthetic spouse',summary:{netIncome:'50010.23'},calculation:{id:'source-calculation',inputRevision:1,result:{}}};
try{
 current.year=2022;source.year=2022;current.fields={...current.fields,'MARST:00001:O':'MARR','SPOUS:00051:C':'40000.00'};current.filing={mode:'refile',submittedAt:'2026-11-13T00:00:00Z',confirmationNumber:'SYNTHETIC',lastAccepted:{inputRevision:1},attempts:[],availability:{supported:true}};
 await w.eval('(async()=>{'+readFileSync('ui/app.js','utf8')+'\n})()');
 click('[data-action="select"][data-id="'+current.id+'"]');await until(()=>w.document.querySelector('[data-action="link-spouse-income"]'),'spouse source control');
 click('[data-action="link-spouse-income"]');await until(()=>w.document.querySelector('#modal').open,'choose source');const form=w.document.querySelector('#modal-form');form.elements.sourceReturnId.value='source';form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await until(()=>!w.document.querySelector('#modal').open,'source saved');
 assert.equal(current.fields['SPOUS:00051:C'],'50010.23');assert.equal(current.revision,2);assert.equal(current.filing.mode,'refile');assert.equal(current.filing.confirmationNumber,'SYNTHETIC');assert.match(w.document.querySelector('.return-meta').textContent,/changes pending/);
 click('[data-action="tab"][data-tab="filing"]');click('[data-action="amendment-review"]');await until(()=>w.document.querySelector('#modal').open,'amendment comparison');assert.match(w.document.querySelector('#modal').textContent,/\$40,000.00/);assert.match(w.document.querySelector('#modal').textContent,/\$50,010.23/);click('[data-action="close-modal"]');
 console.log('PASS: spouse-income refresh copies the exact selected current source, invalidates the draft, preserves acceptance and displays filed/current amendment amounts.');
}finally{w.close();}
