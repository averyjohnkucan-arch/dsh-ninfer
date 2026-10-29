"""Install the repository's checksum-pinned custom runtime without a compiler or system changes."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import platform
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time

SPEC = importlib.util.spec_from_file_location('verified_download', Path(__file__).with_name('fetch-ninfer.py'))
DOWNLOAD = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(DOWNLOAD)
MANIFEST = Path(__file__).with_name('custom-runtime.json')
BASE = 'https://github.com/averyjohnkucan-arch/dsh-ninfer/releases/download/'
HOST_GLIBC = re.compile(r'^lib(?:c|m|mvec|pthread|dl|rt|resolv|util|anl|nss_[a-z0-9_]+)\.so(?:\.|$)')


def installed_files(manifest):
    # glibc components must come from one host version, never a mixture of bundled and host glibc.
    if manifest.get('loader') == 'bundled-glibc':
        return manifest['files']
    return [entry for entry in manifest['files'] if not (entry['name'].startswith('compat/') and HOST_GLIBC.match(Path(entry['name']).name))]


def relative_path(name):
    path = Path(name)
    if not name or path.is_absolute() or '..' in path.parts or '\\' in name:
        raise ValueError('Unsafe runtime archive path')
    return path


def check_platform(manifest):
    if (platform.system(), platform.machine()) != ('Linux', 'x86_64'):
        raise ValueError('The automatic custom NInfer runtime requires Linux x86-64')
    version = platform.libc_ver()[1]
    if manifest.get('loader') != 'bundled-glibc' and (not version or tuple(map(int, version.split('.')[:2])) < (2, 39)):
        raise ValueError('The custom NInfer runtime requires glibc 2.39+ (Ubuntu 24.04 or newer)')
    capabilities = subprocess.check_output(['nvidia-smi', '--query-gpu=compute_cap', '--format=csv,noheader'], text=True)
    cards = [line.strip().replace('.', '') for line in capabilities.splitlines() if line.strip()]
    supported = {value.rstrip('a') for value in manifest['architectures']}
    if not cards or any(card not in supported for card in cards):
        raise ValueError('No matching GPU for the custom runtime architectures: ' + ', '.join(manifest['architectures']))


def current_install(target, manifest):
    try:
        receipt = json.loads((target / 'dsh-runtime.json').read_text())
        if not receipt.get('custom') or any(receipt.get(k) != manifest[k] for k in
                ('release', 'sourceRevision', 'sourceTree', 'patchSha256')):
            return False
        for entry in installed_files(manifest):
            path = target / relative_path(entry['name'])
            if not path.is_file() or path.stat().st_size != entry['size']:
                return False
        return all((target / name).is_file() for name in ('ninfer-serve', 'ninfer-calibrate'))
    except (OSError, ValueError, KeyError, TypeError):
        return False


def verify_package(package, manifest):
    receipt = json.loads((package / 'dsh-runtime.json').read_text())
    for key in ('custom', 'release', 'sourceRevision', 'sourceTree', 'patchSha256', 'files'):
        if receipt.get(key) != manifest[key]:
            raise ValueError('Custom runtime provenance mismatch: ' + key)
    for entry in manifest['files']:
        path = package / relative_path(entry['name'])
        if not path.is_file() or path.stat().st_size != entry['size'] or DOWNLOAD.sha256(path) != entry['sha256']:
            raise ValueError('Custom runtime file failed SHA256 verification: ' + entry['name'])
    files = installed_files(manifest)
    excluded = {entry['name'] for entry in manifest['files']} - {entry['name'] for entry in files}
    for name in excluded:
        (package / relative_path(name)).unlink()
    receipt['files'] = files
    receipt['hostLibrariesExcluded'] = sorted(excluded)
    compat = package / 'compat/usr/lib/x86_64-linux-gnu'
    env = dict(os.environ)
    if manifest.get('loader') == 'bundled-glibc':
        env.pop('LD_LIBRARY_PATH', None)
    else:
        env['LD_LIBRARY_PATH'] = str(compat) + (':' + env['LD_LIBRARY_PATH'] if env.get('LD_LIBRARY_PATH') else '')
    # Check the loader and advertised capabilities before replacing a previous installation.
    help_text = subprocess.check_output([str(package / 'ninfer-serve'), '--help'], text=True, stderr=subprocess.STDOUT, env=env)
    for feature in ('q5_1', 'q6_0', '--embedding-residency', '--output-head-residency'):
        if feature not in help_text:
            raise ValueError('Downloaded custom runtime does not advertise ' + feature)
    subprocess.check_output([str(package / 'ninfer-calibrate'), '--help'], text=True, stderr=subprocess.STDOUT, env=env)
    (package / 'dsh-runtime.json').write_text(json.dumps(receipt, indent=2) + '\n')


def install(root, manifest=None):
    manifest = manifest or json.loads(MANIFEST.read_text())
    if (platform.system(), platform.machine()) != ('Linux', 'x86_64'):
        raise ValueError('The automatic NInfer runtime requires Linux x86-64')
    # Preserve the ordinary upstream runtime on GPUs outside this custom binary's architecture set.
    capabilities = subprocess.check_output(['nvidia-smi', '--query-gpu=compute_cap', '--format=csv,noheader'], text=True)
    cards = [line.strip().replace('.', '') for line in capabilities.splitlines() if line.strip()]
    supported = {arch.rstrip('a') for arch in manifest['architectures']}
    if cards and any(card not in supported for card in cards):
        print('Using the pinned official runtime for this GPU; custom Q5_1/Q6_0 controls require the Blackwell build.', flush=True)
        DOWNLOAD.install(root)
        receipt_path = Path(root).resolve() / 'bin/dsh-runtime.json'
        receipt = json.loads(receipt_path.read_text())
        receipt.update(officialFallbackFor=manifest['release'], computeCapabilities=cards)
        receipt_path.write_text(json.dumps(receipt, indent=2) + '\n')
        return
    check_platform(manifest)
    root = Path(root).resolve()
    root.mkdir(parents=True, exist_ok=True)
    target = root / 'bin'
    if current_install(target, manifest):
        print('DSH_RESULT=' + json.dumps({'executable': str(target / 'ninfer-serve'), 'custom': True, 'sourceRevision': manifest['sourceRevision']}), flush=True)
        return
    downloads = root / 'downloads'
    downloads.mkdir(exist_ok=True)
    parts = []
    for item in manifest['parts']:
        if relative_path(item['name']).name != item['name']:
            raise ValueError('Runtime part must have a plain filename')
        path = downloads / item['name']
        DOWNLOAD.download(BASE + manifest['release'] + '/' + item['name'], path, item['size'], item['sha256'])
        parts.append(path)
    with tempfile.TemporaryDirectory(prefix='custom-install-', dir=root) as temporary:
        staging = Path(temporary)
        archive_path = staging / 'runtime.tar.gz'
        with archive_path.open('wb') as output:
            for part in parts:
                with part.open('rb') as stream:
                    shutil.copyfileobj(stream, output, 4 * 1024 * 1024)
        if DOWNLOAD.sha256(archive_path) != manifest['archiveSha256']:
            raise ValueError('Combined custom runtime archive failed SHA256 verification')
        with tarfile.open(archive_path) as archive:
            archive.extractall(staging, filter='data')
        package = staging / relative_path(manifest['directory'])
        verify_package(package, manifest)
        if target.exists():
            previous = root / ('bin-previous-' + str(time.time_ns()))
            target.rename(previous)
            print('Preserved previous runtime at ' + str(previous), flush=True)
        package.rename(target)
    for part in parts:
        part.unlink()
    try:
        downloads.rmdir()
    except OSError:
        pass
    print('DSH_RESULT=' + json.dumps({'executable': str(target / 'ninfer-serve'), 'custom': True, 'sourceRevision': manifest['sourceRevision']}), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', required=True)
    args = parser.parse_args()
    try:
        install(args.root)
    except Exception as error:
        print(str(error), file=sys.stderr, flush=True)
        raise SystemExit(1)
