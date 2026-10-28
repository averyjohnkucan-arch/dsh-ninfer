import {prepareBase} from './base-checkpoint.js';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, open, rename, rm, readdir, stat, copyFile, chmod, statfs } from 'node:fs/promises';
import { join,dirname,basename } from 'node:path';
import { constants } from 'node:fs';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function syncFile(path){const f=await open(path,'r');try{await f.sync();}finally{await f.close();}}
async function syncDir(path){try{await syncFile(path);}catch(e){if(!['EINVAL','EPERM','EISDIR','ENOTSUP'].includes(e.code))throw e;}}
async function atomic(path,value){const temp=path+'.'+randomUUID()+'.tmp';try{const f=await open(temp,'wx',0o600);try{await f.writeFile(JSON.stringify(value));await f.sync();}finally{await f.close();}await rename(temp,path);await syncDir(join(path,'..'));}finally{await rm(temp,{force:true});}}
export class SerialGate {
 constructor(){this.tail=Promise.resolve();}
 async acquire(signal){let release;const done=new Promise(r=>release=r),prior=this.tail;this.tail=prior.catch(()=>{}).then(()=>done);try{await prior;signal?.throwIfAborted();return release;}catch(e){release();throw e;}}
}
/** Native NInfer snapshots. Only hashed session IDs and message digests enter the catalog. */
export class KvCache {
 constructor(root,{request=fetch,onWarning=()=>{},budget=16*1024**3}={}){this.root=root;this.request=request;this.onWarning=onWarning;this.gate=new SerialGate();this.budget=budget;}
 async touch(item){
  if(!item?.dir)return;
  const path=join(item.dir,'index.json');let data;try{data=JSON.parse(await readFile(path,'utf8'));}catch(e){if(e.code==='ENOENT')return;throw e;}
  const found=item.base?data:(data.models||[]).find(x=>x.file===item.file&&x.identity===item.identity);
  if(found){found.updated=Date.now();await atomic(path,data);}
 }
 async enforceBudget(modelKey,identity,protectedFile){
  const entries=[];
  for(const area of ['chats','bases']){
   const root=join(this.root,area);let dirs;try{dirs=await readdir(root,{withFileTypes:true});}catch(e){if(e.code==='ENOENT')continue;throw e;}
   for(const first of dirs){if(!first.isDirectory()||!/^[a-f0-9]{64}$/.test(first.name))continue;const parent=join(root,first.name);let leaves;
    if(area==='chats')leaves=[parent];else {const subs=await readdir(parent,{withFileTypes:true});leaves=subs.filter(x=>x.isDirectory()&&/^[a-f0-9]{64}$/.test(x.name)).map(x=>join(parent,x.name));}
    for(const dir of leaves){let data;try{data=JSON.parse(await readFile(join(dir,'index.json'),'utf8'));}catch(e){if(e.code==='ENOENT'||e instanceof SyntaxError)continue;throw e;}
     for(const item of area==='chats'?(data.models||[]):[data]){
      if((item.modelKey||item.identity)!==modelKey && item.identity!==identity)continue;
      if(!/^checkpoint-[a-f0-9-]+\.kv$/.test(item.file)||!Number.isFinite(item.bytes))continue;
      entries.push({dir,data,item,area});
     }
    }
   }
  }
  entries.sort((a,b)=>Number(a.item.file===protectedFile)-Number(b.item.file===protectedFile)||(a.item.updated||0)-(b.item.updated||0));let total=entries.reduce((sum,e)=>sum+e.item.bytes,0);
  for(const entry of entries){if(total<=this.budget)break;const path=join(entry.dir,'index.json');
   if(entry.area==='chats'){entry.data.models=entry.data.models.filter(x=>x.file!==entry.item.file);await atomic(path,entry.data);}else await rm(path,{force:true});
   await rm(join(entry.dir,entry.item.file),{force:true});total-=entry.item.bytes;
  }
 }
 async identity(profile){
  const paths=new Set([profile.modelPath,profile.executable,profile.mtpPath,profile.tokenizerPath,profile.packPath,...(profile.modelFiles||[])].filter(Boolean));
  const shard=/^(.*)-[0-9]{5}-of-([0-9]{5})\.gguf$/i.exec(basename(profile.modelPath||''));
  if(shard)for(const file of await readdir(dirname(profile.modelPath)))if(file.startsWith(shard[1]+'-')&&file.endsWith('-of-'+shard[2]+'.gguf'))paths.add(join(dirname(profile.modelPath),file));
  const files=[];const describe=async(path,depth=0)=>{const s=await stat(path);files.push({path,size:s.size,mtimeMs:s.mtimeMs,ctimeMs:s.ctimeMs});if(s.isDirectory()&&depth<2)for(const file of (await readdir(path)).sort())await describe(join(path,file),depth+1);};
  for(const path of [...paths].sort())await describe(path);
  // Conservative: any launch configuration change invalidates compatibility.
  const {name,id,port,reasoning,provenance,status,external,activeRequests,cacheStatus,log,tuneReport,tunePolicy,kvCache,enabled,...configuration}=profile;
  return hash({version:1,files,configuration});
 }
 async work(identity){const path=join(this.root,'work',identity);await mkdir(path,{recursive:true,mode:0o700});return path;}
 async manifest(sessionId){const dir=join(this.root,'chats',hash(String(sessionId)));await mkdir(dir,{recursive:true,mode:0o700});let data={version:1,models:[]};try{data=JSON.parse(await readFile(join(dir,'index.json'),'utf8'));if(data.version!==1||!Array.isArray(data.models))throw new Error('Invalid KV catalog');}catch(e){if(e.code!=='ENOENT')throw e;}return{dir,data};}
 digests(options){return [hash({system:options.system,tools:options.tools}),...(options.messages||[]).map(m=>{const {id,source,createdAt,timestamp,...payload}=m;return hash(payload);})];}
 async candidate(sessionId,identity,digests){
  // Own-chat edits still get native token-prefix validation, even when the
  // logical system/tool hash changes. Cross-chat reuse requires a shared prefix.
  const own=await this.manifest(sessionId);const candidates=[];
  const dirs=await readdir(join(this.root,'chats'),{withFileTypes:true});
  for(const entry of dirs){if(!entry.isDirectory()||!/^[a-f0-9]{64}$/.test(entry.name))continue;const dir=join(this.root,'chats',entry.name);try{const data=dir===own.dir?own.data:JSON.parse(await readFile(join(dir,'index.json'),'utf8'));for(const item of data.models||[]){if(item.identity!==identity||!Array.isArray(item.digests)||!/^checkpoint-[a-f0-9-]+\.kv$/.test(item.file))continue;let common=0;while(common<digests.length&&digests[common]===item.digests[common])common++;if(dir===own.dir||common>1||(common===1&&digests[0]!==hash({system:undefined,tools:undefined})))candidates.push({...item,dir,common,own:dir===own.dir});}}catch(e){if(e.code!=='ENOENT'&&!(e instanceof SyntaxError))throw e;}}
  candidates.sort((a,b)=>Number(b.own)-Number(a.own)||b.common-a.common||b.updated-a.updated);
  for(const c of candidates){try{const info=await stat(join(c.dir,c.file));if(info.isFile()&&info.size===c.bytes)return c;}catch(e){if(e.code!=='ENOENT')throw e;}}
 }
 async slot(state,action,filename,headers,receipt){const response=await this.request(state.url+'/slots/'+(action==='save'?receipt?.slot??0:0)+'?action='+action,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({filename,...(action==='save'?{if_digest:receipt?.digest}:{})}),signal:AbortSignal.timeout(900000)});const result=await response.json();if(!response.ok)throw new Error(result.error?.message||`KV ${action} failed (${response.status})`);return result;}
 async base(state,identity,body,headers,signal){return prepareBase(this,state,identity,body,headers,signal);}
 async restore(state,sessionId,identity,digests,headers,base){
  if(state.kvSession===String(sessionId)&&state.kvIdentity===identity)return;
  // A new chat uses the independent base before considering any legacy cross-chat snapshot.
  let c;
  if(base){const own=await this.manifest(sessionId),item=own.data.models.find(m=>m.identity===identity);if(item&&/^checkpoint-[a-f0-9-]+\.kv$/.test(item.file)){try{const info=await stat(join(own.dir,item.file));if(info.size===item.bytes)c={...item,dir:own.dir,common:0,own:true};}catch(e){if(e.code!=='ENOENT')throw e;}}c??=base;}
  else c=await this.candidate(sessionId,identity,digests);
  if(!c)return;
  if(c.resident){await this.touch(c);state.cacheStatus={phase:'base-ready',tokens:c.tokens};return;}
  // A compatible continuation may still be in NInfer's GPU/host catalog. Let
  // native admission choose its best token prefix rather than reload it from disk.
  const response=await this.request(state.url+'/slots',{headers,signal:AbortSignal.timeout(5000)});
  if(response.ok){const slots=await response.json();if(Array.isArray(slots)&&slots.some(slot=>slot.retained&&slot.session_digest===c.nativeDigest)){await this.touch(c);state.cacheStatus={phase:'resident',fromOtherChat:!c.own&&!c.base,sharedBase:!!c.base};return;}}
  const work=await this.work(identity),filename='restore-'+randomUUID()+'.kv',target=join(work,filename);
  try{await copyFile(join(c.dir,c.file),target,constants.COPYFILE_FICLONE);await this.slot(state,'restore',filename,headers);await this.touch(c);state.kvSession=String(sessionId);state.kvIdentity=identity;state.cacheStatus={phase:'restored',tokens:c.tokens,sharedPrefixMessages:c.common,fromOtherChat:!c.own&&!c.base,sharedBase:!!c.base};}
  finally{await rm(target,{force:true});}
 }
 async save(state,sessionId,identity,digests,headers,receipt){
  if(!Number.isInteger(receipt?.slot)||!/^[a-f0-9]{16}$/.test(receipt?.digest))throw new Error('Engine did not return a native slot identity; previous checkpoint retained.');
  const work=await this.work(identity),filename='checkpoint-'+randomUUID()+'.kv',source=join(work,filename),{dir,data}=await this.manifest(sessionId),target=join(dir,filename);
  try{
   // Preserve the previous valid snapshot if there is insufficient room for its replacement.
   const fs=await statfs(work);const prior=data.models.find(m=>m.identity===identity);const required=Math.max(512*1024*1024,(prior?.bytes||0)*1.1);if(Number(fs.bavail)*Number(fs.bsize)<required)throw new Error('Insufficient free disk space for a safe KV checkpoint replacement.');
   const result=await this.slot(state,'save',filename,headers,receipt),info=await stat(source);if(!info.isFile()||info.size<=0)throw new Error('Engine did not publish a nonempty KV snapshot.');if(info.size>this.budget)throw new Error('Checkpoint exceeds the 16 GiB per-model cache limit.');
   await chmod(source,0o600);await syncFile(source);await rename(source,target);await syncDir(dir);
   const modelKey=state.profile?.id||identity;
   const item={identity,modelKey,file:filename,bytes:info.size,tokens:result.n_saved,nativeDigest:result.session_digest,digests,updated:Date.now()};
   const models=[item,...data.models.filter(m=>m.identity!==identity).sort((a,b)=>b.updated-a.updated)];
   await atomic(join(dir,'index.json'),{version:1,models});
   for(const file of await readdir(dir))if(/^checkpoint-[a-f0-9-]+\.kv$/.test(file)&&!models.some(m=>m.file===file))await rm(join(dir,file),{force:true});
   await this.enforceBudget(modelKey,identity,filename);
   state.kvSession=String(sessionId);state.kvIdentity=identity;state.cacheStatus={phase:'saved',tokens:item.tokens,bytes:item.bytes,updated:item.updated};
  }finally{await rm(source,{force:true});}
 }
 warn(state,error){state.cacheStatus={phase:'warning',message:error.message};this.onWarning(error);}
}
