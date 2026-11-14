import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
const require=createRequire(import.meta.url),{JSDOM}=require(process.env.JSDOM_PATH||'jsdom');
const id='11111111-1111-4111-8111-111111111111',person={id:'person',name:'Synthetic filer',birthDate:'1988-01-01',province:'BC',residency:'Yes'};
let current={id,personId:person.id,personName:person.name,year:2021,revision:3,state:'reviewed',fields:{'TAXPY:00031:D':'1988-01-01','RESID:00001:R':'Yes','RESID:00002:O':'BC','MARST:00001:O':'SING','T4SLI:00014:C:1':'60000.00'},spouseFields:null,issues:[],filingInputIssues:[],advisories:[],preparationDecisions:[],summary:{income:'60000.00',refund:'100.00',owing:'0.00'},calculation:{id:'saved-calculation',inputRevision:3,createdAt:'2026-11-13T00:00:00Z',result:{fields:{},lines:{},allocationAdjustments:[]}},filing:{mode:'netfile',status:'unfiled',attempts:[]},createdAt:'2026-11-13T00:00:00Z',updatedAt:'2026-11-13T00:00:00Z'};
const original=JSON.stringify(current),requests=[],downloads=[],blobs=[];let pdfMode='pending',resolvePdf;
const dom=new JSDOM(readFileSync('ui/index.html','utf8'),{url:'http://localhost/#token=private-synthetic-token',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;
w.confirm=()=>true;w.scrollTo=()=>{};w.HTMLElement.prototype.scrollIntoView=()=>{};
w.URL.createObjectURL=blob=>{blobs.push(blob);return 'blob:export-'+blobs.length;};w.URL.revokeObjectURL=()=>{};
w.HTMLAnchorElement.prototype.click=function(){downloads.push({href:this.href,name:this.download});};
w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
const workspace=()=>({people:[person],returns:[current],years:[2021],settings:{liveSubmissions:false},engine:{},version:1});
function pdfResponse({headers={},type='application/pdf',body='%PDF-1.7\nSynthetic renderer UI test\n%%EOF',status=200}={}){return new Response(body,{status,headers:{'Content-Type':type,'X-Input-Revision':'3','X-Calculation-Id':'saved-calculation','Content-Disposition':"attachment; filename*=UTF-8''..%2F..%2Fsynthetic%20review.pdf",...headers}});}
w.fetch=async(path,options={})=>{const url=new URL(path,'http://localhost');requests.push({path:url.pathname,query:url.searchParams,method:options.method||'GET',headers:options.headers});
 if(url.pathname.endsWith('/pdf')){
  if(pdfMode==='pending')return new Promise(resolve=>{resolvePdf=resolve;});
  if(pdfMode==='conflict')return new Response(JSON.stringify({error:'The return changed. Refresh the saved return and export again.'}),{status:409,headers:{'Content-Type':'application/json'}});
  if(pdfMode==='json-success')return pdfResponse({type:'application/json',body:'{"error":"not a PDF"}'});
  if(pdfMode==='wrong-snapshot')return pdfResponse({headers:{'X-Calculation-Id':'other-calculation'}});
  if(pdfMode==='invalid-bytes')return pdfResponse({body:'<html>not a PDF</html>'});
  return pdfResponse();
 }
 let data;if(url.pathname==='/v1/workspace')data=workspace();else if(url.pathname==='/v1/changes')data={version:1,uiVersion:'test-ui'};else if(url.pathname.endsWith('/forms'))data={inputRevision:3,recommended:['TEST'],selectionSource:'native-print-list',forms:[{id:'TEST',title:'Synthetic form',pages:[{page:1}]}]};else if(url.pathname.endsWith('/preview'))data={svg:'<svg xmlns="http://www.w3.org/2000/svg"/>',warnings:[],unresolved:[]};else if(url.pathname.endsWith('/export'))data={return:current};else if(url.pathname==='/v1/returns/'+id)data=current;else throw Error('Unexpected route '+url.pathname);
 return {ok:true,json:async()=>data};
};
const click=selector=>{const el=w.document.querySelector(selector);assert.ok(el,selector);el.click();};
const pdfButtons=()=>[...w.document.querySelectorAll('[data-action="export-pdf"]')];
async function until(fn,label){const started=Date.now();while(!fn()){if(Date.now()-started>5000)throw Error('Timed out: '+label);await new Promise(r=>setTimeout(r,10));}}
async function exportAndWaitForError(mode,pattern){pdfMode=mode;w.document.querySelector('#toast').textContent='';click('[data-action="export-pdf"]');await until(()=>pattern.test(w.document.querySelector('#toast').textContent),mode);assert.equal(downloads.length,1,'error must not download a JSON/error response');assert.ok(pdfButtons().every(b=>!b.disabled));}
try{
 await w.eval('(async()=>{'+readFileSync('ui/app.js','utf8')+'\n})()');click(`[data-action="select"][data-id="${id}"]`);await until(()=>w.document.querySelector('.return-meta'),'detail');
 assert.equal(w.document.querySelector('.export-menu summary').textContent,'Export');assert.ok(!pdfButtons()[0].disabled);assert.match(pdfButtons()[0].title,/review copy/i);
 const money=w.document.querySelector('[data-code="T4SLI:00014:C:1"]');money.focus();const inputValue=money.value;
 click('[data-action="export-pdf"]');await until(()=>resolvePdf,'PDF request');assert.ok(pdfButtons().every(b=>b.disabled));assert.match(w.document.querySelector('.export-menu summary').textContent,/Creating PDF/);assert.equal(w.document.querySelector('.content').classList.contains('loading'),false);assert.equal(money.value,inputValue);const one=requests.filter(r=>r.path.endsWith('/pdf'))[0];assert.equal(one.method,'GET');assert.equal(one.query.get('expectedRevision'),'3');assert.equal(one.query.get('calculationId'),'saved-calculation');assert.equal(one.headers.Authorization,'Bearer private-synthetic-token');assert.equal(one.headers.Accept,'application/pdf');click('[data-action="export-pdf"]');assert.equal(requests.filter(r=>r.path.endsWith('/pdf')).length,1);
 resolvePdf(pdfResponse());await until(()=>downloads.length===1,'PDF download');assert.equal(downloads[0].name,'synthetic review.pdf');assert.equal(blobs[0].type,'application/pdf');assert.match(w.document.querySelector('#toast').textContent,/download started/);assert.ok(pdfButtons().every(b=>!b.disabled));assert.equal(JSON.stringify(current),original,'export must not change review/calculation/source inputs');
 await exportAndWaitForError('conflict',/Refresh the saved return/);await exportAndWaitForError('json-success',/did not return a PDF/);await exportAndWaitForError('wrong-snapshot',/expected saved calculation/);await exportAndWaitForError('invalid-bytes',/incomplete or invalid/);
 click('[data-action="tab"][data-tab="results"]');assert.ok(pdfButtons().some(b=>b.textContent==='Export PDF'));click('[data-action="tab"][data-tab="preview"]');await until(()=>w.document.querySelector('#preview-svg img'),'preview');assert.ok(pdfButtons().some(b=>b.textContent==='Export full PDF'));
 click('[data-action="tab"][data-tab="inputs"]');pdfMode='pending';resolvePdf=null;click('[data-action="export-pdf"]');await until(()=>resolvePdf,'second pending');const edited=w.document.querySelector('[data-code="T4SLI:00014:C:1"]');edited.value='61000';edited.dispatchEvent(new w.Event('input',{bubbles:true}));assert.ok(pdfButtons().every(b=>b.disabled));w.document.querySelector('#toast').textContent='';resolvePdf(pdfResponse());await until(()=>/changed while the PDF/.test(w.document.querySelector('#toast').textContent),'changed during export');assert.equal(downloads.length,1);const requestCount=requests.filter(r=>r.path.endsWith('/pdf')).length;click('[data-action="export-pdf"]');assert.equal(requests.filter(r=>r.path.endsWith('/pdf')).length,requestCount);assert.ok(pdfButtons().every(b=>b.disabled));assert.equal(edited.value,'61000');assert.equal(JSON.stringify(current),original);
 click('[data-action="refresh"]');await until(()=>w.document.querySelector('#toast').textContent==='Workspace refreshed.','refresh');click('[data-action="export"]');await until(()=>downloads.length===2,'JSON export remains');assert.equal(downloads[1].name,'tax-return-2021.json');assert.equal(blobs.at(-1).type,'application/json');
 current={...current,calculation:null,state:'draft'};w.document.querySelector('#toast').textContent='';click('[data-action="refresh"]');await until(()=>w.document.querySelector('#toast').textContent==='Workspace refreshed.','uncalculated draft');assert.ok(pdfButtons().every(b=>b.disabled));
 assert.ok(requests.every(r=>r.method==='GET'),'PDF feature must not save/review/file inputs');assert.ok(!requests.some(r=>/\/(submit|review|prepare-submission|terms|calculate)$/.test(r.path)));
 console.log('PASS: PDF export binds the saved snapshot, downloads only PDF bytes, preserves edits/review, handles stale/errors, disables duplicate/dirty exports and retains JSON export.');
}finally{w.close();}
