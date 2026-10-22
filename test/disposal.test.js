import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {apply} from '../index.js';
test('late process and job notifications cannot update a disposed adapter during plugin reload',async t=>{
 const root=await mkdtemp(join(tmpdir(),'dsh-dispose-'));t.after(()=>rm(root,{recursive:true,force:true}));
 let adapter,released=false,updates=0;const cleanups=[];
 const ctx={inject:()=>{},on:()=>{},get:()=>{},effect:fn=>{const cleanup=fn();cleanups.push(cleanup);return cleanup;},llm:{registerAdapter:(_ids,a)=>{adapter=a;const handle=()=>{released=true;};handle.replace=()=>{if(released)throw Object.assign(new Error('disposed'),{code:'REGISTRATION_DISPOSED'});updates++;};return handle;}},webServer:{register:()=>()=>{}}};
 await apply(ctx,{dataDir:root});
 adapter.runtime.onChange();assert.equal(updates,1);
 // DSH may dispose its internally registered handle before plugin cleanup runs.
 released=true;assert.doesNotThrow(()=>adapter.runtime.onChange());
 assert.doesNotThrow(()=>adapter.runtime.onChange());
 for(const cleanup of cleanups.reverse())await cleanup();
 assert.doesNotThrow(()=>adapter.runtime.onChange());assert.equal(updates,1);
});
