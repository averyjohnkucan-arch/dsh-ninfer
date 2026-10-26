import test from 'node:test';
import assert from 'node:assert/strict';
import {LocalAdapter} from '../lib/adapter.js';
import {freshProfile} from '../lib/profiles.js';

test('NInfer advertises image input for enabled native GPU and CPU vision profiles',async()=>{
 const profiles=[['q5_1',{'--vision':true,'--vision-residency':'resident'}],['q6_0',{'--vision':true,'--vision-residency':'cpu'}],['text',{}]].map(([id,options])=>({...freshProfile('ninfer'),id,options}));
 const adapter=new LocalAdapter({}, {engine:'ninfer',profiles}, 'NInfer');
 const models=await adapter.listModels('ninfer');
 assert.deepEqual(models.map(p=>p.inputModalities),[['text','image'],['text','image'],['text']]);
 profiles[0].enabled=false;
 assert.deepEqual((await adapter.listModels('ninfer')).map(p=>p.id),['q6_0','text']);
});
