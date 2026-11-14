import { existsSync, chmodSync, readdirSync, mkdirSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const runtimeDir = join(root, '.runtime/electron');
const candidates = [process.env.ELECTRON_BINARY, join(root, 'node_modules/electron/dist/electron'), join(runtimeDir, 'electron')].filter(Boolean);
let executable = candidates.find(existsSync);
if (!executable) {
  const cache = join(homedir(), '.cache/electron');
  const archives = existsSync(cache) ? readdirSync(cache).filter(x => /^electron-v[\d.]+-linux-x64\.zip$/.test(x)).sort((a,b) => b.localeCompare(a, undefined, { numeric: true })) : [];
  if (!archives.length) {
    console.error('Electron runtime not found. Install Electron locally with: npm install --save-dev electron');
    console.error('Or set ELECTRON_BINARY to an existing Electron executable.');
    process.exit(1);
  }
  mkdirSync(runtimeDir, { recursive: true });
  console.log('Preparing the existing cached Electron runtime for local development…');
  const result = spawnSync('python3', ['-c', 'import zipfile,sys; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])', join(cache, archives[0]), runtimeDir], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
  for (const name of ['electron', 'chrome-sandbox', 'chrome_crashpad_handler']) if (existsSync(join(runtimeDir, name))) chmodSync(join(runtimeDir, name), 0o755);
  executable = join(runtimeDir, 'electron');
}
const env = { ...process.env, TAX_WORKBENCH_NODE: process.execPath };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(executable, [root], { cwd: root, env, stdio: 'inherit' });
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', (code, signal) => { if (signal) console.error(`Electron stopped with ${signal}.`); process.exitCode = code ?? 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => child.kill(signal));
