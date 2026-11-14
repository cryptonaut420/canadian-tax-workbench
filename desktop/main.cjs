const { app, BrowserWindow, Menu, dialog } = require('electron');
const { spawn } = require('node:child_process');
const { readFileSync, mkdirSync, chmodSync } = require('node:fs');
const {renderPdfJob}=require('./pdf-renderer.cjs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const dataDir = path.resolve(process.env.TAX_WORKBENCH_DATA_DIR || (app.isPackaged ? path.join(app.getPath('userData'), 'workspace') : path.join(root, '.data')));
mkdirSync(dataDir, { recursive: true, mode: 0o700 });
app.setName('Tax Workbench Canada');
if (!app.isPackaged) app.setPath('userData', path.join(dataDir, 'electron-profile'));
let worker, window, quitting = false;

function startAPI() {
  return new Promise((resolve, reject) => {
    worker = spawn(process.env.TAX_WORKBENCH_NODE || 'node', [path.join(root, 'server/index.mjs')], {
      cwd: root, env: { ...process.env, PORT: '0', TAX_WORKBENCH_DATA_DIR: dataDir }, stdio: ['ignore', 'pipe', 'pipe', 'ipc']
    });
    let pdfQueue=Promise.resolve();
    worker.on('message',job=>{if(job?.type!=='render-pdf')return;const task=pdfQueue.then(()=>renderPdfJob(job,dataDir));pdfQueue=task.catch(()=>{});task.then(()=>{if(worker.connected)worker.send({type:'pdf-rendered',requestId:job.requestId,ok:true});},error=>{console.error('PDF rendering failed:',error.message);if(worker.connected)worker.send({type:'pdf-rendered',requestId:job.requestId,ok:false,error:'The PDF could not be rendered. Recalculate or reopen the desktop and try again.'});});});
    let stdout = '', stderr = '', ready = false;
    const deadline = setTimeout(() => { worker.kill('SIGTERM'); reject(new Error('The local API did not start within two minutes.')); }, 120000);
    worker.stdout.on('data', chunk => {
      stdout += chunk;
      const lines = stdout.split('\n'); stdout = lines.pop();
      for (const line of lines) {
        try { const event = JSON.parse(line); if (event.event === 'ready' && !ready) {
          ready = true; clearTimeout(deadline);
          const connection = JSON.parse(readFileSync(path.join(dataDir, 'connection.json'), 'utf8'));
          resolve(connection);
        } } catch {}
      }
    });
    worker.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-8000); });
    worker.on('error', error => { clearTimeout(deadline); reject(error); });
    worker.on('exit', code => {
      clearTimeout(deadline);
      if (!ready) reject(new Error(stderr || `The local API exited (${code}).`));
      else if (!quitting) { dialog.showErrorBox('The local workspace stopped', stderr || `API exit ${code}. Reopen Tax Workbench Canada to restart it.`); app.quit(); }
    });
  });
}

app.whenReady().then(async () => {
  try {
    const connection = await startAPI();
    window = new BrowserWindow({ title: 'Tax Workbench Canada', width: 1360, height: 940, minWidth: 820, minHeight: 620,
      backgroundColor: '#eef2f6', webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true } });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-prevent-unload', event => {
      const choice = dialog.showMessageBoxSync(window, { type: 'question', title: 'Unsaved input changes', message: 'Discard the unsaved input changes?', buttons: ['Keep editing', 'Discard changes'], defaultId: 0, cancelId: 0 });
      if (choice === 1) event.preventDefault();
    });
    window.webContents.on('will-navigate', (event, url) => { if (new URL(url).origin !== connection.baseURL) event.preventDefault(); });
    const session = window.webContents.session;
    session.on('will-download',(_event,item)=>{if(item.getMimeType()!=='application/pdf')return;item.setSaveDialogOptions({title:'Save tax return review PDF',defaultPath:path.join(app.getPath('downloads'),item.getFilename()),filters:[{name:'PDF document',extensions:['pdf']}]});item.once('done',(_event,state)=>{if(state==='completed'){try{chmodSync(item.getSavePath(),0o600);}catch{}}});});
    session.setPermissionRequestHandler((_webContents, permission, callback) => callback(permission === 'clipboard-sanitized-write'));
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { label: 'File', submenu: [{ label: 'Print calculation view', click: () => window.webContents.print() }, { type: 'separator' }, { role: 'quit' }] },
      { role: 'editMenu' },
      { label: 'View', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }] }
    ]));
    await window.loadURL(`${connection.baseURL}/#token=${encodeURIComponent(connection.token)}`);
  } catch (error) { dialog.showErrorBox('Tax Workbench Canada could not start', error.message); app.quit(); }
});
app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => { quitting = true; if (worker && !worker.killed) worker.kill('SIGTERM'); });
