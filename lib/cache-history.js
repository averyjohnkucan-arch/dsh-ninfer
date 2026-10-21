/** Keep changing tool declarations at their historical positions, not in the prefix header.
 * Requires assets/qwen3_8-cache.jinja. The ordinary tools field remains the server's
 * validation/grammar catalog; the template reads positional declarations from messages.
 */
import {fileURLToPath} from 'node:url';
export const cacheHistoryTemplate=fileURLToPath(new URL('../assets/qwen3_8-cache.jinja',import.meta.url));

export function cacheHistoryPayload(payload) {
 const initial=payload.tools??[];
 const catalog=new Map();
 const add=tool=>{
  if(tool.type!=='function'||!tool.function?.name)throw new Error('NInfer cache history supports function tools only.');
  catalog.set(tool.function.name,tool);
 };
 initial.forEach(add);
 const declaration=tools=>'<tools>\n'+tools.map(tool=>JSON.stringify(tool)).join('\n')+'\n</tools>';
 const messages=(payload.messages??[]).map(message=>{
  if(!message.tools)return {...message};
  if(message.role!=='system')throw new Error('Positional tool declarations require a system message.');
  message.tools.forEach(add);
  const {tools,...rest}=message;
  if(rest.content!=null&&typeof rest.content!=='string')throw new Error('Positional tool update content must be text.');
  return {...rest,content:[rest.content,declaration(tools)].filter(Boolean).join('\n\n')};
 });
 if(initial.length){
  if(messages[0]?.role==='system'){
   if(messages[0].content!=null&&typeof messages[0].content!=='string')throw new Error('Initial system content must be text.');
   messages[0]={...messages[0],content:[messages[0].content,declaration(initial)].filter(Boolean).join('\n\n')};
  }else messages.unshift({role:'system',content:declaration(initial)});
 }
 return {...payload,messages,...(catalog.size?{tools:[...catalog.values()]}:{})};
}

/** Use pi-ai's public payload callback, retaining its streaming and attachment implementation. */
export function cacheHistoryApi(api) {
 const wrap=method=>(model,context,options={})=>api[method](model,context,{...options,onPayload:async(payload,target)=>{
  const selected=await options.onPayload?.(payload,target);
  return cacheHistoryPayload(selected??payload);
 }});
 return {...api,stream:wrap('stream'),streamSimple:wrap('streamSimple')};
}
