import { LlmAdapter, LlmError, resolveRetryPolicy, resolveImageAttachmentAccess } from '@deepseek-ai/dsh-llm';
import { PiAiAdapter } from '@deepseek-ai/dsh-llm-pi-ai';
import { createProvider } from '@earendil-works/pi-ai';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';
export const wireId=p=>String(p.modelId || p.options?.['--model-id'] || p.id);
export class LocalAdapter extends LlmAdapter {
 constructor(ctx,runtime,title){super();this.ctx=ctx;this.runtime=runtime;this.title=title;}
 providerInfo(provider){return{id:provider,name:this.title};}
 profile(model){const p=this.runtime.profiles.find(x=>wireId(x)===model&&x.enabled!==false);if(!p)throw new LlmError('Saved model profile not found.','UNKNOWN_MODEL');return structuredClone(p);}
 delegate(provider,p){
  const vision=this.runtime.engine==='strata'?!!p.projectorPath&&p.visionDevice!=='off':!!(p.options['--vision']||p.options['--vision-cpu']);
  const model={id:wireId(p),name:p.name,api:'openai-completions',provider,baseUrl:`http://127.0.0.1:${p.port}/v1`,reasoning:false,input:vision?['text','image']:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:p.context,maxTokens:Math.min(p.context,p.maxTokens||32768),compat:{supportsDeveloperRole:false,supportsStore:false}};
  const piProvider=createProvider({id:provider,name:this.title,baseUrl:model.baseUrl,auth:{apiKey:{name:this.title,resolve:async()=>({auth:{}})}},models:[model],api:openAICompletionsApi()});
  const resolved={provider,displayName:this.title,piProvider,modelErrors:new Map(),configuredMaxTokens:new Map(),streamIdleTimeoutMs:900000,maxRequestImageBytes:20*1024*1024,requestImagePixelBudget:4*1024*1024,requestImageMaxBytes:1024*1024,retryPolicy:resolveRetryPolicy(),headers:{}};
  const profiles=new Map([[provider,resolved]]);
  return new PiAiAdapter({profiles:()=>profiles,resolveApiKey:async()=>p.options?.['--api-key']||p.serverConfig?.api_key||'dsh-local',auth:{credentials:{read:async()=>undefined,list:async()=>[],modify:async()=>{throw new Error('Local engine credentials are not stored.');},delete:async()=>{}},authContext:{env:async()=>undefined,fileExists:async()=>false}},resolveAttachments:()=>this.ctx.get('attachments'),resolveImageAccess:(attachments,ref)=>resolveImageAttachmentAccess(attachments,path=>this.ctx.get('fs')?.processPathFromHostPath(path),ref)});
 }
 async listModels(provider){return this.runtime.profiles.filter(p=>p.enabled!==false).map(p=>({provider,id:wireId(p),name:p.name,inputModalities:this.runtime.engine==='strata'&&p.projectorPath&&p.visionDevice!=='off'?['text','image']:['text']}));}
 async resolveModel(provider,model,signal){const p=this.profile(model);return this.delegate(provider,p).resolveModel(provider,model,signal);}
 async prepareCall(provider,model,signal){const p=this.profile(model);const delegate=this.delegate(provider,p);const prepared=await delegate.prepareCall(provider,model,signal);const runtime=this.runtime;return{model:prepared.model,async *stream(options){const state=await runtime.start(p.id,{profile:p,signal:options.signal});state.active=(state.active||0)+1;try{yield*prepared.stream(options);}finally{state.active--;}}};}
 async *stream(options){const call=await this.prepareCall(options.provider,options.model,options.signal);yield*call.stream(options);}
}
