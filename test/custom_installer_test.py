"""Verify custom runtime staging, provenance, dependency checks and resumable downloads."""
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).parents[1]


def module(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'scripts' / filename)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


installer = module('custom_installer', 'fetch-custom-engine.py')
packager = module('custom_packager', 'package-custom-engine.py')
HELP = 'q5_1 q6_0 --embedding-residency --output-head-residency'


class CustomInstallerTests(unittest.TestCase):
    def fixture(self, base):
        package = base / 'fixture'
        package.mkdir()
        (package / 'ninfer-multicall').write_bytes(b'fixture-engine')
        host_glibc = package / 'compat/usr/lib/x86_64-linux-gnu/libmvec.so.1'
        host_glibc.parent.mkdir(parents=True)
        host_glibc.write_bytes(b'host-only')
        (package / 'ninfer-serve').symlink_to('ninfer-multicall')
        (package / 'ninfer-calibrate').symlink_to('ninfer-multicall')
        metadata = {'custom': True, 'release': 'test-release', 'sourceRevision': 'pinned-source',
                    'sourceTree': 'pinned-tree', 'patchSha256': 'pinned-patch', 'architectures': ['120a'],
                    'files': [{'name': 'ninfer-multicall', 'size': 14,
                               'sha256': packager.digest(package / 'ninfer-multicall')},
                              {'name': str(host_glibc.relative_to(package)), 'size': 9,
                               'sha256': packager.digest(host_glibc)}]}
        (package / 'dsh-runtime.json').write_text(json.dumps(metadata))
        output = base / 'dist'
        output.mkdir()
        manifest = json.loads(packager.archive_runtime(package, output, metadata, part_limit=100).read_text())
        parts = {item['name']: (output / item['name']).read_bytes() for item in manifest['parts']}
        return manifest, parts

    def test_split_archive_installs_and_reuses_verified_files(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            manifest, parts = self.fixture(root)
            def fetch(request, **_):
                return io.BytesIO(parts[request.full_url.rsplit('/', 1)[-1]])
            with patch.object(installer, 'check_platform'), patch.object(installer.subprocess, 'check_output', side_effect=lambda argv, **_: '12.0\n' if argv[0]=='nvidia-smi' else HELP), \
                    patch.object(installer.DOWNLOAD.urllib.request, 'urlopen', side_effect=fetch) as network:
                target = root / 'engine'
                (target / 'bin').mkdir(parents=True)
                (target / 'bin/old-runtime').write_text('preserve')
                installer.install(target, manifest)
                calls = network.call_count
                installer.install(target, manifest)
                self.assertEqual(network.call_count, calls)
                self.assertTrue((target / 'bin/ninfer-serve').is_file())
                self.assertTrue((target / 'bin/ninfer-calibrate').is_symlink())
                self.assertEqual(list(target.glob('bin-previous-*/old-runtime'))[0].read_text(), 'preserve')
                self.assertFalse((target / 'downloads').exists())
                self.assertFalse((target / 'bin/compat/usr/lib/x86_64-linux-gnu/libmvec.so.1').exists())
                receipt = json.loads((target / 'bin/dsh-runtime.json').read_text())
                self.assertEqual(len(receipt['files']), 1)
                self.assertEqual(len(receipt['hostLibrariesExcluded']), 1)
                (target / 'bin/ninfer-multicall').write_bytes(b'bad')
                self.assertFalse(installer.current_install(target / 'bin', manifest))

    def test_wrong_source_cannot_replace_previous_runtime(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            manifest, parts = self.fixture(root)
            manifest['sourceRevision'] = 'other-source'
            target = root / 'engine'
            (target / 'bin').mkdir(parents=True)
            (target / 'bin/old-runtime').write_text('preserve')
            with patch.object(installer, 'check_platform'), \
                    patch.object(installer.subprocess, 'check_output', return_value='12.0\n'), \
                    patch.object(installer.DOWNLOAD.urllib.request, 'urlopen',
                    side_effect=lambda req, **_: io.BytesIO(parts[req.full_url.rsplit('/', 1)[-1]])):
                with self.assertRaisesRegex(ValueError, 'provenance'):
                    installer.install(target, manifest)
            self.assertEqual((target / 'bin/old-runtime').read_text(), 'preserve')

    def test_changed_file_and_missing_capability_are_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            manifest, _ = self.fixture(root)
            package = root / 'fixture'
            with patch.object(installer.subprocess, 'check_output', return_value='stock runtime'):
                with self.assertRaisesRegex(ValueError, 'advertise q5_1'):
                    installer.verify_package(package, manifest)
            (package / 'ninfer-multicall').write_bytes(b'x' * 14)
            with self.assertRaisesRegex(ValueError, 'SHA256'):
                installer.verify_package(package, manifest)

    def test_other_gpu_keeps_official_runtime_without_custom_capabilities(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            manifest, _ = self.fixture(root)
            def official(target):
                directory = Path(target)/'bin'
                directory.mkdir(parents=True)
                (directory/'dsh-runtime.json').write_text(json.dumps({'official':True,'backend':'12'}))
            with patch.object(installer.subprocess, 'check_output', return_value='8.6\n'), \
                    patch.object(installer.DOWNLOAD, 'install', side_effect=official) as fallback:
                installer.install(root/'engine', manifest)
            fallback.assert_called_once()
            receipt=json.loads((root/'engine/bin/dsh-runtime.json').read_text())
            self.assertEqual(receipt['computeCapabilities'],['86'])
            self.assertEqual(receipt['officialFallbackFor'],manifest['release'])
            self.assertNotIn('custom',receipt)

    def test_platform_architecture_and_unsafe_paths(self):
        with patch.object(installer.platform, 'system', return_value='Linux'), \
                patch.object(installer.platform, 'machine', return_value='x86_64'), \
                patch.object(installer.platform, 'libc_ver', return_value=('glibc', '2.39')), \
                patch.object(installer.subprocess, 'check_output', return_value='12.0\n'):
            installer.check_platform({'architectures': ['120a']})
            with self.assertRaisesRegex(ValueError, 'matching GPU'):
                installer.check_platform({'architectures': ['86']})
        for name in ('../escape', '/etc/passwd', 'a\\b'):
            with self.assertRaises(ValueError):
                installer.relative_path(name)


if __name__ == '__main__':
    unittest.main()
