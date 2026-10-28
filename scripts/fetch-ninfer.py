"""Install a pinned official NInfer release with verified downloads."""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import tarfile
import tempfile
import urllib.request
import sys

REVISION = '3d882fc116941d9233c40bf30f4d66dbaa3d24bd'
BASE = 'https://github.com/iamwavecut/ninfer-all/releases/download/2026-10-26.2/'
PACKAGES = {
    '13': ('ninfer-linux-x64-cuda13.4-sm75-80-86-89-120a-3d882fc11694', [
        (1992294400, '12475aa3e7ee2e3fefaa63845ed3392ca0771e312e83081d3e79bd376f40a1d9'),
        (1930978986, 'ccbcdf2caa179797769c4b0d987b0b0e48fe6d5aadde6ff264f6975271f08817')]),
    '12': ('ninfer-linux-x64-cuda12.9-sm70-75-80-86-89-3d882fc11694', [
        (1992294400, '13e3b61ddcb0b8d860c55894afdebf528cadea7c22fbd67ffd84c9e43eb2f25f'),
        (1992294400, '533fc4fcb51eed5928529202b01dce843a391fcff7c8ca02b6d249b58f931931'),
        (58130579, '474d629b9deceddeeae82709c000e206b796425aacfe3693e3887997b309de4f')]),
}


