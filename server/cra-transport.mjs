import {gunzipSync,inflateSync} from 'node:zlib';
import https from 'node:https';
import {createHash} from 'node:crypto';

export const CRA_ENDPOINT='https://apps.cra-arc.gc.ca/ebci/pfno/ws/services/FileReturnService';
function decodedBody(bytes,encoding,maxBytes){
  const coding=String(encoding || '').trim().toLowerCase();
  if(!coding||coding==='identity')return bytes;
  const options={maxOutputLength:maxBytes};
  if(coding==='gzip')return gunzipSync(bytes,options);
  if(coding==='deflate')return inflateSync(bytes,options);
  throw Error('Unsupported CRA response compression.');
}
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function responseText(bytes,contentType='') {
  const declaration=bytes.subarray(0,200).toString('ascii').match(/encoding\s*=\s*["']([^"']+)/i)?.[1];
  const charset=(contentType.match(/charset\s*=\s*["']?([^\s;"']+)/i)?.[1] || declaration || 'utf-8').toLowerCase();
  if(['iso-8859-1','latin1','latin-1'].includes(charset))return bytes.toString('latin1');
  if(['utf-8','utf8','us-ascii'].includes(charset))return new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  throw Error('Unsupported CRA response encoding.');
}
// Exactly one authenticated-TLS endpoint and one POST per call. No redirects,
// retry loop, cookie jar, public-IP service or GenuTax vendor host is involved.
export class CraTransport {
  constructor({parseResponse,request=https.request,timeout=60000,maxBytes=4*1024*1024}={}) {
    if(typeof parseResponse!=='function')throw Error('A strict CRA response parser is required.');
    this.parseResponse=parseResponse;this.request=request;this.timeout=timeout;this.maxBytes=maxBytes;
  }
  async exchange({payloadXml,payloadHash,year,mode,kind='filing'}) {
    if(!['netfile','refile'].includes(mode))throw Error('Invalid filing mode.');
    const marker=kind==='terms'?(mode==='refile'?'RefileTermsAndConditionsRequest':'TermsAndConditionsRequest'):'FileReturnRequest';
    if(typeof payloadXml!=='string' || !payloadXml.includes(marker))throw Error(`A full ${marker} SOAP envelope is required.`);
    if(/[^\u0000-\u00ff]/u.test(payloadXml))throw Error('Payload contains unescaped characters outside ISO-8859-1.');
    const body=Buffer.from(payloadXml,'latin1');
    if(payloadHash && hash(body)!==payloadHash)throw Error('Prepared payload changed.');
    const received=await new Promise(resolve=>{
      let finished=false,total=0,req,timer;
      const finish=value=>{if(finished)return;finished=true;clearTimeout(timer);resolve(value);};
      timer=setTimeout(()=>{finish({error:'The CRA connection timed out.'});req?.destroy();},this.timeout);
      try {
        req=this.request(CRA_ENDPOINT,{method:'POST',family:4,headers:{'Content-Type':'text/xml;charset=iso-8859-1','SOAPAction':'','Content-Length':body.length,'Accept':'text/xml','Accept-Encoding':'gzip,deflate','User-Agent':'Mozilla/4.0 (compatible; MSIE 6.0; MS Web Services Client Protocol 2.0.50727.4241)'}},res=>{
          const chunks=[];
          res.on('data',chunk=>{const data=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);total+=data.length;if(total>this.maxBytes){finish({error:'The CRA response exceeded its size limit.'});res.destroy();req?.destroy();return;}chunks.push(data);});
          res.on('aborted',()=>finish({error:'The CRA response was interrupted.'}));
          res.on('error',()=>finish({error:'The CRA response could not be read.'}));
          res.on('end',()=>finish({statusCode:res.statusCode,bytes:Buffer.concat(chunks),contentType:String(res.headers?.['content-type'] || ''),contentEncoding:String(res.headers?.['content-encoding'] || '')}));
        });
        req.setTimeout(this.timeout,()=>{finish({error:'The CRA connection timed out.'});req.destroy();});
        req.on('error',()=>finish({error:'The CRA connection ended without a complete acknowledgement.'}));
        req.end(body);
      }catch{finish({error:'The CRA connection could not be opened.'});}
    });
    const receivedAt=new Date().toISOString();
    const raw=received.bytes?{responseSha256:hash(received.bytes),rawResponseBase64:received.bytes.toString('base64')}:{};
    if(received.error || received.statusCode!==200)return {status:'unknown',message:received.error || `CRA returned HTTP ${received.statusCode}. Acceptance is unconfirmed.`,receivedAt,httpStatus:received.statusCode || null,...raw};
    try {
      const xml=responseText(decodedBody(received.bytes,received.contentEncoding,this.maxBytes),received.contentType),parsed=await this.parseResponse(xml,{year});
      return {...parsed,confirmationNumber:parsed.confirmationCode || parsed.confirmationNumber || null,message:parsed.message || parsed.messages?.join('\n') || '',rawResponseXml:xml,...raw,receivedAt,httpStatus:received.statusCode};
    }catch{return {status:'unknown',message:'The response could not be validated as a CRA acknowledgement.',receivedAt,httpStatus:received.statusCode,...raw};}
  }
  send(input){return this.exchange({...input,kind:'filing'});}
  fetchTerms(input){return this.exchange({...input,kind:'terms'});}
}
