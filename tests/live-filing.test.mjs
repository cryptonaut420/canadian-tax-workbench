import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {EventEmitter} from 'node:events';
import {Readable} from 'node:stream';
import {createHash} from 'node:crypto';
import {NativeFiling} from '../server/filing-engine.mjs';
import {CraTransport,CRA_ENDPOINT} from '../server/cra-transport.mjs';
import {LiveFiling,isPublicIPv4,isValidSin} from '../server/live-filing.mjs';
const ns='http://www.cra-arc.gc.ca/xmlns/t1rsp/response/1-0-0';
const envelope=body=>`<?xml version="1.0" encoding="utf-8"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" xmlns:r="${ns}"><s:Body>${body}</s:Body></s:Envelope>`;
const message=text=>`<r:EnglishMessage><r:MessageText>${text}</r:MessageText></r:EnglishMessage>`;
const termsXML=envelope(`<r:TermsAndConditionsResponse><r:TermsAndConditions>${message('Synthetic terms – é. No request reaches CRA.')}</r:TermsAndConditions></r:TermsAndConditionsResponse>`);
const acceptanceXML=envelope(`<r:NetfileReturnResponse><r:ResultCode>000000</r:ResultCode><r:FileReturnResponse><r:Confirmation><r:ConfirmationCode>TEST1234</r:ConfirmationCode>${message('Accepted synthetic fixture – é')}</r:Confirmation></r:FileReturnResponse></r:NetfileReturnResponse>`);
const fields={
 'TAXPY:00001:S':'123456782','TAXPY:00031:D':'1988-01-01','TAXPY:00011:T':'Synthetic','TAXPY:00013:T':'Filer','MARST:00001:O':'SING','FILIN:99903:R':'No',
 'RESID:00001:R':'Yes','RESID:00002:O':'BC','IDENT:00011:R':'CANA','IDENT:00014:T':'Example Street','IDENT:00016:T':'Prince George','IDENT:00017:O':'BC','IDENT:00018:A':'V2L 0A1',
 'T4SLI:00010:O:1':'BC','T4SLI:00014:C:1':'60000.00','T4SLI:00016:C:1':'2900.00','T4SLI:00018:C:1':'889.54','T4SLI:00022:C:1':'10000.00','T4SLI:00024:C:1':'56300.00','T4SLI:00026:C:1':'60000.00'
};
async function setup(t){
 const dir=mkdtempSync(join(tmpdir(),'live-filing-test-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const native=new NativeFiling(resolve('.'),dir),posts=[];let clock=Date.now();
 const request=(url,options,callback)=>{
  assert.equal(url,CRA_ENDPOINT);assert.equal(options.method,'POST');assert.equal(options.headers.SOAPAction,'');
  const req=new EventEmitter();req.setTimeout=()=>{};req.destroy=()=>{};req.end=body=>{
   const text=body.toString('latin1');posts.push(text);const isTerms=text.includes('TermsAndConditionsRequest');
   const response=Readable.from([Buffer.from(isTerms?termsXML:acceptanceXML,'utf8')]);response.statusCode=200;response.headers={'content-type':'text/xml; charset=utf-8'};callback(response);
  };return req;
 };
 const transport=new CraTransport({request,parseResponse:(xml,options)=>native.parseResponse(xml,options)});
 const provider=new LiveFiling(resolve('.'),dir,{native,transport,now:()=>clock});await provider.initialize();
 return {provider,native,posts,advance:ms=>clock+=ms};
}
test('public IPv4 and standard SIN checks exclude placeholders and malformed identities',()=>{
 for(const ip of ['0.0.0.0','127.0.0.1','10.0.0.2','172.31.1.1','192.168.1.2','100.64.1.2','169.254.2.3','203.0.113.3','198.51.100.1','224.0.0.1','8.8.8.8\n','8.08.8.8','::1'])assert.equal(isPublicIPv4(ip),false,ip);
 assert.equal(isPublicIPv4('8.8.8.8'),true);
 assert.equal(isValidSin('123456782'),true);assert.equal(isValidSin('123 456 782'),true);assert.equal(isValidSin('123-456-782'),true);
 for(const sin of ['123456789','000000000','123456782<script>','123 456-782','123456782\n'])assert.equal(isValidSin(sin),false,sin);
});
test('native live plan preserves source inputs, binds CRA terms and sends only explicit finalized metadata through mock HTTPS',async t=>{
 const f=await setup(t);
 const offline=await f.provider.prepare({year:2021,fields:{...fields,'TAXPY:00001:S':'123 456 782'}});
 assert.equal(offline.offlineOnly,true);assert.equal(f.posts.length,0);
 const terms=await f.provider.fetchTerms({year:2021,mode:'netfile'});assert.match(terms.text,/terms – é/);
 assert.equal(f.posts.length,1);assert.ok(!f.posts[0].includes('TaxpayerSocialInsuranceNumber'));
 const p=await f.provider.prepare({year:2021,fields,live:true,originatingIP:'8.8.8.8',terms});
 assert.equal(p.liveReady,true);assert.equal(p.offlineOnly,false);assert.equal(p.schemaValidated,true);assert.equal(p.calculationPasses,3);
 assert.match(p.payloadXml,/<comm:OriginatingIP>8\.8\.8\.8<\/comm:OriginatingIP>/);assert.match(p.payloadXml,/<t1rq:AgreementIndicator>1<\/t1rq:AgreementIndicator>/);
 assert.equal(fields['TAXPY:00001:S'],'123456782');assert.equal(fields['FILIN:99902:R'],undefined);
 assert.equal(p.calculationFields['T1GEN:00484:C'],'491.48');
 const info=await f.provider.inspectBaseline(p.payloadXml,{year:2021});assert.equal(info.taxYear,'2021');assert.equal(info.taxpayerSin,'123456782');
 const result=await f.provider.send({payloadXml:p.payloadXml,payloadHash:p.payloadSha256,year:2021,mode:'netfile',terms,originatingIP:'8.8.8.8',allowSend:()=>true});
 assert.equal(f.posts.length,2);assert.equal(result.status,'accepted');assert.equal(result.confirmationNumber,'TEST1234');assert.match(result.message,/– é/);
 assert.equal(result.responseSha256,createHash('sha256').update(Buffer.from(acceptanceXML)).digest('hex'));
});
test('forged, stale or wrong-mode terms, modified payloads and invalid SIN never transmit a filing',async t=>{
 const f=await setup(t);const terms=await f.provider.fetchTerms({year:2021,mode:'netfile'});
 for(const options of [{terms:{...terms,id:'forged'}},{terms:{...terms,hash:'forged'}},{mode:'refile',terms},{originatingIP:'0.0.0.0',terms},{fields:{...fields,'TAXPY:00001:S':'123456789'},terms},{fields:{...fields,'FILIN:99903:R':''},terms},{fields:{...fields,'FILIN:99931:M':'bad-code'},terms}]){
  await assert.rejects(()=>f.provider.prepare({year:2021,fields,live:true,mode:'netfile',originatingIP:'8.8.8.8',...options}));
 }
 const p=await f.provider.prepare({year:2021,fields,live:true,originatingIP:'8.8.8.8',terms});
 await assert.rejects(()=>f.provider.send({payloadXml:p.payloadXml+' ',payloadHash:p.payloadSha256,year:2021,mode:'netfile',terms,allowSend:()=>true}),e=>e.notSent===true);
 f.advance(11*60000);
 await assert.rejects(()=>f.provider.send({payloadXml:p.payloadXml,payloadHash:p.payloadSha256,year:2021,mode:'netfile',terms,allowSend:()=>true}),e=>e.notSent===true);
 assert.equal(f.posts.length,1,'only the terms mock was called');
});
test('turning live mode off during async XML validation cancels before opening the filing connection',async t=>{
 const f=await setup(t);const terms=await f.provider.fetchTerms({year:2021,mode:'netfile'});
 const p=await f.provider.prepare({year:2021,fields,live:true,originatingIP:'8.8.8.8',terms});
 let release,started;const ready=new Promise(r=>started=r),gate=new Promise(r=>release=r);const validate=f.native.validateRequest.bind(f.native);
 f.native.validateRequest=async(...args)=>{started();await gate;return validate(...args);};let enabled=true;
 const pending=f.provider.send({payloadXml:p.payloadXml,payloadHash:p.payloadSha256,year:2021,mode:'netfile',terms,allowSend:()=>enabled});
 await ready;enabled=false;release();await assert.rejects(()=>pending,e=>e.notSent===true);assert.equal(f.posts.length,1);
});
