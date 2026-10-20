import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { LocalAdapter } from '../lib/adapter.js';
import { freshProfile,validateProfile } from '../lib/profiles.js';
import { profileReasoning,qwen38Reasoning } from '../lib/reasoning.js';

test('Qwen3.8 profiles default to low, medium, xhigh with medium selected',()=>{
 const p=freshProfile('ninfer');p.name='Qwen3.8 Flash Next · Gyro Large';
 assert.deepEqual(validateProfile(p).reasoning,qwen38Reasoning());
 p.name='Other model';assert.deepEqual(profileReasoning(p).efforts,[]);
 p.reasoning={efforts:[],defaultEffort:''};p.name='Qwen3.8';assert.equal(profileReasoning(p).efforts.length,0);
});
test('custom names and wire values persist; invalid defaults and duplicate IDs fail',()=>{
 const p=freshProfile('ninfer');p.reasoning={efforts:[{id:'quick',name:'Quick',value:'low'},{id:'deep',name:'Thorough',value:'xhigh'}],defaultEffort:'quick'};
 assert.deepEqual(validateProfile(JSON.parse(JSON.stringify(p))).reasoning,p.reasoning);
 p.reasoning.defaultEffort='missing';assert.throws(()=>validateProfile(p),/default reasoning/);
 p.reasoning.defaultEffort='quick';p.reasoning.efforts.push(p.reasoning.efforts[0]);assert.throws(()=>validateProfile(p),/unique/);
});
for(const engine of ['ninfer','strata'])test(`${engine}: advertises custom names and sends the selected backend value over HTTP`,async t=>{
 const bodies=[];
 const server=http.createServer(async(req,res)=>{
  let body='';for await(const chunk of req)body+=chunk;
  bodies.push(JSON.parse(body));
  res.writeHead(200,{'Content-Type':'text/event-stream'});
  res.write('data: '+JSON.stringify({id:'test',object:'chat.completion.chunk',created:1,model:'fixture',choices:[{index:0,delta:{role:'assistant',content:'OK'},finish_reason:null}]})+'\n\n');
  res.write('data: '+JSON.stringify({id:'test',object:'chat.completion.chunk',created:1,model:'fixture',choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}})+'\n\n');res.end('data: [DONE]\n\n');
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>server.close());
 const p=freshProfile(engine);p.id='fixture';p.port=server.address().port;p.reasoning=qwen38Reasoning();
 const runtime={engine,profiles:[p],start:async()=>({active:0})};
 const adapter=new LocalAdapter({get:()=>undefined},runtime,engine);
 const info=await adapter.resolveModel(engine,p.id);
 assert.deepEqual(info.reasoning,{efforts:[{id:'low',name:'Low'},{id:'medium',name:'Medium'},{id:'xhigh',name:'XHigh'}],defaultEffort:'medium'});
 const prepared=await adapter.prepareCall(engine,p.id);
 for(const level of [undefined,'low','medium','xhigh']){
  const options=Object.freeze({provider:engine,model:p.id,messages:[{role:'user',content:[{type:'text',text:'Hello'}]}],maxTokens:4,...(level?{reasoningEffort:level}:{})});
  for await(const chunk of prepared.stream(options))assert.notEqual(chunk.kind,'error',JSON.stringify(chunk));
  assert.equal(bodies.at(-1).reasoning_effort,level??'medium');
 }
 p.reasoning={efforts:[{id:'quick',name:'Fast answer',value:'low'},{id:'slow',name:'Deep analysis',value:'xhigh'}],defaultEffort:'quick'};
 const custom=await adapter.prepareCall(engine,p.id);
 assert.equal(custom.model.reasoning.efforts[1].name,'Deep analysis');
 for await(const chunk of custom.stream({provider:engine,model:p.id,messages:[{role:'user',content:[{type:'text',text:'Hello'}]}],reasoningEffort:'slow'}))assert.notEqual(chunk.kind,'error',JSON.stringify(chunk));
 assert.equal(bodies.at(-1).reasoning_effort,'xhigh');
 await assert.rejects(async()=>{for await(const chunk of custom.stream({provider:engine,model:p.id,messages:[],reasoningEffort:'missing'})){}},/Unsupported reasoning effort/);
});
