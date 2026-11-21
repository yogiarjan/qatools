/**
 * QATools independent end-to-end verification harness (verifier-owned).
 * Rewritten against the REAL route surface verified by _verify/dump-routes.mjs.
 *
 *   node _verify/e2e.mjs [--json]
 *
 * Boots the API itself on a scratch port + throwaway SQLite DB, drives the entire
 * ordered QA lifecycle over real HTTP, asserts real values, prints one PASS/FAIL
 * line per step, and exits non-zero if ANY step fails.
 *
 * Resilience: transport errors become status 0 (never an exception); a failed step
 * skips its dependants and is reported; missing modules are SKIP with the status.
 */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const PORT = Number(process.env.E2E_PORT ?? 5271);
const BASE = `http://127.0.0.1:${PORT}`;
const DUMP_JSON = process.argv.includes('--json');

const results = [];
const transcript = [];
const fives = [];

function log(line) {
  transcript.push(line);
  console.log(line);
}

async function step(name, fn, { skip = false, skipReason = '' } = {}) {
  if (skip) {
    results.push({ name, status: 'SKIP', detail: skipReason });
    log(`SKIP  ${name} — ${skipReason}`);
    return { ok: false, skipped: true };
  }
  const started = Date.now();
  try {
    const out = await fn();
    const ms = Date.now() - started;
    if (out && out.ok) {
      results.push({ name, status: 'PASS', detail: out.detail ?? '', ms });
      log(`PASS  ${name} — ${out.detail ?? ''}  (${ms}ms)`);
      return { ok: true, value: out.value };
    }
    const detail = out?.detail ?? 'assertion failed';
    results.push({ name, status: 'FAIL', detail, ms });
    log(`FAIL  ${name} — ${detail}  (${ms}ms)`);
    return { ok: false, value: out?.value };
  } catch (err) {
    const ms = Date.now() - started;
    const detail = err instanceof Error ? err.message : String(err);
    results.push({ name, status: 'FAIL', detail, ms });
    log(`FAIL  ${name} — THREW ${detail}  (${ms}ms)`);
    return { ok: false };
  }
}

/* ------------------------------ HTTP ------------------------------ */

async function req(method, path, body, opts = {}) {
  const init = { method, signal: AbortSignal.timeout(opts.timeoutMs ?? 30000) };
  if (body !== undefined) {
    init.body = opts.rawBody !== undefined ? opts.rawBody : JSON.stringify(body);
    init.headers = { 'content-type': opts.contentType ?? 'application/json' };
  }
  if (opts.headers) init.headers = { ...(init.headers ?? {}), ...opts.headers };
  try {
    const res = await fetch(`${BASE}${path}`, init);
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      /* non-JSON */
    }
    return { status: res.status, ok: res.ok, text, json };
  } catch (err) {
    return { status: 0, ok: false, text: '', json: null, error: err instanceof Error ? err.message : String(err) };
  }
}
const GET = (p, o) => req('GET', p, undefined, o);
const POST = (p, b, o) => req('POST', p, b, o);
const PATCH = (p, b, o) => req('PATCH', p, b, o);
const PUT = (p, b, o) => req('PUT', p, b, o);

function r(res, max = 240) {
  if (res.status === 0) return `TRANSPORT_ERROR(${res.error})`;
  const t = res.text.length > max ? `${res.text.slice(0, max)}…` : res.text;
  return `${res.status} ${t}`;
}
const isList = (res) => res.json && Array.isArray(res.json.data) && typeof res.json.total === 'number';
const isErr = (res) =>
  res.json && res.json.error && typeof res.json.error.code === 'string' && typeof res.json.error.message === 'string';

/* ---------------------------- server ------------------------------ */

const scratch = mkdtempSync(resolve(tmpdir(), 'qatools-e2e-'));
const dbFile = resolve(scratch, 'e2e.db');
const tsx = resolve(root, 'apps/api/node_modules/tsx/dist/cli.mjs');
let child = null;
let serverLog = '';

function startServer() {
  child = spawn(process.execPath, [tsx, resolve(root, 'apps/api/src/server.ts')], {
    cwd: resolve(root, 'apps/api'),
    env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', QATOOLS_DB: dbFile },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => (serverLog += d.toString()));
  child.stderr.on('data', (d) => (serverLog += d.toString()));
}

async function waitForHealth(timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child && child.exitCode !== null) {
      throw new Error(`server exited early (code ${child.exitCode})\n--- log ---\n${serverLog}`);
    }
    const res = await GET('/api/health', { timeoutMs: 2500 });
    if (res.status === 200 && res.json?.status === 'ok') return res.json;
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`API not healthy in ${timeoutMs}ms\n--- log ---\n${serverLog}`);
}

/**
 * Seed the curriculum into the scratch DB so the learning half of the lifecycle has
 * real content. Runs the lane-E seeder as a child process against QATOOLS_DB=our scratch file.
 * Failure here is reported, never fatal — the learning steps then SKIP with a reason.
 */
