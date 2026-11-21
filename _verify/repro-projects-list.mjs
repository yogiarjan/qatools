/**
 * Focused repro for the /api/projects list 500.
 * The error signature was "rows.slice is not a function".
 */
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';

const root = resolve(import.meta.dirname, '..');
const PORT = 5311;
const child = spawn(process.execPath, [resolve(root, 'apps/api/node_modules/tsx/dist/cli.mjs'), resolve(root, 'apps/api/src/server.ts')], {
  cwd: resolve(root, 'apps/api'),
  env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', QATOOLS_DB: resolve(tmpdir(), `vg-${Date.now()}.db`) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let slog = '';
child.stdout.on('data', (d) => (slog += d));
child.stderr.on('data', (d) => (slog += d));

const base = `http://127.0.0.1:${PORT}`;
for (let i = 0; i < 80; i++) {
  try {
    const r = await fetch(`${base}/api/health`);
    if (r.ok) break;
  } catch {}
  await new Promise((r) => setTimeout(r, 300));
}

// Create a project first so the list is non-empty.
await fetch(`${base}/api/projects`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ key: 'VG', name: 'Verifier Guard' }),
});

const probes = [
  '/api/projects',
  '/api/projects?limit=10',
  '/api/projects?q=VG',
  '/api/projects?search=VG',
  "/api/projects?search=%27%20OR%201%3D1%20--",
  '/api/projects?status=active',
];
console.log('--- GET /api/projects variants ---');
for (const p of probes) {
  const r = await fetch(`${base}${p}`);
  const t = await r.text();
  console.log(`${p}\n   -> ${r.status} ${t.slice(0, 200)}`);
}

// Find which query keys are accepted by exercising a bogus one.
console.log('\n--- does ?q= vs ?search= matter? ---');
for (const p of ['/api/projects?q=zzz', '/api/projects?search=zzz']) {
  const r = await fetch(`${base}${p}`);
  console.log(`${p} -> ${r.status} ${(await r.text()).slice(0, 120)}`);
}

console.log('\n--- server log (error traces) ---');
console.log(slog.slice(-3000));

child.kill('SIGKILL');
process.exit(0);
