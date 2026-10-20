/** Per-profile reasoning metadata, using DSH/pi-ai's supported effort identities. */
export const effortIds = ['off','minimal','low','medium','high','xhigh','max'];
export function qwen38Reasoning(){return {efforts:[
 {id:'low',name:'Low',value:'low'},
 {id:'medium',name:'Medium',value:'medium'},
 {id:'xhigh',name:'XHigh',value:'xhigh'},
],defaultEffort:'medium'};}
export function profileReasoning(profile){
 const setting=profile.reasoning??(/qwen[\s._-]*3[._-]*8|3[._-]*8[\s._-]*flash[\s._-]*next/i.test([profile.name,profile.modelId,profile.modelPath,profile.options?.['--model-id']].filter(Boolean).join(' '))?qwen38Reasoning():{efforts:[],defaultEffort:''});
 if(!setting || !Array.isArray(setting.efforts))throw new Error('Reasoning must contain an efforts list.');
 const seen=new Set();
 const efforts=setting.efforts.map(row=>{
  if(!row || typeof row.id!=='string'||! /^[a-zA-Z0-9_-]{1,80}$/.test(row.id) || seen.has(row.id))throw new Error('Reasoning levels must have unique IDs containing letters, numbers, underscores or hyphens.');
  seen.add(row.id);
  if(typeof row.name!=='string'||!row.name.trim()||row.name.length>80)throw new Error('Each reasoning level needs a display name of up to 80 characters.');
  if(typeof row.value!=='string'||!row.value.trim()||row.value.length>100||/[\r\n]/.test(row.value))throw new Error('Each reasoning level needs a non-empty backend value.');
  return {id:row.id,name:row.name.trim(),value:row.value.trim()};
 });
 const defaultEffort=setting.defaultEffort??'';
 if(defaultEffort!==''&&!seen.has(defaultEffort))throw new Error('The default reasoning level must be one of the available levels.');
 return {efforts,defaultEffort};
}
/** pi-ai transports a single selected wire value; DSH keeps the producer's opaque IDs. */
export function reasoningModelFields(profile){
 const {efforts,defaultEffort}=profileReasoning(profile);
 const selected=efforts.find(row=>row.id===defaultEffort)??efforts[0];
 return {reasoning:efforts.length>0,thinkingLevelMap:Object.fromEntries(effortIds.map(id=>[id,id==='medium'?(selected?.value??null):null]))};
}
export function selectedReasoningProfile(profile,requested){
 const config=profileReasoning(profile);
 const id=requested??(config.defaultEffort||undefined);
 if(id===undefined)return {...profile,reasoning:{efforts:[],defaultEffort:''}};
 const row=config.efforts.find(row=>row.id===id);
 if(!row)throw new Error(`Unsupported reasoning effort: ${id}`);
 return {...profile,reasoning:{efforts:[{...row,id:'medium'}],defaultEffort:'medium'}};
}
export function withReasoningInfo(info,profile){
 const {efforts,defaultEffort}=profileReasoning(profile);
 const {reasoning,...rest}=info;
 return efforts.length?{...rest,reasoning:{efforts:efforts.map(({id,name})=>({id,name})),...(defaultEffort?{defaultEffort}:{})}}:rest;
}
