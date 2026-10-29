import { mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from '../lib/process.js';

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const rootArgument = process.argv.indexOf('--root');
const root = resolve(rootArgument >= 0 ? process.argv[rootArgument + 1] : join(packageRoot, '.engine'));

try {
  await mkdir(root, { recursive: true });
  await run('python3', ['-B', join(packageRoot, 'scripts/fetch-custom-engine.py'), '--root', root], {
    cwd: root,
    timeout: 7200000,
    onData: text => process.stdout.write(text),
  });
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
