import test from'node:test';import assert from'node:assert/strict';import{mkdtempSync,rmSync}from'node:fs';import{tmpdir}from'node:os';import{join,resolve}from'node:path';import{NativeFiling}from'../server/filing-engine.mjs';import{createHash}from'node:crypto';
const fields={
 'TAXPY:00001:S':'123 456 782','TAXPY:00031:D':'1988-01-01','TAXPY:00011:T':'Émile & Test','TAXPY:00013:T':'Filer','MARST:00001:O':'SING',
 'RESID:00001:R':'Yes','RESID:00002:O':'BC','IDENT:00011:R':'CANA','IDENT:00014:T':'Example Street','IDENT:00016:T':'Prince George','IDENT:00017:O':'BC','IDENT:00018:A':'V2L 0A1',
 'T4SLI:00010:O:1':'BC','T4SLI:00014:C:1':'60000.00','T4SLI:00016:C:1':'2900.00','T4SLI:00018:C:1':'889.54','T4SLI:00022:C:1':'10000.00','T4SLI:00024:C:1':'56300.00','T4SLI:00026:C:1':'60000.00'
};
test('request validation rejects wrong engine year, encoding and extra SOAP structure; original yearly requests remain valid',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'schema-audit-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const n=new NativeFiling(resolve('.'),dir);await n.initialize();
 const p=await n.prepare({year:2022,fields});assert.equal(p.schemaValidated,true);assert.equal(p.validationErrors.length,0);
 assert.ok(!p.payloadXml.includes('\t'),'original sender resaves XML with XmlDocument default two-space indentation');assert.match(p.payloadXml,/\r?\n  <soapenv:Body>/);assert.equal(p.payloadSha256,createHash('sha256').update(Buffer.from(p.payloadXml,'latin1')).digest('hex'));
 assert.match(p.payloadXml,/encoding="iso-8859-1"/);assert.ok(!/[^\u0000-\u00ff]/u.test(p.payloadXml));assert.match(p.payloadXml,/<comm:SoftwareID>113G<\/comm:SoftwareID>/);assert.match(p.payloadXml,/<comm:SoftwareRevisionDate>2026-04-22<\/comm:SoftwareRevisionDate>/);assert.equal((await n.validateRequest(p.payloadXml,{year:2022})).schemaValidated,true);
 for(const xml of [p.payloadXml.replace('encoding="iso-8859-1"','encoding="utf-8"'),p.payloadXml.replace('<soapenv:Body>','<unexpected/><soapenv:Body>'),p.payloadXml.replace('<soapenv:Body>','<soapenv:Body>Unexpected text'),p.payloadXml.replace('</soapenv:Envelope>','<soapenv:Header/></soapenv:Envelope>'),p.payloadXml.replace('<soapenv:Body>','<soapenv:Header/><soapenv:Header/><soapenv:Body>')]){
  const result=await n.validateRequest(xml,{year:2022});assert.equal(result.schemaValidated,false,JSON.stringify(result));
 }
 const wrongYear=await n.validateRequest(p.payloadXml,{year:2023});assert.equal(wrongYear.schemaValidated,false);assert.ok(wrongYear.validationErrors.some(e=>/tax year/.test(e)));
 const consent=await n.prepare({year:2022,fields:{...fields,'FILIN:99902:R':'Yes'}});await assert.rejects(()=>n.finalizeLive({year:2023,xml:consent.payloadXml,originatingIP:'8.8.8.8'}),/tax year|schema validation/);
 const terms=await n.termsRequest({year:2022,mode:'netfile'});assert.equal(terms.payloadXml,p.termsRequestXml);assert.ok(!terms.payloadXml.includes('\t'));assert.equal((await n.validateRequest(terms.payloadXml,{year:2022})).schemaValidated,true);
});
test('ReFILE difference baseline must match current taxpayer and year before original diff calculation',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'refile-schema-audit-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const n=new NativeFiling(resolve('.'),dir);await n.initialize();
 const p=await n.prepare({year:2022,fields});
 const wrongYearPayload=p.payloadXml.replace(/(<[^>]*TaxYear>)2022(<\/[^>]+>)/g,(_m,a,b)=>a+'2021'+b);
 assert.equal((await n.validateRequest(wrongYearPayload,{year:2022})).schemaValidated,false);
 await assert.rejects(()=>n.prepare({year:2022,mode:'refile',fields,baselinePayloadXml:wrongYearPayload}),/tax year|schema-valid/);
 await assert.rejects(()=>n.prepare({year:2022,mode:'refile',fields:{...fields,'TAXPY:00001:S':'987 654 321'},baselinePayloadXml:p.payloadXml}),/baseline taxpayer/);
 const amended=await n.prepare({year:2022,mode:'refile',fields:{...fields,'T4SLI:00014:C:1':'61000.00'},baselinePayloadXml:p.payloadXml});assert.equal(amended.schemaValidated,true);assert.equal(amended.baselineSupplied,true);assert.match(amended.payloadXml,/<comm:SoftwareID>113S<\/comm:SoftwareID>/);assert.ok(Object.values(amended.refileDifferences).includes('10100'));
});
