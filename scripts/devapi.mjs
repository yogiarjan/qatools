/**
 * Robust dev/boot harness for the API. FROZEN (lead-owned).
 * Usage: node scripts/devapi.mjs [port]
 */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const port = process.argv[2] ?? process.env.PORT ?? '5174';

const tsx = resolve(root, 'apps/api/node_modules/tsx/dist/cli.mjs');
const entry = resolve(root, 'apps/api/src/server.ts');

const child = spawn(process.execPath, [tsx, entry], {
  cwd: resolve(root, 'apps/api'),
  stdio: 'inherit',
  env: { ...process.env, PORT: String(port), HOST: '127.0.0.1' },
});

child.on('exit', (code) => process.exit(code ?? 0));
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => child.kill(sig));
}
