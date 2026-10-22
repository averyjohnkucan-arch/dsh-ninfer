import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {KvCache} from '../lib/kv-cache.js';
async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'dsh-base-test-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const requests=[];let fail=false,saves=0;
 const cache=new KvCache(root,{request:async(url,options)=>{
  const body=options.body&&JSON.parse(options.body);requests.push({url,body});
  if(url.endsWith('/v1/chat/completions'))return Response.json(fail?{error:{message:'seed failed'}}:{id_slot:2,session_digest:'1234567890abcdef'},fail?{status:503}:undefined);
  if(!body)return Response.json([]);
  const action=new URL(url).searchParams.get('action');
  if(action==='save'){saves++;await writeFile(join(await cache.work('model-a'),body.filename),'native '+saves);}
  return Response.json({n_saved:100,n_restored:100,session_digest:'1234567890abcdef'});
 }});
 return{root,cache,requests,state:{url:'http://engine'},body:{model:'model-a',messages:[{role:'system',content:'default policy'},{role:'user',content:'PRIVATE QUESTION'}],tools:[{type:'function',function:{name:'example'}}],prompt_cache_key:'private-chat-id',strata_prefix:{messages:1},max_tokens:1000},fail:()=>{fail=true;}};
}
test('independent base uses no chat content, survives chat purge, and does not regenerate',async t=>{
 const f=await fixture(t);const a=await f.cache.base(f.state,'model-a',f.body,{});
 const seed=f.requests[0].body;assert.equal(seed.max_tokens,1);assert.equal(seed.stream,false);assert.deepEqual(seed.messages,[f.body.messages[0],{role:'user',content:''}]);assert.equal(JSON.stringify(seed).includes('PRIVATE QUESTION'),false);assert.notEqual(seed.prompt_cache_key,'private-chat-id');
 assert.deepEqual(seed.tools,f.body.tools);
 await rm(join(f.root,'chats'),{force:true,recursive:true});
 const restarted=new KvCache(f.root,{request:f.cache.request});
 const b=await restarted.base(f.state,'model-a',{...f.body,messages:[f.body.messages[0],{role:'user',content:'ANOTHER QUESTION'}],prompt_cache_key:'other-chat',temperature:0.8,max_tokens:20},{});
 assert.equal(a.file,b.file);assert.equal(b.resident,undefined);assert.equal(f.requests.filter(x=>x.url.endsWith('/completions')).length,1);
 await restarted.restore(f.state,'new-chat','model-a',['system','new'],{},b);assert.equal(f.state.cacheStatus.sharedBase,true);
});
test('changed instructions create another base once; failed rebuild preserves prior base',async t=>{
 const f=await fixture(t),a=await f.cache.base(f.state,'model-a',f.body,{});
 const changed={...f.body,messages:[{role:'system',content:'new policy'},f.body.messages[1]]};
 const b=await f.cache.base(f.state,'model-a',changed,{});assert.notEqual(a.key,b.key);
 assert.ok(await readFile(join(a.dir,a.file)));
 f.fail();await assert.rejects(()=>f.cache.base(f.state,'model-a',{...changed,tools:[]},{}),/seed failed/);
 assert.equal((await f.cache.base(f.state,'model-a',changed,{})).file,b.file);
});
test('base prefill is skipped for established history, missing system, or cancellation',async t=>{
 const f=await fixture(t);
 assert.equal(await f.cache.base(f.state,'model-a',{...f.body,messages:[...f.body.messages,{role:'assistant',content:'answer'},{role:'user',content:'continue'}]},{}),undefined);
 assert.equal(await f.cache.base(f.state,'model-a',{...f.body,messages:[f.body.messages[1]]},{}),undefined);
 const c=new AbortController();c.abort();await assert.rejects(()=>f.cache.base(f.state,'model-a',f.body,{},c.signal),{name:'AbortError'});
 assert.equal(f.requests.length,0);
});
test('the latest own-chat checkpoint takes precedence over a matching shared base',async t=>{
 const f=await fixture(t),base=await f.cache.base(f.state,'model-a',f.body,{});
 await f.cache.save(f.state,'chat','model-a',['system','message'],{},{slot:2,digest:'1234567890abcdef'});
 const restarted={url:'http://engine'};
 await f.cache.restore(restarted,'chat','model-a',['changed-tools','message'],{},{...base,resident:false});
 assert.equal(restarted.cacheStatus.sharedBase,false);assert.equal(restarted.cacheStatus.fromOtherChat,false);
});
