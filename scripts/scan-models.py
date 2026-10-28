"""Find NInfer model artifacts recursively without loading model weights."""
import importlib.util
import json
import os
from pathlib import Path
import sys

spec=importlib.util.spec_from_file_location('inspect_files',Path(__file__).with_name('inspect-files.py'))
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

def scan(root):
 root=Path(root).expanduser()
 if not root.is_absolute() or not root.is_dir():raise ValueError('Choose an existing absolute folder')
 if root.resolve()==Path(root.anchor):raise ValueError('Choose a model folder instead of the entire filesystem.')
 pending=[root];seen=set();models=[];errors=[];error_count=0
 def record_error(path,error):
  nonlocal error_count
  error_count+=1
  if len(errors)<100:errors.append({'path':str(path),'error':str(error)})
 while pending:
  directory=pending.pop()
  try:
   info=directory.stat();key=(info.st_dev,info.st_ino)
   if key in seen:continue
   seen.add(key)
   with os.scandir(directory) as entries:
    for entry in entries:
     try:
      if entry.is_dir():pending.append(Path(entry.path))
      elif entry.is_file() and entry.name.lower().endswith('.ninfer'):
       with open(entry.path,'rb') as stream:magic=stream.read(8)
       if magic==b'NINPRT\0\3':continue
       models.append(module.inspect(entry.path))
       if len(models)>10000:raise ValueError('Too many artifacts; choose a smaller folder')
     except (OSError,ValueError,json.JSONDecodeError) as error:record_error(entry.path,error)
  except OSError as error:record_error(directory,error)
 return {'root':str(root),'models':sorted(models,key=lambda x:x['name'].casefold()),'errors':errors,'errorCount':error_count}

if __name__=='__main__':
 try:print(json.dumps(scan(sys.argv[1])))
 except Exception as error:print(str(error),file=sys.stderr);sys.exit(1)
