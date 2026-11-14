import test from 'node:test';
import assert from 'node:assert/strict';
import {buildPdfReport} from '../server/pdf-report.mjs';
import {previewCatalog} from '../server/preview.mjs';

const item=(year=2025,printList=['T1GENP1:1:0'])=>({year,revision:3,state:'calculated',personName:'Synthetic <taxpayer>',fields:{'BUSIN:00021:T:1':'First business','BUSIN:00021:T:2':'Second business'},summary:{income:'100000.00',taxableIncome:'90000.00',totalPayable:'20000.00',owing:'0.00',refund:'2500.00'},filing:{status:'unfiled'},issues:[],filingInputIssues:[],advisories:[],calculation:{id:'calculation-3',inputRevision:3,createdAt:'2026-11-13T10:00:00.000Z',result:{fields:{'T1GEN:00150:C':'100000.00'},printList}}});
const svg=(landscape=false)=>`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${landscape?'2100 1600':'1600 2100'}"><rect width="100%" height="100%" fill="white"/><text x="20" y="40">Synthetic form</text></svg>`;

test('PDF pack follows every native print-list page and repeated instance without deduplication',async()=>{
 const value=item(2025,['T1GENP1:1:0','T2125FO:2:1','T2125FO:2:2','BUSIOAD:3:2']);
 value.calculation.result.barcodeData='Synthetic saved source barcode';const calls=[];
 const output=await buildPdfReport(value,{render:async options=>{calls.push(options);return{svg:svg(options.formId==='BUSIOAD'),unresolved:[],warnings:options.formId==='BUSIOAD'?['Synthetic rendering note']:[]};}});
 assert.equal(output.manifest.length,8);assert.deepEqual(output.manifest.map(p=>[p.formId,p.page,p.instance]),[['T1GENP1',1,1],['T2125FO',1,1],['T2125FO',2,1],['T2125FO',1,2],['T2125FO',2,2],['BUSIOAD',1,2],['BUSIOAD',2,2],['BUSIOAD',3,2]]);
 assert.equal(calls.length,8);assert.ok(calls.every(c=>c.barcodeData==='Synthetic saved source barcode'&&c.fields['T1GEN:00150:C']==='100000.00'));
 assert.equal(output.manifest.at(-1).orientation,'landscape');assert.match(output.html,/@page formLandscape \{ size:Letter landscape/);
 assert.equal(output.warnings.length,3);assert.match(output.html,/Rendering warnings/);assert.match(output.html,/Synthetic rendering note/);
 assert.match(output.html,/data-instance="1"/);assert.match(output.html,/data-instance="2"/);assert.match(output.html,/8 original form pages/);
 assert.match(output.html,/Calculated draft - not marked reviewed/);assert.match(output.html,/No accepted submission is recorded/);assert.match(output.html,/Synthetic &lt;taxpayer&gt;/);
 assert.match(output.html,/2,500.00 CAD/);assert.match(output.html,/Supplementary Workbench review schedules/);
 assert.ok(!/<script\b|<link\b|\bsrc\s*=|https?:\/\//i.test(output.html.replaceAll('http://www.w3.org/2000/svg','')));
 assert.equal(output.inputRevision,3);assert.equal(output.calculationId,'calculation-3');
});

test('PDF pack renders original business templates separately in every supported year',async()=>{
 for(let year=2019;year<=2025;year++){
  const catalog=previewCatalog(year),form=catalog.forms.find(f=>f.id==='T2125FO');
  const data=item(year,[`T2125FO:${form.pages.length}:1`,`T2125FO:${form.pages.length}:2`]);
  const report=await buildPdfReport(data,{includeBusinessSchedules:false});
  assert.equal(report.manifest.length,form.pages.length*2,`${year} pages`);
  assert.ok(report.manifest.filter(p=>p.instance===1).length===form.pages.length);assert.ok(report.manifest.filter(p=>p.instance===2).length===form.pages.length);
  assert.match(report.html,/First business/);assert.match(report.html,/Second business/);assert.ok(!report.html.includes('Supplementary Workbench review schedules'));
  assert.ok(report.html.indexOf('data-instance="1"')<report.html.indexOf('data-instance="2"'));
 }
});

test('PDF export rejects stale, absent or incomplete originals instead of silently dropping pages',async()=>{
 await assert.rejects(()=>buildPdfReport({year:2025}),/Calculate the saved return/);
 const stale=item();stale.revision=4;await assert.rejects(()=>buildPdfReport(stale),/Recalculate/);
 await assert.rejects(()=>buildPdfReport(item(2025,[])),/no original form print list/);
 await assert.rejects(()=>buildPdfReport(item(2025,['NO_SUCH_FORM:1:0'])),/template is unavailable/);
 await assert.rejects(()=>buildPdfReport(item(2025,['T1GENP1:0:0'])),/invalid entry/);
 await assert.rejects(()=>buildPdfReport(item(),{render:async()=>({svg:svg(),unresolved:['Unsupported source element']})}),/cannot completely render/);
 await assert.rejects(()=>buildPdfReport(item(),{render:async()=>{throw Error('Image not available');}}),/No incomplete PDF was exported/);
 await assert.rejects(()=>buildPdfReport(item(),{render:async()=>({svg:'<svg></svg>'})}),/page dimensions/);
});

test('PDF filing status never describes an edited snapshot as the previously accepted return',async()=>{
 const data=item(),renderer={render:async()=>({svg:svg(),warnings:[],unresolved:[]})};
 data.filing={submittedAt:'2026-11-12T23:00:00Z',confirmationNumber:'SYNTHETIC-RECEIPT',lastAccepted:{calculationId:'old-calculation',inputRevision:2,confirmationNumber:'SYNTHETIC-RECEIPT'}};
 const old=await buildPdfReport(data,renderer);assert.match(old.html,/Acceptance recorded for a prior or unspecified snapshot/);assert.match(old.html,/not proof that these current values were submitted/);assert.ok(!old.html.includes('CRA acceptance recorded for this snapshot'));
 data.filing.lastAccepted={...data.filing.lastAccepted,calculationId:data.calculation.id,inputRevision:3};
 const accepted=await buildPdfReport(data,renderer);assert.match(accepted.html,/CRA acceptance recorded for this snapshot/);
});

test('inline original SVG fragments are unique per PDF page without rewriting source text or image bytes',async()=>{
 const data=item(2025,['T1GENP1:1:0','T2125FO:1:1','T2125FO:1:2']);
 const original=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 2100"><defs><clipPath id="field-clip-0"><rect width="100" height="20"/></clipPath><linearGradient id="shade"><stop offset="0"/></linearGradient><g id="row"><text>209,416.83</text></g></defs><g clip-path="url(#field-clip-0)" style="fill:url('#shade')"><text>Literal url(#field-clip-0) and id=&quot;field-clip-0&quot;</text></g><use href="#row"/><use xlink:href="#row"/><image href="data:image/png;base64,iVBORw0KGgoAAA=="/></svg>`;
 const out=await buildPdfReport(data,{includeBusinessSchedules:false,render:async()=>({svg:original,warnings:[],unresolved:[]})});
 const rendered=[...out.html.matchAll(/<svg\b[\s\S]*?<\/svg>/g)].map(m=>m[0]);assert.equal(rendered.length,3);
 const ids=[...out.html.matchAll(/\sid="([^"]+)"/g)].map(m=>m[1]);
 // Include SVG identifiers only; form wrappers use data-form-id rather than id.
 assert.equal(ids.length,9);assert.equal(new Set(ids).size,9);
 for(const [index,body]of rendered.entries()){
  const pageIds=new Set([...body.matchAll(/\sid="([^"]+)"/g)].map(m=>m[1]));
  assert.ok([...pageIds].every(id=>id.startsWith(`pdf-page-${index+1}-`)));
  const references=[...body.matchAll(/(?:clip-path|style)="([^"]+)"/g)].flatMap(m=>[...m[1].matchAll(/url\(['"]?#([^)'"\s]+)/g)].map(r=>r[1]));
  references.push(...[...body.matchAll(/(?:href|xlink:href)="#([^"]+)"/g)].map(m=>m[1]));
  assert.ok(references.length>=4);assert.ok(references.every(id=>pageIds.has(id)),references.join(', '));
  assert.match(body,/Literal url\(#field-clip-0\) and id=&quot;field-clip-0&quot;/);
  assert.ok(body.includes('data:image/png;base64,iVBORw0KGgoAAA=='));assert.ok(body.includes('209,416.83'));
 }
 assert.ok(original.includes('id="field-clip-0"'),'original renderer string is unchanged');
});

test('clip references in combined native T1 and T2125 pages resolve inside their own SVG',async()=>{
 const data=item(2025,['T1GENP1:1:0','T2125FO:2:1','T2125FO:2:2']);
 data.calculation.result.fields={...data.calculation.result.fields,'BUSIN:00101:C:1':'209416.83','BUSIN:00101:C:2':'202751.10','BUSIN:08299:C:1':'209416.83','BUSIN:08299:C:2':'202751.10'};
 const out=await buildPdfReport(data,{includeBusinessSchedules:false}),svgs=[...out.html.matchAll(/<svg\b[\s\S]*?<\/svg>/g)].map(m=>m[0]);
 const allIds=svgs.flatMap(body=>[...body.matchAll(/\sid="([^"]+)"/g)].map(m=>m[1]));assert.equal(allIds.length,new Set(allIds).size);assert.ok(allIds.length>=4);
 for(const body of svgs){const ids=new Set([...body.matchAll(/\sid="([^"]+)"/g)].map(m=>m[1]));const refs=[...body.matchAll(/clip-path="url\(#([^)]+)\)"/g)].map(m=>m[1]);assert.ok(refs.every(id=>ids.has(id)));}
 assert.match(out.html,/>209,416<\/text>/);assert.match(out.html,/>202,751<\/text>/);
});
