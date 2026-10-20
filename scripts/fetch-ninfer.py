"""Fetch the tested NInfer runtime from its digest-verified OCI layer."""
import argparse,hashlib,json,pathlib,tarfile,urllib.request,shutil,subprocess
p=argparse.ArgumentParser();p.add_argument('--root',required=True);a=p.parse_args();root=pathlib.Path(a.root);root.mkdir(parents=True,exist_ok=True)
repo='iamwavecut/ninfer-all';manifest='sha256:1f59c4a8285c7c0f9ccb6e5645d112db39956718df9065837ce2a6a3832c6aa9';layer='sha256:53b3ce944aa9ddbe64b46380affd2e3f45e28ba93b316f2f85ec7f664e0fc9ff'
cap=subprocess.check_output(['nvidia-smi','--query-gpu=compute_cap','--format=csv,noheader'],text=True).splitlines()[0].strip()
if not cap.startswith('12.'):
 raise RuntimeError('This pinned runtime is the tested Blackwell sm120a build. Use a compatible ninfer-serve binary in the card for other GPUs; no incompatible binary was installed.')
token=json.load(urllib.request.urlopen('https://ghcr.io/token?scope=repository:'+repo+':pull'))['token']
def fetch(kind,digest):return urllib.request.urlopen(urllib.request.Request('https://ghcr.io/v2/'+repo+'/'+kind+'/'+digest,headers={'Authorization':'Bearer '+token,'Accept':'application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json'}))
with fetch('manifests',manifest) as response:raw=response.read()
if 'sha256:'+hashlib.sha256(raw).hexdigest()!=manifest:raise ValueError('OCI manifest digest mismatch')
meta=json.loads(raw)
if layer not in [x['digest'] for x in meta.get('layers',[])]:raise ValueError('Expected runtime layer is absent from pinned manifest')
archive=root/'runtime-layer.tar.gz';digest=hashlib.sha256()
with fetch('blobs',layer) as response,archive.open('wb') as output:
 while chunk:=response.read(8*1024*1024):digest.update(chunk);output.write(chunk)
if 'sha256:'+digest.hexdigest()!=layer:raise ValueError('Runtime layer digest mismatch')
binpath=root/'bin';binpath.mkdir(exist_ok=True)
with tarfile.open(archive) as tf:
 for member in tf:
  if member.name.startswith('opt/ninfer/sm120a/') and member.isfile():
   dest=binpath/pathlib.Path(member.name).name
   with tf.extractfile(member) as src,dest.open('wb') as dst:shutil.copyfileobj(src,dst)
   dest.chmod(0o755)
for name in ['ninfer','ninfer-serve','ninfer-calibrate','ninfer-perplexity','ninfer-ngram-profile']:
 q=binpath/name
 if not q.exists():q.symlink_to('ninfer-multicall')
(root/'provenance.json').write_text(json.dumps({'source_commit':'5ed86dff9fe3a5a0776f40a7aea86cf381da990d','image_manifest':manifest,'layer':layer,'verified':True},indent=2))
archive.unlink();print('Verified NInfer Blackwell runtime installed. CUDA runtime libraries must be available on the host.',flush=True)
