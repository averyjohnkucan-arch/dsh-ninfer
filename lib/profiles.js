import { profileReasoning } from './reasoning.js';
import { randomUUID } from 'node:crypto';
export function freshProfile(engine) {
  return { id: randomUUID(), name: 'New model', modelPath: '', modelFiles: [], projectorPath: '', mtpPath: '', packPath: '', tokenizerPath: '', executable: '', sourceDir: '', python: 'python3', visionExecutable: '', visionDevice: 'auto', visionGpuIndex: '', context: 262144, kvK: 'FP16', kvV: 'FP16', residentMode: 'percent', residentPercent: 80, residentContext: 209715, port: engine === 'strata' ? 8190 : 8191, gpu: 0, options: {}, environment: {}, serverConfig: {}, serverOptions: {}, locks: [], tuned: {}, tunePolicy: { residentPercent: 80, reserveLow: 6, reserveHigh: 10, finalReserveLow: 0.7, finalReserveHigh: 1.5, maxDecodeLoss: 5, repeats: 3, maxTrials: 128, promptTokens: 512, outputTokens: 128, prefillTokens: 4096, timeoutMs: 900000, maxExperts: 24576 }, extraArgs: [], enabled: true };
}
export function validateProfile(p) {
  if (!p || typeof p !== 'object' || !/^[a-zA-Z0-9_-]{1,100}$/.test(p.id)) throw new Error('Invalid profile ID.');
  if (typeof p.name !== 'string' || !p.name.trim()) throw new Error('Give the model a name.');
  for (const key of ['context','port','gpu']) if (!Number.isInteger(p[key]) || p[key] < (key === 'gpu' ? 0 : 1)) throw new Error(`Invalid ${key}.`);
  if (p.port > 65535 || !Array.isArray(p.locks) || !Array.isArray(p.extraArgs) || p.extraArgs.some(x=>typeof x !== 'string')) throw new Error('Invalid profile configuration.');
  if (!p.options || typeof p.options !== 'object' || Array.isArray(p.options)) throw new Error('Options must be an object.');
  const clean=structuredClone(p);for(const key of ['status','external','activeRequests','cacheStatus','log'])delete clean[key];
  return {...clean,reasoning:profileReasoning(p)};
}
export function optionArgs(options) {
  const args=[];
  for (const [flag,value] of Object.entries(options)) {
    if (!/^--[a-z][a-z0-9-]*$/.test(flag)) throw new Error(`Invalid CLI flag: ${flag}`);
    if (value === false || value === null || value === undefined || value === '') continue;
    if (value === true) args.push(flag);
    else if (typeof value==='object'&&!Array.isArray(value)&&Array.isArray(value.argv)) args.push(flag,...value.argv.map(String));
    else if (Array.isArray(value)) for (const item of value) args.push(flag,String(item));
    else args.push(flag,String(value));
  }
  return args;
}
export function effective(p, key, fallback) {
  return p.locks.includes(key) ? p[key] ?? fallback : p.tuned?.[key] ?? p[key] ?? fallback;
}
export function effectiveOptions(p) {
  const options={...p.options};
  for (const [key,value] of Object.entries(p.tuned?.options ?? {})) if (!p.locks.includes('options.'+key)) options[key]=value;
  return options;
}
export function launchFingerprint(p){return JSON.stringify({modelPath:p.modelPath,packPath:p.packPath,mtpPath:p.mtpPath,context:p.context,kvK:p.kvK,kvV:p.kvV,residentMode:p.residentMode,residentContext:p.residentContext,residentPercent:p.residentPercent,options:p.options,extraArgs:p.extraArgs,tuned:p.tuned});}
export function strataArgs(p) {
  if(p.importedEngineArgs&&p.importedFingerprint===launchFingerprint(p))return [...p.importedEngineArgs];
  const context=effective(p,'context',262144);
  const args={ '--pack':p.packPath, '--native':p.modelPath, '--max-context':context, '--kv':`${effective(p,'kvK','FP16')}/${effective(p,'kvV','FP16')}` };
  const resident=effective(p,'residentMode','percent') === 'percent' ? Math.floor(context*effective(p,'residentPercent',80)/100) : effective(p,'residentContext',context);
  args['--kv-resident']=resident >= context ? 0 : Math.max(Math.min(context,20480),resident);
  if (p.mtpPath) args['--mtp']=p.mtpPath;
  Object.assign(args,effectiveOptions(p));
  return [...optionArgs(args),...p.extraArgs];
}
export function ninferArgs(p) {
  const options={ '--host':'127.0.0.1','--port':p.port,'--model-id':p.id,'--max-context':p.context,...effectiveOptions(p) };
  return [p.modelPath,...optionArgs(options),...p.extraArgs];
}
export function ninferSeed() {
 const p=freshProfile('ninfer');
 return {...p,id:'qwen3_8_27b',name:'Qwen3.8 27B · tested 262k',modelPath:'/mnt/ai/models/Qwen3.8-27B/neroued/NInfer/qwen3_8_27b.ninfer',port:8188,executable:'/mnt/ai/Local AI version 2/runtime/ninfer-test/bin/ninfer-serve',environment:{LD_LIBRARY_PATH:'/mnt/ai/Local AI version 2/runtime/compat-root/usr/local/cuda-13.1/targets/x86_64-linux/lib',NINFER_DEVICE_PROFILES:'/mnt/ai/Local AI version 2/runtime/ninfer-test/device-profiles.json'},powerProfile:'performance',options:{'--model-id':'qwen3.8-27b','--kv-capacity':262144,'--max-concurrency':1,'--kv-dtype':'rk4v4','--spec':'dflash2','--draft-tokens':7,'--lm-head-draft':true,'--embedding-q4':true,'--gdn-state-fp16':true,'--prefill-cublas':true,'--prefill-chunk':512,'--ngram-draft-tokens':0},locks:['context',...['--kv-capacity','--max-concurrency','--kv-dtype','--spec','--draft-tokens','--lm-head-draft','--embedding-q4','--gdn-state-fp16','--prefill-cublas','--prefill-chunk','--ngram-draft-tokens'].map(x=>'options.'+x)],provenance:{sourceRevision:'5ed86dff9fe3a5a0776f40a7aea86cf381da990d',modelRevision:'1cbd84e7221e51186bd7f093a149912d2489625b',modelSha256:'81f924d440c27261d820c19a9f8d45794c5aee410f8a68bd358133fa8c0375da',imageManifest:'sha256:1f59c4a8285c7c0f9ccb6e5645d112db39956718df9065837ce2a6a3832c6aa9',calibrationRouteKeys:89,verifiedBy:'user-provided reference; plugin does not claim a fresh benchmark'}};
}
export const supportedPairs=['FP16/FP16','FP16/Q8','FP16/Q6','Q8/Q8','Q8/Q6','Q6/Q8','Q6/Q6','Q8/Q5','Q5/Q5','Q5/Q4','Q4/Q4'];
export function normalizeProfile(input,engine){
 const p=validateProfile(input);const lock=key=>{if(!p.locks.includes(key))p.locks.push(key);};
 for(const [flag,key]of [['--port','port'],['--max-context','context']]){if(p.options[flag]!=null&&p.options[flag]!==''){p[key]=Number(p.options[flag]);delete p.options[flag];lock(key);}if(p.serverOptions?.[flag]!=null&&p.serverOptions[flag]!==''){p[key]=Number(p.serverOptions[flag]);delete p.serverOptions[flag];lock(key);}}
 if(engine==='ninfer'&&p.modelId)p.options['--model-id']=p.modelId;
 if(engine==='strata'){
  for(const[flag,key]of [['--native','modelPath'],['--pack','packPath'],['--mtp','mtpPath'],['--max-context','context']]){
   if(p.options[flag]!=null&&p.options[flag]!==''){p[key]=key==='context'?Number(p.options[flag]):p.options[flag];lock(key);delete p.options[flag];}
  }
  if(p.options['--kv']){const[k,v]=String(p.options['--kv']).split('/');if(v){p.kvK=k;p.kvV=v;}else{const pair={fp16:'FP16/FP16',int8:'Q8/Q8',q4_0:'Q4/Q4',k8v4:'Q8/Q4'}[k];if(!pair)throw new Error('Use an explicit supported K/V pair.');[p.kvK,p.kvV]=pair.split('/');}lock('kvK');lock('kvV');delete p.options['--kv'];}
  if(p.options['--kv-resident']!=null&&p.options['--kv-resident']!==''){const cells=Number(p.options['--kv-resident']);p.residentMode='context';p.residentContext=cells===0?p.context:cells;lock('residentMode');lock('residentContext');delete p.options['--kv-resident'];}
  if(!supportedPairs.includes(`${p.kvK}/${p.kvV}`))throw new Error(`Unsupported Strata KV pair ${p.kvK}/${p.kvV}. Supported: ${supportedPairs.join(', ')}`);
  if(p.residentMode==='percent'&&(!Number.isFinite(p.residentPercent)||p.residentPercent<0||p.residentPercent>100))throw new Error('Resident percentage must be between 0 and 100.');
 }
 for(const key of ['environment','serverConfig','serverOptions','tunePolicy'])if(!p[key]||typeof p[key]!=='object'||Array.isArray(p[key]))throw new Error(`${key} must be a JSON object.`);
 return validateProfile(p);
}
