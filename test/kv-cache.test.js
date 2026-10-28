import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,writeFile,readFile,rm,readdir,stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { KvCache,SerialGate } from '../lib/kv-cache.js';
async function fixture(t){const root=await mkdtemp(join(tmpdir(),'strata-kv-'));t.after(()=>rm(root,{recursive:true,force:true}));let restores=[],fail=false;const cache=new KvCache(root,{request:async(url,options)=>{if(!options.body)return Response.json([]);const {filename}=JSON.parse(options.body),action=new URL(url).searchParams.get('action');if(fail)return Response.json({error:{message:'save rejected'}},{status:503});const work=await cache.work('model-a');if(action==='save')await writeFile(join(work,filename),'native KV bytes');else restores.push(await readFile(join(work,filename),'utf8'));return Response.json({n_saved:42,n_restored:42,session_digest:'1234567890abcdef'});}});const save=cache.save.bind(cache);cache.save=(...args)=>save(...args,{slot:0,digest:'1234567890abcdef'});return {cache,root,state:{url:'http://engine',ready:true},restores,setFail:value=>fail=value};}
test('published checkpoint restores after manager restart and uses private permissions',async t=>{const f=await fixture(t),digests=f.cache.digests({system:'system',messages:[{role:'user',content:'hello'}]});await f.cache.save(f.state,'chat-a','model-a',digests,{});const {dir,data}=await f.cache.manifest('chat-a');assert.equal(data.models.length,1);assert.equal((await stat(join(dir,data.models[0].file))).mode&0o777,0o600);const restarted=new KvCache(f.root,{request:f.cache.request});await restarted.restore({url:'http://engine'},'chat-a','model-a',digests,{});assert.equal(f.restores.length,1);});
test('failed save preserves last valid checkpoint',async t=>{const f=await fixture(t);await f.cache.save(f.state,'chat','model-a',['system'],{});const before=await f.cache.manifest('chat');f.setFail(true);await assert.rejects(()=>f.cache.save(f.state,'chat','model-a',['new'],{}),/save rejected/);assert.deepEqual((await f.cache.manifest('chat')).data,before.data);assert.equal((await readdir(before.dir)).filter(x=>x.endsWith('.kv')).length,1);});
test('new chats reuse only matching model and logical prefix; truncated files are ignored',async t=>{const f=await fixture(t);await f.cache.save(f.state,'old','model-a',['system','hello'],{});const match=await f.cache.candidate('new','model-a',['system','hello','next']);assert.equal(match.common,2);assert.equal(match.own,false);assert.equal(await f.cache.candidate('new','different',['system','hello']),undefined);assert.equal(await f.cache.candidate('new','model-a',['other','hello']),undefined);await writeFile(join(match.dir,match.file),'bad');assert.equal(await f.cache.candidate('new','model-a',['system','hello']),undefined);});
test('different models retain their own checkpoints',async t=>{const f=await fixture(t);for(const identity of ['model-a','model-b','model-c']){const original=f.cache.slot.bind(f.cache);f.cache.slot=async(state,action,filename,headers)=>{if(action==='save'){await writeFile(join(await f.cache.work(identity),filename),'native KV bytes');return {n_saved:42};}return original(state,action,filename,headers);};await f.cache.save(f.state,'chat',identity,['system'],{});}const {dir,data}=await f.cache.manifest('chat');assert.deepEqual(data.models.map(x=>x.identity),['model-c','model-b','model-a']);assert.equal((await readdir(dir)).filter(x=>x.endsWith('.kv')).length,3);});
test('per-model quota evicts the least recently used checkpoint across restarts',async t=>{const f=await fixture(t);f.cache.budget=30;f.state.profile={id:'model'};const id='a'.repeat(64);const slot=async(_state,action,filename)=>{if(action==='save')await writeFile(join(await f.cache.work(id),filename),'native KV bytes');return{n_saved:42};};f.cache.slot=slot;await f.cache.save(f.state,'first',id,['one'],{});await new Promise(r=>setTimeout(r,5));await f.cache.save(f.state,'second',id,['two'],{});const first=await f.cache.manifest('first');await new Promise(r=>setTimeout(r,5));await f.cache.touch({...first.data.models[0],dir:first.dir});f.cache=new KvCache(f.root,{budget:30});f.cache.slot=slot;const save=f.cache.save.bind(f.cache);f.cache.save=(...args)=>save(...args,{slot:0,digest:'1234567890abcdef'});await new Promise(r=>setTimeout(r,5));await f.cache.save(f.state,'third',id,['three'],{});assert.equal((await f.cache.manifest('first')).data.models.length,1);assert.equal((await f.cache.manifest('second')).data.models.length,0);assert.equal((await f.cache.manifest('third')).data.models.length,1);});
test('an oversized snapshot preserves the previous checkpoint',async t=>{const f=await fixture(t);await f.cache.save(f.state,'chat','model-a',['one'],{});const before=await f.cache.manifest('chat');f.cache.budget=5;await assert.rejects(()=>f.cache.save(f.state,'chat','model-a',['two'],{}),/exceeds/);const after=await f.cache.manifest('chat');assert.equal(after.data.models[0].file,before.data.models[0].file);assert.ok(await readFile(join(after.dir,after.data.models[0].file)));});
test('serial gate prevents interleaved restore/generate/save and releases cancelled waiters',async()=>{const gate=new SerialGate(),release=await gate.acquire();const abort=new AbortController();let entered=false;const pending=gate.acquire(abort.signal).then(()=>entered=true);abort.abort(new Error('cancelled'));assert.equal(entered,false);release();await assert.rejects(pending,/cancelled/);const next=await gate.acquire();next();});

