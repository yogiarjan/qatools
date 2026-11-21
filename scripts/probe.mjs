/**
 * Boot-and-probe harness. Lead-owned.
 * Starts the API on a scratch port/DB, waits for health, runs probes, then exits.
 *
 *   node scripts/probe.mjs                 # health + module registration
 *   node scripts/probe.mjs /api/projects   # also GET each extra path
 */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const port = Number(process.env.PROBE_PORT ?? 5199);

const scratch = mkdtempSync(resolve(tmpdir(), 'qatools-probe-'));
const dbFile = resolve(scratch, 'probe.db');

const tsx = resolve(root, 'apps/api/node_modules/tsx/dist/cli.mjs');
const child = spawn(process.execPath, [tsx, resolve(root, 'apps/api/src/server.ts')], {
  cwd: resolve(root, 'apps/api'),
  env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', QATOOLS_DB: dbFile },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let serverLog = '';
child.stdout.on('data', (d) => (serverLog += d.toString()));
child.stderr.on('data', (d) => (serverLog += d.toString()));

const base = `http://127.0.0.1:${port}`;

async function waitForHealth(timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(2500) });
      if (res.ok) return await res.json();
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`API did not become healthy within ${timeoutMs}ms.\n--- server log ---\n${serverLog}`);
}

function cleanup(code) {
  try {
    child.kill('SIGKILL');
  } catch {
    /* ignore */
  }
  try {
    rmSync(scratch, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  process.exit(code);
}

try {
  const health = await waitForHealth();
  console.log('HEALTH', JSON.stringify({ status: health.status, db: health.db, version: health.version }));

  const mods = health.modules ?? [];
  const ok = mods.filter((m) => m.ok);
  const bad = mods.filter((m) => !m.ok);
  console.log(`MODULES ${ok.length}/${mods.length} registered`);
  for (const m of ok) console.log(`  ok   ${m.name}`);
  for (const m of bad) console.log(`  FAIL ${m.name} — ${m.error}`);

  const extra = process.argv.slice(2);
  let failures = 0;
  for (const path of extra) {
    try {
      const res = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(30000) });
      const text = await res.text();
      const short = text.length > 400 ? `${text.slice(0, 400)}…` : text;
      console.log(`GET ${path} -> ${res.status} ${short}`);
      if (!res.ok) failures++;
    } catch (err) {
      console.log(`GET ${path} -> ERROR ${err.message}`);
      failures++;
    }
  }

  console.log(failures === 0 && bad.length === 0 ? 'PROBE_RESULT=PASS' : 'PROBE_RESULT=FAIL');
  cleanup(failures === 0 && bad.length === 0 ? 0 : 1);
} catch (err) {
  console.error('PROBE_ERROR', err.message);
  cleanup(1);
}
