import z from '@deepseek-ai/schemastery';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { Runtime } from './lib/runtime.js';
import { LocalAdapter } from './lib/adapter.js';
import { approveEscalation } from '@deepseek-ai/dsh-sandbox';
import { defineTool } from '@deepseek-ai/dsh-tools';
export const inject = ['llm','webServer'];
export const Config=z.object({dataDir:z.string().description('Plugin-owned profiles, engine and tuning data directory.').default('')});
export async function apply(ctx, config) {
 const id='ninfer', title='NInfer';
 const token=randomBytes(32).toString('hex');
 let registration;
 const runtime=new Runtime(id,config,()=>{try{registration?.replace([id]);}catch(error){if(error.code==='REGISTRATION_DISPOSED')registration=undefined;else throw error;}});
 await runtime.init();
 // Optional scheduler service. Each engine remains usable on its own.
 ctx.inject(['modelScheduler'],scope=>{
  const scheduler=scope.get('modelScheduler');
  scope.effect(()=>{runtime.scheduler=scheduler;const unregister=scheduler.registerProvider(id,()=>runtime.profiles.map(p=>runtime.driver(p)));return async()=>{unregister();try{await Promise.all(runtime.profiles.map(p=>scheduler.unload(id+':'+p.id,{force:true})));}finally{if(runtime.scheduler===scheduler)runtime.scheduler=null;}};});
 });
 ctx.effect(()=>{const owned=ctx.llm.registerAdapter([id],new LocalAdapter(ctx,runtime,title));registration=owned;return()=>{if(registration===owned)registration=undefined;owned();};});
 ctx.on('webserver/index-inject',table=>table.push({kind:'global',name:'__DSH_NINFER__',value:{path:'/plugins/dsh-ninfer/action',token}}));
 ctx.effect(()=>ctx.webServer.register({kind:'exact',path:'/plugins/dsh-ninfer/action',handler:async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json');
  const bearer=(req.headers.authorization||'').replace(/^Bearer /,'');
  const a=Buffer.from(bearer),b=Buffer.from(token);
  if(a.length!==b.length||!timingSafeEqual(a,b)){res.writeHead(401);res.end(JSON.stringify({error:'Owner capability required.'}));return;}
  if(req.method!=='POST'||!String(req.headers['content-type']).startsWith('application/json')){res.writeHead(405);res.end(JSON.stringify({error:'POST JSON required.'}));return;}
  if(req.headers.origin&&req.headers.origin!==ctx.webServer.getOrigin()){res.writeHead(403);res.end(JSON.stringify({error:'Origin refused.'}));return;}
  try{let body='',size=0;for await(const chunk of req){size+=chunk.length;if(size>2097152)throw new Error('Request exceeds 2 MiB.');body+=chunk;}const {action,payload}=JSON.parse(body);const result=await runtime.action(action,payload);res.end(JSON.stringify({result}));}
  catch(e){res.writeHead(400);res.end(JSON.stringify({error:e.message}));}
 }}));
 ctx.inject(['tools','sandboxPolicy'],tools=>{tools.effect(()=>tools.tools.register(defineTool({name:'ninfer_models',description:'Manage saved NInfer inference profiles. List, create, save, browse model files, import, start, stop, inspect GPU, or cancel a job. Operations share the settings card implementation.',parameters:{action:{type:'string',required:true,description:'Operation name.'},payload:{type:'string',description:'JSON object with operation parameters.',default:'{}'}},output:{schema:{type:'string'},render:(_args,value)=>[{type:'text',text:value}]},execute:async({action,payload},exec)=>{const policy=tools.sandboxPolicy.resolve(exec.agent?{session:exec.agent.session}:{});await approveEscalation({requestedMode:'danger-full-access',effectiveMode:policy.mode,subject:'local inference engine management',justification:'Manage saved engine profiles and local host processes through '+id+'.'},{approver:tools.get('approval'),agent:exec.agent,callId:exec.callId,toolName:id+'_models',signal:exec.signal});exec.signal.throwIfAborted();return JSON.stringify(await runtime.action(action,JSON.parse(payload||'{}'))); }})));});
 ctx.effect(()=>()=>runtime.dispose());
}
