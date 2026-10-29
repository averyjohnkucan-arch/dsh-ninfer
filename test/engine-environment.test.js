import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {engineEnvironment} from '../lib/engine-environment.js';

test('private-loader runtime cannot mix its glibc into the host launcher shell',async t=>{
  const root=await mkdtemp(join(tmpdir(),'ninfer-loader-env-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  await writeFile(join(root,'bundled-loader'),'glibc\n');
  const inherited={LD_LIBRARY_PATH:'/old/runtime',NINFER_DEVICE_PROFILES:'/profile.json'};
  const env=await engineEnvironment(join(root,'ninfer-serve'),inherited);
  assert.equal(env.LD_LIBRARY_PATH,undefined);
  assert.equal(env.NINFER_DEVICE_PROFILES,inherited.NINFER_DEVICE_PROFILES);
  assert.equal(inherited.LD_LIBRARY_PATH,'/old/runtime');
  assert.equal({...inherited,...env}.LD_LIBRARY_PATH,undefined);
});

test('ordinary ELF runtime prepends its private libraries and preserves an explicit library path',async t=>{
  const root=await mkdtemp(join(tmpdir(),'ninfer-elf-env-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const compat=join(root,'compat/usr/lib/x86_64-linux-gnu');
  await mkdir(compat,{recursive:true});
  const env=await engineEnvironment(join(root,'ninfer-serve'),{LD_LIBRARY_PATH:'/custom/cuda'});
  assert.equal(env.LD_LIBRARY_PATH,compat+':/custom/cuda');
});