async function seedCurriculum() {
  return await new Promise((resolvePromise) => {
    const p = spawn(process.execPath, [tsx, resolve(root, 'apps/api/src/seed/run.ts')], {
      cwd: resolve(root, 'apps/api'),
      env: { ...process.env, QATOOLS_DB: dbFile },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    p.stdout.on('data', (d) => (out += d.toString()));
    p.stderr.on('data', (d) => (out += d.toString()));
    p.on('exit', (code) => resolvePromise({ code, out }));
    p.on('error', (err) => resolvePromise({ code: -1, out: String(err) }));
  });
}

let cleaned = false;
function cleanup(code) {
  if (cleaned) return;
  cleaned = true;
  try {
    child?.kill('SIGKILL');
  } catch {}
  try {
    rmSync(scratch, { recursive: true, force: true });
  } catch {}
  process.exit(code);
}

/* --------------------------- lifecycle ---------------------------- */

async function main() {
  log(`=== QATools independent E2E — ${new Date().toISOString()} ===`);
  log(`node ${process.version} | port ${PORT} | db ${dbFile}`);
  log('');

  startServer();
  const health = await waitForHealth();
  log(`HEALTH ${JSON.stringify({ status: health.status, db: health.db, version: health.version })}`);
  const mods = health.modules ?? [];
  const badMods = mods.filter((m) => !m.ok);
  log(`MODULES ${mods.length - badMods.length}/${mods.length} registered`);
  for (const m of badMods) log(`  module FAIL ${m.name} — ${m.error}`);
  log('');

  const live = new Set(mods.filter((m) => m.ok).map((m) => m.name));
  const have = (n) => live.has(n);
  const ctx = {};

  await step('boot: /api/health ok + db ok', async () => ({
    ok: health.status === 'ok' && health.db === 'ok',
    detail: `status=${health.status} db=${health.db} version=${health.version}`,
  }));
  await step('boot: all 21 declared modules register', async () => ({
    ok: badMods.length === 0,
    detail: badMods.length === 0 ? `${mods.length}/${mods.length}` : `${badMods.length} failed: ${badMods.map((m) => m.name).join(', ')}`,
  }));

  /* --- 0. engine honesty --- */
  await step('engine capabilities endpoint responds honestly', async () => {
    const res = await GET('/api/execute/capabilities');
    if (res.status !== 200) return { ok: false, detail: `expected 200, got ${r(res)}` };
    const c = res.json?.data ?? res.json;
    return { ok: true, detail: `${JSON.stringify(c).slice(0, 260)}` };
  });

  /* --- 1. project --- */
  const projStep = await step('create project', async () => {
    const res = await POST('/api/projects', {
      key: 'E2E',
      name: 'E2E Verification Project',
      description: 'Independent verification harness',
      target_url: BASE,
      owner: 'verifier',
      quality_gate: 90,
    });
    if (res.status !== 201) return { ok: false, detail: `expected 201, got ${r(res)}` };
    const p = res.json?.data;
    if (!p?.id) return { ok: false, detail: `no data.id: ${r(res)}` };
    if (!p.id.startsWith('prj_')) return { ok: false, detail: `bad id prefix: ${p.id}` };
    ctx.projectId = p.id;
    return { ok: true, detail: `id=${p.id} key=${p.key}` };
  });

  /* --- 2. requirement --- */
  const reqStep = await step(
    'create requirement REQ-001 (critical)',
    async () => {
      const res = await POST(`/api/projects/${ctx.projectId}/requirements`, {
        code: 'REQ-001',
        title: 'User dapat login dengan kredensial valid',
        description: 'Autentikasi pengguna',
        priority: 'critical',
        acceptance_criteria: ['Login sukses', 'Token dikembalikan'],
      });
      if (res.status !== 201) return { ok: false, detail: `expected 201, got ${r(res)}` };
      const row = res.json?.data;
      if (!row?.id?.startsWith('req_')) return { ok: false, detail: `bad id/prefix: ${r(res)}` };
      ctx.requirementId = row.id;
      return { ok: true, detail: `id=${row.id} code=${row.code} priority=${row.priority}` };
    },
    { skip: !projStep.ok, skipReason: 'requires project' },
  );

  /* --- 3. use case --- */
  const ucStep = await step(
    'create use case UC-001 (+ auto link to requirement)',
    async () => {
      const res = await POST(`/api/projects/${ctx.projectId}/usecases`, {
        code: 'UC-001',
        name: 'Login pengguna',
        goal: 'Pengguna dapat masuk ke aplikasi',
        actors: ['Pengguna terdaftar'],
        preconditions: ['Akun terdaftar'],
        postconditions: ['Sesi aktif'],
        main_flow: ['Buka halaman login', 'Isi kredensial', 'Klik masuk'],
        priority: 'critical',
        risk: 'high',
        requirement_ids: ctx.requirementId ? [ctx.requirementId] : [],
      });
      if (res.status !== 201) return { ok: false, detail: `expected 201, got ${r(res)}` };
      const row = res.json?.data;
      if (!row?.id?.startsWith('uc_')) return { ok: false, detail: `bad id/prefix: ${r(res)}` };
      ctx.useCaseId = row.id;
      return { ok: true, detail: `id=${row.id} code=${row.code}` };
    },
    { skip: !ctx.requirementId, skipReason: 'requires requirement' },
  );

  /* --- 4. scenarios --- */
  const scStep = await step(
    'create scenario SC-001 (happy path)',
    async () => {
      const res = await POST(`/api/projects/${ctx.projectId}/scenarios`, {
        use_case_id: ctx.useCaseId,
        code: 'SC-001',
        title: 'Login berhasil dengan kredensial valid',
        kind: 'happy_path',
        given_text: 'Pengguna di halaman login',
        when_text: 'Kredensial valid dimasukkan',
        then_text: 'Diarahkan ke dashboard',
        priority: 'critical',
      });
      if (res.status !== 201) return { ok: false, detail: `expected 201, got ${r(res)}` };
      const row = res.json?.data;
      if (!row?.id?.startsWith('sc_')) return { ok: false, detail: `bad id/prefix: ${r(res)}` };
      ctx.scenarioId = row.id;
      return { ok: true, detail: `id=${row.id} code=${row.code}` };
    },
    { skip: !ctx.useCaseId, skipReason: 'requires use case' },
  );

  const scStep2 = await step(
    'create scenario SC-002 (negative)',
    async () => {
      const res = await POST(`/api/projects/${ctx.projectId}/scenarios`, {
        use_case_id: ctx.useCaseId,
        code: 'SC-002',
        title: 'Login gagal dengan password salah',
        kind: 'negative',
        given_text: 'Pengguna di halaman login',
        when_text: 'Password salah dimasukkan',
        then_text: 'Sistem menampilkan pesan error',
        priority: 'high',
      });
      if (res.status !== 201) return { ok: false, detail: `expected 201, got ${r(res)}` };
      ctx.scenarioId2 = res.json?.data?.id;
      return { ok: true, detail: `id=${ctx.scenarioId2}` };
    },
    { skip: !ctx.useCaseId, skipReason: 'requires use case' },
  );

  /* --- 5. test cases --- */
  const tcStep = await step(
    'create test case TC-001 (api, regression, critical)',
    async () => {
      const res = await POST(`/api/projects/${ctx.projectId}/testcases`, {
        scenario_id: ctx.scenarioId,
        use_case_id: ctx.useCaseId,
        code: 'TC-001',
        title: 'GET /api/mock/ping mengembalikan 200',
        objective: 'Verifikasi endpoint ping',
        type: 'functional',
        layer: 'api',
        priority: 'critical',
        severity: 'blocker',
        automation_status: 'automated',
        engine: 'api',
        is_regression: 1,
        estimated_minutes: 5,
        expected_result: 'Status 200',
        steps: [
          { action: 'Kirim GET /api/mock/ping', expected: 'Status 200' },
          { action: 'Periksa body.ok', expected: 'ok = true' },
        ],
      });
      if (res.status !== 201) return { ok: false, detail: `expected 201, got ${r(res)}` };
      const row = res.json?.data;
      if (!row?.id?.startsWith('tc_')) return { ok: false, detail: `bad id/prefix: ${r(res)}` };
      ctx.testCaseId = row.id;
      return { ok: true, detail: `id=${row.id} code=${row.code} engine=${row.engine} regression=${row.is_regression} risk=${row.risk_score}` };
    },
    { skip: !ctx.scenarioId, skipReason: 'requires scenario' },
  );

  const tcStep2 = await step(
    'create test case TC-002 (manual, negative)',
    async () => {
      const res = await POST(`/api/projects/${ctx.projectId}/testcases`, {
        scenario_id: ctx.scenarioId2,
        use_case_id: ctx.useCaseId,
        code: 'TC-002',
        title: 'Login password salah menampilkan error',
        type: 'negative',
        layer: 'web',
        priority: 'medium',
        severity: 'major',
        automation_status: 'manual',
        engine: 'manual',
        estimated_minutes: 10,
      });
      if (res.status !== 201) return { ok: false, detail: `expected 201, got ${r(res)}` };
      ctx.testCaseId2 = res.json?.data?.id;
      return { ok: true, detail: `id=${ctx.testCaseId2}` };
    },
    { skip: !ctx.scenarioId2, skipReason: 'requires scenario #2' },
  );

  /* --- 6. matrix --- */
  await step(
    'matrix: full chain linked ⇒ covered, arithmetic consistent',
    async () => {
      // Make sure links exist (lane A may or may not auto-link).
      const res = await GET(`/api/projects/${ctx.projectId}/matrix`);
      if (res.status !== 200) return { ok: false, detail: `expected 200, got ${r(res)}` };
      const doc = res.json?.data ?? res.json;
      const cells = doc?.cells;
      const summary = doc?.summary;
      if (!Array.isArray(cells)) return { ok: false, detail: `no cells[]: ${r(res)}` };
      if (!summary) return { ok: false, detail: `no summary: ${r(res)}` };
      const cell = cells.find((c) => c.requirement_id === ctx.requirementId);
      if (!cell) return { ok: false, detail: `requirement missing from cells` };
      const counted = (summary.covered ?? 0) + (summary.partial ?? 0) + (summary.gaps ?? 0);
      if (counted !== summary.requirements) {
        return { ok: false, detail: `covered+partial+gaps=${counted} != requirements=${summary.requirements}` };
      }
      if (!cell.test_case_ids?.length) {
        return { ok: false, detail: `chain linked but cell has no test_case_ids: ${JSON.stringify(cell)}` };
      }
      return {
        ok: true,
        detail: `reqs=${summary.requirements} covered=${summary.covered} partial=${summary.partial} gaps=${summary.gaps} coverage_pct=${summary.coverage_pct} cell=${cell.coverage} tc=${cell.test_case_ids.length}`,
      };
    },
    { skip: !ctx.testCaseId, skipReason: 'requires test case' },
  );

  /* --- 7. cycle / sprint / scope --- */
  const cycStep = await step(
    'create cycle',
    async () => {
      const res = await POST(`/api/projects/${ctx.projectId}/cycles`, {
        code: 'CYC-2026-Q1',
        name: 'Siklus Q1 2026',
        goal: 'Stabilkan autentikasi',
        start_date: '2026-01-01',
        end_date: '2026-03-31',
      });
      if (res.status !== 201) return { ok: false, detail: `expected 201, got ${r(res)}` };
      const row = res.json?.data;
      if (!row?.id?.startsWith('cyc_')) return { ok: false, detail: `bad id/prefix: ${r(res)}` };
      ctx.cycleId = row.id;
      return { ok: true, detail: `id=${row.id} code=${row.code}` };
    },
    { skip: !ctx.projectId, skipReason: 'requires project' },
  );

  const sprStep = await step(
    'create sprint in cycle',
    async () => {
      const res = await POST(`/api/cycles/${ctx.cycleId}/sprints`, {
        code: 'SPR-01',
        name: 'Sprint 1',
        goal: 'Autentikasi',
        capacity_points: 40,
      });
      if (res.status !== 201) return { ok: false, detail: `expected 201, got ${r(res)}` };
      const row = res.json?.data;
      if (!row?.id?.startsWith('spr_')) return { ok: false, detail: `bad id/prefix: ${r(res)}` };
      ctx.sprintId = row.id;
      return { ok: true, detail: `id=${row.id} code=${row.code}` };
    },
    { skip: !ctx.cycleId, skipReason: 'requires cycle' },
  );

  await step(
    'add test case to sprint scope',
    async () => {
      const res = await POST(`/api/sprints/${ctx.sprintId}/scope`, {
        test_case_id: ctx.testCaseId,
        assignee: 'verifier',
        estimate_minutes: 5,
      });
      if (res.status !== 201 && res.status !== 200) return { ok: false, detail: `expected 200/201, got ${r(res)}` };
      const list = await GET(`/api/sprints/${ctx.sprintId}/scope`);
      if (list.status !== 200) return { ok: false, detail: `scope list -> ${r(list)}` };
      const rows = list.json?.data ?? list.json;
      const arr = Array.isArray(rows) ? rows : rows?.data;
      if (!Array.isArray(arr) || !arr.some((s) => s.test_case_id === ctx.testCaseId)) {
        return { ok: false, detail: `scope added but not listed: ${r(list)}` };
      }
      return { ok: true, detail: `scope contains TC-001 (${arr.length} item)` };
    },
    { skip: !ctx.sprintId || !ctx.testCaseId, skipReason: 'requires sprint + test case' },
  );

  /* --- 8. environment --- */
  const envStep = await step(
    'create environment (api_base = this API)',
    async () => {
      const res = await POST(`/api/projects/${ctx.projectId}/environments`, {
        name: 'E2E Local',
        kind: 'local',
        api_base: BASE,
        base_url: BASE,
        is_default: 1,
      });
      if (res.status !== 201) return { ok: false, detail: `expected 201, got ${r(res)}` };
      const row = res.json?.data;
      if (!row?.id?.startsWith('env_')) return { ok: false, detail: `bad id/prefix: ${r(res)}` };
      ctx.environmentId = row.id;
      return { ok: true, detail: `id=${row.id} name=${row.name}` };
    },
    { skip: !ctx.projectId, skipReason: 'requires project' },
  );

  /* --- 9. execute API test for real --- */
  const collStep = await step(
    'create API collection',
    async () => {
      const res = await POST(`/api/projects/${ctx.projectId}/collections`, {
        name: 'E2E Collection',
        base_url: BASE,
      });
      if (res.status !== 201) return { ok: false, detail: `expected 201, got ${r(res)}` };
      ctx.collectionId = res.json?.data?.id;
      return { ok: true, detail: `id=${ctx.collectionId}` };
    },
    { skip: !ctx.projectId, skipReason: 'requires project' },
  );

  const apiReqStep = await step(
    'create API request → GET /api/mock/products (built-in SUT)',
    async () => {
      const res = await POST(`/api/collections/${ctx.collectionId}/requests`, {
        name: 'Mock products',
        method: 'GET',
        path: '/api/mock/products',
        test_case_id: ctx.testCaseId,
        body_type: 'none',
        assertions: [
          { source: 'status', operator: 'equals', expected: 200 },
          { source: 'jsonpath', path: '$.total', operator: 'gte', expected: 1 },
        ],
      });
      if (res.status !== 201) return { ok: false, detail: `expected 201, got ${r(res)}` };
      const row = res.json?.data;
      if (!row?.id?.startsWith('apr_')) return { ok: false, detail: `bad id/prefix: ${r(res)}` };
      ctx.apiRequestId = row.id;
      return { ok: true, detail: `id=${row.id} ${row.method} ${row.path}` };
    },
    { skip: !ctx.collectionId, skipReason: 'requires collection' },
  );

  await step(
    'execute API test ⇒ REAL pass with evidence',
    async () => {
      const res = await POST(`/api/requests/${ctx.apiRequestId}/run`, {
        environment_id: ctx.environmentId,
        base_url: BASE,
        timeout_ms: 15000,
      });
      if (res.status !== 200 && res.status !== 201) return { ok: false, detail: `expected 200/201, got ${r(res)}` };
      const out = res.json?.data ?? res.json;
      const status = out?.status ?? out?.result?.status;
      if (status !== 'passed') return { ok: false, detail: `engine did not pass: ${r(res, 400)}` };
      const ev = out?.evidence ?? out?.result?.evidence;
      if (!ev || JSON.stringify(ev) === '{}') {
        return { ok: false, detail: `status=passed but NO evidence (possible fake pass): ${r(res, 400)}` };
      }
      ctx.apiExecPassed = true;
      return { ok: true, detail: `status=${status} assertions=${(out.assertions ?? out.result?.assertions ?? []).length} evidence=${JSON.stringify(ev).slice(0, 200)}` };
    },
    { skip: !ctx.apiRequestId, skipReason: 'requires api request' },
  );

  /* --- 10. DB check --- */
  const dbConnStep = await step(
    'create DB connection to scratch sqlite',
    async () => {
      const res = await POST(`/api/projects/${ctx.projectId}/db-connections`, {
        name: 'E2E Scratch DB',
        dialect: 'sqlite',
        dsn: dbFile,
        readonly_guard: 1,
      });
      if (res.status !== 201) return { ok: false, detail: `expected 201, got ${r(res)}` };
      const row = res.json?.data;
      if (!row?.id) return { ok: false, detail: `no id: ${r(res)}` };
      ctx.dbConnectionId = row.id;
      return { ok: true, detail: `id=${row.id} dialect=${row.dialect} guard=${row.readonly_guard}` };
    },
    { skip: !ctx.projectId, skipReason: 'requires project' },
  );

  await step(
    'execute DB check against scratch sqlite ⇒ pass',
    async () => {
      const create = await POST(`/api/projects/${ctx.projectId}/db-checks`, {
        connection_id: ctx.dbConnectionId,
        test_case_id: ctx.testCaseId,
        name: 'sqlite_master punya tabel',
        sql: "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table'",
        assertions: [{ source: 'row_count', operator: 'gte', expected: 1 }],
      });
      if (create.status !== 201) return { ok: false, detail: `create expected 201, got ${r(create)}` };
      const checkId = create.json?.data?.id;
      // ARCHITECTURE.md:121 mandates the `dbc_` prefix for db checks. Record the actual prefix
      // as a separate contract step rather than failing the lifecycle run here.
      if (!checkId) return { ok: false, detail: `no id: ${r(create)}` };
      ctx.dbCheckPrefix = String(checkId).slice(0, 4);
      const exec = await POST(`/api/db-checks/${checkId}/run`, {});
      if (exec.status !== 200 && exec.status !== 201) return { ok: false, detail: `run expected 200/201, got ${r(exec)}` };
      const out = exec.json?.data ?? exec.json;
      const status = out?.status ?? out?.result?.status;
      if (status !== 'passed') return { ok: false, detail: `db check did not pass: ${r(exec, 400)}` };
      ctx.dbCheckId = checkId;
      return { ok: true, detail: `id=${checkId} status=${status} evidence=${JSON.stringify(out?.evidence ?? out?.result?.evidence ?? {}).slice(0, 160)}` };
    },
    { skip: !ctx.dbConnectionId, skipReason: 'requires db connection' },
  );

  /* --- 10b. id-prefix contract (ARCHITECTURE.md §5.3) --- */
  await step(
    'id prefixes match ARCHITECTURE.md §5.3',
    async () => {
      const want = {
        project: ['prj_', ctx.projectId],
        requirement: ['req_', ctx.requirementId],
        usecase: ['uc_', ctx.useCaseId],
        scenario: ['sc_', ctx.scenarioId],
        testcase: ['tc_', ctx.testCaseId],
        cycle: ['cyc_', ctx.cycleId],
        sprint: ['spr_', ctx.sprintId],
        run: ['run_', ctx.runId],
        runresult: ['res_', ctx.runResultId],
        environment: ['env_', ctx.environmentId],
        apirequest: ['apr_', ctx.apiRequestId],
        dbcheck: ['dbc_', ctx.dbCheckId],
      };
      const bad = [];
      for (const [k, [pfx, id]] of Object.entries(want)) {
        if (!id) continue;
        if (!String(id).startsWith(pfx)) bad.push(`${k}: expected ${pfx}, got ${String(id).slice(0, 4)} (${id})`);
      }
      if (bad.length) return { ok: false, detail: bad.join(' | ') };
      return { ok: true, detail: `${Object.values(want).filter(([, v]) => v).length} entity ids conform to §5.3` };
    },
    { skip: !ctx.testCaseId, skipReason: 'requires created entities' },
  );

  /* --- 11. AI offline --- */
  await step(
    'AI status reports mode/provider',
    async () => {
      const res = await GET('/api/ai/status');
      if (res.status !== 200) return { ok: false, detail: `expected 200, got ${r(res)}` };
      const s = res.json?.data ?? res.json;
      if (typeof s?.mode !== 'string') return { ok: false, detail: `no mode: ${r(res)}` };
      return { ok: true, detail: `mode=${s.mode} provider=${s.provider} configured=${s.configured}` };
    },
    { skip: !have('ai'), skipReason: 'ai not registered' },
  );

  await step(
    'AI generate offline ⇒ used_mock:true and real stub data',
    async () => {
      const res = await POST('/api/ai/generate', {
        task: 'generate_scenarios',
        project_id: ctx.projectId,
        input: { use_case_ids: ctx.useCaseId ? [ctx.useCaseId] : [], per_use_case: 2 },
        persist: false,
      });
      if (res.status !== 200 && res.status !== 201) return { ok: false, detail: `expected 200/201, got ${r(res)}` };
      // The module may wrap the AiResult in the standard {data:...} envelope or return it bare.
      const body = res.json ?? {};
      const out = body.data && typeof body.data === 'object' && 'meta' in body.data ? body.data : body;
      ctx.aiOut = out;
      if (!out?.ok) return { ok: false, detail: `ok falsy: ${r(res, 400)}` };
      if (out.meta?.used_mock !== true) return { ok: false, detail: `expected used_mock=true, got ${JSON.stringify(out.meta)}` };
      if (out.data === null || out.data === undefined) return { ok: false, detail: `used_mock but data null` };
      const n = Array.isArray(out.data) ? out.data.length : 1;
      return { ok: true, detail: `used_mock=${out.meta.used_mock} provider=${out.meta.provider} latency=${out.meta.latency_ms}ms items=${n} sample=${JSON.stringify(out.data).slice(0, 130)}` };
    },
    { skip: !have('ai') || !ctx.useCaseId, skipReason: 'requires ai + use case' },
  );

  /* --- 12. run + results --- */
  const runStep = await step(
    'create test run',
    async () => {
      const res = await POST(`/api/projects/${ctx.projectId}/runs`, {
        cycle_id: ctx.cycleId,
        sprint_id: ctx.sprintId,
        environment_id: ctx.environmentId,
        name: 'E2E Manual Run',
        kind: 'manual',
        engine: 'manual',
      });
      if (res.status !== 201) return { ok: false, detail: `expected 201, got ${r(res)}` };
      const row = res.json?.data;
      if (!row?.id?.startsWith('run_')) return { ok: false, detail: `bad id/prefix: ${r(res)}` };
      ctx.runId = row.id;
      return { ok: true, detail: `id=${row.id} code=${row.code}` };
    },
    { skip: !ctx.projectId, skipReason: 'requires project' },
  );

  const resultStep = await step(
    'record manual run result = failed',
    async () => {
      const res = await POST(`/api/runs/${ctx.runId}/results`, {
        test_case_id: ctx.testCaseId2,
        status: 'failed',
        engine: 'manual',
        duration_ms: 1234,
        actual_result: 'Pesan error tidak muncul',
        error_message: 'Pesan error tidak muncul',
        executed_by: 'verifier',
      });
      if (res.status !== 201 && res.status !== 200) return { ok: false, detail: `expected 200/201, got ${r(res)}` };
      // This endpoint returns the run's result SET (an array), not a single row.
      const payload = res.json?.data;
      const rows = Array.isArray(payload) ? payload : payload ? [payload] : [];
      const row = rows.find((x) => x.test_case_id === ctx.testCaseId2) ?? rows[0];
      if (!row?.id?.startsWith('res_')) return { ok: false, detail: `no res_ row in response: ${r(res)}` };
      ctx.runResultId = row.id;
      return { ok: true, detail: `id=${row.id} status=${row.status}` };
    },
    { skip: !ctx.runId || !ctx.testCaseId2, skipReason: 'requires run + tc2' },
  );

  /* --- 13. defect promotion --- */
  const defectStep = await step(
    'promote failure → defect (traceable link)',
    async () => {
      const res = await POST(`/api/projects/${ctx.projectId}/defects`, {
        title: 'Pesan error login tidak tampil',
        description: 'Ditemukan saat run manual',
        severity: 'major',
        priority: 'high',
        source: 'manual',
        test_case_id: ctx.testCaseId2,
        run_result_id: ctx.runResultId,
        expected_result: 'Pesan error tampil',
        actual_result: 'Tidak ada pesan error',
      });
      if (res.status !== 201 && res.status !== 200) return { ok: false, detail: `expected 201/200, got ${r(res)}` };
      const row = res.json?.data;
      if (!row?.id?.startsWith('bug_')) return { ok: false, detail: `bad id/prefix: ${r(res)}` };
      ctx.defectId = row.id;
      const detail = await GET(`/api/defects/${ctx.defectId}`);
      if (detail.status !== 200) return { ok: false, detail: `defect GET -> ${r(detail)}` };
      const d = detail.json?.data;
      if (d?.test_case_id !== ctx.testCaseId2) {
        return { ok: false, detail: `defect.test_case_id=${d?.test_case_id} != ${ctx.testCaseId2}` };
      }
      return { ok: true, detail: `id=${row.id} code=${row.code} linked_tc=${d.test_case_id} run_result=${d.run_result_id}` };
    },
    { skip: !ctx.runResultId || !ctx.testCaseId2, skipReason: 'requires failed result' },
  );

  /* --- 14. regression plan --- */
  await step(
    'regression plan selects high-risk case WITH a reason',
    async () => {
      // Mark TC-001 as regression + high risk first.
      await PATCH(`/api/testcases/${ctx.testCaseId}`, { is_regression: 1, engine: 'api' });
      const res = await GET(`/api/projects/${ctx.projectId}/regression/plan?strategy=risk_based`);
      if (res.status !== 200) return { ok: false, detail: `expected 200, got ${r(res)}` };
      const plan = res.json?.data ?? res.json;
      if (!Array.isArray(plan?.selected)) return { ok: false, detail: `no selected[]: ${r(res)}` };
      if (!plan.selected.length) return { ok: false, detail: `selected 0 cases although a critical regression case exists: ${r(res, 400)}` };
      const hit = plan.selected.find((s) => s.test_case_id === ctx.testCaseId);
      if (!hit) return { ok: false, detail: `TC-001 not selected; got ${JSON.stringify(plan.selected.map((s) => s.code))}` };
      if (!hit.reason?.trim()) return { ok: false, detail: `no reason: ${JSON.stringify(hit)}` };
      if (typeof hit.risk_score !== 'number') return { ok: false, detail: `no numeric risk_score: ${JSON.stringify(hit)}` };
      return {
        ok: true,
        detail: `selected=${plan.selected.length} risk=${hit.risk_score}/${hit.risk_level} reason="${hit.reason.slice(0, 80)}" est=${JSON.stringify(plan.estimates)}`,
      };
    },
    { skip: !ctx.testCaseId, skipReason: 'requires test case' },
  );

  /* --- 15. metrics --- */
  await step(
    'metrics: totals match reality and are internally consistent',
    async () => {
      const res = await GET(`/api/projects/${ctx.projectId}/metrics`);
      if (res.status !== 200) return { ok: false, detail: `expected 200, got ${r(res)}` };
      const m = res.json?.data ?? res.json;
      const t = m?.totals;
      if (!t) return { ok: false, detail: `no totals: ${r(res)}` };
      // Independently count what we created via the list endpoints.
      const tcs = await GET(`/api/projects/${ctx.projectId}/testcases`);
      const realTc = tcs.json?.total ?? tcs.json?.data?.length;
      if (Number(t.test_cases) !== Number(realTc)) {
        return { ok: false, detail: `metrics.test_cases=${t.test_cases} but list endpoint reports ${realTc}` };
      }
      if (Number(t.test_cases) < 2) return { ok: false, detail: `test_cases=${t.test_cases} expected >=2` };
      if (Number(t.defects_total) < 1) return { ok: false, detail: `defects_total=${t.defects_total} expected >=1` };
      const pr = m.quality?.pass_rate;
      if (typeof pr !== 'number' || pr < 0 || pr > 100) return { ok: false, detail: `pass_rate out of range: ${pr}` };
      const cov = m.coverage?.requirement_coverage_pct;
      if (typeof cov !== 'number' || Number.isNaN(cov)) return { ok: false, detail: `coverage pct missing/NaN: ${cov}` };
      return {
        ok: true,
        detail: `req=${t.requirements} uc=${t.use_cases} tc=${t.test_cases}(list=${realTc}) defects=${t.defects_total} pass_rate=${pr} req_cov=${cov}% gate=${m.readiness?.go_no_go}`,
      };
    },
    { skip: !ctx.projectId, skipReason: 'requires project' },
  );

  /* --- 15b. cross-module agreement: matrix vs metrics coverage --- */
  await step(
    'matrix and metrics agree on requirement coverage',
    async () => {
      const mx = await GET(`/api/projects/${ctx.projectId}/matrix`);
      const mt = await GET(`/api/projects/${ctx.projectId}/metrics`);
      if (mx.status !== 200 || mt.status !== 200) {
        return { ok: false, detail: `matrix=${mx.status} metrics=${mt.status}` };
      }
      const mSum = (mx.json?.data ?? mx.json)?.summary;
      const mCov = (mt.json?.data ?? mt.json)?.coverage?.requirement_coverage_pct;
      if (typeof mSum?.coverage_pct !== 'number' || typeof mCov !== 'number') {
        return { ok: false, detail: `missing values: matrix=${mSum?.coverage_pct} metrics=${mCov}` };
      }
      if (mSum.coverage_pct !== mCov) {
        return {
          ok: false,
          detail: `CONTRADICTION: matrix coverage_pct=${mSum.coverage_pct} but metrics requirement_coverage_pct=${mCov} for the same project (matrix says covered=${mSum.covered}, gaps=${mSum.gaps})`,
        };
      }
      return { ok: true, detail: `both report ${mSum.coverage_pct}%` };
    },
    { skip: !ctx.projectId, skipReason: 'requires project' },
  );

  /* --- 16. learning --- */
  // Seed the curriculum first so the learning chain has real content to walk.
  const seed = await seedCurriculum();
  await step('curriculum seeder runs clean on a scratch DB', async () => ({
    ok: seed.code === 0,
    detail:
      seed.code === 0
        ? `${(seed.out.match(/stored totals:.*/) ?? [''])[0].trim()}`
        : `exit=${seed.code} ${seed.out.slice(-400)}`,
  }));

  const enrollStep = await step(
    'enroll learner in a seeded course',
    async () => {
      const res = await GET('/api/courses');
      if (res.status !== 200) return { ok: false, detail: `GET /api/courses -> ${r(res)}` };
      const list = res.json?.data;
      if (!Array.isArray(list) || !list.length) return { ok: false, detail: `no courses seeded: ${r(res)}` };
      // Pick the smallest course so the lesson walk is quick but real.
      const course = list.find((c) => c.slug === 'qa-introduction') ?? list[0];
      ctx.courseId = course.id;
      ctx.learnerEmail = `verifier+${Date.now()}@example.com`;
      const e = await POST('/api/enrollments', {
        course_id: course.id,
        learner_name: 'Verifier E2E',
        learner_email: ctx.learnerEmail,
      });
      if (e.status !== 201 && e.status !== 200) return { ok: false, detail: `enroll -> ${r(e)}` };
      const row = e.json?.data;
      if (!row?.id) return { ok: false, detail: `no enrollment id: ${r(e)}` };
      ctx.enrollmentId = row.id;
      return { ok: true, detail: `course=${course.slug} enrollment=${row.id} status=${e.status}` };
    },
    { skip: !have('courses'), skipReason: 'courses not registered' },
  );

  await step(
    'complete all lessons ⇒ progress reaches 100%',
    async () => {
      const res = await GET(`/api/enrollments/${ctx.enrollmentId}`);
      if (res.status !== 200) return { ok: false, detail: `enrollment -> ${r(res)}` };
      const enr = res.json?.data;
      const lessons = enr?.lessons ?? [];
      if (!lessons.length) return { ok: false, detail: `enrollment has 0 lessons: ${r(res, 300)}` };
      let last = null;
      for (const l of lessons) {
        const c = await POST(`/api/enrollments/${ctx.enrollmentId}/progress`, { lesson_id: l.id, completed: true });
        if (![200, 201, 204].includes(c.status)) return { ok: false, detail: `progress ${l.id} -> ${r(c)}` };
        last = c.json?.data;
      }
      const after = await GET(`/api/enrollments/${ctx.enrollmentId}`);
      const pct = after.json?.data?.progress_pct;
      const done = after.json?.data?.completed_lessons;
      if (Number(done) !== lessons.length) {
        return { ok: false, detail: `${lessons.length} lessons marked but completed_lessons=${done}` };
      }
      if (Number(pct) !== 100) return { ok: false, detail: `all lessons done but progress_pct=${pct}` };
      ctx.lessonCount = lessons.length;
      return { ok: true, detail: `${lessons.length}/${lessons.length} lessons, progress_pct=${pct}` };
    },
    { skip: !ctx.enrollmentId, skipReason: 'requires enrollment' },
  );

  await step(
    'pass every quiz in the course (scores recorded)',
    async () => {
      const course = await GET(`/api/courses/${ctx.courseId}`);
      const detail = course.json?.data ?? course.json;
      const quizzes = detail?.quizzes ?? [];
      if (course.status !== 200) return { ok: false, detail: `course detail -> ${r(course)}` };
      if (!quizzes.length) return { ok: false, detail: `course has 0 quizzes: ${r(course, 300)}` };
      let recorded = 0;
      for (const q of quizzes) {
        const qd = await GET(`/api/courses/${ctx.courseId}/quizzes/${q.id}`);
        const questions = (qd.json?.data ?? qd.json)?.questions ?? [];
        if (!questions.length) return { ok: false, detail: `quiz ${q.id} has no questions: ${r(qd, 250)}` };
        const correct = questions.map((qq) => qq.answer_index);
        const points = questions.reduce((a, b) => a + (b.points ?? 1), 0);
        const got = correct.reduce((a, idx, i) => a + (idx === questions[i].answer_index ? (questions[i].points ?? 1) : 0), 0);
        const score = points ? Math.round((got / points) * 100) : 100;
        // The module records quiz outcomes through the progress endpoint.
        const res = await POST(`/api/enrollments/${ctx.enrollmentId}/progress`, {
          lesson_id: questions[0].lesson_id ?? q.lesson_id ?? null,
          completed: true,
          score,
          quiz_id: q.id,
          passed: true,
          pass_score: q.pass_score,
        });
        if (![200, 201].includes(res.status)) return { ok: false, detail: `quiz ${q.id} submit -> ${r(res)}` };
        recorded++;
      }
      ctx.quizCount = quizzes.length;
      return { ok: true, detail: `${recorded}/${quizzes.length} quizzes recorded as passed` };
    },
    { skip: !ctx.enrollmentId, skipReason: 'requires enrollment' },
  );

  const certStep = await step(
    'issue certificate after completion',
    async () => {
      const res = await POST(`/api/enrollments/${ctx.enrollmentId}/certificate`, {});
      if (res.status !== 201 && res.status !== 200) return { ok: false, detail: `issue -> ${r(res)}` };
      const c = res.json?.data;
      if (!c?.code) return { ok: false, detail: `no code: ${r(res)}` };
      if (!c.id?.startsWith('cert_')) return { ok: false, detail: `bad id prefix: ${c.id}` };
      if (!c.verification_hash) return { ok: false, detail: `no verification_hash` };
      // A real certificate must carry a real SHA-256 (64 hex chars), not a placeholder.
      if (!/^[0-9a-f]{64}$/.test(String(c.verification_hash))) {
        return { ok: false, detail: `verification_hash is not a SHA-256 hex digest: ${c.verification_hash}` };
      }
      ctx.certCode = c.code;
      ctx.certId = c.id;
      return { ok: true, detail: `code=${c.code} grade=${c.grade} score=${c.score} hash=${String(c.verification_hash).slice(0, 16)}…` };
    },
    { skip: !ctx.enrollmentId, skipReason: 'requires completed enrollment' },
  );

  await step(
    'verify certificate with real code ⇒ valid',
    async () => {
      const res = await GET(`/api/certificates/verify/${encodeURIComponent(ctx.certCode)}`);
      if (res.status !== 200) return { ok: false, detail: `verify -> ${r(res)}` };
      const out = res.json?.data ?? res.json;
      if (out?.valid !== true) return { ok: false, detail: `valid code rejected: ${r(res, 400)}` };
      return { ok: true, detail: `valid=true learner=${out.learner_name} course=${out.course_title}` };
    },
    { skip: !ctx.certCode, skipReason: 'requires certificate' },
  );

  await step(
    'certificate renders standalone HTML',
    async () => {
      const res = await GET(`/api/certificates/${ctx.certId}/render?format=html`);
      if (res.status !== 200) return { ok: false, detail: `render -> ${r(res)}` };
      if (!/<html/i.test(res.text)) return { ok: false, detail: `not HTML: ${res.text.slice(0, 160)}` };
      if (!res.text.includes(ctx.certCode)) return { ok: false, detail: `rendered HTML lacks the certificate code` };
      // Must be self-contained: no external assets.
      const external = [...res.text.matchAll(/(?:src|href)="(https?:\/\/[^"]+)"/g)].map((x) => x[1]);
      if (external.length) return { ok: false, detail: `references external assets: ${external.slice(0, 3).join(', ')}` };
      return { ok: true, detail: `HTML ${res.text.length} bytes, self-contained, contains ${ctx.certCode}` };
    },
    { skip: !ctx.certId, skipReason: 'requires certificate' },
  );

  /* ========================= adversarial ========================= */
  log('');
  log('--- adversarial / negative testing ---');

  async function neg(name, fn, deps = {}) {
    const missing = Object.entries(deps).filter(([, v]) => !v).map(([k]) => k);
    if (missing.length) {
      log(`SKIP  [neg] ${name} — missing: ${missing.join(', ')}`);
      results.push({ name: `[neg] ${name}`, status: 'SKIP', detail: `missing: ${missing.join(', ')}` });
      return;
    }
    await step(`[neg] ${name}`, fn);
  }

  await neg('malformed JSON body ⇒ 4xx not 500', async () => {
    const res = await req('POST', '/api/projects', undefined, { rawBody: '{"key":"BAD",', contentType: 'application/json' });
    if (res.status >= 500) {
      fives.push(`malformed JSON -> ${res.status} ${res.text.slice(0, 120)}`);
      return { ok: false, detail: `got ${r(res)}; expected 4xx` };
    }
    if (res.status < 400) return { ok: false, detail: `malformed JSON accepted: ${r(res)}` };
    return { ok: true, detail: `${res.status} ${res.text.slice(0, 130)}` };
  });

  await neg('missing required field ⇒ 400 + error envelope', async () => {
    const res = await POST('/api/projects', { description: 'no key/name' });
    if (res.status >= 500) {
      fives.push(`missing field -> ${res.status}`);
      return { ok: false, detail: `got ${r(res)}` };
    }
    if (![400, 422].includes(res.status)) return { ok: false, detail: `expected 400/422, got ${r(res)}` };
    if (!isErr(res)) return { ok: false, detail: `malformed error envelope: ${r(res)}` };
    return { ok: true, detail: `${res.status} ${res.text.slice(0, 140)}` };
  });

  for (const [label, path] of [
    ['unknown project', '/api/projects/prj_DOESNOTEXIST0000000000'],
    ['unknown test case', '/api/testcases/tc_DOESNOTEXIST0000000000'],
    ['unknown defect', '/api/defects/bug_DOESNOTEXIST0000000000'],
    ['unknown environment', '/api/environments/env_DOESNOTEXIST0000000000'],
    ['unknown run', '/api/runs/run_DOESNOTEXIST0000000000'],
    ['unknown course', '/api/courses/crs_DOESNOTEXIST0000000000'],
    ['unknown requirement', '/api/requirements/req_DOESNOTEXIST0000000000'],
    ['unknown use case', '/api/usecases/uc_DOESNOTEXIST0000000000'],
    ['unknown cycle', '/api/cycles/cyc_DOESNOTEXIST0000000000'],
    ['unknown db check', '/api/db-checks/dbc_DOESNOTEXIST0000000000'],
  ]) {
    await neg(`GET ${label} ⇒ 404 not 500`, async () => {
      const res = await GET(path);
      if (res.status >= 500) {
        fives.push(`GET ${path} -> ${res.status} ${res.text.slice(0, 100)}`);
        return { ok: false, detail: `5xx: ${r(res)}` };
      }
      if (res.status !== 404) return { ok: false, detail: `expected 404, got ${r(res)}` };
      if (!isErr(res)) return { ok: false, detail: `bad error envelope: ${r(res)}` };
      return { ok: true, detail: `404 ${res.text.slice(0, 100)}` };
    });
  }

  await neg('SQL injection in filters ⇒ no 500, tables survive', async () => {
    const payloads = ["' OR 1=1 --", "'; DROP TABLE projects; --", "%' UNION SELECT * FROM sqlite_master --", "1' AND 1=CAST((SELECT sql FROM sqlite_master LIMIT 1) AS INT)--"];
    const codes = [];
    for (const p of payloads) {
      for (const ep of ['/api/projects?q=', '/api/projects?search=', '/api/projects?status=']) {
        const res = await GET(`${ep}${encodeURIComponent(p)}`);
        codes.push(res.status);
        if (res.status >= 500) {
          fives.push(`SQLi ${ep}${p} -> ${res.status} ${res.text.slice(0, 120)}`);
          return { ok: false, detail: `500 on ${ep}${p}: ${r(res)}` };
        }
      }
    }
    const after = await GET('/api/projects');
    if (after.status !== 200) return { ok: false, detail: `projects table gone after injection: ${r(after)}` };
    return { ok: true, detail: `${codes.length} attempts, statuses=${[...new Set(codes)].join('/')}, projects still lists ${after.json?.total}` };
  });

  await neg(
    'readonly_guard blocks destructive SQL',
    async () => {
      const create = await POST(`/api/projects/${ctx.projectId}/db-checks`, {
        connection_id: ctx.dbConnectionId,
        name: 'guard bypass attempt',
        sql: 'DROP TABLE activity_log',
      });
      const checkId = create.json?.data?.id;
      if (!checkId) return { ok: false, detail: `cannot create check: ${r(create)}` };
      const exec = await POST(`/api/db-checks/${checkId}/run`, {});
      if (exec.status >= 500) {
        fives.push(`readonly_guard DROP -> ${exec.status}`);
        return { ok: false, detail: `500 instead of guarded 4xx: ${r(exec)}` };
      }
      const out = exec.json?.data ?? exec.json;
      const st = out?.status ?? out?.error;
      if (exec.status < 400 && st === 'passed') {
        return { ok: false, detail: `DESTRUCTIVE SQL ALLOWED — guard bypassed: ${r(exec, 300)}` };
      }
      return { ok: true, detail: `blocked: ${exec.status} ${exec.text.slice(0, 200)}` };
    },
    { dbConnectionId: ctx.dbConnectionId, projectId: ctx.projectId },
  );

  await neg(
    'certificate refused before completion',
    async () => {
      const courses = await GET('/api/courses');
      const c = courses.json?.data?.[0];
      if (!c) return { ok: false, detail: 'no course' };
      const enr = await POST('/api/enrollments', {
        course_id: c.id,
        learner_name: 'Premature Learner',
        learner_email: `premature+${Date.now()}@example.com`,
      });
      const eid = enr.json?.data?.id;
      if (!eid) return { ok: false, detail: `enroll failed: ${r(enr)}` };
      const res = await POST(`/api/enrollments/${eid}/certificate`, {});
      if (res.status >= 500) {
        fives.push(`premature certificate -> ${res.status}`);
        return { ok: false, detail: `500 instead of 4xx: ${r(res)}` };
      }
      if (res.status < 400) return { ok: false, detail: `CERTIFICATE ISSUED WITHOUT COMPLETION: ${r(res, 300)}` };
      return { ok: true, detail: `refused: ${res.status} ${res.text.slice(0, 150)}` };
    },
    { courses: have('courses') },
  );

  await neg(
    'tampered certificate code ⇒ invalid',
    async () => {
      const tampered = `${ctx.certCode.slice(0, -2)}XX`;
      const res = await GET(`/api/certificates/verify/${encodeURIComponent(tampered)}`);
      if (res.status >= 500) {
        fives.push(`tampered cert -> ${res.status}`);
        return { ok: false, detail: `500: ${r(res)}` };
      }
      const out = res.json?.data ?? res.json;
      if (res.status === 200 && out?.valid === true) {
        return { ok: false, detail: `TAMPERED CODE ACCEPTED: ${r(res, 300)}` };
      }
      return { ok: true, detail: `rejected (${res.status}) ${res.text.slice(0, 150)}` };
    },
    { certCode: ctx.certCode },
  );

  await neg(
    'AI with bogus provider degrades, no 500',
    async () => {
      const res = await POST('/api/ai/generate', {
        task: 'generate_usecases',
        input: { feature_description: 'bogus provider' },
        provider: 'definitely-not-a-provider',
        preview_only: true,
      });
      if (res.status >= 500) {
        fives.push(`bogus AI provider -> ${res.status}`);
        return { ok: false, detail: `500: ${r(res)}` };
      }
      // The ai module returns the bare AiResult ({ok,data,error,meta}), NOT wrapped in {data:...}.
      const out = res.json?.meta ? res.json : (res.json?.data ?? res.json);
      const degraded = out?.meta?.degraded === true || out?.meta?.used_mock === true;
      if (res.status === 200 && out?.ok === true && !degraded) {
        return { ok: false, detail: `success claimed with bogus provider, no degradation flag: ${r(res, 300)}` };
      }
      return { ok: true, detail: `${res.status} ok=${out?.ok} degraded=${out?.meta?.degraded} used_mock=${out?.meta?.used_mock} provider=${out?.meta?.provider}` };
    },
    { ai: have('ai') },
  );

  await neg(
    'execute test case with no artifacts ⇒ clean failure',
    async () => {
      const res = await POST(`/api/test-cases/${ctx.testCaseId2}/execute`, { engine: 'api' });
      if (res.status >= 500) {
        fives.push(`execute no artifacts -> ${res.status}`);
        return { ok: false, detail: `500: ${r(res)}` };
      }
      return { ok: true, detail: `${res.status} ${res.text.slice(0, 200)}` };
    },
    { testCaseId2: ctx.testCaseId2 },
  );

  await neg('list endpoints use {data,total}', async () => {
    const paths = ['/api/projects', '/api/projects/' + ctx.projectId + '/testcases', '/api/projects/' + ctx.projectId + '/defects'];
    const bad = [];
    for (const p of paths) {
      const res = await GET(p);
      if (res.status !== 200) {
        bad.push(`${p}->${res.status}`);
        continue;
      }
      if (!isList(res)) bad.push(`${p} bad envelope ${res.text.slice(0, 90)}`);
    }
    if (bad.length) return { ok: false, detail: bad.join(' | ') };
    return { ok: true, detail: `${paths.length} conformant` };
  });

  await neg('unknown route ⇒ 404 + error envelope', async () => {
    const res = await GET('/api/this-route-does-not-exist');
    if (res.status !== 404) return { ok: false, detail: `expected 404, got ${r(res)}` };
    if (!isErr(res)) return { ok: false, detail: `bad envelope: ${r(res)}` };
    return { ok: true, detail: `404 ${res.text.slice(0, 100)}` };
  });

  /* --------------------------- summary --------------------------- */
  log('');
  log('=== SUMMARY ===');
  const pass = results.filter((x) => x.status === 'PASS').length;
  const fail = results.filter((x) => x.status === 'FAIL');
  const skip = results.filter((x) => x.status === 'SKIP').length;
  log(`PASS=${pass} FAIL=${fail.length} SKIP=${skip} TOTAL=${results.length}`);
  if (fail.length) {
    log('');
    log('--- FAILURES ---');
    for (const f of fail) log(`  FAIL ${f.name} — ${f.detail}`);
  }
  if (fives.length) {
    log('');
    log(`--- 5xx RESPONSES (${fives.length}) ---`);
    for (const f of fives) log(`  ${f}`);
  }

  mkdirSync(here, { recursive: true });
  writeFileSync(resolve(here, 'last-run.txt'), transcript.join('\n'), 'utf8');
  if (DUMP_JSON) {
    writeFileSync(resolve(here, 'last-run.json'), JSON.stringify({ results, fives, when: new Date().toISOString() }, null, 2), 'utf8');
  }

  log('');
  log(fail.length === 0 ? 'E2E_RESULT=PASS' : 'E2E_RESULT=FAIL');
  if (fail.length) {
    log('--- server log tail ---');
    log(serverLog.slice(-3500));
  }
  cleanup(fail.length === 0 ? 0 : 1);
}

process.on('uncaughtException', (err) => {
  console.error('HARNESS CRASH', err);
  transcript.push(`HARNESS CRASH ${err?.stack ?? err}`);
  try {
    writeFileSync(resolve(here, 'last-run.txt'), transcript.join('\n'), 'utf8');
  } catch {}
  cleanup(2);
});

main().catch((err) => {
  console.error('HARNESS ERROR', err);
  transcript.push(`HARNESS ERROR ${err?.stack ?? err}`);
  console.log('E2E_RESULT=FAIL');
  try {
    writeFileSync(resolve(here, 'last-run.txt'), transcript.join('\n'), 'utf8');
  } catch {}
  cleanup(1);
});
