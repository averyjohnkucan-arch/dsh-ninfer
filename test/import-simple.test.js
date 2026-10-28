import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,chmod} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {run} from '../lib/process.js';
import {Runtime} from '../lib/runtime.js';
import {handler} from '../lib/http.js';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {freshProfile} from '../lib/profiles.js';

test('recursive import reads native context, components, and missing shards',async t=>{
 const root=await mkdtemp(join(tmpdir(),'ninfer-scan-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const nested=join(root,'nested');await mkdir(nested);
 const manifest={metadata:{name:'Test model'},components:{text:{config:{model_type:'qwen3_5_text',max_position_embeddings:65536}},vision:{},mtp:{}},files:[{path:null},{path:'part-2.ninferpart'}]};
 const payload=Buffer.from(JSON.stringify(manifest));const header=Buffer.alloc(32);header.write('NINFER\0\x03',0,'binary');header.writeBigUInt64LE(BigInt(payload.length),8);
 const path=join(nested,'model.ninfer');await writeFile(path,Buffer.concat([header,payload]));
 const scan=async()=>JSON.parse((await run('python3',['-B',new URL('../scripts/scan-models.py',import.meta.url).pathname,root])).stdout);
 let result=await scan();assert.equal(result.models[0].complete,false);assert.equal(result.models[0].nativeContext,65536);assert.equal(result.models[0].modelType,'qwen3_5_text');assert.deepEqual(result.models[0].components,['text','vision','mtp']);
 await writeFile(join(nested,'part-2.ninferpart'),'part');result=await scan();assert.equal(result.models[0].complete,true);
});

test('missing runtime is installed on activation and can be retried',async t=>{
 const root=await mkdtemp(join(tmpdir(),'ninfer-auto-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const runtime=new Runtime('ninfer',{dataDir:root});await runtime.init();let calls=0;
 runtime.setup=async()=>{calls++;if(calls===1)throw Error('offline');await mkdir(join(root,'engine','bin'),{recursive:true});await writeFile(join(root,'engine','bin','ninfer-serve'),'ready');};
 const first=await runtime.ensureEngine();await runtime.jobs.get(first.id).promise;assert.equal(runtime.jobs.get(first.id).status,'failed');
 const second=await runtime.action('install-engine');await runtime.jobs.get(second.id).promise;assert.equal(runtime.jobs.get(second.id).status,'complete');assert.equal(await runtime.ensureEngine(),undefined);await runtime.dispose();
});

test('purging NInfer cache preserves saved model profiles',async t=>{
 const root=await mkdtemp(join(tmpdir(),'ninfer-purge-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const runtime=new Runtime('ninfer',{dataDir:root});await runtime.init();
 await mkdir(join(root,'kv'),{recursive:true});await writeFile(join(root,'kv','snapshot'),'cached');
 const before=await readFile(join(root,'profiles.json'),'utf8');await runtime.action('purge-cache');
 assert.equal(await readFile(join(root,'profiles.json'),'utf8'),before);
 await assert.rejects(()=>readFile(join(root,'kv','snapshot')),/ENOENT/);await runtime.dispose();
});

test('calibration saves the native GPU profile for the selected model',async t=>{
 const root=await mkdtemp(join(tmpdir(),'ninfer-calibrate-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const bin=join(root,'bin');await mkdir(bin);const tool=join(bin,'ninfer-calibrate');
 await writeFile(tool,'#!/bin/sh\nprintf "{}" > "$4"\n');await chmod(tool,0o755);
 const runtime=new Runtime('ninfer',{dataDir:root});await runtime.init();const p=freshProfile('ninfer');p.executable=join(bin,'ninfer-serve');runtime.profiles=[p];
 const job=await runtime.action('calibrate',{id:p.id});await runtime.jobs.get(job.id).promise;
 assert.equal(runtime.jobs.get(job.id).status,'complete');assert.equal(await readFile(p.environment.NINFER_DEVICE_PROFILES,'utf8'),'{}');await runtime.dispose();
});

test('owner Connection route dispatches JSON and rejects invalid methods',async()=>{
 const fetch=handler({action:async(action,payload)=>({action,payload})});
 const response=await fetch(new Request('http://localhost/api/dsh-ninfer',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'list',payload:{}})}));
 assert.equal(response.status,200);assert.deepEqual((await response.json()).result,{action:'list',payload:{}});
 assert.equal((await fetch(new Request('http://localhost/api/dsh-ninfer'))).status,405);
});

test('browser card declares the DSH slot dependency and registers its model panel',async()=>{
 let definition,registered;const source=await readFile(new URL('../client.js',import.meta.url),'utf8');
 vm.runInNewContext(source,{window:{__ModuleLoader__:{load(value){definition=value;}}}});
 const plugin=definition.factory(name=>{assert.equal(name,'react');return {createElement(){}};});
 assert.deepEqual(Array.from(plugin.inject),['slots']);
 plugin.apply({slots:{inject(_name,callback){callback();},register(options,component){registered={options,component};}}});
 assert.equal(registered.options.id,'dsh-ninfer');assert.equal(typeof registered.component,'function');
});
