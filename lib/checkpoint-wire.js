import {createHash} from 'node:crypto';
import {cacheHistoryPayload} from './cache-history.js';

/** Public pi-ai callbacks preserve its protocol handling; observe native slot metadata in SSE. */
export function checkpointApi(api,{history=false,receipt,beforeRequest}={}) {
 const wrap=method=>(model,context,options={})=>api[method](model,context,{
  ...options,
  onPayload:async(payload,target)=>{
   const selected=await options.onPayload?.(payload,target);
   let body=history?cacheHistoryPayload(selected??payload):{...(selected??payload)};
   if(options.sessionId){
    body={...body,prompt_cache_key:'dsh-'+createHash('sha256').update(String(options.sessionId)).digest('hex')};
    // This is metadata, not prompt text. It marks the reusable system/tool prefix.
    const first=body.messages?.[0];
    if(first?.role==='system'&&typeof first.content==='string')body={...body,messages:[{...first,content:[{type:'text',text:first.content,prompt_cache_breakpoint:{mode:'explicit'}}]},...body.messages.slice(1)]};
   }
   await beforeRequest?.(body);
   return body;
  },
  ...(receipt?{fetch:async(input,init)=>{
   receipt.slot=undefined;receipt.digest=undefined;
   const response=await (options.fetch??fetch)(input,init);
   if(!response.ok||!response.body||!response.headers.get('content-type')?.includes('text/event-stream'))return response;
   const decoder=new TextDecoder();let pending='';
   const observe=line=>{if(!line.startsWith('data:'))return;try{const data=JSON.parse(line.slice(5).trim());if(Number.isInteger(data.id_slot)&&data.id_slot>=0&&/^[a-f0-9]{16}$/.test(data.session_digest)){receipt.slot=data.id_slot;receipt.digest=data.session_digest;receipt.timings=data.timings;}}catch{}};
   const body=response.body.pipeThrough(new TransformStream({transform(chunk,controller){
    pending+=decoder.decode(chunk,{stream:true});let at;
    while((at=pending.indexOf('\n'))>=0){observe(pending.slice(0,at));pending=pending.slice(at+1);}
    if(pending.length>1048576)pending='';
    controller.enqueue(chunk);
   },flush(){pending+=decoder.decode();if(pending)observe(pending);}}));
   return new Response(body,{status:response.status,statusText:response.statusText,headers:response.headers});
  }}:{})
 });
 return {...api,stream:wrap('stream'),streamSimple:wrap('streamSimple')};
}