test('display and runtime state never change native checkpoint compatibility',async t=>{const f=await fixture(t),file=join(f.root,'model.gguf');await writeFile(file,'weights');const profile={modelPath:file,executable:file,options:{'--kv':'FP16/FP16'}};assert.equal(await f.cache.identity(profile),await f.cache.identity({...profile,name:'renamed',status:'running',activeRequests:1,log:'process output',cacheStatus:{phase:'saved'},kvCache:true}));});

test('a fresh chat can reuse the system prefix with a different first user message',async t=>{
 const f=await fixture(t);
 const old=f.cache.digests({system:'shared instructions',tools:[],messages:[{role:'user',content:'first chat'}]});
 const next=f.cache.digests({system:'shared instructions',tools:[],messages:[{role:'user',content:'different chat'}]});
 await f.cache.save(f.state,'old','model-a',old,{});
 const candidate=await f.cache.candidate('new','model-a',next);
 assert.equal(candidate.common,1);assert.equal(candidate.own,false);
});
test('resident native digest skips disk restoration when alternating chats',async t=>{
 const f=await fixture(t);await f.cache.save(f.state,'chat-a','model-a',['system','a'],{});
 const request=f.cache.request;
 f.cache.request=(url,options)=>options.body?request(url,options):Promise.resolve(Response.json([{retained:true,session_digest:'1234567890abcdef'}]));
 const state={url:'http://engine'};
 await f.cache.restore(state,'chat-b','model-a',['system','b'],{});
 assert.equal(f.restores.length,0);assert.equal(state.cacheStatus.phase,'resident');
});
test('missing slot metadata cannot replace a previously published snapshot',async t=>{
 const f=await fixture(t);await f.cache.save(f.state,'chat','model-a',['system'],{});
 const before=(await f.cache.manifest('chat')).data;
 await assert.rejects(KvCache.prototype.save.call(f.cache,f.state,'chat','model-a',['new'],{},{}),/native slot identity/);
 assert.deepEqual((await f.cache.manifest('chat')).data,before);
});

test('own-chat tool edits defer partial invalidation to native token validation',async t=>{
 const f=await fixture(t);
 await f.cache.save(f.state,'edited-chat','model-a',['old-system-tools','hello'],{});
 const own=await f.cache.candidate('edited-chat','model-a',['new-system-tools','hello']);
 assert.equal(own.own,true);assert.equal(own.common,0);
 assert.equal(await f.cache.candidate('unrelated-chat','model-a',['new-system-tools','hello']),undefined);
});
