import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {Readable} from 'node:stream';
import {CraTransport,CRA_ENDPOINT} from '../server/cra-transport.mjs';
const xml='<?xml version="1.0"?><FileReturnRequest>André</FileReturnRequest>';
test('CRA transport makes exactly one ISO-8859-1 POST and maps native confirmation codes to receipts',async()=>{
 let calls=0,body;
 const request=(url,options,callback)=>{
  calls++;assert.equal(url,CRA_ENDPOINT);assert.equal(options.method,'POST');assert.equal(options.headers.SOAPAction,'');assert.equal(options.headers['Content-Type'],'text/xml;charset=iso-8859-1');
  const req=new EventEmitter();req.setTimeout=()=>{};req.destroy=()=>{};req.end=b=>{body=b;const response=Readable.from([Buffer.from('<response/>','latin1')]);response.statusCode=200;callback(response);};return req;
 };
 const transport=new CraTransport({request,parseResponse:async(xml,{year})=>{assert.equal(year,2021);return {status:'accepted',confirmationCode:'TEST123',messages:['Synthetic acceptance']};}});
 const result=await transport.send({payloadXml:xml,year:2021,mode:'netfile'});
 assert.equal(calls,1);assert.equal(body.toString('latin1'),xml);assert.equal(body.length,Buffer.byteLength(xml,'latin1'));assert.equal(result.confirmationNumber,'TEST123');assert.equal(result.message,'Synthetic acceptance');
});
test('redirects, connection loss and parser failure remain ambiguous, with no automatic retry',async()=>{
 for(const scenario of ['redirect','disconnect','bad-response']){
  let calls=0;const request=(_url,_options,callback)=>{calls++;const req=new EventEmitter();req.setTimeout=()=>{};req.destroy=()=>{};req.end=()=>{if(scenario==='disconnect'){req.emit('error',Error('Lost'));return;}const response=Readable.from([Buffer.from('<bad/>')]);response.statusCode=scenario==='redirect'?302:200;callback(response);};return req;};
  const transport=new CraTransport({request,parseResponse:async()=>{throw Error('Invalid');}});
  assert.equal((await transport.send({payloadXml:xml,year:2021,mode:'refile'})).status,'unknown');assert.equal(calls,1);
 }
});
test('payload hash or encoding mismatch fails locally without opening a connection',async()=>{
 const transport=new CraTransport({request(){throw Error('Must not run');},parseResponse:async()=>{}});
 await assert.rejects(()=>transport.send({payloadXml:xml,mode:'netfile',payloadHash:'changed'}),/changed/);
 await assert.rejects(()=>transport.send({payloadXml:xml+'😀',mode:'netfile'}),/ISO-8859-1/);
});
test('a hard total deadline bounds slow trickled responses, independent of socket-idle callbacks',async()=>{
 let interval,destroyed=false;
 const request=(_url,_options,callback)=>{const req=new EventEmitter();req.setTimeout=()=>{};req.destroy=()=>{destroyed=true;clearInterval(interval);};req.end=()=>{const response=new Readable({read(){}});response.statusCode=200;callback(response);interval=setInterval(()=>response.push(Buffer.from(' ')),5);};return req;};
 const start=Date.now();const transport=new CraTransport({request,timeout:30,parseResponse:async()=>{throw Error('Should not parse incomplete data');}});
 const result=await transport.send({payloadXml:xml,year:2021,mode:'netfile'});
 assert.equal(result.status,'unknown');assert.equal(destroyed,true);assert.ok(Date.now()-start<1000);assert.match(result.message,/timed out/);
});

