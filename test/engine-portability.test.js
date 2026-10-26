import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,readFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Runtime} from '../lib/runtime.js';
import {freshProfile,ninferSeed} from '../lib/profiles.js';
import {engineBuildPlan,cudaArchitecture} from '../lib/engine-build-plan.js';

test('fresh installation has no machine-specific profiles; existing imports survive reload',async t=>{
 const root=await mkdtemp(join(tmpdir(),'ninfer-portable-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const runtime=new Runtime('ninfer',{dataDir:root});await runtime.init();assert.deepEqual(runtime.profiles,[]);
 const profile=freshProfile('ninfer');profile.modelPath=join(root,'owner model.ninfer');profile.executable=join(root,'owner engine');
 await runtime.save(profile);await runtime.dispose();
 const reloaded=new Runtime('ninfer',{dataDir:root});await reloaded.init();assert.equal(reloaded.profiles[0].modelPath,profile.modelPath);assert.equal(reloaded.profiles[0].executable,profile.executable);await reloaded.dispose();
 const preset=ninferSeed();assert.equal(preset.modelPath,'');assert.equal(preset.executable,'');assert.deepEqual(preset.environment,{});
});

test('engine upgrades get separate directories and cannot overwrite the old source',async t=>{
 const root=await mkdtemp(join(tmpdir(),'ninfer builds '));t.after(()=>rm(root,{recursive:true,force:true}));
 await mkdir(join(root,'source'));await writeFile(join(root,'source','owner.txt'),'preserve');
 const engine={revision:'a'.repeat(40)};
 const old=engineBuildPlan(root,engine,Buffer.from('old patch')),next=engineBuildPlan(root,engine,Buffer.from('new patch'));
 assert.notEqual(old.root,next.root);await mkdir(next.source,{recursive:true});assert.equal(await readFile(join(root,'source','owner.txt'),'utf8'),'preserve');
 assert.throws(()=>engineBuildPlan(root,{...engine,patchSha256:'wrong'},Buffer.from('new patch')),/checksum/);
});

test('CUDA architecture follows the host rather than assuming Blackwell',()=>{
 assert.equal(cudaArchitecture('8.6\n'),'86');assert.equal(cudaArchitecture('8.9'),'89');assert.equal(cudaArchitecture('12.0'),'120a');
 assert.throws(()=>cudaArchitecture('not available'),/--arch/);assert.throws(()=>cudaArchitecture('9.0'),/not established/);
});
