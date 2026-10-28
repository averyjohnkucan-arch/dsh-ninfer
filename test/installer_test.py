"""Installer checks and staging without a GPU or network."""
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('fetch_ninfer',Path(__file__).parents[1]/'scripts/fetch-ninfer.py')
installer=importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)

class InstallerTests(unittest.TestCase):
 def test_verified_release_is_staged_before_publishing(self):
  name='ninfer-fixture'; data=io.BytesIO()
  with tarfile.open(fileobj=data,mode='w:gz') as archive:
   for filename in ('ninfer-serve','ninfer-calibrate','backends/cuda13/libninfer-runtime.so'):
    content=b'fixture'; info=tarfile.TarInfo(name+'/'+filename); info.mode=0o755; info.size=len(content); archive.addfile(info,io.BytesIO(content))
  payload=data.getvalue();digest=hashlib.sha256(payload).hexdigest()
  with tempfile.TemporaryDirectory() as directory:
   root=Path(directory)/'runtime'
   (root/'bin').mkdir(parents=True);(root/'bin/unfinished').write_text('preserve')
   with patch.dict(installer.PACKAGES,{'13':(name,[(len(payload),digest)])}), patch.object(installer.subprocess,'check_output',return_value='12.0\n'), patch.object(installer.urllib.request,'urlopen',side_effect=lambda *_a,**_k:io.BytesIO(payload)), patch.object(installer,'prepare_compat_libraries',return_value=[]):
    installer.install(root)
    installer.install(root)
   self.assertTrue((root/'bin/ninfer-serve').is_file())
   self.assertEqual(json.loads((root/'bin/dsh-runtime.json').read_text())['sourceRevision'],installer.REVISION)
   self.assertFalse((root/'downloads').exists())
   self.assertEqual(list(root.glob('bin-incomplete-*/unfinished'))[0].read_text(),'preserve')

 def test_download_rejects_bad_checksum(self):
  with tempfile.TemporaryDirectory() as directory, patch.object(installer.urllib.request,'urlopen',side_effect=lambda *_a,**_k:io.BytesIO(b'bad')), patch.object(installer.time,'sleep'):
   path=Path(directory)/'part'
   with self.assertRaisesRegex(ValueError,'Checksum'):
    installer.download('https://example.invalid',path,3,'0'*64)
   self.assertFalse(path.exists())

 def test_bad_download_retries_from_zero_and_recovers(self):
  payload=b'correct bytes';digest=hashlib.sha256(payload).hexdigest()
  with tempfile.TemporaryDirectory() as directory, patch.object(installer.urllib.request,'urlopen',side_effect=[io.BytesIO(b'bad'),io.BytesIO(payload)]) as fetch, patch.object(installer.time,'sleep'):
   path=Path(directory)/'part';installer.download('https://example.invalid',path,len(payload),digest)
   self.assertEqual(path.read_bytes(),payload);self.assertEqual(fetch.call_count,2)
   self.assertFalse(fetch.call_args.args[0].has_header('Range'))

 def test_verified_existing_download_is_not_fetched(self):
  with tempfile.TemporaryDirectory() as directory, patch.object(installer.urllib.request,'urlopen') as fetch:
   path=Path(directory)/'part';path.write_bytes(b'valid')
   installer.download('https://example.invalid',path,5,hashlib.sha256(b'valid').hexdigest());fetch.assert_not_called()

 def test_resume_and_server_ignoring_range_both_verify_the_whole_file(self):
  payload=b'a verified transfer';digest=hashlib.sha256(payload).hexdigest()
  for status in (200,206):
   response=io.BytesIO(payload if status==200 else payload[5:]);response.status=status;response.headers={'Content-Range':f'bytes 5-{len(payload)-1}/{len(payload)}'}
   with tempfile.TemporaryDirectory() as directory, patch.object(installer.urllib.request,'urlopen',return_value=response) as fetch:
    path=Path(directory)/'part';path.write_bytes(payload[:5]);installer.download('https://example.invalid',path,len(payload),digest)
    self.assertEqual(path.read_bytes(),payload);self.assertEqual(fetch.call_args.args[0].get_header('Range'),'bytes=5-')

 def test_unsatisfiable_range_restarts_from_zero(self):
  payload=b'correct';digest=hashlib.sha256(payload).hexdigest()
  error=installer.urllib.error.HTTPError('https://example.invalid',416,'range',{},None)
  with tempfile.TemporaryDirectory() as directory, patch.object(installer.urllib.request,'urlopen',side_effect=[error,io.BytesIO(payload)]) as fetch, patch.object(installer.time,'sleep'):
   path=Path(directory)/'part';path.write_bytes(payload[:2]);installer.download('https://example.invalid',path,len(payload),digest)
   self.assertEqual(path.read_bytes(),payload);self.assertFalse(fetch.call_args.args[0].has_header('Range'))

if __name__=='__main__':unittest.main()
