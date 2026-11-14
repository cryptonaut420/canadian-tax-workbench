import {partnershipEngineFields,partnershipSlipReport} from './partnership-slips.mjs';
import { spawn } from 'node:child_process';
import { existsSync, statSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ApiError } from './model.mjs';
function run(command,args,{cwd,env,input='',timeout=45000}={}) {
  return new Promise((resolve,reject)=>{
    const child=spawn(command,args,{cwd,env:{...process.env,...env},stdio:['pipe','pipe','pipe']});
    let out='',err='',size=0,settled=false;
    const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve(value);};
    const timer=setTimeout(()=>{child.kill('SIGTERM');finish(new ApiError(504,'Offline filing validation timed out.'));},timeout);
    child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
    for(const [stream,isError] of [[child.stdout,false],[child.stderr,true]])stream.on('data',chunk=>{
      size+=Buffer.byteLength(chunk,'utf8');if(size>8*1024*1024){child.kill('SIGTERM');finish(new ApiError(502,'Offline filing output exceeded its limit.'));return;}
      if(isError)err+=chunk;else out+=chunk;
    });
    child.on('error',e=>finish(new ApiError(503,`Cannot start offline filing validator: ${e.message}`)));
    child.on('close',code=>finish(code===0?null:new ApiError(502,`Offline filing validator failed: ${err.trim()||`exit ${code}`}`),out));
    child.stdin.on('error',()=>{});child.stdin.end(input);
  });
}
// Deliberately no HTTP client and no automatic retries. Only bundled resources
// and caller-supplied XML are processed by this adapter.
export class NativeFiling {
  constructor(root,dataDir) {
    this.root=root;this.dll=join(root,'native-filing/bin/Debug/net10.0/NativeFiling.dll');
    this.env={DOTNET_CLI_TELEMETRY_OPTOUT:'1',DOTNET_SKIP_FIRST_TIME_EXPERIENCE:'1',DOTNET_CLI_HOME:join(dataDir,'dotnet-home')};
    mkdirSync(this.env.DOTNET_CLI_HOME,{recursive:true,mode:0o700});this.queue=Promise.resolve();
  }
  async initialize() {
    const sources=['native-common/InterviewConditions.cs','native-interview/manifest.json','native-common/PartnershipAllocation.cs','native-common/BusinessDataTable.cs','native-common/CryptoSchedule.cs','native-common/EnhancedCca2024.cs','native-common/PreapportionedHomeOffice.cs','native-common/SignedInventory.cs','native-filing/Program.cs','native-filing/PartnershipGross.cs','native-filing/NativeFiling.csproj','native-filing/offline-engines/manifest.json'].map(p=>join(this.root,p));
    if(!existsSync(this.dll)||sources.some(p=>statSync(p).mtimeMs>statSync(this.dll).mtimeMs))
      await run('dotnet',['build','native-filing/NativeFiling.csproj','--nologo'],{cwd:this.root,env:this.env,timeout:120000});
    return {available:true,liveReady:false,networkEnabled:false,blockers:['Live CRA transmission has not been verified end to end.','Offline payloads use an IP placeholder; current CRA terms and filing authorization are not loaded.']};
  }
  invoke(command,input) {
    const operation=this.queue.then(async()=>JSON.parse(await run('dotnet',[this.dll,command],{cwd:this.root,env:this.env,input:JSON.stringify(input)})));
    this.queue=operation.catch(()=>{});return operation;
  }
  prepare({year,mode='netfile',fields={},spouseFields=null,baselinePayloadXml=null}) {return this.invoke('prepare',{year,mode,fields:partnershipEngineFields(fields,year),spouseFields:partnershipEngineFields(spouseFields,year),baselinePayloadXml}).then(result=>({...result,partnershipSlips:[...partnershipSlipReport(fields),...partnershipSlipReport(spouseFields??{},'spouse')]}));}
  parseResponse(xml,{year=2021}={}) {return this.invoke('parse-response',{year,xml});}
  validateRequest(xml,{year=2021}={}) {return this.invoke('validate',{year,xml});}
}

// Metadata-only and pure XML transformations. These methods never open sockets.
NativeFiling.prototype.termsRequest=function({year,mode='netfile'}){return this.invoke('terms-request',{year,mode});};
NativeFiling.prototype.finalizeLive=function({year,xml,originatingIP}){return this.invoke('finalize-live',{year,xml,originatingIP});};
NativeFiling.prototype.inspectBaseline=function(xml,{year=2021}={}){return this.validateRequest(xml,{year});};
