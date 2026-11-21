/**
 * Lane B — QA Project Management test suite.
 *
 * Exercises the real Fastify app against a scratch SQLite database (never the dev DB), so the
 * tests cover routing, envelopes, repositories and services together.
 *
 * Run from the repo root:
 *   node --test --import ./apps/api/node_modules/tsx/dist/loader.mjs apps/api/test/lane-b.test.ts
 */

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { newId, nowIso } from '@qatools/shared';

/* ------------------------------------------------------------------ *
 * Scratch database — must be set BEFORE the app (and `db`) are imported.
 * ------------------------------------------------------------------ */

const scratch = mkdtempSync(resolve(tmpdir(), 'qatools-lane-b-'));
process.env.QATOOLS_DB = resolve(scratch, 'lane-b.db');

/**
 * The lane builds its own Fastify instance instead of importing `server.ts`.
 *
 * Two reasons:
 *  1. `server.ts` is lead-owned and registers EVERY lane; importing it would make this suite
 *     fail whenever another lane is mid-write (a half-saved module breaks module resolution).
 *  2. Mounting only lane B's modules proves the lane's own contract, and leaves the
 *     cross-lane wiring to the lead's integration probe.
 *
 * The prefix and the module registration order match `server.ts`, so route behaviour is identical.
 */
const Fastify = (await import('fastify')).default;
const { migrate } = await import('../src/db/index.js');
const { db } = await import('../src/db/index.js');

const app = Fastify({ logger: false, bodyLimit: 32 * 1024 * 1024 });
migrate();

const LANE_B_MODULES: Array<{ name: string; path: string }> = [
  { name: 'cycles', path: '../src/modules/cycles/index.js' },
  { name: 'runs', path: '../src/modules/runs/index.js' },
  { name: 'regression', path: '../src/modules/regression/index.js' },
  { name: 'metrics', path: '../src/modules/metrics/index.js' },
  { name: 'defects', path: '../src/modules/defects/index.js' },
  { name: 'environment', path: '../src/modules/environment/index.js' },
];

for (const mod of LANE_B_MODULES) {
  const imported = (await import(mod.path)) as { default: unknown };
  assert.equal(typeof imported.default, 'function', `modul ${mod.name} harus punya default export plugin`);
  await app.register(imported.default as never, { prefix: '/api' });
}

/**
 * Lane A's matrix module is mounted too, but ONLY for the §5.4 agreement test: the metrics
 * module must report the same coverage number the matrix reports. It is registered
 * opportunistically so a lane-A refactor cannot fail this suite for the wrong reason.
 */
let matrixAvailable = false;
try {
  const matrix = (await import('../src/modules/matrix/index.js')) as { default: unknown };
  if (typeof matrix.default === 'function') {
    await app.register(matrix.default as never, { prefix: '/api' });
    matrixAvailable = true;
  }
} catch {
  matrixAvailable = false;
}

await app.ready();

/* ------------------------------------------------------------------ *
 * Fixtures
 * ------------------------------------------------------------------ */

const PROJECT_ID = newId('prj_');
const OTHER_PROJECT_ID = newId('prj_');
let useCaseId = '';
let scenarioId = '';
/** High risk: critical + always + complex + defect history + last-run-failed + regression. */
let highRiskCaseId = '';
/** Medium risk: medium priority functional case, no history. */
let mediumRiskCaseId = '';
/** Low risk: low priority cosmetic-ish case with no history and cold usage. */
let lowRiskCaseId = '';
let runId = '';

