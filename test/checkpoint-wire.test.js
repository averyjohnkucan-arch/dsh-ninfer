import test from 'node:test';
import assert from 'node:assert/strict';
import {checkpointApi} from '../lib/checkpoint-wire.js';

test('new chats retain identical shared policy text and receive independent private anchors',async()=>{
 const calls=[];const api={stream:(_m,_c,options)=>options.onPayload({messages:[{role:'system',content:'Policy and tools'},{role:'user',content:'Hello'}]})};
 const wrapped=checkpointApi(api);
 calls.push(await wrapped.stream({}, {},{sessionId:'a'}),await wrapped.stream({}, {},{sessionId:'b'}));
 assert.deepEqual(calls[0].messages,calls[1].messages);
 assert.deepEqual(calls[0].messages[0].content,[{type:'text',text:'Policy and tools',prompt_cache_breakpoint:{mode:'explicit'}}]);
 assert.notEqual(calls[0].prompt_cache_key,calls[1].prompt_cache_key);
 assert.equal((await wrapped.stream({}, {},{})).prompt_cache_key,undefined);
});

test('native receipt observation preserves every streamed byte across arbitrary transport splits',async()=>{
 const receipt={},body='data: {"choices":[{"delta":{"content":"hello"}}]}\n\ndata: {"id_slot":3,"session_digest":"1234567890abcdef","timings":{"predicted_ms":10}}\n\ndata: [DONE]\n\n';
 const api={stream:async(_m,_c,options)=>{const response=await options.fetch('http://localhost/v1/chat/completions',{});return response.text();}};
 const fetch=async()=>new Response(new ReadableStream({start(controller){for(let i=0;i<body.length;i+=7)controller.enqueue(new TextEncoder().encode(body.slice(i,i+7)));controller.close();}}),{headers:{'content-type':'text/event-stream'}});
 assert.equal(await checkpointApi(api,{receipt}).stream({}, {},{fetch}),body);
 assert.equal(receipt.slot,3);assert.equal(receipt.digest,'1234567890abcdef');
});
