import {randomUUID} from 'node:crypto';
import {mkdir,writeFile,readFile,rm,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {ApiError} from './model.mjs';
import {buildPdfReport} from './pdf-report.mjs';

// PDF rendering reuses the installed desktop's sandboxed Chromium engine.
// The local API remains usable without it; PDF requests then explain what to open.
export function desktopPdfRenderer(channel=process){
 if(typeof channel.send!=='function')return null;
 const pending=new Map();
 channel.on('message',message=>{
  if(message?.type!=='pdf-rendered')return;
  const task=pending.get(message.requestId);if(!task)return;
  pending.delete(message.requestId);clearTimeout(task.timer);
  message.ok?task.resolve():task.reject(new ApiError(503,message.error||'The desktop could not render the PDF.'));
 });
 channel.once('disconnect',()=>{for(const task of pending.values()){clearTimeout(task.timer);task.reject(new ApiError(503,'The desktop PDF renderer closed. Reopen Tax Workbench.'));}pending.clear();});
 return job=>new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{pending.delete(job.requestId);reject(new ApiError(504,'PDF rendering timed out. No return was submitted.'));},120000);
  pending.set(job.requestId,{resolve,reject,timer});
  const failed=()=>{clearTimeout(timer);pending.delete(job.requestId);reject(new ApiError(503,'The desktop PDF renderer is unavailable. Reopen Tax Workbench.'));};
  try{channel.send({type:'render-pdf',...job},error=>{if(error)failed();});}catch{failed();}
 });
}

export class PdfExporter{
 constructor({store,dataDir,renderer=desktopPdfRenderer(),buildReport=buildPdfReport}){this.store=store;this.dataDir=dataDir;this.renderer=renderer;this.buildReport=buildReport;this.queue=Promise.resolve();}
 async report(id,{expectedRevision,calculationId}={}){
  const item=this.store.get(id);
  if(!item.calculation||item.calculation.inputRevision!==item.revision)throw new ApiError(409,'Calculate the saved return before exporting its PDF.');
  if(expectedRevision!==undefined&&Number(expectedRevision)!==item.revision||calculationId!==undefined&&calculationId!==item.calculation.id)throw new ApiError(409,'The return changed. Refresh before exporting its PDF.');
  const report=await this.buildReport(item);
  return {item,report};
 }
 assertCurrent(item){const current=this.store.get(item.id);if(current.revision!==item.revision||current.calculation?.id!==item.calculation.id||current.updatedAt!==item.updatedAt||current.state!==item.state||JSON.stringify([current.issues,current.advisories,current.filing])!==JSON.stringify([item.issues,item.advisories,item.filing]))throw new ApiError(409,'The return changed during PDF export. Refresh and export the current saved calculation.');}
 export(id,options={}){
  const task=this.queue.then(async()=>{
   if(!this.renderer)throw new ApiError(503,'Open the Tax Workbench desktop app to export a PDF. The complete HTML review pack is available through /print-report.');
   const {item,report}=await this.report(id,options),requestId=randomUUID(),directory=join(this.dataDir,'pdf-jobs',requestId),inputPath=join(directory,'report.html'),outputPath=join(directory,'report.pdf');
   try{
    await mkdir(directory,{recursive:true,mode:0o700});
    await writeFile(inputPath,report.html,{mode:0o600,flag:'wx'});
    await this.renderer({requestId,inputPath,outputPath});
    const info=await stat(outputPath);if(info.size>100*1024*1024)throw new ApiError(502,'The PDF exceeded the export size limit.');
    const bytes=await readFile(outputPath);if(bytes.length<8||bytes.subarray(0,5).toString()!=='%PDF-')throw new ApiError(502,'The PDF renderer did not return a valid document.');
    this.assertCurrent(item);
    const name=(item.personName||'Taxpayer').normalize('NFKC').replace(/[^\p{L}\p{N} _.-]/gu,'').replace(/\s+/g,' ').trim().slice(0,100)||'Taxpayer';
    return {bytes,filename:`${name} - ${item.year} - review.pdf`,...report,html:undefined};
   }finally{await rm(directory,{recursive:true,force:true});}
  });this.queue=task.catch(()=>{});return task;
 }
}
