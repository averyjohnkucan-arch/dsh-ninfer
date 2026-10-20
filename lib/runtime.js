import { checkMemory } from './gpu-guard.js';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, rename, readdir, stat, access } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve, dirname, isAbsolute } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { freshProfile, validateProfile, strataArgs, ninferArgs, ninferSeed, effective, normalizeProfile } from './profiles.js';
import { run, ready, terminate, gpuInfo } from './process.js';
const packageRoot=dirname(dirname(fileURLToPath(import.meta.url)));
export class Runtime {
 constructor(engine,config,onChange=()=>{}) {
  this.engine=engine;this.config=config;this.onChange=onChange;
  this.root=resolve(config.dataDir || join(process.env.DSH_HOME || join(homedir(),'.dsh'),'dsh-'+engine));
  this.profiles=[];this.running=new Map();this.starting=new Map();this.memoryBudgets={};this.jobs=new Map();this.writeQueue=Promise.resolve();this.cancelled=false;
 }
 async init(){await mkdir(this.root,{recursive:true,mode:0o700});try{this.memoryBudgets=JSON.parse(await readFile(join(this.root,'memory-budgets.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}try{const d=JSON.parse(await readFile(join(this.root,'profiles.json'),'utf8'));this.profiles=d.profiles.map(validateProfile);}catch(e){if(e.code!=='ENOENT')throw e;this.profiles=this.engine==='ninfer'?[ninferSeed()]:[];await this.persist();}}
 persist(){const snapshot=JSON.stringify({version:1,profiles:this.profiles},null,2)+'\n';this.writeQueue=this.writeQueue.catch(()=>{}).then(async()=>{const tmp=join(this.root,`profiles.${randomUUID()}.tmp`);await writeFile(tmp,snapshot,{mode:0o600});await rename(tmp,join(this.root,'profiles.json'));});return this.writeQueue;}
 find(id){const p=this.profiles.find(x=>x.id===id);if(!p)throw new Error('Model profile not found.');return p;}
 async save(profile){const p=normalizeProfile(profile,this.engine);if(this.running.get(p.id)?.active)throw new Error('Stop the active answer before editing this model.');if(this.jobsFor(p.id))throw new Error('Wait for the running operation or cancel it before saving.');if(this.running.has(p.id))await this.stop(p.id);const others=this.profiles.filter(x=>x.id!==p.id);if(others.some(x=>x.port===p.port))throw new Error('Another saved model uses this port. Choose a different port.');this.profiles=[...others,p];await this.persist();this.onChange();return p;}
 jobsFor(id){return [...this.jobs.values()].some(j=>j.profileId===id&&j.status==='running');}
 async list(){return {engine:this.engine,profiles:this.profiles.map(p=>({...p,status:this.running.get(p.id)?.ready?'running':'stopped',external:!!this.running.get(p.id)?.external,activeRequests:this.running.get(p.id)?.active||0,log:this.running.get(p.id)?.log.slice(-6000)||''})),jobs:[...this.jobs.values()].map(({controller,promise,...j})=>j),options:JSON.parse(await readFile(join(packageRoot,'lib/options.json'),'utf8')),dataDir:this.root};}
 async browse(path=homedir()){if(!isAbsolute(path))throw new Error('Use an absolute host path.');const entries=await readdir(path,{withFileTypes:true});const rows=[];for(const e of entries.slice(0,1500)){const p=join(path,e.name);let directory=e.isDirectory();if(e.isSymbolicLink()){try{directory=(await stat(p)).isDirectory();}catch(err){if(err.code==='ENOENT')continue;throw err;}}if(directory||/\.(gguf|ninfer|json)$/i.test(e.name))rows.push({name:e.name,path:p,directory});}return{path,parent:dirname(path),truncated:entries.length>1500,entries:rows.sort((a,b)=>Number(b.directory)-Number(a.directory)||a.name.localeCompare(b.name))};}
 job(kind,profileId,operation){if(this.jobsFor(profileId))throw new Error('This model already has an operation running.');const id=randomUUID(),controller=new AbortController();const j={id,kind,profileId,status:'running',progress:'Starting…',log:'',controller};this.jobs.set(id,j);const report=message=>{j.progress=String(message);j.log=(j.log+message+'\n').slice(-100000);};j.promise=operation(controller.signal,report).then(result=>{j.status='complete';j.result=result;j.progress='Complete';}).catch(e=>{j.status=controller.signal.aborted?'cancelled':'failed';j.error=e.message;j.progress=e.message;}).finally(()=>{delete j.promise;this.onChange();});return{id};}
 async source(p){const source=p.sourceDir||join(this.root,'engine','source');await access(join(source,this.engine==='strata'?'serve/server.py':'CMakeLists.txt'));return source;}
 driver(profile,{priority='interactive',reuseExisting=true}={}){const p=structuredClone(profile);return {key:this.engine+':'+p.id,name:p.name,gpu:p.gpu,priority,fingerprint:JSON.stringify(p),load:signal=>this.startLocal(p.id,{profile:p,signal,reuseExisting}),unload:()=>{if(this.running.get(p.id)?.external)throw new Error('Externally managed server still owns the GPU. Stop it in its owner application before switching.');return this.stopLocal(p.id);},busy:()=>this.jobsFor(p.id)};}
 async acquire(profile,signal,options={}){if(this.scheduler)return this.scheduler.acquire(this.driver(profile,options),signal);return {state:await this.startLocal(profile.id,{...options,profile,signal}),signal,release:()=>{}};}
 async start(id,options={}){if(!this.scheduler)return this.startLocal(id,options);const lease=await this.acquire(options.profile||this.find(id),options.signal,options);try{return lease.state;}finally{lease.release();}}
 async startLocal(id,options={}){
  const p=structuredClone(options.profile||this.find(id)),fingerprint=JSON.stringify(p);
  const pending=this.starting.get(id);
  if(pending){if(pending.fingerprint!==fingerprint)throw new Error('This model is already loading with another configuration.');return pending.promise;}
  if(this.running.has(id))return this.startManaged(id,{...options,profile:p});
  const promise=this.startManaged(id,{...options,profile:p});
  this.starting.set(id,{fingerprint,promise});
  try{return await promise;}finally{if(this.starting.get(id)?.promise===promise)this.starting.delete(id);}
 }
 async startManaged(id,{profile,signal,reuseExisting=true}={}){
  if(this.cancelled)throw new Error('Plugin is disabled.');
  const p=structuredClone(profile||this.find(id));
  let old=this.running.get(id);if(old?.external){try{const response=await fetch(old.url+'/v1/models',{headers:this.serverHeaders(p),signal:AbortSignal.timeout(1500)});if(!response.ok)throw new Error('not ready');const listing=await response.json();if(!listing.data?.some(m=>m.id===(p.modelId||p.options?.['--model-id']||p.id)))throw new Error('model changed');}catch{this.running.delete(id);old=undefined;}}if(old){if(old.fingerprint!==JSON.stringify(p))throw new Error('Stop the current engine before changing its configuration.');await old.promise;return old;}
  if(!p.modelPath)throw new Error('Choose a model file first.');await access(p.modelPath);
  const host=p.options?.['--host']||p.serverOptions?.['--host']||'127.0.0.1';if(!['127.0.0.1','::1','localhost'].includes(host))throw new Error('Managed engines must bind to loopback.');
  for(const [otherId,state]of this.running){if(otherId!==id&&state.profile.gpu===p.gpu){if(state.active>0)throw new Error('Another model is answering a request; wait before switching.');if(state.external)throw new Error('Detach and stop the externally managed model before loading another model on this GPU.');await this.stopLocal(otherId);}}
  const url=`http://127.0.0.1:${p.port}`;
  let response;
  try{response=await fetch(url+'/v1/models',{headers:this.serverHeaders(p),signal:AbortSignal.timeout(2000)});}catch(e){if(e.name!=='TypeError'&&e.name!=='TimeoutError')throw e;if(e.name==='TimeoutError')throw new Error(`Port ${p.port} did not respond in time. Check the existing server before retrying.`);}
  if(response){
   if(reuseExisting&&response.ok){let listing;try{listing=await response.json();}catch{}if(listing?.data?.some(m=>m.id===(p.modelId||p.options?.['--model-id']||p.id)))return this.attachState(p,url);}
   throw new Error(`Port ${p.port} is occupied by a server that cannot be reused for this profile. Select its matching model or choose another port. The existing server was left running.`);
  }
  const memoryKey=createHash('sha256').update(JSON.stringify(p)).digest('hex');
  const beforeMemory=await gpuInfo(p.gpu);
  const weightMiB=this.engine==='ninfer'?(await stat(p.modelPath)).size/1048576:0;
  checkMemory(beforeMemory,Math.max(weightMiB,Number(this.memoryBudgets[memoryKey])||0));
  let command,args,cwd,env={...process.env,...p.environment};
  if(this.engine==='ninfer'){
   command=p.executable||join(this.root,'engine','bin','ninfer-serve');args=ninferArgs(p);cwd=dirname(command);
   if(p.powerProfile){args=['launch','--profile',p.powerProfile,'--reason','DSH NInfer inference','--appid','dsh-ninfer',command,...args];command='powerprofilesctl';}
  }else{
   cwd=await this.source(p);command=p.python||join(this.root,'engine','venv','bin','python');
   const exe=p.executable||join(cwd,'build','strata');await access(exe);
   if(!p.packPath)throw new Error('Import the GGUF model or choose an existing prepared pack first.');
   const cfg={...p.serverConfig,exe,cwd,args:strataArgs(p),tokenizer:p.tokenizerPath||join(p.packPath,'tokenizer'),model_name:p.modelId||p.id,port:p.port,host:'127.0.0.1',gpu:p.gpu,open_browser:false};
   const vision=effective(p,'visionDevice','auto');
   if(p.projectorPath && vision!=='off'){
    let device=vision;
    if(device==='auto'){try{device=(await gpuInfo(p.gpu)).totalMiB<=12*1024?'igpu':'gpu';}catch{device='cpu';}}
    let vexe=p.visionExecutable;
    if(device==='igpu'){if(p.visionIgpuExecutable&&p.visionGpuIndex!==''){vexe=p.visionIgpuExecutable;}else{device='cpu';vexe=p.visionCpuExecutable||vexe;}}
    if(device==='cpu')vexe=p.visionCpuExecutable||vexe;
    if(!vexe)throw new Error('Choose a compatible vision encoder binary, or turn vision off.');
    cfg.vision={...p.serverConfig.vision,exe:vexe,model:p.modelPath,mmproj:p.projectorPath,gpu:device!=='cpu',...(p.visionCpuExecutable?{cpu_exe:p.visionCpuExecutable}:{})};
    if(device==='igpu'){
     if(!p.visionGpuIndex)throw new Error('Choose the Vulkan iGPU device index for this vision binary, or select CPU fallback.');
     cfg.vision.env={...(cfg.vision.env||{}),GGML_VK_VISIBLE_DEVICES:String(p.visionGpuIndex)};
     // Vision's own device selection is separate from the CUDA text engine.
     const wrapper=join(this.root,`vision-vulkan-${p.id}.sh`);
     if(process.platform==='win32')throw new Error('Vulkan vision device wrapper currently requires Linux.');
     const quote=x=>"'"+String(x).replaceAll("'","'\"'\"'")+"'";
     await writeFile(wrapper,'#!/bin/sh\nexport GGML_VK_VISIBLE_DEVICES='+quote(p.visionGpuIndex)+'\nexec '+quote(vexe)+' \"$@\"\n',{mode:0o700});
     cfg.vision.exe=wrapper;
    }
   }else delete cfg.vision;
   const cfgPath=join(this.root,`run-${p.id}.json`);await writeFile(cfgPath,JSON.stringify(cfg,null,2),{mode:0o600});
   args=['-B','-m','serve.server','--engine','strata','--config',cfgPath,'--host','127.0.0.1','--port',String(p.port),...Object.entries(p.serverOptions||{}).flatMap(([key,v])=>v===false||v==null||v===''?[]:v===true?[key]:[key,String(v)])];
  }
  const state={profile:p,url,fingerprint:JSON.stringify(p),log:'',ready:false,child:spawn(command,args,{cwd,env,detached:process.platform!=='win32',stdio:['ignore','pipe','pipe']})};
  this.running.set(id,state);
  const append=b=>{state.log=(state.log+String(b)).slice(-150000);};state.child.stdout.on('data',append);state.child.stderr.on('data',append);state.child.on('error',e=>append(e.message));
  state.child.on('close',()=>{state.ready=false;if(this.running.get(id)===state)this.running.delete(id);this.onChange();});
  state.promise=ready(url,state.child,{signal,timeout:p.tunePolicy?.timeoutMs||900000,log:()=>state.log}).then(async()=>{
   const afterMemory=await gpuInfo(p.gpu);
   const used=Math.max(0,beforeMemory.freeMiB-afterMemory.freeMiB);
   this.memoryBudgets[memoryKey]=Math.max(Number(this.memoryBudgets[memoryKey])||0,used);
   const tmp=join(this.root,`memory-budgets.${randomUUID()}.tmp`);
   await writeFile(tmp,JSON.stringify(this.memoryBudgets),{mode:0o600});await rename(tmp,join(this.root,'memory-budgets.json'));
   state.ready=true;this.onChange();return state;
  }).catch(async e=>{await this.stopLocal(id);throw e;});
  return state.promise;
 }
 serverHeaders(p){const key=p.options?.['--api-key']||p.serverConfig?.api_key;return key?{Authorization:'Bearer '+key}:{};}
 attachState(p,url){const existing=this.running.get(p.id);if(existing)return existing;const state={profile:structuredClone(p),url,fingerprint:JSON.stringify(p),ready:true,external:true,log:'Using a matching existing server. Saved launch settings were not reapplied; Stop only detaches. Stop the external server first to apply different launch settings.'};state.promise=Promise.resolve(state);this.running.set(p.id,state);this.onChange();return state;}
 async stop(id){if(this.running.get(id)?.external)return this.stopLocal(id);if(this.scheduler)await this.scheduler.unload(this.engine+':'+id,{force:true});return this.stopLocal(id);}
 async stopLocal(id){const state=this.running.get(id);if(state){await terminate(state.child);if(this.running.get(id)===state)this.running.delete(id);}return{stopped:true};}
 async import(id,signal,report){const p=structuredClone(this.find(id));if(this.engine==='ninfer'){await access(p.modelPath);return{modelPath:p.modelPath};}const source=await this.source(p);const result=await run(p.python||'python3',['-B',join(packageRoot,'scripts/import-model.py'),'--source',source,'--model',p.modelPath,'--output',join(this.root,'packs',id),...(p.mtpPath?['--mtp',p.mtpPath]:[])],{env:p.environment,signal,timeout:7200000,onData:report});const resultLine=result.stdout.trim().split('\n').findLast(x=>x.startsWith('DSH_RESULT='));if(!resultLine)throw new Error('Import finished without its completion receipt.');const receipt=JSON.parse(resultLine.slice(11));this.profiles=this.profiles.map(x=>x.id===id?{...x,...receipt,options:{...receipt.options,...x.options}}:x);await this.persist();return receipt;}
 async setup(id,signal,report){const p=this.find(id);const r=await run(process.execPath,[join(packageRoot,'scripts/setup-engine.js'),'--root',join(this.root,'engine')],{signal,timeout:7200000,onData:report});const receipt=JSON.parse(r.stdout.trim().split('\n').findLast(x=>x.startsWith('DSH_RESULT=')).slice(11));this.profiles=this.profiles.map(x=>x.id===id?{...x,...receipt}:x);await this.persist();return receipt;}
 async action(action,payload={}){
  switch(action){
   case 'importConfig':{if(this.engine!=='strata')throw new Error('Strata configuration only.');const {importConfig}=await import('./import-config.js');return this.save(await importConfig(payload.path));}
   case 'assign':{const {spawnSync}=await import('node:child_process');const result=spawnSync('python3',[join(packageRoot,'scripts/inspect-files.py')],{input:JSON.stringify(payload.paths),encoding:'utf8',timeout:60000,maxBuffer:8*1024*1024});if(result.error)throw result.error;if(result.status!==0)throw new Error(result.stderr.trim());return JSON.parse(result.stdout);}
   case 'attach':{const p=this.find(payload.id);const url=`http://127.0.0.1:${p.port}`;const response=await fetch(url+'/v1/models',{headers:this.serverHeaders(p),signal:AbortSignal.timeout(5000)});if(!response.ok)throw new Error('Server model listing failed.');const list=await response.json();if(!list.data?.some(m=>m.id===(p.modelId||p.options?.['--model-id']||p.id)))throw new Error('Existing server does not advertise this profile model ID.');this.attachState(p,url);return{attached:true,url};}
   case 'list':return this.list();case 'new':{const p=freshProfile(this.engine);const prior=this.profiles.find(x=>x.executable);if(prior)for(const key of ['executable','sourceDir','python','visionExecutable','visionIgpuExecutable','visionCpuExecutable','visionGpuIndex'])p[key]=prior[key]||p[key];if(prior?.environment?.LD_LIBRARY_PATH)p.environment.LD_LIBRARY_PATH=prior.environment.LD_LIBRARY_PATH;const ports=new Set(this.profiles.map(x=>x.port));while(ports.has(p.port))p.port++;return p;}case 'browse':return this.browse(payload.path);
   case 'save':return this.save(payload.profile);
   case 'remove':if(this.jobsFor(payload.id))throw new Error('Cancel the operation first.');await this.stop(payload.id);this.profiles=this.profiles.filter(x=>x.id!==payload.id);await this.persist();this.onChange();return{removed:true};
   case 'prepareStart':return this.job('prepare-start',payload.id,async(signal,report)=>{let p=this.find(payload.id);let readyBinary=true;try{await access(p.executable||join(this.root,'engine','bin','ninfer-serve'));if(this.engine==='strata')await this.source(p);}catch(e){if(e.code!=='ENOENT')throw e;readyBinary=false;}if(!readyBinary){report('Installing engine runtime');await this.setup(payload.id,signal,report);}p=this.find(payload.id);if(this.engine==='strata'&&!p.packPath){report('Preparing model files');await this.import(payload.id,signal,report);}report('Starting inference server');const state=await this.start(payload.id,{signal});return{url:state.url};});
   case 'start':return this.job('start',payload.id,signal=>this.start(payload.id,{signal}).then(s=>({url:s.url})));
   case 'stop':return this.stop(payload.id);
   case 'cancel':{const j=this.jobs.get(payload.id);if(j?.status==='running')j.controller.abort();return{cancelled:true};}
   case 'import':return this.job('import',payload.id,(s,r)=>this.import(payload.id,s,r));
   case 'setup':return this.job('setup',payload.id,(s,r)=>this.setup(payload.id,s,r));
   case 'help':{const p=this.find(payload.id);const binary=p.executable;if(!binary)throw new Error('Set up the engine first.');return run(binary,['--help'],{env:p.environment}).then(x=>({text:x.stdout+x.stderr}));}
   case 'gpu':return gpuInfo(payload.gpu||0);
   case 'calibrate':if(this.engine!=='ninfer')throw new Error('NInfer only.');return this.job('calibrate',payload.id,async(s,r)=>{const p=this.find(payload.id);const output=join(this.root,`calibration-${p.id}.json`);await run(join(dirname(p.executable),'ninfer-calibrate'),['--device',String(p.gpu),'--out',output],{env:p.environment,signal:s,timeout:900000,onData:r});p.environment.NINFER_DEVICE_PROFILES=output;await this.persist();return{path:output};});
   case 'tune':if(this.engine!=='strata')throw new Error('NInfer has no automatic tuning.');return this.job('tune',payload.id,async(s,r)=>{const {tune}=await import('./tuner.js');const p=structuredClone(this.find(payload.id));const result=await tune(p,this,s,r);this.profiles=this.profiles.map(x=>x.id===p.id?{...x,tuned:result.tuned,tuneReport:result}:x);await this.persist();return result;});
   default:throw new Error('Unknown operation.');
  }
 }
 async dispose(){this.cancelled=true;for(const j of this.jobs.values())j.controller.abort();await Promise.all([...this.running.keys()].map(id=>this.stop(id)));await Promise.all([...this.jobs.values()].map(j=>j.promise).filter(Boolean));}
}
