import {spawn} from 'node:child_process';
import {existsSync,statSync,mkdirSync} from 'node:fs';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {ApiError} from './model.mjs';
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
function run(command,args,{input='',cwd,env={},timeout=30000,maxBytes=16*1024*1024}={}){
 return new Promise((resolve,reject)=>{const child=spawn(command,args,{cwd,env:{...process.env,...env},stdio:['pipe','pipe','pipe']});let out='',err='',bytes=0,done=false;
 const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);error?reject(error):resolve(value);};
 const timer=setTimeout(()=>{child.kill();finish(new ApiError(504,'Original PDF417 encoder timed out.'));},timeout);
 for(const [stream,isError] of [[child.stdout,false],[child.stderr,true]])stream.on('data',chunk=>{bytes+=chunk.length;if(bytes>maxBytes){child.kill();finish(new ApiError(502,'PDF417 response exceeds its output limit.'));return;}if(isError)err+=chunk;else out+=chunk;});
 child.on('error',error=>finish(error));child.on('close',code=>finish(code===0?null:new ApiError(422,err.trim() || 'Original PDF417 encoding failed.'),out));child.stdin.on('error',()=>{});child.stdin.end(input);
 });
}
export class NativeBarcode{
 constructor(root=ROOT,dataDir=join(ROOT,'.data')){this.root=root;this.dll=join(root,'native-barcode/bin/Debug/net10.0/NativeBarcode.dll');this.env={DOTNET_CLI_HOME:join(dataDir,'dotnet-home'),DOTNET_CLI_TELEMETRY_OPTOUT:'1',DOTNET_SKIP_FIRST_TIME_EXPERIENCE:'1'};mkdirSync(this.env.DOTNET_CLI_HOME,{recursive:true,mode:0o700});this.queue=Promise.resolve();}
 async initialize(){const sources=['native-barcode/Program.cs','native-barcode/NativeBarcode.csproj','native-barcode/original/pdf417_20.dll'].map(p=>join(this.root,p));if(!existsSync(this.dll)||sources.some(p=>statSync(p).mtimeMs>statSync(this.dll).mtimeMs))await run('dotnet',['build','native-barcode/NativeBarcode.csproj','--nologo'],{cwd:this.root,env:this.env,timeout:120000});return {available:true,sourceEncoder:true,wineRequired:false,pixelParityVerified:false};}
 encode(input){const next=this.queue.then(async()=>JSON.parse(await run('dotnet',[this.dll],{input:JSON.stringify(input),cwd:this.root,env:this.env})));this.queue=next.catch(()=>{});return next;}
 async render({barcodeData,dataType='Ordinary',dataColumns=14,dataRows=50,maxCodes=2,width=1500,height=390,justification='Right',year=2021,dpi=300}={}){
  if(typeof barcodeData!=='string')throw new ApiError(400,'The native calculation barcode payload is required.');
  if(!['Ordinary','SFD'].includes(dataType))throw new ApiError(422,'Unsupported original barcode data type.');
  if(!Number.isFinite(width)||width<=0||width>20000||!Number.isFinite(height)||height<=0||height>20000||!['Left','Center','Right'].includes(justification))throw new ApiError(400,'Invalid barcode rectangle or justification.');
  if(!Number.isSafeInteger(dataColumns)||dataColumns<1||dataColumns>30||!Number.isSafeInteger(dataRows)||dataRows<3||dataRows>90||!Number.isSafeInteger(maxCodes)||maxCodes<1||maxCodes>8)throw new ApiError(400,'Invalid barcode layout bounds.');
  const parts=barcodeData.split('\r');
  const texts=dataType==='Ordinary'?[{text:parts[0],id:[1,1,3,0]}]:[{text:parts[1] || '',id:[1,1,3,1]},{text:parts[2] || '',id:[1,1,3,2]}];
  if(!texts.some(x=>x.text))return {markup:'',segments:[],warnings:['The native calculation did not provide barcode data for this form. Complete the return identity/address and recalculate.'],parityVerified:false};
  if(dataType==='SFD' && !texts[0].text)return {markup:'',segments:[],warnings:['The native calculation provided no SFD header barcode payload.'],parityVerified:false};
  if(!Number.isSafeInteger(dpi)||dpi<100||dpi>600)throw new ApiError(400,'Barcode reference DPI must be an integer from100 to600.');
  let rows=dataRows,threshold=Math.trunc(Math.fround(dataColumns*rows*Math.fround(1.13)));
  // Original renderer expands SFD rows from50 to60 before adding macro codes.
  if(dataType==='SFD' && dataRows===50 && texts.some(x=>x.text.length>threshold)){
   rows=60;for(let candidate=51;candidate<=60;candidate++){const limit=Math.trunc(dataColumns*candidate*1.1299999952316284);if(texts.every(x=>x.text.length<=limit)){rows=candidate;break;}}
   threshold=Math.trunc(dataColumns*rows*1.1299999952316284);
  }
  const segments=[];
  for(const item of texts){if(!item.text)continue;const macro=item.text.length>threshold;const ideal=dpi/100,lower=Math.floor(ideal),barWidth=ideal-lower===0.5?(lower%2===0?lower:lower+1):Math.round(ideal),barHeight=Math.max(1,Math.trunc(rows>50?3*barWidth*50/rows:3*barWidth));const input={text:item.text,columns:dataColumns,rows,ecLevel:4,barWidth,barHeight,macro,macroId:item.id,segment:0};
   const first=await this.encode(input);const count=macro?first.segments:1;if(count<1||count>maxCodes)throw new ApiError(422,'The native barcode exceeds this form’s maximum number of codes.');segments.push({...first,payloadSha256:createHash('sha256').update(Buffer.from(item.text,'latin1')).digest('hex')});
   for(let segment=1;segment<count;segment++)segments.push({...await this.encode({...input,segment}),payloadSha256:segments.at(-1).payloadSha256});
  }
  if(segments.length>maxCodes)throw new ApiError(422,'Combined native barcodes exceed this form’s maximum number of codes.');
  // Original GDI uses one module per0.01inch; original form layouts use200units/in.
  // Retain native module geometry and align within the allotted rectangle.
  const scale=200/dpi,gap=100,occupiedWidth=segments.reduce((n,s)=>n+s.width*scale,0)+gap*(segments.length-1);
  if(occupiedWidth>width || Math.max(...segments.map(s=>s.height*scale))>height)throw new ApiError(422,'Original barcode geometry does not fit this review layout; do not stretch machine-readable modules.');
  // The source renderer centers each code vertically and places subsequent
  // macro/SFD codes to the left, with a0.5inch gap (100 template units).
  let right=justification==='Left'?occupiedWidth:justification==='Center'?(width+occupiedWidth)/2:width;
  const groups=[];
  for(let i=0;i<segments.length;i++){const s=segments[i],w=s.width*scale,h=s.height*scale;right-=w;const x=right,y=(height-h)/2;
   const path=s.bars.filter(b=>b.color===-16777216).map(b=>`M${b.x1},${Math.min(b.y1,b.y2)}h${b.width}v${Math.abs(b.y2-b.y1)}h${-b.width}z`).join('');
   groups.push(`<g data-native-pdf417="${i}" transform="translate(${x} ${y}) scale(${scale})" shape-rendering="crispEdges"><path d="${path}" fill="#000"/></g>`);right-=gap;
  }
  return {markup:groups.join(''),segments:segments.map(({bars,...metadata})=>metadata),warnings:['Barcode encoding uses the original managed algorithm. Native SVG/GDI pixel alignment has not been independently verified; this remains a review copy.'],parityVerified:false,sourceEncoder:true,referenceDpi:dpi};
 }
}
let shared;
export async function renderBarcode(input){if(!shared){const instance=new NativeBarcode();shared=instance.initialize().then(()=>instance).catch(error=>{shared=undefined;throw error;});}return (await shared).render(input);}
