import { chmod, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

// npm archives occasionally restore node-pty's Darwin helper without its
// executable bit. Aside requires a real PTY, so repair only that packaged
// helper after dependency installation. No downloaded or application file is
// modified.
if (process.platform === 'darwin') {
  const requireFromApi = createRequire(new URL('../package.json', import.meta.url));
  const packageRoot = dirname(requireFromApi.resolve('node-pty/package.json'));
  const helper = join(
    packageRoot,
    'prebuilds',
    `${process.platform}-${process.arch}`,
    'spawn-helper',
  );
  try {
    const details = await stat(helper);
    await chmod(helper, details.mode | 0o111);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}
