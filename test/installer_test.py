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
   for filename in ('ninfer-serve','ninfer-calibrate','backends/cuda13/runtime.so'):
    content=b'fixture'; info=tarfile.TarInfo(name+'/'+filename); info.mode=0o755; info.size=len(content); archive.addfile(info,io.BytesIO(content))
  payload=data.getvalue();digest=hashlib.sha256(payload).hexdigest()
  with tempfile.TemporaryDirectory() as directory:
   root=Path(directory)/'runtime'
   with patch.dict(installer.PACKAGES,{'13':(name,[(len(payload),digest)])}), patch.object(installer.subprocess,'check_output',return_value='12.0\n'), patch.object(installer.urllib.request,'urlopen',side_effect=lambda *_a,**_k:io.BytesIO(payload)), patch.object(installer,'prepare_compat_libraries',return_value=[]):
    installer.install(root)
   self.assertTrue((root/'bin/ninfer-serve').is_file())
   self.assertEqual(json.loads((root/'bin/dsh-runtime.json').read_text())['sourceRevision'],installer.REVISION)
   self.assertFalse((root/'downloads').exists())

 def test_download_rejects_bad_checksum(self):
  with tempfile.TemporaryDirectory() as directory, patch.object(installer.urllib.request,'urlopen',return_value=io.BytesIO(b'bad')):
   path=Path(directory)/'part'
   with self.assertRaisesRegex(ValueError,'Checksum'):
    installer.download('https://example.invalid',path,3,'0'*64)
   self.assertFalse(path.exists())

if __name__=='__main__':unittest.main()
