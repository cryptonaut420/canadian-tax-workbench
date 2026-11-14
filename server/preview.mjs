import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ApiError } from './model.mjs';
import { renderBarcode } from './barcode.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '../native-preview');
const manifests = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
const bundles = new Map();
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const n = (attrs, key, fallback = 0) => Number(attrs[key] ?? fallback);
const yes = value => value === 'true';
function bundle(year) {
  const manifest = manifests.find(x => x.year === Number(year));
  if (!manifest) throw new ApiError(404, 'No form templates for this tax year.');
  if (!bundles.has(manifest.year)) {
    const compressed = readFileSync(join(root, `${manifest.year}.json.gz`));
    if (createHash('sha256').update(compressed).digest('hex') !== manifest.bundleSha256) throw new ApiError(500, 'Form template hash mismatch.');
    bundles.set(manifest.year, JSON.parse(gunzipSync(compressed)));
  }
  return bundles.get(manifest.year);
}
function title(id) {
  if (/^T1G/.test(id)) return `T1 income tax return ${id.match(/P(\d+)$/)?.[1] ? '— page '+id.match(/P(\d+)$/)[1] : id}`;
  if (/^T1C/.test(id)) return `T1 condensed return — ${id}`;
  if (id === 'T2125FO') return 'T2125 — Business or professional activities';
  if (id === 'SCHED08') return 'Schedule 8 — CPP contributions';
  if (id === 'SCH08QC') return 'Schedule 8 — QPP contributions';
  if (/^[A-Z]{2}428FO$/.test(id)) return `${id.slice(0,2)}428 — provincial tax`;
  if (id.startsWith('T2209')) return 'T2209 — Federal foreign tax credits';
  if (id.startsWith('T2036')) return 'T2036 — Provincial foreign tax credits';
  if (id === 'T1WORKS') return 'Federal worksheet';
  if (/^SCHED\d+$/.test(id)) return `Schedule ${Number(id.slice(5))}`;
  return id;
}
function limitations(form, page, prepared = false) {
  const nodes = page.children, tags = new Set(nodes.map(x => x.tag));
  const out = [];
  if (tags.has('BarCode')) out.push('Machine-readable filing barcodes are omitted. This copy is for review only.');
  if (tags.has('ConditionalSection') && !prepared) out.push('This conditional page requires GenuTax’s native condensed PrintList preparation.');
  return out;
}
function children(node, tag) { return node.children.filter(x=>x.tag===tag); }
function loopIds(fields, group, parent = []) {
  const at=3+parent.length;
  return [...new Set(Object.keys(fields).map(key=>key.split(':')).filter(parts=>parts[0]===group && parent.every((value,i)=>parts[i+3]===String(value)) && parts.length>at).map(parts=>parts[at]))]
    .sort((a,b)=>/^\d+$/.test(a)&&/^\d+$/.test(b)?Number(a)-Number(b):a.localeCompare(b));
}
function allNodes(node) { return [node,...node.children.flatMap(allNodes)]; }
function pageCount(form, fields, instance = 1) {
  if (!yes(form.attrs.IsLooping)) return children(form,'Page').length;
  let rows=0;
  for (const node of allNodes(form)) if (node.tag==='DataText') {
    const [group,,,mode]=node.attrs.ID.split(':');
    if(mode==='L'||mode==='ML') rows=Math.max(rows,loopIds(fields,group,mode==='ML'?[instance]:[]).length);
  }
  return Math.max(1, Math.ceil(rows/n(form.attrs,'RowsPerPage',50)));
}
function recommended(forms, fields) {
  const province = fields['RESID:00100:O'] || fields['RESID:00002:O'] || fields['RESID:00100:T'];
  const result = [];
  const add = id => { if (forms[id] && !result.includes(id)) result.push(id); };
  for (let page = 1; page <= 10; page++) {
    const variants = [`T1G${province}P${page}`, `T1GENP${page}`];
    const selected = variants.find(id => forms[id]); if (selected) add(selected);
  }
  add(`${province}428FO`);
  if (Object.entries(fields).some(([key,value])=>key.startsWith('SCH08:') && value !== '' && value !== '0.00' && value !== '0')) add(province === 'QC' ? 'SCH08QC' : 'SCHED08');
  if (Object.entries(fields).some(([key,value])=>key.startsWith('FORTX:00025:') && Number(value)>0)) { add('T2209FO'); add('T2036FO'); }
  return result;
}
export function previewCatalog(year, fields = {}, printList = null) {
  const b = bundle(year);
  const included=(printList || []).map(value=>{
    const [id,count,instance]=String(value).split(':');
    return {id,pages:Number(count),instance:Math.max(1,Number(instance)||1),templateAvailable:!!b.forms[id]};
  });
  return { year: Number(year), sourceSha256: b.sourceSha256, evidenceId: b.evidenceId,
    parityVerified: false, format: 'svg', included, selectionSource:Array.isArray(printList)?'native-print-list':'heuristic',
    recommended:Array.isArray(printList)?[...new Set(included.map(x=>x.id))]:recommended(b.forms, fields),
    description: 'Original GenuTax form layouts and images, rendered natively for review. Font/position parity and all dynamic layouts remain unverified; this is not a paper-filing copy.',
    forms: Object.entries(b.forms).map(([id,form])=>{
      const instances = yes(form.attrs.IsMultiple) ? [...new Set(allNodes(form).filter(x=>x.tag==='DataText'&&['M','ML'].includes(x.attrs.ID.split(':')[3])).flatMap(x=>loopIds(fields,x.attrs.ID.split(':')[0])))].sort((a,b)=>Number(a)-Number(b)) : ['1'];
      const prepared=included.find(x=>x.id===id);
      const sourcePages=children(form,'Page'), pages=yes(form.attrs.IsLooping)||yes(form.attrs.IsConditional)?Array.from({length:prepared?.pages||pageCount(form,fields,instances[0]||1)},()=>sourcePages[0]):sourcePages;
      return {id,title:title(id),multiple:yes(form.attrs.IsMultiple),instances:instances.length?instances:['1'],looping:yes(form.attrs.IsLooping),
        pages:pages.map((page,i)=>({page:yes(form.attrs.IsLooping)||yes(form.attrs.IsConditional)?i+1:Number(page.attrs.PageNumber),width:n(page.attrs,'Width'),height:n(page.attrs,'Height'),warnings:limitations(form,page,!!prepared),supported:!!prepared||!page.children.some(x=>x.tag==='ConditionalSection')}))};
    }) };
}
// Formatting uses decimal strings and BigInt; no floating point money conversion.
export function formatMoney(value, {split = false, noCents = false} = {}) {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(String(value));
  if (!match) return {whole:'',cents:'',text:''};
  const fraction = (match[3] || '').padEnd(3,'0');
  let fractionalCents = BigInt(fraction.slice(0,2));
  if (Number(fraction[2]) >= 5) fractionalCents++;
  const cents = BigInt(match[2])*100n + fractionalCents;
  // Original renderer truncates whole dollars before formatting NoCents and
  // split columns. It tests the raw Decimal for zero/sign, before N2 rounding.
  const whole = (split || noCents ? BigInt(match[2]) : cents/100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g,',');
  const decimal = (split ? fractionalCents : cents%100n).toString().padStart(2,'0');
  const zero = !/[1-9]/.test(match[2]+(match[3] || ''));
  const negative = match[1] === '-' && !zero;
  return {whole:(negative?'(':'')+whole+(negative&&noCents?')':''), cents:decimal+(negative?')':''),
    text:(negative?'(':'')+whole+(noCents?'':'.'+decimal)+(negative?')':''),zero};
}
export function renderPreview({year, formId, page = 1, instance = 1, fields = {}, printList = null, barcodeMarkup = {}}) {
  const b = bundle(year), form = b.forms[formId];
  if (!form) throw new ApiError(404, 'Form not found.');
  if (!Number.isSafeInteger(Number(instance)) || Number(instance) < 1 || Number(instance) > 10000) throw new ApiError(400, 'Form instance must be an integer from 1 to 10000.');
  const prepared=(printList || []).map(x=>String(x).split(':')).find(x=>x[0]===formId&&Math.max(1,Number(x[2])||1)===Number(instance));
  const pages = form.children.filter(x=>x.tag==='Page'), totalPages=prepared?Number(prepared[1]):pageCount(form,fields,instance);
  const dynamic=yes(form.attrs.IsLooping)||yes(form.attrs.IsConditional);
  const selected = dynamic && Number.isSafeInteger(Number(page)) && Number(page)>=1 && Number(page)<=totalPages ? pages[0] : !dynamic ? pages.find(x=>Number(x.attrs.PageNumber)===Number(page)) : null;
  if (!selected) throw new ApiError(404, 'Form page not found.');
  const warnings = limitations(form,selected,!!prepared);
  if (selected.children.some(x=>x.tag==='ConditionalSection') && !prepared) throw new ApiError(422, 'Recalculate with native condensed print preparation before viewing this conditional form.', {warnings});
  const unresolved = new Set(), missing = new Set(), body = [], barcodeSlots = [], fonts = selected.children.filter(x=>x.tag==='Font');
  const canonical = new Map(Object.entries(fields).map(([key,value])=>[key.replace(/^([^:]+:[^:]+):[^:]+/,'$1'),value]));
  const lookup = code => fields[code] ?? canonical.get(code.replace(/^([^:]+:[^:]+):[^:]+/,'$1')) ?? '';
  const resolveField = (code, attrs = {}) => {
    const [group,field,type,mode] = code.split(':');
    const base=[group,field,type].join(':');
    let resolved=code;
    const row=n(attrs,'LoopNum')+(yes(form.attrs.IsLooping)?n(form.attrs,'RowsPerPage',50)*(Number(page)-1):0);
    const multiple=yes(form.attrs.IsMultiple), parent=multiple&&mode==='ML'?[String(instance)]:[];
    if (attrs.AltLoopID && ['L','ML'].includes(mode)) {
      const alternate=lookup(multiple&&mode==='ML'?attrs.AltLoopID.split(':').slice(0,3).join(':')+':'+instance:attrs.AltLoopID);
      if (alternate && /^[A-Z0-9]{5}:\d{5}:[A-Z](?::[A-Za-z0-9_-]+)*$/.test(alternate)) return lookup(alternate);
    }
    if (mode==='M') resolved=multiple?base+':'+instance:base;
    else if (mode==='L'||mode==='ML') {
      if(mode==='ML'&&!multiple) return lookup(base);
      const ids=loopIds(fields,group,parent), id=ids[row-1];
      if (!id) return '';
      resolved=base+':'+[...parent,id].join(':');
    }
    return lookup(resolved);
  };
  const condition = a => {
    if(yes(a.IsAlways))return true;
    const compare=(code,test,when)=>{
      const kind=String(code).split(':')[2],raw=resolveField(code);
      let left=String(raw),right=String(when);
      if(['C','I','F','P'].includes(kind)) {
        const scaled=value=>{const m=/^(-?)(\d+)(?:\.(\d+))?$/.exec(value||'0');if(!m)return null;return BigInt(m[1]+m[2]+(m[3]||'').padEnd(28,'0'));};
        left=scaled(left);right=scaled(right);if(left===null||right===null)return false;
      } else if(kind==='B') { left=left.toLowerCase()||'false';right=right.toLowerCase(); }
      return test==='NotEquals'?left!==right:test==='GreaterThan'?left>right:test==='GreaterThanEquals'?left>=right:test==='LessThan'?left<right:test==='LessThanEquals'?left<=right:left===right;
    };
    return compare(a.FieldCode,a.Test,a.WhenValue)&&(!a.AndFieldCode||compare(a.AndFieldCode,a.AndTest,a.AndWhenValue));
  };
  const width = n(selected.attrs,'Width'), height = n(selected.attrs,'Height'), dataSize = n(selected.attrs,'DataFontSize',25);
  const expanded=[];let cursor=70,started=Number(page)===1;
  const shifted=(node,dx,dy)=>({...node,attrs:{...node.attrs,Left:n(node.attrs,'Left')+dx,Top:n(node.attrs,'Top')+dy,...(node.tag==='Line'?{Right:n(node.attrs,'Right')+dx,Bottom:n(node.attrs,'Bottom')+dy}:{}),...(node.tag==='DataText'&&n(node.attrs,'CentsSep')?{CentsSep:n(node.attrs,'CentsSep')+dx}:{})}});
  for(const node of selected.children){
    if(node.tag!=='ConditionalSection'){expanded.push(node);continue;}
    if(!started&&node.attrs.ID===resolveField(`T1KFS:0000${page}:T`))started=true;
    if(!started)continue;
    if(Number(page)<totalPages&&node.attrs.ID===resolveField(`T1KFS:0000${Number(page)+1}:T`))break;
    if(!condition(node.attrs))continue;
    let column=0,lastColumnar=false,nextY=cursor;
    for(const unit of node.children){
      if(unit.tag!=='ConditionalUnit'||!condition(unit.attrs))continue;
      lastColumnar=yes(unit.attrs.IsColumnar);nextY=cursor+n(unit.attrs,'VerticalSpace');
      for(const child of unit.children)expanded.push(shifted(child,lastColumnar?column*(Number(year)>=2023?315:300):0,cursor));
      if(lastColumnar){column++;if(column>=5){column=0;cursor=nextY;}}
      else cursor=nextY;
    }
    if(lastColumnar&&column>0)cursor=nextY;
  }
  for (const node of expanded) {
    const a=node.attrs, x=n(a,'Left'), y=n(a,'Top');
    if ((yes(a.FirstPageOnly)&&Number(page)!==1)||(yes(a.LastPageOnly)&&Number(page)!==totalPages)) continue;
    if (node.tag === 'Image') {
      const image = b.images[node.text.trim()];
      if (image) body.push(`<image x="${x}" y="${y}" width="${n(a,'Width')}" height="${n(a,'Height')}" href="data:image/png;base64,${image}"/>`);
      else unresolved.add('Image: '+node.text.trim());
    } else if (node.tag === 'Line') body.push(`<line x1="${x}" y1="${y}" x2="${n(a,'Right')}" y2="${n(a,'Bottom')}" stroke="#${escape(a.Color||'000000')}" stroke-width="${n(a,'LineWidth',1)}"/>`);
    else if (node.tag === 'TextLine') {
      const f = fonts[n(a,'Font')] || {attrs:{Size:'28'},text:'Arial'};
      body.push(`<text xml:space="preserve" x="${x}" y="${y+n(f.attrs,'Size',28)*0.91}" font-family="Arial, Liberation Sans, sans-serif" font-size="${n(f.attrs,'Size',28)}" font-weight="${yes(f.attrs.Bold)?'bold':'normal'}" font-style="${yes(f.attrs.Italic)?'italic':'normal'}" fill="#${escape(a.Color||'000000')}">${node.children.map(c=>`<tspan${c.attrs.Bold?' font-weight="bold"':''}${c.attrs.CancelBold?' font-weight="normal"':''}${c.attrs.Size?` font-size="${n(c.attrs,'Size')}"`:''}${c.attrs.Underline?' text-decoration="underline"':''}>${escape(c.text.replace(/\[([A-Z0-9]{5}:\d{5}:[A-Z](?::[A-Za-z0-9_-]+)*)\]/g,(_,code)=>String(resolveField(code))))}</tspan>`).join('')}</text>`);
    } else if (node.tag === 'DataText') {
      const code=a.ID, kind=code.split(':')[2], raw=resolveField(code,a);
      const force=yes(a.ForceZero) || (a.ForceZeroWhen && ['true','True','Yes','1'].includes(String(resolveField(a.ForceZeroWhen))));
      if (raw === '' && !force) { missing.add(code); continue; }
      let text=String(raw === '' && force && ['I','F','P'].includes(kind) ? '0' : raw), cents='', split=kind==='C' && !!n(a,'CentsSep') && !yes(a.NoCents);
      if (kind==='C') {
        const value=formatMoney(raw || '0',{split,noCents:yes(a.NoCents)});
        if (value.zero && !force) continue;
        text=split?value.whole:value.text;cents=split?value.cents:'';
      } else if (kind==='D' && text) {
        const parts=text.split('-'); text=a.DateSection==='Y'?parts[0]:a.DateSection==='M'?parts[1]:a.DateSection==='D'?parts[2]:parts.join('/');
      } else {
        if (kind==='B' && !['true','True'].includes(text) && !force) continue;
        if (['I','F','P'].includes(kind) && Number(text)===0 && !force) continue;
        text=node.text.replace('{0}',text);
        if (n(a,'StartPos')>0) text=text.slice(n(a,'StartPos')-1,n(a,'StartPos')-1+n(a,'NumChars',text.length));
      }
      let align=a.Justification||'Center', xx=align==='Left'?x:align==='Right'?x+n(a,'Width'):x+n(a,'Width')/2;
      if (split) {align='Right';xx=n(a,'CentsSep')-5;}
      const attrs=`y="${y+2+dataSize*0.91}" font-family="Arial, Liberation Sans, sans-serif" font-size="${dataSize}" font-weight="${yes(a.Bold)?'bold':'normal'}"`;
      const clip=`field-clip-${body.length}`;
      body.push(`<g data-field="${escape(code)}"><title>${escape(code)}</title><clipPath id="${clip}"><rect x="${x}" y="${y}" width="${n(a,'Width')}" height="${n(a,'Height')}"/></clipPath><g clip-path="url(#${clip})"><text x="${xx}" ${attrs} text-anchor="${align==='Left'?'start':align==='Right'?'end':'middle'}">${escape(text)}</text>${split?`<text x="${n(a,'CentsSep')+5}" ${attrs}>${escape(cents)}</text>`:''}</g></g>`);
    } else if (node.tag === 'BarCode') {
      const slot={dataType:a.DataType,dataColumns:n(a,'DataColumns',14),dataRows:n(a,'DataRows',50),maxCodes:n(a,'MaxCodes',2),width:n(a,'Width'),height:n(a,'Height'),justification:a.Justification || 'Right'};
      barcodeSlots.push(slot);
      const encoded=barcodeMarkup[a.DataType];
      if(encoded?.markup)body.push(`<g data-source-pdf417="${escape(a.DataType)}" transform="translate(${x} ${y})">${encoded.markup}</g>`);
      if(encoded?.warnings)warnings.push(...encoded.warnings);
    } else if (node.tag === 'PageIndicator') body.push(`<text x="${x}" y="${y}" font-family="Arial, sans-serif" font-size="20">${escape(node.text.replace('{0}',page).replace('{1}',totalPages))}</text>`);
    else if (!['Font','BarCode'].includes(node.tag)) unresolved.add(node.tag);
  }
  if (unresolved.size) warnings.push(`Unimplemented elements or loop fields: ${[...unresolved].join(', ')}.`);
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${escape(title(formId))}"><title>${escape(title(formId))} — review copy</title><rect width="100%" height="100%" fill="white"/>${body.join('')}<rect x="0" y="${height-25}" width="${width}" height="25" fill="white"/><text x="${width/2}" y="${height-7}" text-anchor="middle" font-family="Arial, sans-serif" font-size="16" fill="#596673">Tax Workbench review copy — rendering parity unverified — not for paper filing</text></svg>`;
  return {svg,year:Number(year),formId,page:Number(page),instance:Number(instance),warnings:warnings.filter(w=>!w.startsWith('Machine-readable filing barcodes are omitted.') || !barcodeSlots.length || !barcodeSlots.every(slot=>barcodeMarkup[slot.dataType]?.markup)),barcodeSlots,unresolved:[...unresolved],missingFields:[...missing],parityVerified:false,sourceSha256:b.sourceSha256};
}

export async function renderPreviewWithBarcodes(options) {
  const initial=renderPreview(options);
  if(!initial.barcodeSlots.length)return initial;
  if(!options.barcodeData)return {...initial,warnings:[...initial.warnings,'The saved calculation has no original barcode payload. Complete identity/address inputs and recalculate before expecting machine-readable filing barcodes.']};
  const barcodeMarkup={};
  for(const slot of initial.barcodeSlots){
    if(barcodeMarkup[slot.dataType])continue;
    try { barcodeMarkup[slot.dataType]=await renderBarcode({...slot,barcodeData:options.barcodeData,year:options.year}); }
    catch(error){barcodeMarkup[slot.dataType]={markup:'',warnings:[`Original barcode encoding is unavailable for this page: ${error.message}`]};}
  }
  const result=renderPreview({...options,barcodeMarkup});
  return {...result,barcodes:Object.fromEntries(Object.entries(barcodeMarkup).map(([type,value])=>[type,{segments:value.segments || [],sourceEncoder:value.sourceEncoder===true,parityVerified:false}]))};
}
