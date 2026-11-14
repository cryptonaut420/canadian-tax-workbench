import {assertFilingAvailable} from './filing-availability.mjs';
import {isValidSin} from './identity.mjs';
export {isValidSin} from './identity.mjs';
import {createHash,randomUUID} from 'node:crypto';
import {isIPv4} from 'node:net';
import {NativeFiling} from './filing-engine.mjs';
import {CraTransport} from './cra-transport.mjs';
import {ApiError} from './model.mjs';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const wireHash=xml=>hash(Buffer.from(xml,'latin1'));
export function isPublicIPv4(value){
  if(typeof value!=='string' || !isIPv4(value))return false;
  const [a,b,c]=value.split('.').map(Number);
  return !(a===0 || a===10 || a===127 || a>=224 || (a===100 && b>=64 && b<=127) || (a===169 && b===254) || (a===172 && b>=16 && b<=31) || (a===192 && b===168) || (a===192 && b===0 && (c===0 || c===2)) || (a===192 && b===88 && c===99) || (a===198 && (b===18 || b===19)) || (a===198 && b===51 && c===100) || (a===203 && b===0 && c===113));
}
export function validateOriginatingIP(value){if(!isPublicIPv4(value))throw new ApiError(400,'Enter your current public IPv4 address. Private, loopback and placeholder addresses cannot be used for live filing.');return value;}


export function validateTaxpayerSin(value){
  if(!isValidSin(value))throw new ApiError(422,'Enter a valid standard nine-digit SIN. Temporary or individual tax-number filing needs separate verification.');
  return value.replace(/[ -]/g,'');
}

