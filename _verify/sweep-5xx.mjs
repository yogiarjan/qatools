/**
 * Whole-surface 5xx hunter (verifier-owned).
 *
 * Boots the API on a seeded scratch DB and issues a legitimate GET to every registered
 * route, plus a battery of malformed/negative requests, reporting every 5xx.
 * Goal: prove or falsify "no route returns 500 on a legitimate request".
 */
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const PORT = Number(process.env.SWEEP_PORT ?? 5351);
const BASE = `http://127.0.0.1:${PORT}`;
const DB = resolve(tmpdir(), `sweep-${Date.now()}.db`);
const tsx = resolve(root, 'apps/api/node_modules/tsx/dist/cli.mjs');

/* ---- collect every declared GET route with its PATH params replaced by unknowns ---- */
const modsDir = resolve(root, 'apps/api/src/modules');
const files = [];
(function walk(d) {
  for (const e of readdirSync(d)) {
    const p = join(d, e);
    if (statSync(p).isDirectory()) walk(p);
    else if (e === 'index.ts') files.push(p);
  }
})(modsDir);

const routes = [];
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  const re = /app\.(get|post|put|patch|delete)\s*(?:<[\s\S]*?>)?\s*\(\s*[`'"](\/[^`'"]*)[`'"]/g;
  let m;
  while ((m = re.exec(src)) !== null) routes.push({ verb: m[1].toUpperCase(), path: m[2], file: f.slice(root.length + 1) });
}
// De-duplicate
const seen = new Set();
const unique = routes.filter((r) => {
  const k = `${r.verb} ${r.path}`;
  if (seen.has(k)) return false;
  seen.add(k);
  return true;
});

/* ---- boot ---- */
const child = spawn(process.execPath, [tsx, resolve(root, 'apps/api/src/server.ts')], {
  cwd: resolve(root, 'apps/api'),
  env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', QATOOLS_DB: DB },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
child.stdout.on('data', (d) => (serverLog += d.toString()));
child.stderr.on('data', (d) => (serverLog += d.toString()));
for (let i = 0; i < 120; i++) {
  try {
    if ((await fetch(`${BASE}/api/health`)).ok) break;
  } catch {}
  await new Promise((r) => setTimeout(r, 300));
}

// Seed curriculum so learning routes have content.
await new Promise((res) => {
  const s = spawn(process.execPath, [tsx, resolve(root, 'apps/api/src/seed/run.ts')], {
    cwd: resolve(root, 'apps/api'),
    env: { ...process.env, QATOOLS_DB: DB },
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  s.on('exit', res);
});

const j = async (u, m = 'GET', b) => {
  try {
    const r = await fetch(BASE + u, {
      method: m,
      headers: { 'content-type': 'application/json' },
      body: b ? JSON.stringify(b) : undefined,
      signal: AbortSignal.timeout(20000),
    });
    const t = await r.text();
    return { s: r.status, t };
  } catch (e) {
    return { s: 0, t: String(e.message) };
  }
};

// Build a real project + chain so param routes resolve.
const proj = (await j('/api/projects', 'POST', { key: 'SWEEP', name: 'Sweep' })).t;
const pid = JSON.parse(proj).data.id;
const req = JSON.parse((await j(`/api/projects/${pid}/requirements`, 'POST', { code: 'REQ-001', title: 'T' })).t).data.id;
const uc = JSON.parse((await j(`/api/projects/${pid}/usecases`, 'POST', { code: 'UC-001', name: 'U', requirement_ids: [req] })).t).data.id;
const sc = JSON.parse((await j(`/api/projects/${pid}/scenarios`, 'POST', { use_case_id: uc, code: 'SC-001', title: 'S' })).t).data.id;
const tc = JSON.parse((await j(`/api/projects/${pid}/testcases`, 'POST', { scenario_id: sc, use_case_id: uc, code: 'TC-001', title: 'T' })).t).data.id;

const subs = { projectId: pid, id: tc, ':id': tc, caseId: tc, artifactId: tc, collectionId: 'UNKNOWN', cycleId: 'UNKNOWN', runId: 'UNKNOWN', resultId: 'UNKNOWN', code: 'UNKNOWN', courseId: 'UNKNOWN', lessonId: 'UNKNOWN' };

console.log(`=== WHOLE-SURFACE SWEEP — ${unique.length} declared routes ===\n`);
const fives = [];
const results = [];

for (const r of unique) {
  if (r.verb !== 'GET') continue; // start with the safe/idempotent half
  let p = r.path;
  for (const [k, v] of Object.entries(subs)) p = p.replace(`:${k.replace(':', '')}`, v);
  p = p.replace(/:[A-Za-z]+/g, 'UNKNOWN');
  if (r.path.startsWith('/projects') && !r.path.includes(':projectId')) p = p.replace('/projects', `/projects`);
  const res = await j(`/api${p}`);
  // /api/mock/flaky is the mock SYSTEM UNDER TEST: it returns 500 by design on 2 of every 3
  // calls so automation lanes can prove retry/healing. A 5xx there is the feature working.
  const EXPECTED_500 = p === '/mock/flaky';
  const flag = res.s >= 500 && !EXPECTED_500 ? '  <<< 5xx' : res.s >= 500 ? '  (intentional SUT failure)' : '';
  if (res.s >= 500 && !EXPECTED_500) fives.push(`GET /api${p} (${r.file}) -> ${res.s} ${res.t.slice(0, 180)}`);
  results.push(`${res.s}  GET /api${p}${flag}`);
  console.log(`${String(res.s).padStart(3)}  GET /api${p}${flag}`);
}

console.log(`\n=== NEGATIVE BATTERY ===`);
const negs = [
  ['POST /api/projects malformed', '/api/projects', 'POST', undefined, '{"broken":'],
  ['POST /api/projects empty', '/api/projects', 'POST', {}],
  ['POST /api/projects bad types', '/api/projects', 'POST', { key: { a: 1 }, name: [1, 2] }],
  ['POST /api/projects huge key', '/api/projects', 'POST', { key: 'X'.repeat(5000), name: 'n' }],
  ['POST /api/projects null bytes', '/api/projects', 'POST', { key: 'A\u0000B', name: 'n\u0000' }],
  ['POST /api/enrollments bad email', '/api/enrollments', 'POST', { course_id: 'x', learner_name: 'n', learner_email: '!!not-an-email' }],
  ['POST /api/enrollments unknown course', '/api/enrollments', 'POST', { course_id: 'crs_NOPE', learner_name: 'n', learner_email: 'a@b.co' }],
  ['POST /api/quizzes/unknown/submit', '/api/quizzes/qz_NOPE/submit', 'POST', { answers: [] }],
  ['POST /api/ai/generate unknown task', '/api/ai/generate', 'POST', { task: 'not_a_task' }],
  ['POST /api/test-cases/unknown/execute', '/api/test-cases/tc_NOPE/execute', 'POST', { engine: 'api' }],
  ['POST /api/db-checks/unknown/run', '/api/db-checks/dbc_NOPE/run', 'POST', {}],
  ['POST /api/certificates/unknown/revoke', '/api/certificates/cert_NOPE/revoke', 'POST', { reason: 'x' }],
  ['PATCH /api/testcases/unknown', '/api/testcases/tc_NOPE', 'PATCH', { title: 'x' }],
  ['GET /api/projects/../../etc/passwd', '/api/projects/..%2F..%2Fetc%2Fpasswd', 'GET', undefined],
];
for (const [label, path, verb, body, raw] of negs) {
  let res;
  if (raw !== undefined) {
    try {
      const rr = await fetch(BASE + path, { method: verb, headers: { 'content-type': 'application/json' }, body: raw });
      res = { s: rr.status, t: await rr.text() };
    } catch (e) {
      res = { s: 0, t: e.message };
    }
  } else {
    res = await j(path, verb, body);
  }
  const flag = res.s >= 500 ? '  <<< 5xx' : '';
  if (res.s >= 500) fives.push(`${label} -> ${res.s} ${res.t.slice(0, 180)}`);
  console.log(`${String(res.s).padStart(3)}  ${label}${flag}`);
}

console.log(`\n=== SUMMARY ===`);
console.log(`routes swept: ${unique.filter((r) => r.verb === 'GET').length} GET | negative cases: ${negs.length}`);
if (fives.length) {
  console.log(`\n5xx RESPONSES (${fives.length}):`);
  for (const f of fives) console.log(`  ${f}`);
  console.log('\nSWEEP=FAIL');
} else {
  console.log('ZERO 5xx responses across the entire swept surface.');
  console.log('\nSWEEP=PASS');
}

child.kill('SIGKILL');
process.exit(fives.length ? 1 : 0);
