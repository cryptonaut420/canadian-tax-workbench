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
let puts=0,decisionPosts=[],previewRequests=[];const workspace=()=>({people:[person],returns:[current,second,{...current,id:'other',personId:'p2',personName:'Another person',summary:{income:'999999.99',refund:'999.99',owing:'0.00'}},{...current,id:'missing',year:2024,summary:{income:null,refund:null,owing:null},calculation:null}],years:[2019,2020,2021,2022,2023,2024,2025],engine:{},settings:{liveSubmissions:false},version:1});
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
try{
 current.summary={income:'1000.10',refund:'10.10',owing:'0.00'};second.summary={income:'2000.20',refund:'0.00',owing:'25.25'};
 await w.eval('(async()=>{'+readFileSync('ui/app.js','utf8')+'\n})()');
 assert.match(w.document.querySelector('h1').textContent,/Welcome to Tax Workbench/);assert.equal(w.document.querySelector('table'),null,'welcome is not an all-person return ledger');assert.equal(w.document.querySelector('[data-action="home"]').textContent,'Welcome');
 click('[data-action="person-filter"][data-id="p1"]');
 assert.equal(w.document.querySelector('[data-ledger-total="income"]').textContent,'$3,000.30');assert.equal(w.document.querySelector('[data-ledger-total="balance"]').textContent,'$15.15 net owing');assert.match(w.document.querySelector('.ledger-totals').textContent,/1 not calculated/);
 assert.equal(w.document.querySelectorAll('tbody tr').length,3);assert.ok(!w.document.querySelector('table').textContent.includes('fields'));assert.match(w.document.querySelector('thead').textContent,/Revision/);
 input('#ledger-year','2021');assert.equal(w.document.querySelector('[data-ledger-total="income"]').textContent,'$1,000.10');assert.equal(w.document.querySelector('[data-ledger-total="balance"]').textContent,'$10.10 net refund');
 input('#ledger-search','does-not-match');assert.equal(w.document.querySelector('[data-ledger-total="income"]').textContent,'—');click('[data-action="clear-ledger-filters"]');assert.equal(w.document.querySelector('[data-ledger-total="income"]').textContent,'$3,000.30');
 input('#ledger-status','filed');assert.equal(w.document.querySelector('[data-ledger-total="balance"]').textContent,'—');click('[data-action="clear-ledger-filters"]');
 click('[data-action="home"]');assert.equal(w.document.querySelector('table'),null);
 console.log('PASS: welcome replaces all-person ledger; totals follow person/year/search/progress filters, use exact cents and exclude missing calculations; revisions remain visible.');
}finally{w.close();}