// A live capability is not filing authorization. The root API controls the
// persisted live switch and the per-snapshot human confirmation. This provider
// still requires current server-issued terms and an unchanged prepared payload.
export class LiveFiling {
  constructor(root,dataDir,{native,transport,now=()=>Date.now(),termsTTL=10*60000}={}){
    this.native=native || new NativeFiling(root,dataDir);
    this.transport=transport || new CraTransport({parseResponse:(xml,options)=>this.native.parseResponse(xml,options)});
    this.now=now;this.termsTTL=termsTTL;this.terms=new Map();this.prepared=new Map();
  }
  async initialize(){
    const health=await this.native.initialize();
    return {...health,liveReady:health.available!==false,networkEnabled:false,requiresExplicitLiveSetting:true,requiresCurrentCraTerms:true,requiresHumanConfirmation:true,blockers:[]};
  }
  prune(){
    for(const [id,t]of this.terms)if(Date.parse(t.expiresAt)<=this.now())this.terms.delete(id);
    for(const [id,p]of this.prepared)if(Date.parse(p.expiresAt)<=this.now())this.prepared.delete(id);
  }
  async fetchTerms({year,mode='netfile'}){
    assertFilingAvailable(year,mode);
    this.prune();
    const request=await this.native.termsRequest({year,mode});
    if(!request.schemaValidated || !request.payloadXml)throw new ApiError(422,'The original CRA terms request failed local schema validation.');
    // A terms request has no taxpayer return data. This is the only network
    // operation performed here before the user confirms a prepared filing.
    const response=await this.transport.fetchTerms({payloadXml:request.payloadXml,payloadHash:wireHash(request.payloadXml),year,mode});
    if(response.status!=='terms' || response.schemaValidated!==true || !response.messages?.some(s=>s.trim()))throw new ApiError(502,'CRA terms could not be retrieved and validated. No return was submitted.');
    const text=response.messages.join('\n\n');
    const t={id:randomUUID(),hash:hash(text),text,year,mode,fetchedAt:new Date(this.now()).toISOString(),expiresAt:new Date(this.now()+this.termsTTL).toISOString(),source:'CRA',responseSha256:response.responseSha256 || null};
    this.terms.set(t.id,Object.freeze(t));return {...t};
  }
  checkTerms(reference,{year,mode}={}){
    this.prune();
    const id=typeof reference==='string'?reference:reference?.id;
    const t=this.terms.get(id);
    if(!t || t.year!==year || t.mode!==mode || (reference?.hash && reference.hash!==t.hash))throw new ApiError(409,'Load the current CRA terms for this tax year and filing mode before preparing a live request.');
    return {...t};
  }
  isTermsCurrent(reference,options){try{this.checkTerms(reference,options);return true;}catch{return false;}}
  async prepare({year,mode='netfile',fields={},spouseFields=null,baselinePayloadXml=null,live=false,originatingIP,terms=null,termsId=null}){
    if(!live)return {...await this.native.prepare({year,mode,fields,spouseFields,baselinePayloadXml}),liveReady:false,offlineOnly:true};
    assertFilingAvailable(year,mode);
    validateOriginatingIP(originatingIP);
    const taxpayerSin=validateTaxpayerSin(fields['TAXPY:00001:S']);
    if(!['Yes','No'].includes(fields['FILIN:99903:R']))throw new ApiError(422,'Specify whether this is the taxpayer’s first-ever income tax return. A new filing year is a different question.');
    const accessCode=fields['FILIN:99931:M'];
    if(year>=2020 && fields['FILIN:99903:R']==='No' && accessCode && (typeof accessCode!=='string' || accessCode.length!==8 || !/^[A-Za-z0-9]{8}$/.test(accessCode)))throw new ApiError(422,'The optional NETFILE access code must contain exactly eight letters or digits.');
    const currentTerms=this.checkTerms(terms || termsId,{year,mode});
    // This is a pending-confirmation clone, never a silent update of the user's
    // stored answers. Agreement=1 cannot be transmitted without root confirmation.
    const formattedSin=sin=>sin.replace(/^(.{3})(.{3})(.{3})$/,'$1 $2 $3');
    const liveFields={...fields,'TAXPY:00001:S':formattedSin(taxpayerSin),'FILIN:99902:R':'Yes'};
    if(liveFields['SPOUS:00001:S'])liveFields['SPOUS:00001:S']=formattedSin(validateTaxpayerSin(liveFields['SPOUS:00001:S']));
    const liveSpouse=spouseFields ? {...spouseFields} : null;
    if(liveSpouse?.['TAXPY:00001:S'])liveSpouse['TAXPY:00001:S']=formattedSin(validateTaxpayerSin(liveSpouse['TAXPY:00001:S']));
    const prepared=await this.native.prepare({year,mode,fields:liveFields,spouseFields:liveSpouse,baselinePayloadXml});
    const errors=[...(prepared.validationErrors || [])];
    if(mode==='refile' && !baselinePayloadXml)errors.push('ReFILE requires the immutable original accepted request baseline.');
    if(!prepared.payloadXml || prepared.schemaValidated!==true || errors.length)return {...prepared,validationErrors:errors,liveReady:false,offlineOnly:true,terms:currentTerms};
    const final=await this.native.finalizeLive({year,xml:prepared.payloadXml,originatingIP});
    errors.push(...(final.validationErrors || []));
    const liveReady=final.schemaValidated===true && errors.length===0;
    if(liveReady)this.prepared.set(final.payloadSha256,{year,mode,termsId:currentTerms.id,termsHash:currentTerms.hash,originatingIP,expiresAt:currentTerms.expiresAt});
    return {...prepared,...final,validationErrors:errors,liveReady,offlineOnly:!liveReady,terms:currentTerms,
      warnings:['This pending-confirmation request has not been sent. Live filing uses the current public IPv4 detected automatically or entered in Settings.','Schema validation and original engine eligibility do not establish independent CRA certification or exhaustive return parity.'],
      evidence:{...prepared.evidence,liveMetadata:'The validated offline payload, including any explicit partnershipGrossAdjustments, is preserved byte for byte except the single audited OriginatingIP placeholder. AgreementIndicator is generated by the original serializer from a pending-confirmation clone.'}};
  }
  assertCanSend({payloadXml,payloadHash,year,mode,terms,termsId,originatingIP}){
    this.prune();
    assertFilingAvailable(year,mode);
    if(typeof payloadXml!=='string' || /[^\u0000-\u00ff]/u.test(payloadXml))throw new ApiError(409,'The prepared filing payload is missing or has invalid wire encoding.');
    const actual=wireHash(payloadXml),p=this.prepared.get(actual);
    if(!p || payloadHash!==actual || p.year!==year || p.mode!==mode)throw new ApiError(409,'Prepare and confirm a fresh live request. Its original payload must not change.');
    const t=this.checkTerms(terms || termsId || p.termsId,{year,mode});
    if(t.hash!==p.termsHash || (originatingIP && originatingIP!==p.originatingIP))throw new ApiError(409,'The filing IP or CRA terms changed. Prepare a new confirmation.');
    validateOriginatingIP(p.originatingIP);return {...p,terms:t};
  }
  async send(input){
    try {
      this.assertCanSend(input);
      const validation=await this.native.validateRequest(input.payloadXml,{year:input.year});
      if(validation.schemaValidated!==true || validation.taxYear!==String(input.year) || !isPublicIPv4(validation.originatingIP) || validation.agreementIndicator!=='1')throw new ApiError(409,'The prepared request no longer passes live filing validation.');
      validateTaxpayerSin(validation.taxpayerSin);
      // This callback is supplied by the root service, never by an HTTP body.
      // Recheck its persisted live switch/settings version after async work and
      // immediately before the transport opens the one allowed HTTPS request.
      this.assertCanSend(input);
      if(typeof input.allowSend!=='function' || input.allowSend()!==true)throw new ApiError(409,'Filing settings, reviewed inputs or linked sources changed before transmission. Prepare again.');
    }catch(error){error.notSent=true;throw error;}
    return this.transport.send(input);
  }
  inspectBaseline(xml,options){return this.native.inspectBaseline(xml,options);}
  parseResponse(xml,options){return this.native.parseResponse(xml,options);}
  validateRequest(xml,options){return this.native.validateRequest(xml,options);}
}
