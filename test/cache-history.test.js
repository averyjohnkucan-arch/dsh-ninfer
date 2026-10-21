import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {cacheHistoryPayload,cacheHistoryTemplate} from '../lib/cache-history.js';
import {LocalAdapter} from '../lib/adapter.js';
import {freshProfile,validateProfile} from '../lib/profiles.js';

const tool=name=>({type:'function',function:{name,description:name+' description',parameters:{type:'object',properties:{value:{type:'string'}},required:['value']}}});
const text=text=>({type:'text',text});
const user=value=>({role:'user',content:[text(value)]});
const assistant=value=>({id:'assistant-1',role:'assistant',content:[text(value)],source:{provider:'ninfer',model:'fixture'}});

test('positional declarations retain the original prefix and register added tools for native validation',()=>{
 const initial=tool('initial'),late=tool('late');
 const first={messages:[{role:'system',content:'Stable policy'},{role:'user',content:'Hello'}],tools:[initial]};
 const second={messages:[...first.messages,{role:'assistant',content:'Hi'},{role:'system',tools:[late]},{role:'system',content:'New knowledge at this point'},{role:'user',content:'Next'}],tools:[initial]};
 const before=structuredClone(second);
 const a=cacheHistoryPayload(first),b=cacheHistoryPayload(second);
 assert.deepEqual(b.messages.slice(0,a.messages.length),a.messages);
 assert.deepEqual(b.tools,[initial,late]);
 assert.ok(!b.messages[0].content.includes('late description'));
 assert.ok(b.messages[3].content.includes('late description'));
 assert.ok(b.messages.every(m=>!('tools'in m)),'stock NInfer refuses the nonstandard message.tools field');
 assert.deepEqual(second,before,'transport conversion must not modify durable history');
 assert.equal(b.messages[4].content,'New knowledge at this point');
});

test('tool discovery after an initially tool-free turn does not insert a new leading message',()=>{
 const first={messages:[{role:'user',content:'Hello'}]};
 const second={messages:[...first.messages,{role:'assistant',content:'Hi'},{role:'system',tools:[tool('late')]},{role:'user',content:'Next'}]};
 assert.deepEqual(cacheHistoryPayload(second).messages.slice(0,1),cacheHistoryPayload(first).messages);
 assert.equal(cacheHistoryPayload(second).tools[0].function.name,'late');
});

test('cache history cannot be enabled with a template that re-injects the changing catalog at the front',()=>{
 const p=freshProfile('ninfer');p.cacheStableHistory=true;
 assert.throws(()=>validateProfile(p),/requires the bundled/);
 p.options['--chat-template']=cacheHistoryTemplate;p.options['--preserve-thinking']=true;
 assert.equal(validateProfile(p).cacheStableHistory,true);
});

async function fixture(t,enabled){
 const bodies=[];
 const server=http.createServer(async(req,res)=>{
  let input='';for await(const part of req)input+=part;
  bodies.push(JSON.parse(input));
  res.writeHead(200,{'Content-Type':'text/event-stream'});
  const base={id:'fixture',object:'chat.completion.chunk',created:1,model:'fixture'};
  res.write('data: '+JSON.stringify({...base,choices:[{index:0,delta:{role:'assistant',content:'Hi'},finish_reason:null}]})+'\n\n');
  res.write('data: '+JSON.stringify({...base,choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:10,completion_tokens:1,total_tokens:11}})+'\n\n');
  res.end('data: [DONE]\n\n');
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>server.close());
 const p=freshProfile('ninfer');p.id='fixture';p.port=server.address().port;p.cacheStableHistory=enabled;
 p.reasoning={efforts:[{id:'off',name:'Off',value:'off'}],defaultEffort:'off'};
 if(enabled)Object.assign(p.options,{'--chat-template':cacheHistoryTemplate,'--preserve-thinking':true});
 const runtime={engine:'ninfer',profiles:[p],acquire:async()=>({state:{active:0},release:()=>{}})};
 const adapter=new LocalAdapter({get:()=>undefined},runtime,'NInfer');
 const prepared=await adapter.prepareCall('ninfer','fixture');
 const call=async messages=>{
  for await(const chunk of prepared.stream({provider:'ninfer',model:'fixture',system:'Stable base policy',messages,maxTokens:8,tools:[{name:'initial',description:'Base tool',parameters:{type:'object'}},{name:'late',description:'Later discovered tool',parameters:{type:'object'},deferLoading:true}]})){
   assert.notEqual(chunk.kind,'error',JSON.stringify(chunk));
  }
 };
 return {bodies,prepared,call};
}

test('installed DSH/pi-ai route anchors system and tool updates instead of rewriting the original prefix',async t=>{
 const {bodies,prepared,call}=await fixture(t,true);
 assert.equal(prepared.model.systemPromptUpdate,'in-history');
 assert.equal(prepared.model.toolUpdate,'addition-only');
 await call([user('Hello')]);
 await call([user('Hello'),assistant('Hi'),{id:'update-1',role:'developer',content:[text('New retrieved knowledge'),{type:'tool-addition',toolName:'late'}]},user('Next')]);
 const [first,second]=bodies;
 assert.deepEqual(second.messages.slice(0,first.messages.length),first.messages);
 assert.equal(second.tools.length,2);
 assert.ok(second.messages.slice(first.messages.length).some(m=>m.content?.includes('Later discovered tool')));
 assert.ok(second.messages.slice(first.messages.length).some(m=>m.content?.includes('New retrieved knowledge')));
 assert.ok(!second.messages[0].content.includes('Later discovered tool'));
 assert.ok(second.messages.every(m=>!m.tools));
});

test('the old capability declaration reproduces the prefix rewrite on the same system update',async t=>{
 const {bodies,call}=await fixture(t,false);
 await call([user('Hello')]);
 await call([user('Hello'),assistant('Hi'),{id:'system-update',role:'system',content:[text('New retrieved knowledge')]},user('Next')]);
 assert.notDeepEqual(bodies[0].messages[0],bodies[1].messages[0]);
 assert.ok(bodies[1].messages[0].content.includes('New retrieved knowledge'));
});