test('original gzip/deflate negotiation decodes bounded responses while preserving exact wire receipts',async()=>{
 const{gzipSync,deflateSync}=await import('node:zlib');const{createHash}=await import('node:crypto');
 for(const[encoding,compress]of[['gzip',gzipSync],['deflate',deflateSync]]){
  const expected='<?xml version="1.0" encoding="iso-8859-1"?><response>Accepté &amp; reçu</response>',bytes=compress(Buffer.from(expected,'latin1'));let parsed=0;
  const request=(_url,options,callback)=>{assert.equal(options.headers['Accept-Encoding'],'gzip,deflate');const req=new EventEmitter();req.setTimeout=()=>{};req.destroy=()=>{};req.end=()=>{const response=Readable.from([bytes]);response.statusCode=200;response.headers={'content-type':'text/xml;charset=iso-8859-1','content-encoding':encoding};callback(response);};return req;};
  const t=new CraTransport({request,parseResponse:async input=>{parsed++;assert.equal(input,expected);return{status:'accepted',confirmationCode:'SYNTHETIC-ONLY'};}});const r=await t.send({payloadXml:xml,year:2021,mode:'netfile'});assert.equal(r.status,'accepted');assert.equal(parsed,1);assert.equal(r.responseSha256,createHash('sha256').update(bytes).digest('hex'));assert.equal(r.rawResponseBase64,bytes.toString('base64'));assert.equal(r.rawResponseXml,expected);
 }
});

test('malformed, unsupported or oversized decompressed acknowledgements remain unknown without retry',async()=>{
 const{gzipSync}=await import('node:zlib');
 for(const[encoding,bytes]of[['gzip',Buffer.from('notgzip')],['br',Buffer.from('unsupported')],['gzip',gzipSync(Buffer.alloc(2048,65))]]){
  let calls=0,parses=0;const request=(_u,_o,callback)=>{calls++;const req=new EventEmitter();req.setTimeout=()=>{};req.destroy=()=>{};req.end=()=>{const response=Readable.from([bytes]);response.statusCode=200;response.headers={'content-type':'text/xml','content-encoding':encoding};callback(response);};return req;};const t=new CraTransport({request,maxBytes:1024,parseResponse:async()=>{parses++;return{status:'accepted'};}});const r=await t.send({payloadXml:xml,year:2021,mode:'netfile'});assert.equal(r.status,'unknown');assert.equal(calls,1);assert.equal(parses,0);
 }
});

test('HTTP wire preserves empty SOAPAction, Latin1 byte length and escaped text for NETFILE/ReFILE operations',async t=>{
 const http=await import('node:http');const{createHash}=await import('node:crypto');let requests=[];
 const server=http.createServer(async(req,res)=>{const chunks=[];for await(const c of req)chunks.push(c);requests.push({headers:req.headers,rawHeaders:req.rawHeaders,method:req.method,body:Buffer.concat(chunks),httpVersion:req.httpVersion});res.writeHead(200,{'Content-Type':'text/xml;charset=utf-8'});res.end('<synthetic/>');});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const request=(url,options,callback)=>{assert.equal(url,CRA_ENDPOINT);return http.request({host:'127.0.0.1',port:server.address().port,path:'/offline-wire-test',...options},callback);};const transport=new CraTransport({request,parseResponse:async()=>({status:'accepted',confirmationCode:'LOCAL-ONLY'})});
 for(const[mode,kind,marker]of[['netfile','filing','FileReturnRequest'],['refile','filing','FileReturnRequest'],['netfile','terms','TermsAndConditionsRequest'],['refile','terms','RefileTermsAndConditionsRequest']]){
  const payload=`<?xml version="1.0" encoding="iso-8859-1"?><${marker}>André &amp; Élise &#x4E2D;</${marker}>`,bytes=Buffer.from(payload,'latin1');await transport.exchange({payloadXml:payload,payloadHash:createHash('sha256').update(bytes).digest('hex'),year:2022,mode,kind});const actual=requests.at(-1);assert.equal(actual.method,'POST');assert.equal(actual.httpVersion,'1.1');assert.equal(actual.headers.soapaction,'');assert.ok(actual.rawHeaders.includes('SOAPAction'));assert.equal(actual.headers['content-type'],'text/xml;charset=iso-8859-1');assert.equal(Number(actual.headers['content-length']),bytes.length);assert.deepEqual(actual.body,bytes);assert.equal(actual.headers.authorization,undefined);assert.equal(actual.headers.cookie,undefined);
 }
 assert.equal(requests.length,4);
});
