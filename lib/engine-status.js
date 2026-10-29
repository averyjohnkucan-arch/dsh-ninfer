import { readFile, stat, access } from 'node:fs/promises';
import { join } from 'node:path';

/** A folder is ready only when it belongs to this pinned custom build and has all its files. */
export async function customEngineReady(directory, engine) {
  try {
    const receipt = JSON.parse(await readFile(join(directory, 'dsh-runtime.json'), 'utf8'));
    if (!receipt.custom || receipt.release !== engine.customRuntimeRelease ||
        receipt.sourceRevision !== engine.revision || receipt.sourceTree !== engine.sourceTree ||
        receipt.patchSha256 !== engine.patchSha256 || !Array.isArray(receipt.files) || !receipt.files.length)
      return false;
    for (const name of ['ninfer-serve', 'ninfer-calibrate',
      'compat/usr/lib/x86_64-linux-gnu/libcublas.so.13',
      'compat/usr/lib/x86_64-linux-gnu/libcublasLt.so.13',
      'compat/usr/lib/x86_64-linux-gnu/libcudart.so.13']) await access(join(directory, name));
    for (const file of receipt.files) {
      if (typeof file.name !== 'string' || file.name.startsWith('/') ||
          file.name.includes('\\') || file.name.split('/').includes('..')) return false;
      const info = await stat(join(directory, file.name));
      if (!info.isFile() || info.size !== file.size) return false;
    }
    return true;
  } catch (error) {
    if (error.code === 'ENOENT' || error instanceof SyntaxError || error instanceof TypeError) return false;
    throw error;
  }
}

/** Older GPUs keep their previously supported upstream engine, without advertising custom KV controls. */
export async function officialEngineReady(directory, engine) {
  try {
    const receipt = JSON.parse(await readFile(join(directory, 'dsh-runtime.json'), 'utf8'));
    const custom = new Set((engine.customRuntimeArchitectures || []).map(arch => arch.replace(/a$/, '')));
    if (!receipt.official || receipt.sourceRevision !== engine.officialSourceRevision ||
        receipt.officialFallbackFor !== engine.customRuntimeRelease ||
        !receipt.computeCapabilities?.length || receipt.computeCapabilities.some(arch => custom.has(arch)))
      return false;
    const required = ['ninfer-serve', 'ninfer-calibrate', `backends/cuda${receipt.backend}/libninfer-runtime.so`];
    await Promise.all(required.map(name => access(join(directory, name))));
    return true;
  } catch (error) {
    if (error.code === 'ENOENT' || error instanceof SyntaxError || error instanceof TypeError) return false;
    throw error;
  }
}
