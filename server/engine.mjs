import {partnershipEngineFields,partnershipSlipReport} from './partnership-slips.mjs';
import { spawn } from 'node:child_process';
import { existsSync, statSync, mkdirSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { resolve, join } from 'node:path';
import { ApiError } from './model.mjs';

function run(command, args, { input = '', cwd, env = {}, timeout = 45000, maxBytes = 16 * 1024 * 1024 } = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd, env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '', bytes = 0, settled = false;
    const finish = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : resolvePromise(value); };
    const timer = setTimeout(() => { child.kill('SIGTERM'); finish(new ApiError(504, 'The native calculation timed out.')); }, timeout);
    child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
    for (const [stream, isError] of [[child.stdout, false], [child.stderr, true]]) stream.on('data', chunk => {
      bytes += Buffer.byteLength(chunk,'utf8');
      if (bytes > maxBytes) { child.kill('SIGTERM'); finish(new ApiError(502, 'The engine response exceeded its output limit.')); return; }
      if (isError) err += chunk; else out += chunk;
    });
    child.on('error', error => finish(new ApiError(503, `Cannot start the native engine: ${error.message}`)));
    child.on('close', code => finish(code === 0 ? null : new ApiError(502, `Native engine failed: ${err.trim() || out.trim() || `exit ${code}`}`), out));
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

export class NativeEngine {
  constructor(root, dataDir) {
    this.root = root;
    this.dll = join(root, 'native-engine/bin/Debug/net10.0/NativeTax.dll');
    this.env = { DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_SKIP_FIRST_TIME_EXPERIENCE: '1', DOTNET_CLI_HOME: join(dataDir, 'dotnet-home') };
    mkdirSync(this.env.DOTNET_CLI_HOME, { recursive: true, mode: 0o700 });
    this.queue = Promise.resolve();
  }
  async initialize() {
    const sources = ['native-common/InterviewConditions.cs','native-interview/manifest.json','native-common/PartnershipAllocation.cs','native-common/BusinessDataTable.cs','native-common/CryptoSchedule.cs','native-common/EnhancedCca2024.cs','native-common/PreapportionedHomeOffice.cs','native-common/SignedInventory.cs','native-engine/Program.cs', 'native-engine/NativeTax.csproj', 'native-engine/legacy-lines.json', 'engines/manifest.json'].map(p => join(this.root, p));
    if (!existsSync(this.dll) || sources.some(p => statSync(p).mtimeMs > statSync(this.dll).mtimeMs)) {
      await run('dotnet', ['build', 'native-engine/NativeTax.csproj', '--nologo'], { cwd: this.root, env: this.env, timeout: 120000 });
    }
    this.health = JSON.parse(await run('dotnet', [this.dll, 'doctor'], { cwd: this.root, env: this.env }));
    return this.health;
  }
  calculate(request) {
    const operation = this.queue.then(async () => {const result=JSON.parse(await run('dotnet', [this.dll, 'calculate'], { input: JSON.stringify({...request,fields:partnershipEngineFields(request.fields,request.year),spouseFields:partnershipEngineFields(request.spouseFields,request.year)}), cwd: this.root, env: this.env }));return {...result,partnershipSlips:[...partnershipSlipReport(request.fields),...partnershipSlipReport(request.spouseFields??{},'spouse')]};});
    this.queue = operation.catch(() => {});
    return operation;
  }
  carryForward(request) {
    const operation=this.queue.then(async()=>{
      const result=JSON.parse(await run('dotnet',[this.dll,'carry-forward'],{input:JSON.stringify({...request,fields:partnershipEngineFields(request.fields,request.year),spouseFields:partnershipEngineFields(request.spouseFields,request.year)}),cwd:this.root,env:this.env}));
      const hints=new Map(),fallback=new Map(),stringKinds=new Set(['T','R','O','S','A','N','M']);
      const remember=(map,code)=>{const [group,field,kind]=code.split(':');if(!stringKinds.has(kind))return;const id=group+':'+field;if(!map.has(id))map.set(id,new Set());map.get(id).add(kind);};
      const definitions=JSON.parse(gunzipSync(readFileSync(join(this.root,'native-interview',`${result.targetYear}.json.gz`))));
      for(const section of definitions.sections)for(const topic of section.topics)for(const field of topic.fields)remember(hints,field.code);
      for(const code of JSON.parse(readFileSync(join(this.root,'research',String(result.targetYear),'field-codes.json'),'utf8')))remember(fallback,code);
      const aliases=[];
      const normalize=fields=>fields==null?null:Object.fromEntries(Object.entries(fields).map(([code,value])=>{
        const parts=code.split(':');if(parts[2]!=='T')return [code,value];
        const choices=hints.get(parts[0]+':'+parts[1]) || fallback.get(parts[0]+':'+parts[1]);
        if(choices?.size===1){parts[2]=[...choices][0];const normalized=parts.join(':');if(normalized!==code)aliases.push({from:code,to:normalized});return [normalized,value];}
        return [code,value];
      }));
      return {...result,fields:normalize(result.fields),spouseFields:normalize(result.spouseFields),normalizedStringAliases:aliases};
    });
    this.queue=operation.catch(()=>{});return operation;
  }
  cleanInputs(request) {
    const operation=this.queue.then(async()=>{
      const effective={...request,fields:partnershipEngineFields(request.fields,request.year),spouseFields:partnershipEngineFields(request.spouseFields,request.year)};
      const result=JSON.parse(await run('dotnet',[this.dll,'clean-inputs'],{input:JSON.stringify(effective),cwd:this.root,env:this.env}));
      for(const [scope,original,active] of [['primary',request.fields,effective.fields],['spouse',request.spouseFields,effective.spouseFields]])if(result[scope]&&original)result[scope].fields={...Object.fromEntries(Object.entries(original).filter(([k])=>!Object.hasOwn(active,k))),...result[scope].fields};
      return result;
    });
    this.queue=operation.catch(()=>{});return operation;
  }
}
