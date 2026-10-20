import { readFile, access, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { basename, join } from 'node:path';
import { freshProfile, normalizeProfile, strataArgs } from './profiles.js';
const root='/mnt/ai/Local AI version 2';
async function remap(value){
 if(typeof value==='string'){
  if(value.startsWith('/opt/prod/')){const target=root+value.slice('/opt/prod'.length);try{await access(target);return target;}catch(e){if(e.code!=='ENOENT')throw e;}}
  if(value==='/usr/local/cuda-13.1/lib64'||value==='/usr/local/cuda/lib64'){try{await access(value);return value;}catch(e){if(e.code!=='ENOENT')throw e;const target=join(root,'runtime/compat-root/usr/local/cuda-13.1/targets/x86_64-linux/lib');try{await access(target);return target;}catch(e){if(e.code!=='ENOENT')throw e;}}}
  return value;
 }
 if(Array.isArray(value))return Promise.all(value.map(remap));
 if(value&&typeof value==='object')return Object.fromEntries(await Promise.all(Object.entries(value).map(async([k,v])=>[k,await remap(v)])));
 return value;
}
export async function importConfig(path){
 const raw=await readFile(path,'utf8');const original=JSON.parse(raw);if(!Array.isArray(original.args)||!original.exe)throw new Error('Choose a Strata run configuration containing exe and args.');
 const cfg=await remap(original);const p=freshProfile('strata');
 p.id=basename(path,'.json').replace(/[^a-zA-Z0-9_-]/g,'_');p.name=({ 'atomic-q5-regular':'Qwen3.8 Flash Next · Atomic Q5 Regular','atomic-q5-turbo':'Qwen3.8 Flash Next · Atomic Q5 Turbo','gyro-l-regular':'Qwen3.8 Flash Next · Gyro Large Regular','gyro-l-turbo':'Qwen3.8 Flash Next · Gyro Large Turbo'})[p.id]||cfg.model_name||p.id;
 p.executable=cfg.exe;p.sourceDir=cfg.cwd;p.modelId=cfg.model_name||p.id;p.port=cfg.port||8190;p.gpu=cfg.gpu||0;
 p.python='python3';p.maxTokens=p.context===32768?8191:65535;
 p.serverConfig=structuredClone(cfg);p.environment={...cfg.env};if(cfg.lib_dirs?.length)p.environment.LD_LIBRARY_PATH=cfg.lib_dirs.join(':');
 const options={};for(let i=0;i<cfg.args.length;i++){const flag=cfg.args[i];if(!String(flag).startsWith('--'))throw new Error('Unsupported positional engine argument in saved config.');const values=[];while(i+1<cfg.args.length&&!String(cfg.args[i+1]).startsWith('--'))values.push(cfg.args[++i]);const value=values.length===0?true:values.length===1?values[0]:{argv:values};if(options[flag]!==undefined)options[flag]=Array.isArray(options[flag])?[...options[flag],value]:[options[flag],value];else options[flag]=value;}
 p.options=options;p.projectorPath=cfg.vision?.mmproj||'';p.visionExecutable=cfg.vision?.exe||'';p.visionCpuExecutable=cfg.vision?.cpu_exe||'';p.visionDevice=cfg.vision?(cfg.vision.gpu?'gpu':'cpu'):'off';
 p.locks=[...Object.keys(p),...Object.keys(options).map(x=>'options.'+x)];
 const normalized=normalizeProfile(p,'strata');normalized.maxTokens=normalized.context===32768?8191:65535;
 normalized.importedEngineArgs=cfg.args;normalized.importedFingerprint=launchFingerprint(normalized);
 const required=[normalized.executable,normalized.sourceDir,normalized.modelPath,normalized.packPath,normalized.tokenizerPath,normalized.mtpPath,normalized.projectorPath,normalized.visionExecutable].filter(Boolean);const missing=[];for(const file of required){try{await access(file);}catch(e){if(e.code!=='ENOENT')throw e;missing.push(file);}}
 normalized.provenance={kind:'imported-saved-profile',sourceConfig:path,sourceSha256:createHash('sha256').update(raw).digest('hex'),originalStatus:cfg.prod_profile_requirements?.status||'saved configuration; validation status not recorded',inferenceRerun:false,pathRemappingOnly:true,missingPaths:missing};
 return normalized;
}
export function launchFingerprint(p){return JSON.stringify({modelPath:p.modelPath,packPath:p.packPath,mtpPath:p.mtpPath,context:p.context,kvK:p.kvK,kvV:p.kvV,residentMode:p.residentMode,residentContext:p.residentContext,residentPercent:p.residentPercent,options:p.options,extraArgs:p.extraArgs,tuned:p.tuned});}