def sha256(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        while block := stream.read(4 * 1024 * 1024):
            digest.update(block)
    return digest.hexdigest()


def download(url, path, expected_size, expected_hash):
    if path.exists() and path.stat().st_size == expected_size and sha256(path) == expected_hash:
        return
    offset = path.stat().st_size if path.exists() else 0
    if offset >= expected_size:
        path.unlink()
        offset = 0
    request = urllib.request.Request(url, headers={'Range': f'bytes={offset}-'} if offset else {})
    with urllib.request.urlopen(request, timeout=120) as response:
        if offset and (response.status != 206 or not response.headers.get('Content-Range', '').startswith(f'bytes {offset}-')):
            offset = 0
        with path.open('ab' if offset else 'wb') as stream:
            received = offset
            while block := response.read(4 * 1024 * 1024):
                stream.write(block)
                received += len(block)
                print(f'{path.name}: {received // 1048576} / {expected_size // 1048576} MiB', flush=True)
    if path.stat().st_size != expected_size or sha256(path) != expected_hash:
        path.unlink()
        raise ValueError(f'Checksum or size mismatch for {path.name}; retry installation')


def extract_deb(path, destination):
    """Extract the verified Debian data archive without requiring a package manager."""
    with path.open('rb') as stream:
        if stream.read(8) != b'!<arch>\n':
            raise ValueError('Invalid Debian archive')
        while header := stream.read(60):
            if len(header) != 60 or header[58:] != b'`\n':
                raise ValueError('Invalid Debian archive member')
            name = header[:16].decode().strip().rstrip('/')
            size = int(header[48:58].decode().strip())
            if name == 'data.tar.xz':
                with tarfile.open(fileobj=io.BytesIO(stream.read(size)), mode='r:xz') as archive:
                    members = [m for m in archive if m.name.startswith('./usr/lib/x86_64-linux-gnu/') or m.name.startswith('./usr/share/doc/')]
                    archive.extractall(destination, members=members, filter='data')
                return
            stream.seek(size + size % 2, 1)
    raise ValueError('Debian archive has no supported data archive')


def missing_dependencies(library, extra=None):
    env = dict(os.environ)
    if extra:
        env['LD_LIBRARY_PATH'] = str(extra) + (':' + env['LD_LIBRARY_PATH'] if env.get('LD_LIBRARY_PATH') else '')
    result = subprocess.run(['ldd', str(library)], capture_output=True, text=True, env=env)
    missing = [line.strip() for line in result.stdout.splitlines() if 'not found' in line]
    if result.returncode and not missing:
        raise ValueError('Unable to inspect NInfer runtime dependencies: ' + result.stderr.strip())
    return missing


def prepare_compat_libraries(package, backend, downloads):
    library = package / 'backends' / ('cuda' + backend) / 'libninfer-runtime.so'
    if not library.is_file():
        raise ValueError('The NInfer release has no selected backend')
    missing = missing_dependencies(library)
    if not missing:
        return []
    print('Installing verified private multimedia libraries for this system', flush=True)
    packages = json.loads(Path(__file__).with_name('debian-runtime.json').read_text())
    compat = package / 'compat'
    archives = []
    for item in packages:
        path = downloads / (item['name'] + '.deb')
        download('https://deb.debian.org/debian/' + item['path'], path, item['size'], item['sha256'])
        extract_deb(path, compat)
        archives.append(path)
    unresolved = missing_dependencies(library, compat / 'usr/lib/x86_64-linux-gnu')
    if unresolved:
        raise ValueError('NInfer needs system libraries: ' + '; '.join(unresolved))
    return archives


def install(root):
    if (platform.system(), platform.machine()) != ('Linux', 'x86_64'):
        raise ValueError('The automatic NInfer runtime is available for Linux x86-64')
    capabilities = [value.strip() for value in subprocess.check_output(['nvidia-smi', '--query-gpu=compute_cap', '--format=csv,noheader'], text=True).splitlines() if value.strip()]
    if not capabilities or any(value not in ('7.0', '7.5', '8.0', '8.6', '8.9', '12.0') for value in capabilities):
        raise ValueError('No verified release is available for one or more detected GPU architectures')
    if '7.0' in capabilities and '12.0' in capabilities:
        raise ValueError('A mixed Volta and Blackwell system needs the upstream dual-CUDA package')
    backend = '13' if '12.0' in capabilities else '12'
    name, parts = PACKAGES[backend]
    root = Path(root).resolve()
    root.mkdir(parents=True, exist_ok=True)
    target = root / 'bin'
    if target.exists():
        raise ValueError('Runtime directory already exists; select a new engine directory to preserve it')
    downloads = root / 'downloads'
    downloads.mkdir(exist_ok=True)
    paths = []
    for index, (size, digest) in enumerate(parts, 1):
        filename = f'{name}.tar.gz.{index:03d}'
        path = downloads / filename
        download(BASE + filename, path, size, digest)
        paths.append(path)
    # The release is split at arbitrary byte boundaries; concatenate as a stream.
    with tempfile.TemporaryDirectory(prefix='ninfer-install-', dir=root) as staging:
        staging = Path(staging)
        archive_path = staging / 'runtime.tar.gz'
        with archive_path.open('wb') as archive:
            for path in paths:
                with path.open('rb') as part:
                    shutil.copyfileobj(part, archive, 4 * 1024 * 1024)
        with tarfile.open(archive_path) as archive:
            archive.extractall(staging, filter='data')
        package = staging / name
        executable = package / 'ninfer-serve'
        if not executable.is_file() or not (package / 'ninfer-calibrate').is_file() or not (package / 'backends').is_dir():
            raise ValueError('The verified release is missing its server, calibration tool, or backend')
        paths.extend(prepare_compat_libraries(package, backend, downloads))
        (package / 'dsh-runtime.json').write_text(json.dumps({'sourceRevision': REVISION, 'backend': backend, 'official': True}, indent=2))
        package.rename(target)
    for path in paths:
        path.unlink()
    try:
        downloads.rmdir()
    except OSError:
        pass  # Preserve unrelated or resumable downloads.
    print('DSH_RESULT=' + json.dumps({'executable': str(target / 'ninfer-serve'), 'official': True, 'sourceRevision': REVISION}), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', required=True)
    args = parser.parse_args()
    try:
        install(args.root)
    except Exception as error:
        print(str(error), file=sys.stderr, flush=True)
        raise SystemExit(1)
