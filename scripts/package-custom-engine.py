"""Build the pinned custom engine and publish a relocatable Linux runtime archive."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tarfile

PACKAGE = Path(__file__).resolve().parents[1]
ARCHITECTURES = ['75', '80', '86', '89', '120a']
# The host supplies glibc and the NVIDIA driver. Everything else is private to this runtime.
HOST_LIBRARIES = re.compile(r'^(?:ld-linux|lib(?:c|m|pthread|dl|rt|resolv|util)\.so|libcuda\.|libnvidia-)')


def run(*args, cwd=None, env=None):
    return subprocess.check_output(args, cwd=cwd, env=env, text=True).strip()


def digest(path):
    result = hashlib.sha256()
    with path.open('rb') as stream:
        while block := stream.read(4 * 1024 * 1024):
            result.update(block)
    return result.hexdigest()


def prepare_source(source, engine):
    patch = PACKAGE / engine['patch']
    if digest(patch) != engine['patchSha256']:
        raise ValueError('The custom engine patch does not match its pinned SHA256')
    source.mkdir(parents=True)
    run('git', 'init', str(source))
    run('git', 'remote', 'add', 'origin', engine['source'] + '.git', cwd=source)
    run('git', 'fetch', '--depth', '1', 'origin', engine['revision'], cwd=source)
    run('git', 'checkout', '--detach', 'FETCH_HEAD', cwd=source)
    if run('git', 'rev-parse', 'HEAD', cwd=source) != engine['revision']:
        raise ValueError('Source revision mismatch')
    run('git', 'apply', '--index', str(patch), cwd=source)
    if run('git', 'write-tree', cwd=source) != engine['sourceTree']:
        raise ValueError('Patched source tree mismatch')


def copy_libraries(binary, destination, licenses):
    cuda = Path('/usr/local/cuda-13.1/targets/x86_64-linux/lib')
    env = dict(os.environ, LD_LIBRARY_PATH=str(cuda))
    dependencies = run('ldd', str(binary), env=env)
    packages = set()
    for line in dependencies.splitlines():
        name = line.strip().split(' ', 1)[0]
        if HOST_LIBRARIES.match(name) or name == 'linux-vdso.so.1':
            continue
        match = re.search(r'=> (/\S+)', line)
        if not match:
            raise ValueError('Unresolved runtime dependency: ' + line)
        path = Path(match.group(1))
        shutil.copy2(path.resolve(), destination / name)
        try:
            owner = run('dpkg-query', '-S', str(path.resolve())).split(': ', 1)[0]
            packages.add(owner)
        except subprocess.CalledProcessError:
            if not str(path).startswith(str(cuda)):
                raise
    # cuBLAS loads this dependency internally, so ldd does not list it on every toolkit.
    for name in ('libcublasLt.so.13',):
        path = cuda / name
        if path.is_file() and not (destination / name).exists():
            shutil.copy2(path.resolve(), destination / name)
    for package in packages:
        copyright = Path('/usr/share/doc') / package.split(':')[0] / 'copyright'
        if copyright.is_file():
            shutil.copy2(copyright.resolve(), licenses / (package.replace(':', '-') + '.txt'))
    for name in ('EULA.txt', 'LICENSE'):
        path = cuda.parents[2] / name
        if path.is_file():
            shutil.copy2(path, licenses / ('CUDA-' + name))
    return run('dpkg-query', '-W', '-f=${Package}\t${Version}\n', *sorted(packages))


def archive_runtime(package, output, metadata, part_limit=1700 * 1024 * 1024):
    archive = output / (package.name + '.tar.gz')
    with tarfile.open(archive, 'w:gz', compresslevel=1) as stream:
        stream.add(package, arcname=package.name)
    manifest = {**metadata, 'directory': package.name, 'archiveSha256': digest(archive), 'parts': []}
    with archive.open('rb') as stream:
        index = 1
        while True:
            part = output / (archive.name + f'.{index:03}')
            size = 0
            with part.open('wb') as target:
                while size < part_limit:
                    block = stream.read(min(4 * 1024 * 1024, part_limit - size))
                    if not block:
                        break
                    target.write(block)
                    size += len(block)
            if not size:
                part.unlink()
                break
            manifest['parts'].append({'name': part.name, 'size': size, 'sha256': digest(part)})
            index += 1
    archive.unlink()
    path = output / 'runtime-manifest.json'
    path.write_text(json.dumps(manifest, indent=2) + '\n')
    return path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--work', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--jobs', default='2')
    args = parser.parse_args()
    engine = json.loads((PACKAGE / 'lib/engine.json').read_text())
    work, output = Path(args.work).resolve(), Path(args.output).resolve()
    work.mkdir(parents=True, exist_ok=True)
    output.mkdir(parents=True, exist_ok=True)
    source, build = work / 'source', work / 'build'
    prepare_source(source, engine)
    subprocess.run(['cmake', '-S', str(source), '-B', str(build), '-G', 'Ninja',
        '-DCMAKE_BUILD_TYPE=Release', '-DCMAKE_CUDA_COMPILER=/usr/local/cuda-13.1/bin/nvcc',
        '-DCMAKE_CUDA_ARCHITECTURES=' + ';'.join(ARCHITECTURES),
        '-DNINFER_BUILD_APPS=ON', '-DNINFER_MULTICALL=ON', '-DBUILD_TESTING=OFF',
        '-DNINFER_BUILD_BENCHMARKS=OFF'], check=True)
    subprocess.run(['cmake', '--build', str(build), '--target', 'ninfer-multicall', '--parallel', args.jobs], check=True)
    package = work / 'ninfer-custom-linux-x64-cuda13'
    package.mkdir()
    compat = package / 'compat/usr/lib/x86_64-linux-gnu'
    compat.mkdir(parents=True)
    licenses = package / 'licenses'
    licenses.mkdir()
    binary = package / 'ninfer-multicall'
    shutil.copy2(build / 'apps/ninfer-multicall', binary)
    for name in ('ninfer-serve', 'ninfer-calibrate'):
        (package / name).symlink_to('ninfer-multicall')
    (licenses / 'packages.txt').write_text(copy_libraries(binary, compat, licenses) + '\n')
    # The CI host has no GPU. A temporary linker stub permits --help without shipping a driver.
    stub = work / 'driver-stub'
    stub.mkdir()
    (stub / 'libcuda.so.1').symlink_to('/usr/local/cuda-13.1/targets/x86_64-linux/lib/stubs/libcuda.so')
    help_text = run(str(package / 'ninfer-serve'), '--help',
                    env=dict(os.environ, LD_LIBRARY_PATH=str(compat) + ':' + str(stub)))
    for feature in ('q5_1', 'q6_0', '--embedding-residency', '--output-head-residency'):
        if feature not in help_text:
            raise ValueError('Custom runtime is missing ' + feature)
    shutil.copy2(source / 'LICENSE', licenses / 'NInfer-Apache-2.0.txt')
    shutil.copy2(PACKAGE / engine['patch'], licenses / 'custom-engine.patch')
    metadata = {'format': 1, 'custom': True, 'release': engine['customRuntimeRelease'],
        'sourceRevision': engine['revision'], 'sourceTree': engine['sourceTree'],
        'patchSha256': engine['patchSha256'], 'platform': 'linux-x64',
        'architectures': ARCHITECTURES, 'minimumGlibc': '2.39', 'cuda': '13.1',
        'capabilities': engine['capabilities'],
        'files': [{'name': str(p.relative_to(package)), 'size': p.stat().st_size, 'sha256': digest(p)}
                  for p in sorted(package.rglob('*')) if p.is_file() and not p.is_symlink()]}
    (package / 'dsh-runtime.json').write_text(json.dumps(metadata, indent=2) + '\n')
    print(archive_runtime(package, output, metadata), flush=True)


if __name__ == '__main__':
    main()
