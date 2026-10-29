import { access } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/** Bundled-loader launchers must start with the host shell's libraries, then select their private loader. */
export async function engineEnvironment(executable, environment) {
  const env = { ...environment };
  const directory = dirname(executable);
  try {
    await access(join(directory, 'bundled-loader'));
    // Undefined also overrides process helpers that merge the parent environment again.
    env.LD_LIBRARY_PATH = undefined;
    return env;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const compat = join(directory, 'compat/usr/lib/x86_64-linux-gnu');
  try {
    await access(compat);
    env.LD_LIBRARY_PATH = [compat, env.LD_LIBRARY_PATH].filter(Boolean).join(':');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return env;
}
