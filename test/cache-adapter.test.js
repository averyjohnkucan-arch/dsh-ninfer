import test from 'node:test';import assert from 'node:assert/strict';import http from 'node:http';
import {LocalAdapter} from '../lib/adapter.js';import {freshProfile} from '../lib/profiles.js';import {SerialGate} from '../lib/kv-cache.js';
test('adapter brackets a real SSE stream with chat restore/save and skips auxiliary calls',async t=>{
 const events=[],state={ready:true,active:0};let fail=false;
 const server=http.createServer(async(req,res)=>{for await(const chunk of req){}if(fail){res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({error:{message:'invalid fixture request'}}));return;}res.writeHead(200,{'Content-Type':'text/event-stream'});for(const choices of [[{index:0,delta:{role:'assistant',content:'Hello'},finish_reason:null}],[{index:0,delta:{},finish_reason:'stop'}]])res.write('data: '+JSON.stringify({id:'fixture',object:'chat.completion.chunk',created:1,model:'fixture',choices,id_slot:0,session_digest:'1234567890abcdef'})+'\n\n');res.end('data: [DONE]\n\n');});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>server.close());
 const p=freshProfile('ninfer');p.id='fixture';p.kvCache=true;p.port=server.address().port;
 const runtime={engine:'ninfer',profiles:[p],acquire:async()=>({state,release:()=>events.push('release')}),onChange:()=>{},serverHeaders:()=>({}),cache:{gate:new SerialGate(),identity:async()=> 'model',digests:options=>options.messages.map(m=>m.role),base:async()=>{events.push('base');},restore:async(_s,session)=>events.push('restore '+session),save:async(_s,session,_i,_d,_h,receipt)=>{assert.equal(receipt.slot,0);assert.equal(receipt.digest,'1234567890abcdef');events.push('save '+session);},warn:()=>events.push('warning')}};
 const adapter=new LocalAdapter({get:()=>undefined},runtime,'NInfer'),call=await adapter.prepareCall('ninfer','fixture');
 const options={provider:'ninfer',model:'fixture',sessionId:'chat-a',messages:[{role:'user',content:[{type:'text',text:'Hi'}]}]};
 for await(const chunk of call.stream(options)){}assert.deepEqual(events,['base','restore chat-a','save chat-a','release']);assert.equal(state.active,0);
 events.length=0;for await(const chunk of call.stream({...options,purpose:'session-title'})){}assert.deepEqual(events,['release']);
 events.length=0;fail=true;try{for await(const chunk of call.stream(options)){}}catch{}assert.deepEqual(events,['base','restore chat-a','release']);assert.equal(state.active,0);
});
test('a cancelled waiter cannot decrement another inference call activity',async()=>{
 const p=freshProfile('ninfer');p.id='fixture';p.kvCache=true;
 const controller=new AbortController();controller.abort();
 const state={ready:true,active:1};let released=0;
 const runtime={engine:'ninfer',profiles:[p],acquire:async()=>({state,signal:controller.signal,release:()=>released++}),cache:{gate:new SerialGate()},onChange:()=>{}};
 const adapter=new LocalAdapter({get:()=>undefined},runtime,'NInfer');
 const call=await adapter.prepareCall('ninfer','fixture');
 await assert.rejects(async()=>{for await(const chunk of call.stream({sessionId:'cancelled',messages:[{role:'user',content:[{type:'text',text:'Hi'}]}]})){}},{name:'AbortError'});
 assert.equal(state.active,1);assert.equal(released,1);
});