function seed() {
  const now = nowIso();
  const insertProject = db.prepare(
    `INSERT INTO projects (id, key, name, status, quality_gate, created_at, updated_at)
     VALUES (?, ?, ?, 'active', ?, ?, ?)`,
  );
  insertProject.run(PROJECT_ID, 'LNB', 'Lane B Test Project', 90, now, now);
  insertProject.run(OTHER_PROJECT_ID, 'LNB2', 'Other Project', 90, now, now);

  useCaseId = newId('uc_');
  db.prepare(
    `INSERT INTO use_cases (id, project_id, code, name, priority, risk, status, generated_by, created_at, updated_at)
     VALUES (?, ?, 'UC-001', 'Checkout', 'critical', 'high', 'approved', 'manual', ?, ?)`,
  ).run(useCaseId, PROJECT_ID, now, now);

  scenarioId = newId('sc_');
  db.prepare(
    `INSERT INTO scenarios (id, project_id, use_case_id, code, title, kind, priority, generated_by, created_at, updated_at)
     VALUES (?, ?, ?, 'SC-001', 'Checkout happy path', 'happy_path', 'critical', 'manual', ?, ?)`,
  ).run(scenarioId, PROJECT_ID, useCaseId, now, now);

  const insertCase = db.prepare(
    `INSERT INTO test_cases
       (id, project_id, scenario_id, use_case_id, code, title, type, layer, priority, severity,
        automation_status, engine, risk_score, estimated_minutes, is_regression, status,
        generated_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready', 'manual', ?, ?)`,
  );

  // critical priority, 5 steps, manual → high score
  highRiskCaseId = newId('tc_');
  insertCase.run(
    highRiskCaseId, PROJECT_ID, scenarioId, useCaseId, 'TC-001', 'Checkout with valid card',
    'functional', 'web', 'critical', 'blocker', 'manual', 'web', 0, 25, 1, now, now,
  );

  mediumRiskCaseId = newId('tc_');
  insertCase.run(
    mediumRiskCaseId, PROJECT_ID, scenarioId, useCaseId, 'TC-002', 'Checkout with saved address',
    'functional', 'api', 'medium', 'major', 'automated', 'api', 0, 8, 0, now, now,
  );

  lowRiskCaseId = newId('tc_');
  insertCase.run(
    lowRiskCaseId, PROJECT_ID, scenarioId, useCaseId, 'TC-003', 'Checkout page footer text',
    'usability', 'web', 'low', 'cosmetic', 'cannot_automate', 'manual', 0, 2, 0, now, now,
  );

  // Steps make TC-001 structurally complex.
  for (let i = 1; i <= 5; i++) {
    db.prepare(
      `INSERT INTO test_steps (id, test_case_id, order_index, action, expected, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(newId('tst_'), highRiskCaseId, i, `Langkah ${i}`, `Harapan ${i}`, now);
  }
}

before(() => {
  seed();
});

after(() => {
  try {
    rmSync(scratch, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});

/* ------------------------------------------------------------------ *
 * HTTP helper
 * ------------------------------------------------------------------ */

interface Res<T> {
  status: number;
  body: T;
}

async function call<T = Record<string, unknown>>(
  method: string,
  url: string,
  payload?: unknown,
): Promise<Res<T>> {
  const res = await app.inject({
    method: method as 'GET',
    url: `/api${url}`,
    ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
  });
  let body: unknown = null;
  try {
    body = res.json();
  } catch {
    body = res.body;
  }
  return { status: res.statusCode, body: body as T };
}

/* ================================================================== *
 * 1. cycle → sprint → scope
 * ================================================================== */

describe('cycles: cycle → sprint → scope', () => {
  let cycleId = '';
  let sprintId = '';

  test('creates a cycle with an auto code', async () => {
    const res = await call<{ data: { id: string; code: string; status: string } }>(
      'POST',
      `/projects/${PROJECT_ID}/cycles`,
      {
        name: 'Q1 2026',
        goal: 'Stabilkan checkout',
        start_date: '2026-01-05',
        end_date: '2026-03-27',
        entry_criteria: ['Semua requirement approved'],
        exit_criteria: ['Pass rate >= 90%', 'Tidak ada blocker terbuka'],
      },
    );
    assert.equal(res.status, 201);
    assert.match(res.body.data.code, /^CYC-/, 'cycle code harus berprefix CYC-');
    assert.equal(res.body.data.status, 'planned');
    cycleId = res.body.data.id;
  });

  test('creates a sprint nested under the cycle with an auto SPR code', async () => {
    const res = await call<{ data: { id: string; code: string; cycle_id: string; capacity_points: number } }>(
      'POST',
      `/cycles/${cycleId}/sprints`,
      {
        name: 'Sprint 1',
        goal: 'Checkout inti',
        start_date: '2026-01-05',
        end_date: '2026-01-16',
        capacity_points: 40,
      },
    );
    assert.equal(res.status, 201);
    assert.equal(res.body.data.code, 'SPR-01');
    assert.equal(res.body.data.cycle_id, cycleId);
    assert.equal(res.body.data.capacity_points, 40);
    sprintId = res.body.data.id;
  });

  test('rejects a sprint for a cycle that does not exist', async () => {
    const res = await call('POST', '/cycles/cyc_missing/sprints', { name: 'Nope' });
    assert.equal(res.status, 404);
  });

  test('adds test cases to the sprint scope, defaulting the estimate from the test case', async () => {
    const res = await call<{ data: Array<{ id: string; test_case_id: string; estimate_minutes: number; status: string }> }>(
      'POST',
      `/sprints/${sprintId}/scope`,
      { test_case_ids: [highRiskCaseId, mediumRiskCaseId], assignee: 'Budi' },
    );
    assert.equal(res.status, 201);
    assert.equal(res.body.data.length, 2);
    const high = res.body.data.find((r) => r.test_case_id === highRiskCaseId);
    assert.ok(high, 'TC-001 harus ada di scope');
    assert.equal(high!.estimate_minutes, 25, 'estimasi diwarisi dari test_cases.estimated_minutes');
    assert.equal(high!.status, 'todo');
  });

  test('scope is idempotent — re-adding the same case updates instead of duplicating', async () => {
    const before = await call<{ data: unknown[] }>('GET', `/sprints/${sprintId}/scope`);
    await call('POST', `/sprints/${sprintId}/scope`, { test_case_ids: [highRiskCaseId] });
    const after = await call<{ data: unknown[] }>('GET', `/sprints/${sprintId}/scope`);
    assert.equal(after.body.data.length, before.body.data.length);
  });

  test('rejects scope entries for unknown test cases', async () => {
    const res = await call('POST', `/sprints/${sprintId}/scope`, { test_case_ids: ['tc_does_not_exist'] });
    assert.equal(res.status, 400);
  });

  test('scope rows expose the joined test-case fields the UI renders', async () => {
    const res = await call<{ data: Array<{ tc_code: string; tc_title: string; tc_risk_score: number }> }>(
      'GET',
      `/sprints/${sprintId}/scope`,
    );
    assert.equal(res.status, 200);
    const high = res.body.data.find((r) => r.tc_code === 'TC-001');
    assert.ok(high, 'scope harus menyertakan kode test case hasil join');
    assert.equal(high!.tc_title, 'Checkout with valid card');
  });

  test('updates a scope row status and estimate', async () => {
    const list = await call<{ data: Array<{ id: string; test_case_id: string }> }>(
      'GET',
      `/sprints/${sprintId}/scope`,
    );
    const row = list.body.data.find((r) => r.test_case_id === mediumRiskCaseId);
    assert.ok(row);
    const res = await call<{ data: { status: string; assignee: string } }>(
      'PATCH',
      `/sprint-scope/${row!.id}`,
      { status: 'done', assignee: 'Sari' },
    );
    assert.equal(res.status, 200);
    assert.equal(res.body.data.status, 'done');
    assert.equal(res.body.data.assignee, 'Sari');
  });

  test('plan reports planned vs actual effort and gantt-friendly sprint geometry', async () => {
    const res = await call<{
      data: {
        totals: { cycles: number; sprints: number; scope_count: number; estimate_minutes: number };
        cycles: Array<{
          cycle_id: string;
          sprints: Array<{
            sprint_id: string;
            offset_days: number;
            duration_days: number;
            estimate_sum: number;
            status_counts: { todo: number; in_progress: number; done: number };
            progress_pct: number;
          }>;
        }>;
      };
    }>('GET', `/projects/${PROJECT_ID}/plan`);

    assert.equal(res.status, 200);
    assert.equal(res.body.data.totals.cycles, 1);
    assert.equal(res.body.data.totals.sprints, 1);
    assert.equal(res.body.data.totals.scope_count, 2);
    assert.equal(res.body.data.totals.estimate_minutes, 33, '25 + 8 menit');

    const sprint = res.body.data.cycles[0]!.sprints[0]!;
    assert.equal(sprint.sprint_id, sprintId);
    assert.equal(sprint.offset_days, 0, 'sprint mulai bersamaan dengan cycle');
    assert.equal(sprint.duration_days, 12, '5 Jan – 16 Jan inklusif');
    assert.equal(sprint.status_counts.done, 1);
    assert.equal(sprint.status_counts.todo, 1);
    assert.equal(sprint.progress_pct, 50);
  });

  test('deleting a scope row removes it from the sprint', async () => {
    const created = await call<{ data: Array<{ id: string }> }>('POST', `/sprints/${sprintId}/scope`, {
      test_case_ids: [lowRiskCaseId],
    });
    const rowId = created.body.data.find(() => true)!.id;
    const del = await call('DELETE', `/sprint-scope/${rowId}`);
    assert.equal(del.status, 200);
    const list = await call<{ data: Array<{ id: string }> }>('GET', `/sprints/${sprintId}/scope`);
    assert.ok(!list.body.data.some((r) => r.id === rowId));
  });
});

/* ================================================================== *
 * 2. manual run results + counter rollup
 * ================================================================== */

describe('runs: manual results and counter rollup', () => {
  test('creates a run with an auto RUN-nnnn code', async () => {
    const res = await call<{ data: { id: string; code: string; kind: string; status: string; total: number } }>(
      'POST',
      `/projects/${PROJECT_ID}/runs`,
      { name: 'Manual smoke', kind: 'manual', engine: 'manual', executed_by: 'Budi' },
    );
    assert.equal(res.status, 201);
    assert.match(res.body.data.code, /^RUN-\d{4}$/);
    assert.equal(res.body.data.kind, 'manual');
    assert.equal(res.body.data.status, 'running');
    assert.equal(res.body.data.total, 0);
    runId = res.body.data.id;
  });

  test('records a manual result and rolls the counter into test_runs', async () => {
    const res = await call<{ data: Array<{ status: string; test_case_id: string }> }>(
      'POST',
      `/runs/${runId}/results`,
      { test_case_id: highRiskCaseId, status: 'passed', actual_result: 'Checkout berhasil' },
    );
    assert.equal(res.status, 201);

    const run = await call<{ data: { total: number; passed: number; failed: number } }>('GET', `/runs/${runId}`);
    assert.equal(run.body.data.total, 1);
    assert.equal(run.body.data.passed, 1);
    assert.equal(run.body.data.failed, 0);
  });

  test('records failures and blocked results, and the counters follow', async () => {
    await call('POST', `/runs/${runId}/results`, {
      test_case_id: mediumRiskCaseId,
      status: 'failed',
      actual_result: 'HTTP 500',
      error_message: 'Internal Server Error',
    });
    await call('POST', `/runs/${runId}/results`, {
      test_case_id: lowRiskCaseId,
      status: 'blocked',
      actual_result: 'Environment down',
    });

    const run = await call<{ data: { total: number; passed: number; failed: number; blocked: number } }>(
      'GET',
      `/runs/${runId}`,
    );
    assert.equal(run.body.data.total, 3);
    assert.equal(run.body.data.passed, 1);
    assert.equal(run.body.data.failed, 1);
    assert.equal(run.body.data.blocked, 1);
  });

  test('recording the same test case twice upserts on unique(run_id, test_case_id)', async () => {
    const res = await call<{ data: Array<{ id: string }> }>('POST', `/runs/${runId}/results`, {
      test_case_id: highRiskCaseId,
      status: 'failed',
      actual_result: 'Regresi ditemukan',
    });
    assert.equal(res.status, 201);

    const run = await call<{ data: { total: number; passed: number; failed: number; results: unknown[] } }>(
      'GET',
      `/runs/${runId}`,
    );
    assert.equal(run.body.data.total, 3, 'tidak boleh menambah baris hasil baru');
    assert.equal(run.body.data.results.length, 3);
    assert.equal(run.body.data.passed, 0, 'hasil lama harus tertimpa');
    assert.equal(run.body.data.failed, 2);
  });

  test('rejects a result for a test case that does not exist', async () => {
    const res = await call('POST', `/runs/${runId}/results`, { test_case_id: 'tc_nope', status: 'passed' });
    assert.equal(res.status, 404);
  });

  test('completes the run, stamping finished_at and final counters', async () => {
    const res = await call<{ data: { status: string; finished_at: string; total: number; failed: number } }>(
      'POST',
      `/runs/${runId}/complete`,
    );
    assert.equal(res.status, 200);
    assert.equal(res.body.data.status, 'completed');
    assert.ok(res.body.data.finished_at, 'finished_at harus terisi');
    assert.equal(res.body.data.total, 3);
    assert.equal(res.body.data.failed, 2);
  });

  test('lists runs for the project only', async () => {
    const mine = await call<{ data: unknown[]; total: number }>('GET', `/projects/${PROJECT_ID}/runs`);
    assert.equal(mine.status, 200);
    assert.equal(mine.body.total, 1);
    const other = await call<{ total: number }>('GET', `/projects/${OTHER_PROJECT_ID}/runs`);
    assert.equal(other.body.total, 0);
  });

  test('batch result recording accepts a results[] array', async () => {
    const created = await call<{ data: { id: string } }>('POST', `/projects/${PROJECT_ID}/runs`, {
      name: 'Batch run',
      kind: 'manual',
    });
    const batchRun = created.body.data.id;
    const res = await call<{ data: unknown[] }>('POST', `/runs/${batchRun}/results`, {
      results: [
        { test_case_id: highRiskCaseId, status: 'passed' },
        { test_case_id: mediumRiskCaseId, status: 'passed' },
      ],
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.data.length, 2);
    const run = await call<{ data: { total: number; passed: number } }>('GET', `/runs/${batchRun}`);
    assert.equal(run.body.data.total, 2);
    assert.equal(run.body.data.passed, 2);
  });
});

/* ================================================================== *
 * 3. defect status transition guard
 * ================================================================== */

describe('defects: status transition guard', () => {
  let defectId = '';

  test('creates a defect with auto code BUG-nnn', async () => {
    const res = await call<{ data: { id: string; code: string; status: string } }>(
      'POST',
      `/projects/${PROJECT_ID}/defects`,
      {
        title: 'Tombol checkout tidak merespons',
        description: 'Klik tombol tidak memicu request apa pun',
        severity: 'critical',
        priority: 'high',
        test_case_id: highRiskCaseId,
        steps_to_reproduce: '1. Buka checkout\n2. Klik Bayar',
        expected_result: 'Pesanan dibuat',
        actual_result: 'Tidak terjadi apa-apa',
      },
    );
    assert.equal(res.status, 201);
    assert.match(res.body.data.code, /^BUG-\d{3}$/);
    assert.equal(res.body.data.status, 'new');
    defectId = res.body.data.id;
  });

  test('walks the legal happy path new → triaged → in_progress → fixed → retest → verified → closed', async () => {
    for (const status of ['triaged', 'in_progress', 'fixed', 'retest', 'verified', 'closed']) {
      const res = await call<{ data: { status: string; closed_at: string | null } }>(
        'PATCH',
        `/defects/${defectId}/status`,
        { status },
      );
      assert.equal(res.status, 200, `transisi ke ${status} harus diterima`);
      assert.equal(res.body.data.status, status);
    }
    const closed = await call<{ data: { closed_at: string | null } }>('GET', `/defects/${defectId}`);
    assert.ok(closed.body.data.closed_at, 'closed_at harus terisi saat ditutup');
  });

  test('REJECTS an illegal jump closed → fixed with 409 illegal_transition', async () => {
    const res = await call<{
      error: { code: string; message: string; details?: { allowed_next?: string[] } };
    }>('PATCH', `/defects/${defectId}/status`, { status: 'fixed' });

    assert.equal(res.status, 409, 'lompatan status ilegal harus ditolak');
    assert.equal(res.body.error.code, 'illegal_transition');
    assert.deepEqual(res.body.error.details?.allowed_next, ['reopened']);

    const current = await call<{ data: { status: string } }>('GET', `/defects/${defectId}`);
    assert.equal(current.body.data.status, 'closed', 'status tidak boleh berubah setelah penolakan');
  });

  test('REJECTS skipping triage: a fresh defect cannot jump new → verified', async () => {
    const created = await call<{ data: { id: string } }>('POST', `/projects/${PROJECT_ID}/defects`, {
      title: 'Defect untuk uji guard',
      severity: 'major',
    });
    const id = created.body.data.id;

    const res = await call<{ error: { code: string; details?: { allowed_next?: string[] } } }>(
      'PATCH',
      `/defects/${id}/status`,
      { status: 'verified' },
    );
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'illegal_transition');
    assert.deepEqual(res.body.error.details?.allowed_next, ['triaged', 'in_progress', 'rejected', 'deferred']);
  });

  test('allows reopened from closed and requires a working state next', async () => {
    const reopen = await call<{ data: { status: string; closed_at: string | null } }>(
      'PATCH',
      `/defects/${defectId}/status`,
      { status: 'reopened' },
    );
    assert.equal(reopen.status, 200);
    assert.equal(reopen.body.data.status, 'reopened');
    assert.equal(reopen.body.data.closed_at, null, 'closed_at harus dibersihkan saat dibuka ulang');

    const jump = await call('PATCH', `/defects/${defectId}/status`, { status: 'verified' });
    assert.equal(jump.status, 409);
  });

  test('no-op transitions are rejected as bad requests', async () => {
    const res = await call('PATCH', `/defects/${defectId}/status`, { status: 'reopened' });
    assert.equal(res.status, 400);
  });

  test('exposes the allowed-next statuses for the UI', async () => {
    const res = await call<{ data: { status: string; allowed_next: string[] } }>(
      'GET',
      `/defects/${defectId}/transitions`,
    );
    assert.equal(res.status, 200);
    assert.ok(res.body.data.allowed_next.includes('in_progress'));
  });

  test('promotes a failed run result into a defect and links both directions', async () => {
    const run = await call<{ data: { results: Array<{ id: string; test_case_id: string; status: string; defect_id: string | null }> } }>(
      'GET',
      `/runs/${runId}`,
    );
    const failed = run.body.data.results.find((r) => r.status === 'failed');
    assert.ok(failed, 'harus ada hasil gagal untuk dipromosikan');
    assert.equal(failed!.defect_id, null, 'belum tertaut sebelum promosi');

    const res = await call<{ data: { defect: { id: string; code: string; test_case_id: string }; run_result: { id: string; defect_id: string } } }>(
      'POST',
      `/defects/${failed!.id}/promote-from-result`,
      { run_result_id: failed!.id, severity: 'critical' },
    );
    assert.equal(res.status, 201);
    assert.match(res.body.data.defect.code, /^BUG-/);
    assert.equal(res.body.data.defect.test_case_id, failed!.test_case_id);
    assert.equal(
      res.body.data.run_result.defect_id,
      res.body.data.defect.id,
      'run_results.defect_id harus ditulis balik',
    );
  });

  test('promotion is idempotent — the same result never creates a second defect', async () => {
    const run = await call<{ data: { results: Array<{ id: string; defect_id: string | null; status: string }> } }>(
      'GET',
      `/runs/${runId}`,
    );
    const failed = run.body.data.results.find((r) => r.status === 'failed')!;
    assert.ok(failed.defect_id, 'hasil gagal harus sudah tertaut');

    const again = await call<{ data: { defect: { id: string } } }>(
      'POST',
      `/defects/${failed.id}/promote-from-result`,
      { run_result_id: failed.id },
    );
    assert.equal(again.status, 201);
    assert.equal(again.body.data.defect.id, failed.defect_id);
  });

  test('defect stats aggregate by severity, status and age', async () => {
    const res = await call<{
      data: {
        total: number;
        by_severity: Record<string, number>;
        by_status: Record<string, number>;
        age: { buckets: Record<string, number> };
        top_components: Array<{ code: string; count: number }>;
      };
    }>('GET', `/projects/${PROJECT_ID}/defects/stats`);

    assert.equal(res.status, 200);
    assert.ok(res.body.data.total >= 3);
    assert.ok(Object.keys(res.body.data.by_severity).length > 0);
    assert.ok(Object.keys(res.body.data.by_status).length > 0);
    assert.equal(typeof res.body.data.age.buckets.lt_1d, 'number');
  });

  test('defect list filters by status', async () => {
    const res = await call<{ data: Array<{ status: string }> }>(
      'GET',
      `/projects/${PROJECT_ID}/defects?status=new&open_only=1`,
    );
    assert.equal(res.status, 200);
    assert.ok(res.body.data.every((d) => d.status === 'new'));
  });
});

/* ================================================================== *
 * 4. regression plan — high risk first, budget respected
 * ================================================================== */

describe('regression (King): risk-based selection', () => {
  test('risk_based selects high-risk cases and always explains every decision', async () => {
    const res = await call<{
      data: {
        strategy: string;
        selected: Array<{ test_case_id: string; code: string; risk_score: number; risk_level: string; reason: string }>;
        excluded: Array<{ test_case_id: string; code: string; reason: string }>;
        estimates: {
          total_cases: number;
          selected_cases: number;
          estimated_minutes: number;
          automated_share_pct: number;
          coverage_of_high_risk_pct: number;
        };
        rationale: string;
      };
    }>('GET', `/projects/${PROJECT_ID}/regression/plan?strategy=risk_based`);

    assert.equal(res.status, 200);
    assert.equal(res.body.data.strategy, 'risk_based');

    // TC-001 is critical + web + 5 steps + regression member + last-run-failed + defect history,
    // so it must be selected and must carry a reason.
    const high = res.body.data.selected.find((s) => s.test_case_id === highRiskCaseId);
    assert.ok(high, 'TC-001 (risiko tinggi) wajib terpilih');
    assert.ok(high!.risk_score >= 65, `skor risiko harus >= 65, dapat ${high!.risk_score}`);
    assert.equal(high!.risk_level, 'high');
    assert.ok(high!.reason.length > 20, 'setiap kasus terpilih wajib punya alasan yang terbaca');
    assert.match(high!.reason, /MASUK/);

    // Every excluded case must also explain itself.
    for (const ex of res.body.data.excluded) {
      assert.ok(ex.reason.length > 20, `${ex.code} harus punya alasan pengecualian`);
      assert.match(ex.reason, /DIKELUARKAN|Anggaran|Tidak terhubung/);
    }

    // The low-risk usability case must NOT be selected in a risk-based plan.
    assert.ok(
      !res.body.data.selected.some((s) => s.test_case_id === lowRiskCaseId),
      'TC-003 (risiko rendah) tidak boleh masuk suite berbasis risiko',
    );

    assert.equal(res.body.data.estimates.total_cases, 3);
    assert.equal(
      res.body.data.estimates.selected_cases,
      res.body.data.selected.length,
    );
    assert.ok(res.body.data.estimates.estimated_minutes > 0);
    assert.ok(res.body.data.rationale.length > 40, 'rationale Bahasa Indonesia wajib ada');
    assert.match(res.body.data.rationale, /Regresi adalah Raja|Strategi/);
  });

  test('selection is deterministic — the same inputs produce the same plan', async () => {
    const a = await call<{ data: { selected: Array<{ test_case_id: string }> } }>(
      'GET',
      `/projects/${PROJECT_ID}/regression/plan?strategy=risk_based`,
    );
    const b = await call<{ data: { selected: Array<{ test_case_id: string }> } }>(
      'GET',
      `/projects/${PROJECT_ID}/regression/plan?strategy=risk_based`,
    );
    assert.deepEqual(
      a.body.data.selected.map((s) => s.test_case_id),
      b.body.data.selected.map((s) => s.test_case_id),
    );
  });

  test('full strategy selects every active case', async () => {
    const res = await call<{ data: { strategy: string; selected: unknown[]; excluded: unknown[] } }>(
      'GET',
      `/projects/${PROJECT_ID}/regression/plan?strategy=full`,
    );
    assert.equal(res.status, 200);
    assert.equal(res.body.data.selected.length, 3);
    assert.equal(res.body.data.excluded.length, 0);
  });

  test('time_boxed never exceeds the minute budget', async () => {
    // TC-001 alone costs 25 minutes, so a 25-minute budget must select exactly it.
    const tight = await call<{
      data: {
        strategy: string;
        selected: Array<{ test_case_id: string; estimated_minutes?: number; risk_score: number }>;
        estimates: { estimated_minutes: number };
        rationale: string;
      };
    }>('GET', `/projects/${PROJECT_ID}/regression/plan?strategy=time_boxed&budget_minutes=25`);

    assert.equal(tight.status, 200);
    assert.equal(tight.body.data.strategy, 'time_boxed');
    assert.ok(
      tight.body.data.estimates.estimated_minutes <= 25,
      `total menit ${tight.body.data.estimates.estimated_minutes} tidak boleh melebihi budget 25`,
    );
    // Greedy by risk: the highest-scoring case must be the first one taken.
    const topScore = Math.max(...tight.body.data.selected.map((s) => s.risk_score));
    const first = tight.body.data.selected[0]!;
    assert.equal(first.risk_score, topScore, 'kasus risiko tertinggi harus diambil lebih dahulu');

    const generous = await call<{ data: { estimates: { estimated_minutes: number }; selected: unknown[] } }>(
      'GET',
      `/projects/${PROJECT_ID}/regression/plan?strategy=time_boxed&budget_minutes=1000`,
    );
    assert.ok(
      generous.body.data.selected.length >= tight.body.data.selected.length,
      'budget lebih besar tidak boleh memilih lebih sedikit kasus',
    );
  });

  test('time_boxed announces when the budget cannot cover a high-risk case', async () => {
    const res = await call<{
      data: {
        selected: Array<{ test_case_id: string }>;
        excluded: Array<{ test_case_id: string; reason: string }>;
        detail: { excluded_high_risk: Array<{ code: string }> };
        rationale: string;
      };
    }>('GET', `/projects/${PROJECT_ID}/regression/plan?strategy=time_boxed&budget_minutes=1`);

    assert.equal(res.status, 200);
    assert.equal(res.body.data.selected.length, 0, 'budget 1 menit tidak cukup untuk kasus mana pun');
    assert.ok(res.body.data.detail.excluded_high_risk.length > 0, 'kasus risiko tinggi yang terbuang harus dilaporkan');
    assert.match(res.body.data.rationale, /PERINGATAN/);
    const highExclusion = res.body.data.excluded.find((e) => e.test_case_id === highRiskCaseId);
    assert.ok(highExclusion);
    assert.match(highExclusion!.reason, /RISIKO TINGGI TERBUANG/);
  });

  test('impact_only without impact_of yields an empty, fully-explained plan (not a silent fallback)', async () => {
    const res = await call<{
      data: { strategy: string; selected: unknown[]; excluded: Array<{ reason: string }>; rationale: string };
    }>('GET', `/projects/${PROJECT_ID}/regression/plan?strategy=impact_only`);

    assert.equal(res.status, 200);
    assert.equal(res.body.data.selected.length, 0);
    assert.ok(res.body.data.excluded.every((e) => /impact_of/.test(e.reason)));
    assert.match(res.body.data.rationale, /suite kosong/);
  });

  test('impact_only follows the traceability graph from the changed use case', async () => {
    const res = await call<{
      data: { strategy: string; selected: Array<{ test_case_id: string }>; estimates: { total_cases: number } };
    }>('GET', `/projects/${PROJECT_ID}/regression/plan?strategy=impact_only&impact_of=${useCaseId}`);

    assert.equal(res.status, 200);
    assert.equal(res.body.data.strategy, 'impact_only');
    // Every case hangs off the use case structurally, so all three are impacted.
    assert.equal(res.body.data.selected.length, 3);
    assert.ok(res.body.data.selected.some((s) => s.test_case_id === highRiskCaseId));
  });

  test('impact_only 404s for a made-up artifact id', async () => {
    const res = await call('GET', `/projects/${PROJECT_ID}/regression/plan?strategy=impact_only&impact_of=uc_hantu`);
    assert.equal(res.status, 404);
  });

  test('smoke_then_full builds two ordered phases', async () => {
    const res = await call<{
      data: {
        strategy: string;
        selected: Array<{ test_case_id: string; reason: string }>;
        detail: { phases: Array<{ name: string; test_case_ids: string[]; reason: string }> };
      };
    }>('GET', `/projects/${PROJECT_ID}/regression/plan?strategy=smoke_then_full`);

    assert.equal(res.status, 200);
    assert.equal(res.body.data.detail.phases.length, 2);
    assert.equal(res.body.data.detail.phases[0]!.name, 'Fase 1 — Smoke');
    assert.equal(res.body.data.detail.phases[1]!.name, 'Fase 2 — Suite Penuh');
    assert.ok(res.body.data.detail.phases[0]!.test_case_ids.length > 0, 'lapisan smoke tidak boleh kosong');
    assert.ok(
      res.body.data.selected.some((s) => s.reason.startsWith('[Fase 1 — Smoke]')),
      'alasan harus menyebut fase',
    );
  });

  test('an unknown strategy falls back to risk_based rather than erroring', async () => {
    const res = await call<{ data: { strategy: string } }>(
      'GET',
      `/projects/${PROJECT_ID}/regression/plan?strategy=tidak_ada`,
    );
    assert.equal(res.status, 200, 'strategi tak dikenal harus degrade, bukan gagal');
    assert.equal(res.body.data.strategy, 'risk_based');
  });

  test('per-case explain endpoint returns the scoring factors', async () => {
    const res = await call<{
      data: {
        score: number;
        level: string;
        factors: string[];
        threshold: number;
        qualifies_for_default_suite: boolean;
        inputs: {
          business_criticality: string;
          business_criticality_source: string;
          defect_history: number;
          last_run_failed: boolean;
          is_regression: boolean;
          executions: number;
        };
      };
    }>('GET', `/projects/${PROJECT_ID}/regression/explain/${highRiskCaseId}`);

    assert.equal(res.status, 200);
    assert.ok(res.body.data.score >= 65, `skor ${res.body.data.score} harus >= 65`);
    assert.equal(res.body.data.level, 'high');
    assert.equal(res.body.data.threshold, 65);
    assert.equal(res.body.data.qualifies_for_default_suite, true);
    assert.ok(res.body.data.factors.length >= 4, 'faktor skor harus dirinci');
    assert.ok(res.body.data.factors.some((f) => f.includes('business criticality')));
    assert.ok(res.body.data.factors.some((f) => f.includes('usage frequency')));

    // Criticality is inherited from the highest-priority ancestor available.
    assert.equal(res.body.data.inputs.business_criticality, 'critical');
    assert.equal(res.body.data.inputs.is_regression, true);
    assert.ok(res.body.data.inputs.executions >= 1, 'riwayat eksekusi harus terbaca');
  });

  test('a low-risk case reports a score below the default threshold', async () => {
    const res = await call<{ data: { score: number; level: string; qualifies_for_default_suite: boolean } }>(
      'GET',
      `/projects/${PROJECT_ID}/regression/explain/${lowRiskCaseId}`,
    );
    assert.equal(res.status, 200);
    assert.ok(res.body.data.score < 65, `skor ${res.body.data.score} harus < 65`);
    assert.equal(res.body.data.qualifies_for_default_suite, false);
  });

  test('regression suite membership can be set, added to, and removed', async () => {
    const set = await call<{ data: Array<{ id: string }>; total: number }>(
      'PUT',
      `/projects/${PROJECT_ID}/regression/suite`,
      { test_case_ids: [highRiskCaseId, mediumRiskCaseId] },
    );
    assert.equal(set.status, 200);
    assert.equal(set.body.total, 2);
    assert.equal(set.body.data.length, 2);

    const listed = await call<{ data: Array<{ id: string }>; total: number; summary: { size: number } }>(
      'GET',
      `/projects/${PROJECT_ID}/regression/suite`,
    );
    assert.equal(listed.body.summary.size, 2);

    const removed = await call<{ removed: number }>('DELETE', `/projects/${PROJECT_ID}/regression/suite`, {
      test_case_ids: [mediumRiskCaseId],
    });
    assert.equal(removed.status, 200);
    assert.equal(removed.body.removed, 1);

    const after = await call<{ data: Array<{ id: string }>; total: number }>(
      'GET',
      `/projects/${PROJECT_ID}/regression/suite`,
    );
    assert.equal(after.body.total, 1);
    assert.equal(after.body.data[0]!.id, highRiskCaseId);
  });

  test('flaky detection reports cases whose status keeps flipping', async () => {
    const created = await call<{ data: { id: string } }>('POST', `/projects/${PROJECT_ID}/runs`, {
      name: 'Flaky probe',
      kind: 'manual',
    });
    const flakyRun = created.body.data.id;

    // Four alternating results on one case: pass → fail → pass → fail.
    for (const status of ['passed', 'failed', 'passed', 'failed']) {
      await call('POST', `/runs/${flakyRun}/results`, {
        test_case_id: mediumRiskCaseId,
        status,
        duration_ms: 1000,
      });
    }

    const res = await call<{ data: Array<{ test_case_id: string; flips: number; pass_rate: number }>; total: number }>(
      'GET',
      `/projects/${PROJECT_ID}/regression/flaky`,
    );
    assert.equal(res.status, 200);
    const flaky = res.body.data.find((f) => f.test_case_id === mediumRiskCaseId);
    assert.ok(flaky, 'kasus yang bolak-balik lulus/gagal harus terdeteksi flaky');
    assert.ok(flaky!.flips >= 2, `flips harus >= 2, dapat ${flaky!.flips}`);
    assert.ok(flaky!.pass_rate > 0 && flaky!.pass_rate < 100);
  });
});

/* ================================================================== *
 * 5. metrics snapshot + readiness gate
 * ================================================================== */

describe('metrics: snapshot and readiness gate', () => {
  test('snapshot conforms to the frozen MetricsSnapshot shape', async () => {
    const res = await call<{
      data: {
        project_id: string;
        generated_at: string;
        totals: Record<string, number>;
        coverage: Record<string, number>;
        quality: Record<string, number>;
        efficiency: Record<string, number>;
        readiness: { release_gate_pct: number; go_no_go: string; blockers: string[] };
        trend: Array<{ date: string; passed: number; failed: number; blocked: number; total: number }>;
        defects_by_severity: Record<string, number>;
        defects_by_status: Record<string, number>;
        flaky_cases: unknown[];
      };
    }>('GET', `/projects/${PROJECT_ID}/metrics`);

    assert.equal(res.status, 200);
    const m = res.body.data;
    assert.equal(m.project_id, PROJECT_ID);

    for (const key of [
      'requirements', 'use_cases', 'scenarios', 'test_cases',
      'automated', 'defects_open', 'defects_total', 'runs',
    ]) {
      assert.equal(typeof m.totals[key], 'number', `totals.${key} harus number`);
    }
    for (const key of [
      'requirement_coverage_pct', 'test_case_execution_pct', 'automation_pct', 'regression_suite_size',
    ]) {
      assert.equal(typeof m.coverage[key], 'number', `coverage.${key} harus number`);
    }
    for (const key of [
      'pass_rate', 'fail_rate', 'block_rate', 'defect_density',
      'defect_leakage_pct', 'reopen_rate', 'regression_suite_pass_pct',
    ]) {
      assert.equal(typeof m.quality[key], 'number', `quality.${key} harus number`);
    }
    for (const key of ['avg_case_duration_ms', 'automation_roi_minutes_saved', 'estimated_hours_saved_per_run']) {
      assert.equal(typeof m.efficiency[key], 'number', `efficiency.${key} harus number`);
    }

    assert.equal(m.readiness.release_gate_pct, 90, 'diambil dari projects.quality_gate');
    assert.ok(Array.isArray(m.readiness.blockers));
    assert.equal(m.trend.length, 30, 'trend default 30 hari');
    assert.ok(Array.isArray(m.flaky_cases));
    assert.equal(typeof m.defects_by_severity, 'object');
    assert.equal(typeof m.defects_by_status, 'object');
  });

  test('readiness is no_go when the pass rate is below the quality gate', async () => {
    const res = await call<{
      data: { go_no_go: string; pass_rate: number; quality_gate: number; blockers: string[] };
    }>('GET', `/projects/${PROJECT_ID}/metrics/readiness`);

    assert.equal(res.status, 200);
    // The fixtures deliberately leave failures in place, so the rate is well under 90%.
    assert.ok(
      res.body.data.pass_rate < res.body.data.quality_gate,
      `pass rate ${res.body.data.pass_rate} harus di bawah gate ${res.body.data.quality_gate}`,
    );
    assert.equal(res.body.data.go_no_go, 'no_go');
    assert.ok(
      res.body.data.blockers.some((b) => /Pass rate/.test(b)),
      'blocker harus menyebut pass rate di bawah gate',
    );
  });

  test('readiness blocks on an open blocker-severity defect', async () => {
    const res = await call<{ data: { blockers: string[] } }>(
      'GET',
      `/projects/${PROJECT_ID}/metrics/readiness`,
    );
    assert.ok(
      res.body.data.blockers.some((b) => /critical|blocker/.test(b)),
      'defect severity critical yang terbuka harus menjadi blocker',
    );
  });

  test('a project with no executions is no_go with an explanatory blocker', async () => {
    const res = await call<{
      data: { go_no_go: string; pass_rate: number; blockers: string[] };
    }>('GET', `/projects/${OTHER_PROJECT_ID}/metrics/readiness`);

    assert.equal(res.status, 200);
    assert.equal(res.body.data.go_no_go, 'no_go');
    assert.equal(res.body.data.pass_rate, 0);
    assert.ok(res.body.data.blockers.some((b) => /Belum ada eksekusi/.test(b)));
  });

  test('trend endpoint honours the days parameter', async () => {
    const res = await call<{ data: { days: number; data: Array<{ date: string }> } }>(
      'GET',
      `/projects/${PROJECT_ID}/metrics/trend?days=7`,
    );
    assert.equal(res.status, 200);
    assert.equal(res.body.data.days, 7);
    assert.equal(res.body.data.data.length, 7);
    assert.match(res.body.data.data[0]!.date, /^\d{4}-\d{2}-\d{2}$/);
  });

  test('metrics 404s for an unknown project', async () => {
    const res = await call('GET', '/projects/prj_hantu/metrics');
    assert.equal(res.status, 404);
  });

  test('regression_suite_pass_pct only counts regression-kind runs', async () => {
    const res = await call<{ data: { quality: { regression_suite_pass_pct: number } } }>(
      'GET',
      `/projects/${PROJECT_ID}/metrics`,
    );
    // No regression-kind run has been executed yet (the engine is unavailable), so it is 0 —
    // and crucially it must NOT be polluted by the manual run's results.
    assert.equal(res.body.data.quality.regression_suite_pass_pct, 0);
  });
});

/* ================================================================== *
 * 5b. matrix ↔ metrics agreement (ARCHITECTURE.md §5.4)
 *
 * This is the assertion that would have caught the link-direction defect where
 * requirement_coverage_pct was permanently 0 while the matrix reported 100% for the
 * same project. The two numbers are shown side by side in the UI and must never disagree.
 * ================================================================== */

describe('matrix ↔ metrics agreement (§5.4)', () => {
  test('lane A matrix module is mounted for the comparison', () => {
    assert.ok(matrixAvailable, 'modul matrix lane A harus dapat dimuat untuk uji kesepakatan angka');
  });

  test('metrics requirement_coverage_pct equals the matrix summary coverage_pct', async () => {
    const matrix = await call<{
      data: { summary: { requirements: number; covered: number; partial: number; coverage_pct: number } };
    }>('GET', `/projects/${PROJECT_ID}/matrix`);
    assert.equal(matrix.status, 200, 'endpoint matrix harus tersedia untuk perbandingan');

    const metrics = await call<{ data: { coverage: { requirement_coverage_pct: number } } }>(
      'GET',
      `/projects/${PROJECT_ID}/metrics`,
    );
    assert.equal(metrics.status, 200);

    assert.equal(
      metrics.body.data.coverage.requirement_coverage_pct,
      matrix.body.data.summary.coverage_pct,
      `metrik (${metrics.body.data.coverage.requirement_coverage_pct}%) harus sama dengan matrix (${matrix.body.data.summary.coverage_pct}%)`,
    );
  });

  test('a fully traced requirement is reported as covered by BOTH matrix and metrics', async () => {
    // Seed a requirement linked to the existing use case in the §5.4 direction
    // (from_id = requirement, to_id = usecase), then confirm coverage is not stuck at 0.
    const now = nowIso();
    const requirementId = newId('req_');
    db.prepare(
      `INSERT INTO requirements (id, project_id, code, title, priority, status, created_at, updated_at)
       VALUES (?, ?, 'REQ-001', 'Checkout harus berfungsi', 'critical', 'approved', ?, ?)`,
    ).run(requirementId, PROJECT_ID, now, now);

    // §5.4: from_id is the UPSTREAM artifact (the requirement).
    db.prepare(
      `INSERT INTO matrix_links (id, project_id, link_type, from_kind, from_id, to_kind, to_id, created_at, created_by)
       VALUES (?, ?, 'requirement_to_usecase', 'requirement', ?, 'usecase', ?, ?, 'test')`,
    ).run(newId('ml_'), PROJECT_ID, requirementId, useCaseId, now);

    const matrix = await call<{ data: { summary: { requirements: number; coverage_pct: number } } }>(
      'GET',
      `/projects/${PROJECT_ID}/matrix`,
    );
    const metrics = await call<{ data: { coverage: { requirement_coverage_pct: number } } }>(
      'GET',
      `/projects/${PROJECT_ID}/metrics`,
    );

    assert.ok(matrix.body.data.summary.requirements >= 1, 'requirement harus terbaca matrix');
    assert.ok(
      matrix.body.data.summary.coverage_pct > 0,
      `matrix harus melaporkan cakupan > 0, dapat ${matrix.body.data.summary.coverage_pct}`,
    );
    assert.ok(
      metrics.body.data.coverage.requirement_coverage_pct > 0,
      `metrik TIDAK boleh 0 saat requirement tercakup (regresi §5.4), dapat ${metrics.body.data.coverage.requirement_coverage_pct}`,
    );
    assert.equal(
      metrics.body.data.coverage.requirement_coverage_pct,
      matrix.body.data.summary.coverage_pct,
      'metrik dan matrix wajib melaporkan angka yang sama',
    );
  });

  test('metrics automation_pct follows the shared TestCase contract, not the matrix shortcut', async () => {
    // The two are intentionally NOT equal: the matrix counts `automation_status = 'automated'`
    // only, while the frozen TestCase contract also treats `engine <> 'manual'` as automated
    // (see MetricsSnapshot / TestCase in @qatools/shared). Metrics owns the broader definition.
    const direct = await call<{ data: { totals: { test_cases: number; automated: number }; coverage: { automation_pct: number } } }>(
      'GET',
      `/projects/${PROJECT_ID}/metrics`,
    );
    const t = direct.body.data.totals;
    assert.ok(t.test_cases > 0, 'fixture harus punya test case');
    assert.equal(
      direct.body.data.coverage.automation_pct,
      Number(((t.automated / t.test_cases) * 100).toFixed(1)),
      'automation_pct harus = automated / test_cases sesuai kontrak TestCase',
    );

    // The matrix figure must never exceed the contract figure (its denominator is broader,
    // its numerator narrower) — a sanity bound that still catches a broken delegation.
    const matrix = await call<{ data: { summary: { automation_pct: number } } }>(
      'GET',
      `/projects/${PROJECT_ID}/matrix`,
    );
    assert.ok(
      matrix.body.data.summary.automation_pct <= direct.body.data.coverage.automation_pct,
      'matrix automation_pct tidak boleh melebihi definisi kontrak TestCase',
    );
  });
});

/* ================================================================== *
 * 6. environments and test data
 * ================================================================== */

describe('environments: CRUD, single default, test data sets', () => {
  let firstEnvId = '';
  let secondEnvId = '';

  test('the first environment automatically becomes the project default', async () => {
    const res = await call<{ data: { id: string; name: string; is_default: number; kind: string } }>(
      'POST',
      `/projects/${PROJECT_ID}/environments`,
      { name: 'Staging', base_url: 'https://staging.example.com', kind: 'staging', api_base: 'https://api.staging.example.com' },
    );
    assert.equal(res.status, 201);
    assert.equal(res.body.data.is_default, 1, 'environment pertama otomatis menjadi default');
    firstEnvId = res.body.data.id;
  });

  test('a second environment is not default until asked', async () => {
    const res = await call<{ data: { id: string; is_default: number } }>(
      'POST',
      `/projects/${PROJECT_ID}/environments`,
      { name: 'UAT', kind: 'uat', base_url: 'https://uat.example.com' },
    );
    assert.equal(res.body.data.is_default, 0);
    secondEnvId = res.body.data.id;
  });

  test('marking a default clears the previous one — exactly one default survives', async () => {
    const marked = await call<{ data: { id: string; is_default: number } }>(
      'POST',
      `/environments/${secondEnvId}/default`,
    );
    assert.equal(marked.status, 200);
    assert.equal(marked.body.data.is_default, 1);

    const all = await call<{ data: Array<{ id: string; is_default: number }> }>(
      'GET',
      `/projects/${PROJECT_ID}/environments`,
    );
    assert.equal(all.body.data.filter((e) => e.is_default === 1).length, 1, 'hanya satu default per project');
    assert.equal(all.body.data.find((e) => e.is_default === 1)!.id, secondEnvId);
  });

  test('rejects an invalid environment kind', async () => {
    const res = await call('POST', `/projects/${PROJECT_ID}/environments`, {
      name: 'Bad',
      kind: 'production-ish',
    });
    assert.equal(res.status, 400);
  });

  test('variable key/value editor round-trips through JSON', async () => {
    const res = await call<{ data: { variables: string } }>('PATCH', `/environments/${firstEnvId}`, {
      variables: { USER: 'qa1', PASS: 'secret', BASE: 'https://staging.example.com' },
    });
    assert.equal(res.status, 200);
    const parsed = JSON.parse(res.body.data.variables) as Record<string, string>;
    assert.equal(parsed.USER, 'qa1');
    assert.equal(parsed.PASS, 'secret');
  });

  test('deleting the default promotes another environment', async () => {
    const del = await call('DELETE', `/environments/${secondEnvId}`);
    assert.equal(del.status, 200);
    const all = await call<{ data: Array<{ id: string; is_default: number }> }>(
      'GET',
      `/projects/${PROJECT_ID}/environments`,
    );
    assert.equal(all.body.data.length, 1);
    assert.equal(all.body.data[0]!.is_default, 1, 'project tidak boleh kehilangan default');
  });

  test('creates a test data set and derives columns from the rows', async () => {
    const res = await call<{ data: { id: string; columns: string; rows: string } }>(
      'POST',
      `/projects/${PROJECT_ID}/testdata`,
      {
        name: 'Data checkout',
        environment_id: firstEnvId,
        rows: [
          { email: 'a@example.com', password: 'rahasia1', ekspektasi: 'sukses' },
          { email: 'b@example.com', password: 'salah', ekspektasi: 'gagal' },
        ],
      },
    );
    assert.equal(res.status, 201);
    const columns = JSON.parse(res.body.data.columns) as string[];
    const rows = JSON.parse(res.body.data.rows) as Array<Record<string, string>>;
    assert.deepEqual(columns, ['email', 'password', 'ekspektasi']);
    assert.equal(rows.length, 2);
    assert.equal(rows[0]!.email, 'a@example.com');
  });

  test('test data sets can be filtered by environment and edited', async () => {
    const created = await call<{ data: { id: string } }>('POST', `/projects/${PROJECT_ID}/testdata`, {
      name: 'Data login',
      rows: [{ user: 'x', pass: 'y' }],
    });
    const id = created.body.data.id;

    const patched = await call<{ data: { name: string; rows: string } }>('PATCH', `/testdata/${id}`, {
      name: 'Data login v2',
      rows: [{ user: 'x', pass: 'y' }, { user: 'z', pass: 'w' }],
    });
    assert.equal(patched.body.data.name, 'Data login v2');
    assert.equal((JSON.parse(patched.body.data.rows) as unknown[]).length, 2);

    const filtered = await call<{ data: unknown[] }>(
      'GET',
      `/projects/${PROJECT_ID}/testdata?environment_id=${firstEnvId}`,
    );
    assert.equal(filtered.body.data.length, 1, 'hanya data set milik environment itu');

    const del = await call('DELETE', `/testdata/${id}`);
    assert.equal(del.status, 200);
  });
});

/* ================================================================== *
 * 7. cross-lane graceful degradation (the live code path today)
 * ================================================================== */

describe('cross-lane bridges degrade gracefully', () => {
  test('POST /runs/:id/execute returns 503 engine_unavailable while lane-auto has no module', async () => {
    const res = await call<{ error: { code: string; message: string } }>(
      'POST',
      `/runs/${runId}/execute`,
      { engine: 'api', test_case_ids: [highRiskCaseId] },
    );

    // Either lane-auto has landed (2xx/5xx from the engine) or it has not (503 engine_unavailable).
    // Both are acceptable contracts; a boot failure or a bare 500 is not.
    if (res.status === 503) {
      assert.equal(res.body.error.code, 'engine_unavailable');
      assert.match(res.body.error.message, /belum tersedia/);
    } else {
      assert.ok(
        res.status === 200 || res.status === 201 || res.status === 502,
        `status tak terduga: ${res.status} ${JSON.stringify(res.body)}`,
      );
      if (res.status === 502) {
        assert.equal((res.body as unknown as { error: { code: string } }).error.code, 'engine_error');
      }
    }
  });

  test('the execute bridge never breaks module boot (routes are registered)', async () => {
    const res = await call<{ data: unknown[] }>('GET', `/projects/${PROJECT_ID}/runs`);
    assert.equal(res.status, 200, 'modul runs harus tetap melayani walau engine belum ada');
  });

  test('POST /defects/:id/ai-triage returns 503 ai_unavailable while lane-ai has no module', async () => {
    const created = await call<{ data: { id: string } }>('POST', `/projects/${PROJECT_ID}/defects`, {
      title: 'Defect untuk uji triase AI',
      actual_result: 'Tombol tidak bekerja',
      expected_result: 'Tombol bekerja',
    });
    const id = created.body.data.id;

    const res = await call<{ error: { code: string; message: string } }>(
      'POST',
      `/defects/${id}/ai-triage`,
      {},
    );

    if (res.status === 503) {
      assert.equal(res.body.error.code, 'ai_unavailable');
    } else {
      // lane-ai landed: a success envelope or an upstream AI failure, never a crash.
      assert.ok([200, 201, 502].includes(res.status), `status tak terduga: ${res.status}`);
    }
  });

  test('the regression run bridge also degrades to engine_unavailable', async () => {
    const res = await call<{ error?: { code: string } }>(
      'POST',
      `/projects/${PROJECT_ID}/regression/run`,
      { strategy: 'risk_based' },
    );
    if (res.status === 503) {
      assert.equal(res.body.error?.code, 'engine_unavailable');
    } else {
      assert.ok([200, 201, 502].includes(res.status), `status tak terduga: ${res.status}`);
    }
  });
});

/* ================================================================== *
 * 8. API conventions
 * ================================================================== */

describe('frozen API conventions', () => {
  test('list endpoints use the { data, total } envelope', async () => {
    const res = await call<{ data: unknown[]; total: number }>('GET', `/projects/${PROJECT_ID}/cycles`);
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.data));
    assert.equal(typeof res.body.total, 'number');
  });

  test('errors use the { error: { code, message } } envelope', async () => {
    const res = await call<{ error: { code: string; message: string } }>('GET', '/cycles/cyc_tidak_ada');
    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'not_found');
    assert.ok(res.body.error.message.length > 0);
  });

  test('validation failures return 400 bad_request', async () => {
    const res = await call<{ error: { code: string } }>('POST', `/projects/${PROJECT_ID}/cycles`, {});
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'bad_request');
  });
});
