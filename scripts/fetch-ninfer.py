"""Install a pinned official NInfer release with verified downloads."""
import argparse
import hashlib
import http.client
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
import urllib.error
import sys
import time

REVISION = '40d913db2e87e2211fce4089c0c7920480a5e7a0'
BASE = 'https://github.com/iamwavecut/ninfer-all/releases/download/2026-11-13.2/'
PACKAGES = {'13': ('ninfer-linux-x64-cuda13.4-sm75-80-86-89-120a-40d913db2e87',
        [(1992294400, '332eb059c5f931c6654f4378be7f5acee0558936652cc2759f856186eb21b7de'),
         (1014654557, 'a39b1ad276baa95057e021c518807d3b303e1ca6ce3e922a688348d2c0778a19')]),
 '12': ('ninfer-linux-x64-cuda12.9-sm70-75-80-86-89-40d913db2e87',
        [(1992294400, '71bcc1142bdfa2e8feb3ddcb5bae49237cd744402b5c2d6ae82f0bb642476d9e'),
         (1053022988, 'dbfda70ae4aa080e280a97107f18669ec5584c0ba1d600e414844daea3078070')])}


def sha256(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        while block := stream.read(4 * 1024 * 1024):
            digest.update(block)
    return digest.hexdigest()


def download(url, path, expected_size, expected_hash, attempts=3):
    """Resume interrupted transfers; a failed integrity check always retries from byte zero."""
    for attempt in range(attempts):
        try:
            return download_once(url, path, expected_size, expected_hash)
        except (OSError, ValueError, http.client.IncompleteRead) as error:
            if isinstance(error, urllib.error.HTTPError):
                if error.code == 416:
                    path.unlink(missing_ok=True)
                error.close()
            if attempt + 1 == attempts:
                raise
            print(f'{path.name}: {error}; retrying ({attempt + 2}/{attempts})', flush=True)
            time.sleep(min(2 ** attempt, 4))


def download_once(url, path, expected_size, expected_hash):
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
                if received > expected_size:
                    stream.close()
                    path.unlink()
                    raise ValueError('Server sent more bytes than the verified release part contains')
                print(f'{path.name}: {received // 1048576} / {expected_size // 1048576} MiB', flush=True)
    if path.stat().st_size != expected_size or sha256(path) != expected_hash:
        path.unlink()
        raise ValueError(f'Checksum or size mismatch for {path.name}; discarded the damaged download')


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
    # An interrupted installation may leave a folder, but it is ready only with its receipt and tools.
    try:
        receipt = json.loads((target / 'dsh-runtime.json').read_text())
        complete = receipt.get('sourceRevision') == REVISION and receipt.get('backend') == backend and all(
            (target / name).is_file() for name in ('ninfer-serve', 'ninfer-calibrate', f'backends/cuda{backend}/libninfer-runtime.so'))
    except (OSError, ValueError):
        complete = False
    if complete:
        print('DSH_RESULT=' + json.dumps({'executable': str(target / 'ninfer-serve'), 'official': True, 'sourceRevision': REVISION}), flush=True)
        return
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
        if target.exists():
            backup = root / ('bin-incomplete-' + str(time.time_ns()))
            target.rename(backup)
            print(f'Preserved the previous incomplete runtime at {backup}', flush=True)
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
