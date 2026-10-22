import {createHash,randomUUID} from 'node:crypto';
import {mkdir,readFile,stat,chmod,open,rename,rm} from 'node:fs/promises';
import {join} from 'node:path';

const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function sync(path){let file;try{file=await open(path,'r');await file.sync();}catch(e){if(!['EINVAL','EPERM','EISDIR','ENOTSUP'].includes(e.code))throw e;}finally{await file?.close();}}
/** An independent system/tool seed. No user or assistant history enters this request. */
export async function prepareBase(cache,state,identity,body,headers,signal){
 const first=body.messages?.[0];
 if(first?.role!=='system')return;
 // Include prompt-rendering controls, but not sampling limits, chat IDs or stream mode.
 const descriptor={version:1,model:body.model,system:first};
 for(const key of ['tools','tool_choice','parallel_tool_calls','chat_template','chat_template_kwargs','enable_thinking','reasoning_effort','thinking'])if(body[key]!==undefined)descriptor[key]=body[key];
 const key=hash(descriptor),dir=join(cache.root,'bases',identity,key),index=join(dir,'index.json');
 try{
  const item=JSON.parse(await readFile(index,'utf8'));
  if(item.key===key&&item.identity===identity&&/^checkpoint-[a-f0-9-]+\.kv$/.test(item.file)){
   const info=await stat(join(dir,item.file));
   if(info.isFile()&&info.size===item.bytes)return {...item,dir,common:1,own:false,base:true};
  }
 }catch(e){if(e.code!=='ENOENT'&&!(e instanceof SyntaxError))throw e;}
 // Build once for a fresh chat. Never interrupt an established chat to prewarm a changed toolset.
 if(body.messages.length!==2||body.messages[1].role!=='user')return;
 signal?.throwIfAborted();
 state.kvSession=null;state.kvIdentity=null;
 // Both engines require a generation request to publish retained state. A blank
 // synthetic user and one discarded token produce the native system-prefix anchor.
 // Only that exact matching prefix is reusable in a real chat; the tail is synthetic.
 const seed={model:body.model,messages:[first,{role:'user',content:''}],stream:false,max_tokens:1,max_completion_tokens:1,temperature:0,seed:1};
 for(const field of Object.keys(descriptor))if(!['version','system','model'].includes(field))seed[field]=descriptor[field];
 if(body.strata_prefix)seed.strata_prefix={messages:1};
 if(body.prompt_cache_key)seed.prompt_cache_key='dsh-base-'+key;
 const response=await cache.request(state.url+'/v1/chat/completions',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify(seed),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(900000)]):AbortSignal.timeout(900000)});
 const result=await response.json();
 if(!response.ok)throw new Error(result.error?.message||`Base prefill failed (${response.status})`);
 signal?.throwIfAborted();
 const receipt={slot:result.id_slot,digest:result.session_digest};
 if(body.prompt_cache_key&&(!Number.isInteger(receipt.slot)||!/^[a-f0-9]{16}$/.test(receipt.digest)))throw new Error('Base prefill returned no native slot identity.');
 const work=await cache.work(identity),file='checkpoint-'+randomUUID()+'.kv',source=join(work,file),target=join(dir,file),temp=index+'.'+randomUUID()+'.tmp';
 await mkdir(dir,{recursive:true,mode:0o700});
 try{
  const saved=await cache.slot(state,'save',file,headers,receipt),info=await stat(source);
  if(!info.isFile()||!info.size)throw new Error('Engine did not publish a base checkpoint.');
  await chmod(source,0o600);await sync(source);await rename(source,target);await sync(dir);
  const item={key,identity,file,bytes:info.size,tokens:saved.n_saved,nativeDigest:saved.session_digest,updated:Date.now()};
  const f=await open(temp,'wx',0o600);try{await f.writeFile(JSON.stringify(item));await f.sync();}finally{await f.close();}
  await rename(temp,index);await sync(dir);
  return {...item,dir,common:1,own:false,base:true,resident:true};
 }finally{await rm(source,{force:true});await rm(temp,{force:true});}
}
