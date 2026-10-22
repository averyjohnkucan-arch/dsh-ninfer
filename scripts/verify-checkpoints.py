#!/usr/bin/env python3
"""Two-process native KV qualification. Run capture, restart the server, then restore.
Uses only public local HTTP endpoints; writes a small report and one named test snapshot.
"""
import argparse,json,time,urllib.request
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('phase',choices=['baseline','capture','restore','cold']);p.add_argument('--url',required=True);p.add_argument('--model',required=True);p.add_argument('--engine',choices=['ninfer','strata'],default='ninfer');p.add_argument('--report',required=True);a=p.parse_args()
report=Path(a.report)
def open_request(req):
 try:return urllib.request.urlopen(req,timeout=600)
 except urllib.error.HTTPError as error:raise RuntimeError(error.read().decode()) from None

def request(path,body=None):
 req=urllib.request.Request(a.url+path,data=None if body is None else json.dumps(body).encode(),headers={'Content-Type':'application/json'})
 return json.load(open_request(req))
def generate(messages):
 body={'model':a.model,'messages':messages,'temperature':0,'seed':17,'max_tokens':64,'stream':True,'stream_options':{'include_usage':True},'chat_template_kwargs':{'enable_thinking':False}}
 if a.engine=='ninfer':body['prompt_cache_key']='dsh-qualification'
 else:body['strata_prefix']={'messages':1}
 start=time.monotonic();first=None;content='';metadata={};reasoning=''
 req=urllib.request.Request(a.url+'/v1/chat/completions',data=json.dumps(body).encode(),headers={'Content-Type':'application/json'})
 with open_request(req) as response:
  for line in response:
   if not line.startswith(b'data:'):continue
   data=line[5:].strip()
   if data==b'[DONE]':break
   chunk=json.loads(data)
   if chunk.get('error'):raise RuntimeError(chunk['error'])
   for key in ['timings','usage','id_slot','session_digest']:
    if key in chunk:metadata[key]=chunk[key]
   for choice in chunk.get('choices',[]):
    delta=choice.get('delta',{});text=delta.get('content') or '';think=delta.get('reasoning_content') or ''
    if (text or think) and first is None:first=time.monotonic()-start
    content+=text;reasoning+=think
 return {'content':content,'reasoning':reasoning,'first_token_seconds':first,'wall_seconds':time.monotonic()-start,**metadata}
def save_receipt(reply):
 body={'filename':'dsh-qualification.kv'}
 if a.engine=='ninfer':body['if_digest']=reply['session_digest']
 return request('/slots/'+str(reply.get('id_slot',0))+'?action=save',body)
def cached(result):
 t=result.get('timings',{});u=result.get('usage',{})
 return t.get('cache_n',u.get('prompt_tokens_details',{}).get('cached_tokens',0))
system='You are a precise assistant. Follow the current user instruction.\n'+''.join(f'Reference entry {i}: the blue archive stores item {i} on shelf {i%19}.\n' for i in range(160))
head={'role':'system','content':([{'type':'text','text':system,'prompt_cache_breakpoint':{'mode':'explicit'}}] if a.engine=='ninfer' else system)}
initial=[head,{'role':'user','content':'Reply with the single word ALPHA.'}]
new_chat=[head,{'role':'user','content':'Translate screwdriver into Spanish. Reply with just the Spanish word.'}]
if a.phase in ('baseline','capture'):
 first=generate(initial);saved=save_receipt(first) if a.phase=='capture' else None
 continuation=initial+[{'role':'assistant','content':first['content']},{'role':'user','content':'Write the integers from 1 through 30, separated by commas.'}]
 expected=generate(continuation)
 data={'engine':a.engine,'model':a.model,'first':first,'save':saved,'continuation':continuation,'expected':expected}
 report.write_text(json.dumps(data,indent=2));print(json.dumps({'phase':a.phase,'first':first,'save':saved,'expected':expected},indent=2))
elif a.phase=='restore':
 data=json.loads(report.read_text());start=time.monotonic();restored=request('/slots/0?action=restore',{'filename':'dsh-qualification.kv'});restore_wall=time.monotonic()-start
 actual=generate(data['continuation'])
 data.update(restored=restored,restore_wall_seconds=restore_wall,actual=actual);report.write_text(json.dumps(data,indent=2))
 assert actual['content']==data['expected']['content'], 'Restored continuation differs from uninterrupted greedy continuation'
 assert cached(actual)>0, 'Continuation did not reuse any native prefix'
 request('/slots/0?action=restore',{'filename':'dsh-qualification.kv'})
 fresh=generate(new_chat)
 data['fresh']=fresh;report.write_text(json.dumps(data,indent=2))
 assert cached(fresh)>1000, 'Fresh chat failed to reuse the shared system prefix'
 print(json.dumps({k:data[k] for k in ['restored','restore_wall_seconds','actual','fresh']},indent=2))
else:
 data=json.loads(report.read_text());cold=generate(new_chat);assert cold['content']==data['fresh']['content'], 'Fresh chat with shared cache differs from cold new chat'
 data['cold']=cold;report.write_text(json.dumps(data,indent=2));print(json.dumps({'cold':cold,'verified':True},indent=2))
