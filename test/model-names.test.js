import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Runtime} from '../lib/runtime.js';
import {freshProfile} from '../lib/profiles.js';
import {LocalAdapter,wireId} from '../lib/adapter.js';

test('renaming persists to the model picker without changing native identity, files or options',async t=>{
 const root=await mkdtemp(join(tmpdir(),'ninfer-model-name-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const runtime=new Runtime('ninfer',{dataDir:root});await runtime.init();t.after(()=>runtime.dispose());
 const p=freshProfile('ninfer');p.name='Original model';p.modelPath='/models/original.ninfer';p.modelId='native-original';p.options={'--kv-dtype':'nvfp4'};
 const original=await runtime.save(p);await runtime.save({...original,name:'My 256K model'});
 const reloaded=new Runtime('ninfer',{dataDir:root});await reloaded.init();t.after(()=>reloaded.dispose());
 const saved=reloaded.find(p.id);assert.equal(saved.name,'My 256K model');assert.equal(saved.modelPath,p.modelPath);assert.deepEqual(saved.options,original.options);assert.equal(wireId(saved),wireId(original));
 const models=await new LocalAdapter({},reloaded,'NInfer').listModels('ninfer');assert.equal(models[0].name,saved.name);assert.equal(models[0].id,wireId(original));
});
