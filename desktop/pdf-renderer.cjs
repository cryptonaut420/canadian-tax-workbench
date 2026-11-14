const {BrowserWindow,session}=require('electron');
const {writeFileSync,realpathSync}=require('node:fs');
const {pathToFileURL}=require('node:url');
const path=require('node:path');

// A private, temporary document rendered by the same engine as the app preview.
// No page script, Node integration, external requests or taxpayer submission.
async function renderPdfJob(job,dataDir){
 if(!/^[a-f0-9-]{36}$/.test(job.requestId||''))throw Error('Invalid PDF job.');
 const directory=path.join(dataDir,'pdf-jobs',job.requestId),inputPath=path.join(directory,'report.html'),outputPath=path.join(directory,'report.pdf');
 if(path.resolve(job.inputPath)!==inputPath||path.resolve(job.outputPath)!==outputPath||realpathSync(inputPath)!==inputPath)throw Error('Invalid PDF job paths.');
 const inputURL=pathToFileURL(inputPath).href;
 const isolated=session.fromPartition('tax-pdf-renderer',{cache:false});
 isolated.setPermissionRequestHandler((_webContents,_permission,callback)=>callback(false));
 isolated.webRequest.onBeforeRequest((details,callback)=>callback({cancel:details.url!==inputURL&&!details.url.startsWith('data:')}));
 const win=new BrowserWindow({show:false,width:1100,height:1400,webPreferences:{session:isolated,contextIsolation:true,sandbox:true,nodeIntegration:false,webSecurity:true,backgroundThrottling:false}});
 win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
 win.webContents.on('will-navigate',(event,url)=>{if(url!==inputURL)event.preventDefault();});
 let timeout;
 try{
  const render=async()=>{
   await win.loadURL(inputURL);
   await win.webContents.executeJavaScript(`(async()=>{await document.fonts.ready;await Promise.all(Array.from(document.images,image=>image.decode()));return true})()`);
   const pdf=await win.webContents.printToPDF({printBackground:true,preferCSSPageSize:true,pageSize:'Letter',margins:{top:0,bottom:0,left:0,right:0},generateTaggedPDF:true,generateDocumentOutline:true});
   writeFileSync(outputPath,pdf,{mode:0o600,flag:'wx'});
  };
  await Promise.race([render(),new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error('PDF rendering timed out.')),105000);})]);
 }finally{clearTimeout(timeout);if(!win.isDestroyed())win.destroy();isolated.webRequest.onBeforeRequest(null);}
}
module.exports={renderPdfJob};
