"""Classify selected GGUF headers. Never read or copy tensor payloads."""
import json, pathlib, re, struct, sys
SIZES={0:1,1:1,2:2,3:2,4:4,5:4,6:4,7:1,10:8,11:8,12:8}
FORMATS={0:'B',1:'b',2:'H',3:'h',4:'I',5:'i',6:'f',7:'?',10:'Q',11:'q',12:'d'}
def inspect(path):
 path=pathlib.Path(path)
 if path.suffix.lower()=='.ninfer':return {'path':str(path),'kind':'ninfer','name':path.stem}
 with path.open('rb') as f:
  def take(n):
   data=f.read(n)
   if len(data)!=n:raise ValueError(f'{path.name}: truncated GGUF header')
   return data
  def number(fmt):return struct.unpack('<'+fmt,take(struct.calcsize('<'+fmt)))[0]
  def string(keep=True):
   n=number('Q')
   if n>64*1024*1024:raise ValueError('GGUF string exceeds inspection limit')
   if keep:return take(n).decode('utf8')
   f.seek(n,1)
  def value(kind,keep=True,depth=0):
   if depth>2:raise ValueError('GGUF nested metadata exceeds inspection limit')
   if kind==8:return string(keep)
   if kind==9:
    subtype=number('I');n=number('Q')
    if n>16000000:raise ValueError('GGUF array exceeds inspection limit')
    if subtype in SIZES:f.seek(n*SIZES[subtype],1)
    else:
     for _ in range(n):value(subtype,False,depth+1)
    return None
   if kind not in SIZES:raise ValueError('Unknown GGUF metadata type')
   val=number(FORMATS[kind]);return val if keep else None
  if take(4)!=b'GGUF':raise ValueError(f'{path.name}: not a GGUF file')
  version=number('I')
  if version not in (2,3):raise ValueError(f'{path.name}: unsupported GGUF version {version}')
  tensors=number('Q');nkv=number('Q')
  if tensors>2000000 or nkv>100000:raise ValueError('GGUF header exceeds inspection limits')
  metadata={}
  for _ in range(nkv):
   key=string();kind=number('I');keep=not key.startswith('tokenizer.');v=value(kind,keep)
   if keep and v is not None:metadata[key]=v
  names=[]
  for _ in range(tensors):
   name=string();dims=number('I')
   if dims>8:raise ValueError('Invalid GGUF tensor dimensions')
   f.seek(8*dims,1);tensor_type=number('I');number('Q');names.append(name)
   if name.endswith(('experts.gate_up_proj','experts.down_proj')):metadata['dsh.mtp.'+name]=tensor_type
 arch=metadata.get('general.architecture','');name=str(metadata.get('general.name',path.stem))
 projector=arch=='clip' or any(k.startswith('clip.') for k in metadata) or any(n.startswith(('v.patch_embd','mm.','v.blk.','vision.')) for n in names)
 mtp=any(n.startswith('mtp.') for n in names)
 blocks={m.group(1) for n in names if (m:=re.match(r'blk\.(\d+)\.',n))}
 if not mtp and len(blocks)<=1 and any('nextn' in n for n in names):mtp=True
 kind='projector' if projector else 'mtp' if mtp else 'model'
 split=int(metadata.get('split.count',1));index=int(metadata.get('split.no',0))
 match=re.match(r'^(.*)-(\d{5})-of-(\d{5})\.gguf$',path.name,re.I)
 if match:group=str(path.parent/match.group(1));split=int(match.group(3));index=int(match.group(2))-1
 else:group=str(path)
 return {'path':str(path),'kind':kind,'name':name,'architecture':arch,'group':group,'shardIndex':index,'shardCount':split,'tensorCount':tensors,'embeddedMtp':any('nextn' in n for n in names) and kind=='model','mtpImportSupported':kind!='mtp' or metadata.get('strata.mtp.expert_format')=='q2_0' or all(metadata.get('dsh.mtp.'+n)==42 for n in ['mtp.layers.0.mlp.experts.gate_up_proj','mtp.layers.0.mlp.experts.down_proj'])}
def assign(paths):
 if not isinstance(paths,list) or not paths or len(paths)>1024:raise ValueError('Select between 1 and 1024 model files')
 items=[inspect(str(pathlib.Path(p).absolute())) for p in dict.fromkeys(paths)]
 groups={}
 for x in items:
  if x['kind']=='model':groups.setdefault(x['group'],[]).append(x)
 if len(groups)>1:raise ValueError('Selection contains more than one main model or quantization. Select one model set and its optional MTP/projector.')
 result={};warnings=[]
 if groups:
  shards=next(iter(groups.values()));shards.sort(key=lambda x:x['shardIndex']);expected=shards[0]['shardCount'];indices={x['shardIndex'] for x in shards}
  if len(indices)!=len(shards):raise ValueError('Duplicate shard indices in selected model set')
  missing=[i+1 for i in range(expected) if i not in indices]
  if missing:warnings.append('Missing model shards: '+', '.join(map(str,missing)))
  if 0 not in indices:warnings.append('Select the first model shard before importing.')
  result.update(modelPath=shards[0]['path'],modelFiles=[x['path'] for x in shards])
  if shards[0]['name']:result['suggestedName']=shards[0]['name']
 for role,key in [('projector','projectorPath'),('mtp','mtpPath'),('ninfer','modelPath')]:
  candidates=[x for x in items if x['kind']==role]
  if len(candidates)>1:raise ValueError('Multiple '+role+' files were selected; choose the one to use.')
  if candidates:
   result[key]=candidates[0]['path']
   if role=='mtp' and not candidates[0]['mtpImportSupported']:warnings.append('Selected MTP GGUF is not the packed Q2_0 MTP format accepted by Strata. Choose a prepared runtime or a supported packed MTP GGUF before importing.')
 if not result:raise ValueError('No model, projector or MTP artifact recognized')
 return {'assignments':result,'files':items,'warnings':warnings,'complete':not warnings}
if __name__=='__main__':
 try:print(json.dumps(assign(json.load(sys.stdin))))
 except Exception as e:print(str(e),file=sys.stderr);sys.exit(1)
