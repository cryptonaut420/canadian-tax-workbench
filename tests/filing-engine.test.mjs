import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {NativeFiling} from '../server/filing-engine.mjs';
const responseNS='http://www.cra-arc.gc.ca/xmlns/t1rsp/response/1-0-0';
const envelope=body=>`<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" xmlns:r="${responseNS}"><s:Body>${body}</s:Body></s:Envelope>`;
const filing=body=>envelope(`<r:NetfileReturnResponse><r:ResultCode>000000</r:ResultCode><r:FileReturnResponse>${body}</r:FileReturnResponse></r:NetfileReturnResponse>`);
const message=text=>`<r:EnglishMessage><r:MessageText>${text}</r:MessageText></r:EnglishMessage>`;
test('offline native filing metadata, exact terms SOAP, strict response classification and hostile XML',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'tax-offline-filing-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const engine=new NativeFiling(resolve('.'),dir);await engine.initialize();
  for(const year of [2019,2020,2021,2022,2023,2024,2025]) {
    const p=await engine.prepare({year,mode:'netfile'});assert.equal(p.liveReady,false);assert.equal(p.payloadXml,null);
    assert.match(p.termsRequestXml,/<t1rq:TermsAndConditionsRequest\s*\/>/);assert.equal(p.termsSchemaValidated,true);assert.equal(p.transport.automaticRetries,false);
  }
  const refile=await engine.prepare({year:2021,mode:'refile'});assert.match(refile.termsRequestXml,/RefileTermsAndConditionsRequest/);assert.ok(refile.validationErrors.some(x=>x.includes('ReFILE is no longer available')));
  const fields={
    'TAXPY:00001:S':'123 456 789','TAXPY:00031:D':'1988-01-01','TAXPY:00011:T':'Synthetic','TAXPY:00013:T':'Filer',
    'RESID:00001:R':'Yes','RESID:00002:O':'BC','IDENT:00011:R':'CANA','IDENT:00014:T':'Example Street','IDENT:00016:T':'Prince George','IDENT:00017:O':'BC','IDENT:00018:A':'V2L 0A1',
    'T4SLI:00010:O:1':'BC','T4SLI:00014:C:1':'60000.00','T4SLI:00016:C:1':'2900.00','T4SLI:00018:C:1':'889.54','T4SLI:00022:C:1':'10000.00','T4SLI:00024:C:1':'56300.00','T4SLI:00026:C:1':'60000.00'
  };
  const request=await engine.prepare({year:2021,mode:'netfile',fields});
  assert.equal(request.schemaValidated,true);assert.equal(request.liveReady,false);assert.equal(request.offlineOnly,true);assert.equal(request.validationErrors.length,0);
  assert.match(request.payloadXml,/<comm:OriginatingIP>0\.0\.0\.0<\/comm:OriginatingIP>/);assert.match(request.payloadXml,/<comm:SoftwareID>113G<\/comm:SoftwareID>/);
  assert.match(request.payloadXml,/<t1rq:AgreementIndicator>0<\/t1rq:AgreementIndicator>/);assert.match(request.payloadSha256,/^[a-f0-9]{64}$/);
  assert.equal((await engine.validateRequest(request.payloadXml)).schemaValidated,true);
  assert.equal(request.converged,true);assert.equal(request.calculationPasses,3);assert.equal(request.verificationPasses,1);
  const baseline=await engine.prepare({year:2022,mode:'netfile',fields});
  const amendment=await engine.prepare({year:2022,mode:'refile',fields:{...fields,'T4SLI:00014:C:1':'61000.00'},baselinePayloadXml:baseline.payloadXml});
  assert.equal(amendment.baselineSupplied,true);assert.equal(amendment.schemaValidated,true);
  assert.match(amendment.payloadXml,/<comm:SoftwareID>113S<\/comm:SoftwareID>/);
  assert.ok(Object.values(amendment.refileDifferences).includes('10100'));assert.ok(Object.values(amendment.refileDifferences).includes('+1,000.00'));
  const accepted=await engine.parseResponse(filing(`<r:Confirmation><r:ConfirmationCode>TEST1234</r:ConfirmationCode>${message('Accepted synthetic fixture')}</r:Confirmation>`));
  assert.equal(accepted.status,'accepted');assert.equal(accepted.confirmationCode,'TEST1234');assert.equal(accepted.schemaValidated,true);assert.match(accepted.dateSource,/Local receipt/);
  for(const year of [2019,2020,2021,2022,2023,2024,2025]){
    const current=filing(`<r:Confirmation><r:ConfirmationCode>SYNTH12345</r:ConfirmationCode>${message('Synthetic receipt')}</r:Confirmation>`).replace('000000','80');
    const parsed=await engine.parseResponse(current,{year});assert.equal(parsed.status,'accepted');assert.equal(parsed.resultCode,'80');assert.equal(parsed.schemaValidated,true);assert.equal(parsed.schemaCompatibility.length,1);
  }
  for(const code of ['8','800','abcdef','80 ']){
    const malformed=filing('<r:Confirmation><r:ConfirmationCode>SYNTH12345</r:ConfirmationCode></r:Confirmation>').replace('000000',code);
    assert.equal((await engine.parseResponse(malformed)).status,'unknown');
  }
  assert.equal((await engine.parseResponse(filing('<r:Confirmation/>').replace('000000','80'))).status,'unknown');
  const direct=envelope(`<r:FileReturnResponse><r:ProcessingError>${message('Synthetic invalid industry code')}<r:ErrorCodeDescription><r:ErrorCode>180002</r:ErrorCode>${message('Synthetic industry validation')}</r:ErrorCodeDescription></r:ProcessingError></r:FileReturnResponse>`);
  const oldResponse=await engine.parseResponse(direct,{year:2019});assert.equal(oldResponse.status,'rejected');assert.equal(oldResponse.schemaValidated,true);assert.deepEqual(oldResponse.errorCodes,['180002']);
  const directAccepted=envelope(`<r:FileReturnResponse><r:Confirmation><r:ConfirmationCode>SYNTH12345</r:ConfirmationCode>${message('Synthetic direct acknowledgement')}</r:Confirmation></r:FileReturnResponse>`);assert.equal((await engine.parseResponse(directAccepted,{year:2019})).status,'accepted');
  assert.equal((await engine.parseResponse(direct.replaceAll(responseNS,'https://untrusted.example/'),{year:2019})).status,'unknown');
  const rejected=await engine.parseResponse(filing(`<r:Rejection>${message('Rejected synthetic fixture')}</r:Rejection>`));assert.equal(rejected.status,'rejected');
  const processing=await engine.parseResponse(filing(`<r:ProcessingError>${message('Correct the fields')}<r:ErrorCodeDescription><r:ErrorCode>123</r:ErrorCode>${message('Synthetic error')}</r:ErrorCodeDescription></r:ProcessingError>`));assert.equal(processing.status,'rejected');assert.deepEqual(processing.errorCodes,['123']);
  const terms=await engine.parseResponse(envelope(`<r:TermsAndConditionsResponse><r:TermsAndConditions>${message('Synthetic terms')}</r:TermsAndConditions></r:TermsAndConditionsResponse>`));assert.equal(terms.status,'terms');assert.deepEqual(terms.messages,['Synthetic terms']);
  for(const xml of [filing('<r:Confirmation/>'),filing(`<r:SystemError>${message('Try later')}</r:SystemError>`),envelope('<s:Fault><faultstring>Unavailable</faultstring></s:Fault>'),'<not-xml',filing('<r:Confirmation><r:ConfirmationCode>TEST1234</r:ConfirmationCode></r:Confirmation>').replaceAll(responseNS,'https://untrusted.example/'),`<!DOCTYPE x [<!ENTITY secret SYSTEM "file:///etc/passwd">]>${filing('<r:Confirmation>&secret;</r:Confirmation>')}`]) {
    const result=await engine.parseResponse(xml);assert.equal(result.status,'unknown');assert.equal(result.requiresReconciliation,true);assert.equal(result.automaticRetryAllowed,false);
  }
  assert.equal((await engine.validateRequest('<malformed')).schemaValidated,false);
});
