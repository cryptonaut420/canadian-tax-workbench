import {ApiError,summary} from './model.mjs';
import {previewCatalog,renderPreviewWithBarcodes,formatMoney} from './preview.mjs';
import {renderBusinessSchedules} from './business-schedules.mjs';

const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=value=>value===null||value===undefined||value===''?'Not available':`${formatMoney(value).text || 'Not available'} CAD`;
const positive=value=>/^\d+(?:\.\d+)?$/.test(String(value))&&BigInt(String(value).replace('.',''))>0n;
const itemRows=rows=>rows.map(([label,value])=>`<tr><th scope="row">${escape(label)}</th><td>${escape(value)}</td></tr>`).join('');

// Inline SVG fragment IDs live in the whole HTML document, not in each SVG.
// Reusing preview IDs across pages would attach later amounts to earlier clips.
// Rewrite only XML attributes; taxpayer text and embedded image bytes stay intact.
function namespaceSvgIds(svg,prefix){
 const tags=/<(?:[^"'>]|"[^"]*"|'[^']*')*>/g;
 const attribute=/([\s])([A-Za-z_][\w:.-]*)\s*=\s*("[^"]*"|'[^']*')/g;
 const ids=new Map();
 for(const tag of svg.match(tags)||[])for(const [, ,name,quoted]of tag.matchAll(attribute)){
  if(name!=='id')continue;
  const value=quoted.slice(1,-1);
  if(ids.has(value))throw new ApiError(422,'An original SVG page contains a duplicate fragment identifier. No incomplete PDF was exported.');
  ids.set(value,prefix+value);
 }
 const urlAttributes=new Set(['clip-path','mask','filter','fill','stroke','marker','marker-start','marker-mid','marker-end','style']);
 return svg.replace(tags,tag=>tag.replace(attribute,(all,space,name,quoted)=>{
  const quote=quoted[0];let value=quoted.slice(1,-1),next=value;
  if(name==='id')next=ids.get(value);
  else if((name==='href'||name==='xlink:href')&&value.startsWith('#')&&ids.has(value.slice(1)))next='#'+ids.get(value.slice(1));
  else if(urlAttributes.has(name))next=value.replace(/url\(\s*(["']?)#([^\s)'"]+)\1\s*\)/g,(reference,q,id)=>ids.has(id)?`url(${q}#${ids.get(id)}${q})`:reference);
  else if(name==='aria-labelledby'||name==='aria-describedby')next=value.replace(/\S+/g,id=>ids.get(id)||id);
  return next===value?all:`${space}${name}=${quote}${next}${quote}`;
 }));
}

const styles=`
@page report { size:Letter portrait; margin:.48in; }
@page formPortrait { size:Letter portrait; margin:.2in; }
@page formLandscape { size:Letter landscape; margin:.2in; }
*{box-sizing:border-box}html{font-family:Arial,Helvetica,sans-serif;color:#18384c;font-size:10pt;line-height:1.45}body{margin:0;page:report;background:#fff}
h1,h2,h3{line-height:1.2;break-after:avoid}h1{font-size:27pt;letter-spacing:-.6pt;margin:0 0 10pt}h2{font-size:16pt;margin:23pt 0 10pt}h3{font-size:11pt;margin:14pt 0 7pt}
p{margin:7pt 0;overflow-wrap:anywhere;orphans:3;widows:3}table{width:100%;border-collapse:collapse;margin:10pt 0 15pt;table-layout:fixed}thead{display:table-header-group}tr{break-inside:avoid}th,td{border-bottom:1px solid #d9e2e7;padding:7pt 8pt;text-align:left;vertical-align:top;overflow-wrap:anywhere}th{font-weight:600;background:#f3f6f8}caption{text-align:left;font-weight:600;padding:5pt 0}.metadata th{width:35%}.muted{color:#596e7b}.eyebrow{font-size:9pt;font-weight:700;letter-spacing:1.2pt;text-transform:uppercase;color:#277a75;margin-bottom:16pt}.notice{border-left:3pt solid #bd8434;padding:10pt 12pt;background:#fbf6ed;margin:16pt 0}.key-totals{display:grid;grid-template-columns:1fr 1fr;gap:9pt;margin:18pt 0}.total{padding:12pt;border:1px solid #d9e2e7}.total-label{font-size:9pt;color:#596e7b}.total-value{font-size:18pt;font-weight:700;margin-top:4pt}.manifest{break-before:page}.manifest td:first-child{width:7%}.manifest td:last-child{width:17%}.manifest .code{font-family:monospace;font-size:8pt}.form-page{margin:0;break-before:page;break-inside:avoid;display:flex;flex-direction:column;overflow:hidden}.form-page.portrait{page:formPortrait;width:8.1in;height:10.6in}.form-page.landscape{page:formLandscape;width:10.6in;height:8.1in}.form-caption{font-size:7pt;line-height:1.2;color:#647780;min-height:.16in;padding:0 0 .04in;flex:none}.svg-holder{flex:1;min-height:0;width:100%}.svg-holder>svg{width:100%;height:100%;display:block;max-width:100%;max-height:100%}.supplement{page:report;break-before:page}.supplement main>h1{font-size:22pt}.supplement section{margin:14pt 0 20pt}.supplement th{width:42%}.supplement h2{font-size:15pt}.warning-list{padding-left:16pt;font-size:9pt}.source-stamp{font-size:8pt;color:#596e7b}.status{font-weight:600}.cover{page:report}.cover .metadata{font-size:9pt}.manifest h1{font-size:21pt}
`;

function filingDescription(item,calculation){
 const accepted=item.filing?.lastAccepted;
 if(accepted?.calculationId===calculation.id&&accepted?.inputRevision===item.revision)return `CRA acceptance recorded for this snapshot${accepted.confirmationNumber?' - confirmation '+accepted.confirmationNumber:''}${accepted.completedAt?' - '+accepted.completedAt:''}`;
 if(accepted||item.filing?.submittedAt)return `Acceptance recorded for a prior or unspecified snapshot${item.filing?.confirmationNumber?' - confirmation '+item.filing.confirmationNumber:''}. This PDF contains the current saved snapshot; it is not proof that these current values were submitted.`;
 if(item.filing?.blocked)return 'A transmission has an unresolved outcome. Check the recorded filing history before another attempt.';
 if(item.priorFiling||item.initialFilingMode==='refile')return 'Prior filing reported separately. No accepted transmission of this current snapshot is recorded in this workspace.';
 return 'No accepted submission is recorded in this workspace.';
}

/** Build a self-contained review document from the original native PrintList.
 * It does not recalculate, alter inputs/reviews, fetch external assets or submit.
 */
export async function buildPdfReport(item,{includeBusinessSchedules=true,render=renderPreviewWithBarcodes}={}){
 const calculation=item?.calculation;
 if(!calculation?.result)throw new ApiError(409,'Calculate the saved return before exporting a PDF.');
 if(calculation.inputRevision!==item.revision)throw new ApiError(409,'Recalculate the latest saved inputs before exporting a PDF.');
 if(typeof includeBusinessSchedules!=='boolean')throw new ApiError(400,'includeBusinessSchedules must be a boolean.');
 const result=calculation.result,printList=result.printList;
 if(!Array.isArray(printList)||!printList.length)throw new ApiError(422,'The saved calculation has no original form print list. Recalculate before exporting a complete PDF.');
 const fields={...item.fields,...result.fields};
 const catalog=previewCatalog(item.year,fields,printList),forms=new Map(catalog.forms.map(form=>[form.id,form]));
 const manifest=[],pages=[],warnings=[];
 for(const entry of printList){
  if(typeof entry!=='string'||!/^([A-Z0-9_]+):([1-9]\d*):(\d+)$/.test(entry))throw new ApiError(422,'The original form print list contains an invalid entry. Recalculate before exporting the PDF.');
  const [formId,countText,rawInstance]=entry.split(':'),count=Number(countText),instance=Math.max(1,Number(rawInstance));
  if(!Number.isSafeInteger(count)||!Number.isSafeInteger(instance)||instance>10000)throw new ApiError(422,'The original form print list contains an invalid page count or instance.');
  const form=forms.get(formId);
  if(!form)throw new ApiError(422,`PDF export cannot include original form ${formId}: its template is unavailable. No incomplete PDF was exported.`,{formId});
  for(let index=0;index<count;index++){
   const page=form.pages[index]?.page??index+1;
   let rendered;
   try{rendered=await render({year:item.year,formId,page,instance,fields,printList,barcodeData:result.barcodeData});}
   catch(error){throw new ApiError(error.status===409?409:422,`PDF export could not render ${formId}, entry ${instance}, page ${page}: ${error.message}. No incomplete PDF was exported.`,{formId,page,instance});}
   if(typeof rendered?.svg!=='string'||!/^<svg\b/i.test(rendered.svg))throw new ApiError(422,`PDF export did not receive a complete SVG for ${formId}, entry ${instance}, page ${page}.`);
   if(rendered.unresolved?.length)throw new ApiError(422,`PDF export cannot completely render ${formId}, entry ${instance}, page ${page}: ${rendered.unresolved.join(', ')}.`,{formId,page,instance,unresolved:rendered.unresolved});
   const dimensions=rendered.svg.match(/\bviewBox=["']\s*[-\d.]+\s+[-\d.]+\s+([\d.]+)\s+([\d.]+)\s*["']/i);
   if(!dimensions||!(Number(dimensions[1])>0&&Number(dimensions[2])>0))throw new ApiError(422,`PDF export could not determine the page dimensions for ${formId}.`);
   const orientation=Number(dimensions[1])>Number(dimensions[2])?'landscape':'portrait';
   const pageWarnings=[...new Set(rendered.warnings||[])];
   const record={formId,page,instance,title:form.title,orientation,warnings:pageWarnings};manifest.push(record);
   for(const warning of pageWarnings)warnings.push(`${formId} / entry ${instance} / page ${page}: ${warning}`);
   const pageSvg=namespaceSvgIds(rendered.svg,`pdf-page-${manifest.length}-`);
   pages.push(`<figure class="form-page ${orientation}" data-form-id="${escape(formId)}" data-instance="${instance}" data-form-page="${page}"><figcaption class="form-caption">${escape(form.title)} | ${escape(formId)}${form.multiple?' | entry '+instance:''} | form page ${page} | saved revision ${item.revision}</figcaption><div class="svg-holder">${pageSvg}</div></figure>`);
  }
 }
 const totals=item.summary||summary(result),balance=positive(totals.refund)?['Refund',money(totals.refund)]:['Balance owing',money(totals.owing??totals.refund)];
 const generatedAt=new Date().toISOString();
 const metadata=[['Taxpayer',item.personName||'Unnamed taxpayer'],['Tax year',item.year],['Snapshot',item.state==='reviewed'?'Marked reviewed':'Calculated draft - not marked reviewed'],['Saved input revision',item.revision],['Calculation ID',calculation.id],['Calculated at (UTC)',calculation.createdAt||'Not supplied'],['Export generated at (UTC)',generatedAt],['Filing record',filingDescription(item,calculation)]];
 const issues=[...(item.issues||[]),...(item.filingInputIssues||[])],advisories=item.advisories||[];
 const sourceNotes=issues.length||advisories.length?`<section><h2>Preparation notes</h2>${issues.length?`<h3>Items requiring attention</h3><ul class="warning-list">${issues.map(text=>`<li>${escape(text)}</li>`).join('')}</ul>`:''}${advisories.length?`<h3>Source choices and advisories</h3><ul class="warning-list">${advisories.map(text=>`<li>${escape(text)}</li>`).join('')}</ul>`:''}</section>`:'';
 let supplement='';
 if(includeBusinessSchedules){
  const business=renderBusinessSchedules(item),body=business.html.match(/<body>([\s\S]*)<\/body>/i)?.[1];
  if(!body)throw new ApiError(500,'The supplementary business schedule could not be included in the PDF.');
  supplement=`<section class="supplement" aria-label="Supplementary business review schedules">${body}</section>`;
 }
 const manifestRows=manifest.map((entry,index)=>`<tr><td>${index+1}</td><td>${escape(entry.title)}<br><span class="code">${escape(entry.formId)} | entry ${entry.instance}</span></td><td>Form page ${entry.page}${entry.orientation==='landscape'?'<br>Landscape':''}</td></tr>`).join('');
 const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; script-src 'none'; object-src 'none'; base-uri 'none'"><title>${escape(item.year)} tax return review - ${escape(item.personName||'Taxpayer')}</title><style>${styles}</style></head><body><header class="cover"><p class="eyebrow">Tax Workbench | review copy</p><h1>${escape(item.year)} Tax Return Review</h1><p>${escape(item.personName||'Taxpayer')}</p><div class="notice"><strong>For review and record keeping.</strong> Original form layouts are rendered from the saved calculation. Rendering parity remains unverified. This is not a paper-filing copy, a submission to CRA, or proof of acceptance.</div><div class="key-totals">${[['Total income - line 15000',money(totals.income)],['Taxable income - line 26000',money(totals.taxableIncome)],['Total payable - line 43500',money(totals.totalPayable)],balance].map(([label,value])=>`<div class="total"><div class="total-label">${escape(label)}</div><div class="total-value">${escape(value)}</div></div>`).join('')}</div><table class="metadata"><caption>Saved snapshot and filing record</caption><tbody>${itemRows(metadata)}</tbody></table><p class="source-stamp">The PDF does not change review or filing status. Amounts may change if the saved inputs change.</p></header><section class="manifest"><h1>Included forms and schedules</h1><p>${manifest.length} original form pages, in the exact saved native print-list order. Entry numbers distinguish repeated business or other records. The sequence below counts original form pages, not physical PDF pages; the cover, this index and Workbench supplements are additional.</p><table><thead><tr><th scope="col">Order</th><th scope="col">Original form</th><th scope="col">Form page</th></tr></thead><tbody>${manifestRows}</tbody></table>${sourceNotes}${warnings.length?`<section><h2>Rendering warnings</h2><ul class="warning-list">${warnings.map(text=>`<li>${escape(text)}</li>`).join('')}</ul></section>`:''}<p class="source-stamp">Template source SHA-256: ${escape(catalog.sourceSha256)}. Original form selection: native print list. No unsupported form is silently omitted.</p></section><div class="original-forms">${pages.join('')}</div>${supplement}</body></html>`;
 return {html,manifest,warnings,year:item.year,inputRevision:calculation.inputRevision,calculationId:calculation.id,generatedAt};
}
