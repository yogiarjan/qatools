/**
 * QATools one-command launcher.
 *
 *   node start.mjs             # seed (if empty) + run API + Web together
 *   node start.mjs --reset     # wipe the local DB, re-seed, then run
 *   node start.mjs --no-seed   # just run the two servers
 *
 * Starts BOTH servers as child processes, streams their output with a prefix,
 * waits until the API answers /api/health, prints the URLs to open, and shuts
 * everything down cleanly on Ctrl+C.
 */

import { spawn } from 'node:child_process';
import { existsSync, rmSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)));
const tsx = resolve(root, 'apps/api/node_modules/tsx/dist/cli.mjs');
const apiEntry = resolve(root, 'apps/api/src/server.ts');
const viteBin = resolve(root, 'apps/web/node_modules/vite/bin/vite.js');
const dbPath = resolve(root, 'apps/api/data/qatools.db');

const args = process.argv.slice(2);
const reset = args.includes('--reset');
const noSeed = args.includes('--no-seed');

const API_PORT = Number(process.env.PORT ?? 5174);
const WEB_PORT = Number(process.env.WEB_PORT ?? 5173);
const API_URL = `http://127.0.0.1:${API_PORT}`;
const WEB_URL = `http://127.0.0.1:${WEB_PORT}`;

/* ------------------------------------------------------------- preflight */

for (const [label, p] of [
  ['tsx', tsx],
  ['api entry', apiEntry],
  ['vite', viteBin],
]) {
  if (!existsSync(p)) {
    console.error(`\n  ✗ ${label} not found at ${p}`);
    console.error('    Run "pnpm install" in the repo root first.\n');
    process.exit(1);
  }
}
if (!existsSync(resolve(root, 'node_modules'))) {
  console.error('\n  ✗ dependencies not installed. Run: pnpm install\n');
  process.exit(1);
}

function run(cmd, cmdArgs, opts = {}) {
  return new Promise((res) => {
    const child = spawn(cmd, cmdArgs, { cwd: root, stdio: 'inherit', ...opts });
    child.on('exit', (code) => res(code ?? 0));
  });
}

/* ----------------------------------------------------------- seed step */

if (reset && existsSync(dbPath)) {
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      rmSync(`${dbPath}${suffix}`, { force: true });
    } catch {
      /* ignore */
    }
  }
  console.log('  · local database removed (--reset)');
}

const dbExists = existsSync(dbPath);
if (!noSeed) {
  console.log(dbExists && !reset ? '  · seeding (idempotent)…' : '  · seeding initial data…');
  const cur = await run(process.execPath, [tsx, resolve(root, 'apps/api/src/seed/run.ts')]);
  if (cur !== 0) console.error('  ! curriculum seed exited non-zero (continuing)');
  const demo = await run(process.execPath, [tsx, resolve(root, 'apps/api/src/seed/demo.ts')]);
  if (demo !== 0) console.error('  ! demo seed exited non-zero (continuing)');
}

/* --------------------------------------------------------- start servers */

const children = [];

function start(label, cmd, cmdArgs, color, cwd = root) {
  const child = spawn(cmd, cmdArgs, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  const tag = `\x1b[${color}m[${label}]\x1b[0m `;
  const pipe = (stream) => {
    let buf = '';
    stream.on('data', (d) => {
      buf += d.toString();
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const l of lines) if (l.trim()) console.log(tag + l);
    });
  };
  pipe(child.stdout);
  pipe(child.stderr);
  child.on('exit', (code) => {
    if (!shuttingDown) console.log(tag + `exited with code ${code}`);
  });
  children.push(child);
  return child;
}

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('\n  · shutting down…');
  for (const c of children) {
    try {
      c.kill();
    } catch {
      /* ignore */
    }
  }
  setTimeout(() => process.exit(0), 800);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

console.log('\n  Starting QATools…\n');
start('api', process.execPath, [tsx, apiEntry], '35', resolve(root, 'apps/api'));
// Vite must run from apps/web so it finds index.html and vite.config.ts.
start(
  'web',
  process.execPath,
  [viteBin, '--host', '127.0.0.1', '--port', String(WEB_PORT)],
  '36',
  resolve(root, 'apps/web'),
);

/* --------------------------------------------------- wait for API health */

const deadline = Date.now() + 60_000;
let healthy = false;
while (Date.now() < deadline) {
  try {
    const res = await fetch(`${API_URL}/api/health`, { signal: AbortSignal.timeout(2000) });
    if (res.ok) {
      healthy = true;
      break;
    }
  } catch {
    /* not up yet */
  }
  await new Promise((r) => setTimeout(r, 600));
}

console.log('');
if (healthy) {
  console.log('  ┌─────────────────────────────────────────────────────────┐');
  console.log('  │  QATools siap dipakai                                   │');
  console.log('  └─────────────────────────────────────────────────────────┘');
  console.log(`\n   Buka di browser : \x1b[36m${WEB_URL}\x1b[0m`);
  console.log(`   API langsung    : ${API_URL}/api/health`);
  console.log(`   Mock system-uji : ${API_URL}/api/mock/demo`);
  console.log('\n   Alur yang disarankan:');
  console.log('     1. Sidebar → Projects        → pilih/buat project (isi URL web Anda)');
  console.log('     2. Analyzer Web Existing     → tempel URL, dapatkan requirement + use case');
  console.log('     3. Requirements → Use Cases → Scenarios → Test Cases');
  console.log('     4. Traceability Matrix       → lihat cakupan & gap');
  console.log('     5. Cycle & Sprint            → rencanakan');
  console.log('     6. Run Center                → eksekusi (API/DB/Web/AI)');
  console.log('     7. AI Agent Pool             → regresi paralel multi-worker');
  console.log('     8. Code Generator            → ekspor ke Playwright/Robot/pytest');
  console.log('     9. Regresi (King) & Metrics  → quality gate rilis');
  console.log('\n   Tekan Ctrl+C untuk berhenti.\n');
} else {
  console.log('  ! API tidak merespons dalam 60 detik — cek log [api] di atas.\n');
}
