/**
 * runs repository — `test_runs` and `run_results`, plus the counter rollup and the
 * flaky-history queries shared with the metrics/regression modules.
 *
 * Only this module writes to those two tables (ARCHITECTURE.md §7).
 */

import type { RunResult, TestRun } from '@qatools/shared';
import { nowIso } from '@qatools/shared';
import { db, findById, insertRow, updateRow, deleteById, nextCode } from '../../db/index.js';

export const RUN_KINDS = ['manual', 'automation', 'regression', 'smoke', 'ai'] as const;
export const RUN_ENGINES = ['manual', 'db', 'api', 'web', 'ai'] as const;
export const RUN_LIFECYCLE = ['running', 'completed', 'aborted'] as const;

/* -------------------------------- test runs ------------------------------ */

export interface RunInput {
  project_id: string;
  name: string;
  cycle_id?: string | null;
  sprint_id?: string | null;
  environment_id?: string | null;
  code?: string | null;
  kind?: string | null;
  engine?: string | null;
  executed_by?: string | null;
  notes?: string | null;
}

export function listRuns(projectId: string, filters: { kind?: string; status?: string; limit?: number } = {}): TestRun[] {
  const where = ['project_id = ?'];
  const params: unknown[] = [projectId];
  if (filters.kind) {
    where.push('kind = ?');
    params.push(filters.kind);
  }
  if (filters.status) {
    where.push('status = ?');
    params.push(filters.status);
  }
  params.push(Math.min(500, Math.max(1, filters.limit ?? 100)));
  return db
    .prepare(
      `SELECT * FROM test_runs WHERE ${where.join(' AND ')}
        ORDER BY COALESCE(started_at, created_at) DESC, created_at DESC LIMIT ?`,
    )
    .all(...params) as unknown as TestRun[];
}

export function getRun(id: string): TestRun | undefined {
  return findById<TestRun>('test_runs', id);
}

/** Run plus everything the detail view renders without extra round-trips. */
export interface RunDetail extends TestRun {
  results: RunResultRow[];
  environment: { id: string; name: string; kind: string; base_url: string | null } | null;
  sprint: { id: string; code: string; name: string } | null;
  cycle: { id: string; code: string; name: string } | null;
}

export interface RunResultRow extends RunResult {
  tc_code: string;
  tc_title: string;
  tc_priority: string;
  tc_type: string;
  tc_layer: string;
  defect_code: string | null;
}

/** `test_runs.code` is unique per project: RUN-0001, RUN-0002, … */
export function nextRunCode(projectId: string): string {
  const base = nextCode('test_runs', 'RUN', projectId, 4);
  let code = base;
  let n = 1;
  while (db.prepare('SELECT 1 FROM test_runs WHERE project_id = ? AND code = ?').get(projectId, code)) {
    code = `${base}-${++n}`;
  }
  return code;
}

export function createRun(input: RunInput): TestRun {
  const id = insertRow(
    'test_runs',
    {
      project_id: input.project_id,
      cycle_id: input.cycle_id ?? null,
      sprint_id: input.sprint_id ?? null,
      environment_id: input.environment_id ?? null,
      code: input.code?.trim() || nextRunCode(input.project_id),
      name: input.name,
      kind: normalizeKind(input.kind),
      engine: normalizeEngine(input.engine),
      status: 'running',
      started_at: nowIso(),
      executed_by: input.executed_by ?? null,
      notes: input.notes ?? null,
    },
    'run_',
  );
  return getRun(id) as TestRun;
}

export function updateRun(id: string, patch: Record<string, unknown>): TestRun | undefined {
  const clean: Record<string, unknown> = {};
  for (const key of [
    'name',
    'cycle_id',
    'sprint_id',
    'environment_id',
    'executed_by',
    'notes',
    'started_at',
    'finished_at',
  ] as const) {
    if (patch[key] !== undefined) clean[key] = patch[key];
  }
  if (patch.status !== undefined) {
    const s = String(patch.status);
    clean.status = (RUN_LIFECYCLE as readonly string[]).includes(s) ? s : 'running';
  }
  if (patch.kind !== undefined) clean.kind = normalizeKind(patch.kind);
  if (patch.engine !== undefined) clean.engine = normalizeEngine(patch.engine);
  updateRow('test_runs', id, clean);
  return getRun(id);
}

export function removeRun(id: string): number {
  return deleteById('test_runs', id);
}

export function runDetail(id: string): RunDetail | undefined {
  const run = getRun(id);
  if (!run) return undefined;
  const results = listResults(id);
  const env = run.environment_id
    ? (db
        .prepare('SELECT id, name, kind, base_url FROM environments WHERE id = ?')
        .get(run.environment_id) as RunDetail['environment'])
    : null;
  const sprint = run.sprint_id
    ? (db.prepare('SELECT id, code, name FROM sprints WHERE id = ?').get(run.sprint_id) as RunDetail['sprint'])
    : null;
  const cycle = run.cycle_id
    ? (db.prepare('SELECT id, code, name FROM cycles WHERE id = ?').get(run.cycle_id) as RunDetail['cycle'])
    : null;
  return { ...run, results, environment: env ?? null, sprint: sprint ?? null, cycle: cycle ?? null };
}

/* ------------------------------- run results ----------------------------- */

export interface ResultInput {
  test_case_id: string;
  status?: string | null;
  engine?: string | null;
  duration_ms?: unknown;
  actual_result?: string | null;
  error_message?: string | null;
  evidence?: unknown;
  executed_by?: string | null;
  executed_at?: string | null;
  defect_id?: string | null;
}

export function listResults(runId: string): RunResultRow[] {
  return db
    .prepare(
      `SELECT rr.*, tc.code AS tc_code, tc.title AS tc_title, tc.priority AS tc_priority,
              tc.type AS tc_type, tc.layer AS tc_layer, d.code AS defect_code
         FROM run_results rr
         JOIN test_cases tc ON tc.id = rr.test_case_id
         LEFT JOIN defects d ON d.id = rr.defect_id
        WHERE rr.run_id = ?
        ORDER BY tc.code ASC`,
    )
    .all(runId) as unknown as RunResultRow[];
}

export function getResult(id: string): RunResult | undefined {
  return findById<RunResult>('run_results', id);
}

export function findResult(runId: string, testCaseId: string): RunResult | undefined {
  return db
    .prepare('SELECT * FROM run_results WHERE run_id = ? AND test_case_id = ?')
    .get(runId, testCaseId) as RunResult | undefined;
}

/**
 * Records (or re-records) a single manual result. Upsert on the unique(run_id, test_case_id)
 * pair so re-testing a case in the same run overwrites rather than duplicates.
 */
export function recordResult(runId: string, input: ResultInput): RunResultRow {
  const run = getRun(runId);
  if (!run) throw new Error('run_not_found');
  const status = normalizeResultStatus(input.status);
  const engine = normalizeEngine(input.engine ?? run.engine);
  const duration = toDuration(input.duration_ms, run.engine, engine);
  const executedAt = input.executed_at ?? nowIso();

  db.transaction(() => {
    const existing = findResult(runId, input.test_case_id);
    if (existing) {
      updateRow('run_results', existing.id, {
        status,
        engine,
        duration_ms: duration,
        actual_result: input.actual_result ?? null,
        error_message: input.error_message ?? null,
        evidence: input.evidence === undefined ? null : jsonOrNull(input.evidence),
        executed_by: input.executed_by ?? null,
        executed_at: executedAt,
        defect_id: input.defect_id ?? existing.defect_id,
      });
    } else {
      insertRow(
        'run_results',
        {
          run_id: runId,
          test_case_id: input.test_case_id,
          status,
          engine,
          duration_ms: duration,
          actual_result: input.actual_result ?? null,
          error_message: input.error_message ?? null,
          evidence: input.evidence === undefined ? null : jsonOrNull(input.evidence),
          executed_by: input.executed_by ?? null,
          executed_at: executedAt,
          defect_id: input.defect_id ?? null,
        },
        'res_',
      );
    }
    rollUp(runId);
  });

  const row = findResult(runId, input.test_case_id) as RunResult;
  return listResults(runId).find((r) => r.id === row.id) as RunResultRow;
}

/** Bulk-records engine results — used by the execute endpoint and the regression runner. */
export function recordResults(runId: string, inputs: ResultInput[]): void {
  const run = getRun(runId);
  if (!run) throw new Error('run_not_found');
  db.transaction(() => {
    for (const input of inputs) {
      const status = normalizeResultStatus(input.status);
      const engine = normalizeEngine(input.engine ?? run.engine);
      const duration = toDuration(input.duration_ms, run.engine, engine);
      const existing = findResult(runId, input.test_case_id);
      const payload = {
        status,
        engine,
        duration_ms: duration,
        actual_result: input.actual_result ?? null,
        error_message: input.error_message ?? null,
        evidence: input.evidence === undefined ? null : jsonOrNull(input.evidence),
        executed_by: input.executed_by ?? null,
        executed_at: input.executed_at ?? nowIso(),
      };
      if (existing) updateRow('run_results', existing.id, payload);
      else
        insertRow(
          'run_results',
          { ...payload, run_id: runId, test_case_id: input.test_case_id, defect_id: input.defect_id ?? null },
          'res_',
        );
    }
    rollUp(runId);
  });
}

export function updateResult(id: string, patch: Record<string, unknown>): RunResult | undefined {
  const clean: Record<string, unknown> = {};
  for (const key of ['actual_result', 'error_message', 'executed_by', 'defect_id', 'executed_at'] as const) {
    if (patch[key] !== undefined) clean[key] = patch[key];
  }
  if (patch.status !== undefined) clean.status = normalizeResultStatus(patch.status);
  if (patch.engine !== undefined) clean.engine = normalizeEngine(patch.engine);
  if (patch.duration_ms !== undefined) clean.duration_ms = Math.max(0, Math.round(Number(patch.duration_ms) || 0));
  if (patch.evidence !== undefined) clean.evidence = jsonOrNull(patch.evidence);
  const existing = getResult(id);
  if (!existing) return undefined;
  updateRow('run_results', id, clean);
  rollUp(existing.run_id);
  return getResult(id);
}

export function removeResult(id: string): number {
  const existing = getResult(id);
  if (!existing) return 0;
  const changes = deleteById('run_results', id);
  rollUp(existing.run_id);
  return changes;
}

/* --------------------------------- rollup -------------------------------- */

/**
 * Recomputes `total/passed/failed/blocked/skipped/duration_ms` from the run's results.
 * `not_run` rows count toward `total` but never toward a pass/fail bucket.
 */
export function rollUp(runId: string): TestRun | undefined {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(CASE WHEN status = 'passed'  THEN 1 ELSE 0 END), 0) AS passed,
              COALESCE(SUM(CASE WHEN status = 'failed'  THEN 1 ELSE 0 END), 0) AS failed,
              COALESCE(SUM(CASE WHEN status = 'blocked' THEN 1 ELSE 0 END), 0) AS blocked,
              COALESCE(SUM(CASE WHEN status = 'skipped' THEN 1 ELSE 0 END), 0) AS skipped,
              COALESCE(SUM(duration_ms), 0) AS duration_ms
         FROM run_results WHERE run_id = ?`,
    )
    .get(runId) as Record<string, number> | undefined;

  updateRow('test_runs', runId, {
    total: Number(row?.total ?? 0),
    passed: Number(row?.passed ?? 0),
    failed: Number(row?.failed ?? 0),
    blocked: Number(row?.blocked ?? 0),
    skipped: Number(row?.skipped ?? 0),
    duration_ms: Number(row?.duration_ms ?? 0),
  });
  return getRun(runId);
}

/** Completes a run: final rollup + `finished_at` + status. */
export function completeRun(
  runId: string,
  opts: { status?: string; duration_ms?: number; notes?: string | null } = {},
): TestRun | undefined {
  const run = getRun(runId);
  if (!run) return undefined;
  const patch: Record<string, unknown> = {
    status: opts.status ?? 'completed',
    finished_at: nowIso(),
  };
  if (opts.notes !== undefined) patch.notes = opts.notes;
  updateRow('test_runs', runId, patch);
  rollUp(runId);
  if (opts.duration_ms !== undefined) {
    updateRow('test_runs', runId, { duration_ms: Math.max(0, Math.round(opts.duration_ms)) });
  }
  return getRun(runId);
}

/* --------------------- shared history queries (read-only) ----------------- */

export interface CaseRunHistory {
  test_case_id: string;
  total: number;
  passed: number;
  failed: number;
  blocked: number;
  last_status: string | null;
  last_executed_at: string | null;
}

/** Latest result per test case, used for the "last run failed" risk factor. */
export function latestResultPerCase(projectId: string): Map<string, CaseRunHistory> {
  const rows = db
    .prepare(
      `SELECT rr.test_case_id, rr.status, rr.executed_at, rr.created_at
         FROM run_results rr
         JOIN test_runs tr ON tr.id = rr.run_id
        WHERE tr.project_id = ?
        ORDER BY COALESCE(rr.executed_at, rr.created_at) ASC`,
    )
    .all(projectId) as Array<{
    test_case_id: string;
    status: string;
    executed_at: string | null;
    created_at: string;
  }>;

  const map = new Map<string, CaseRunHistory>();
  for (const r of rows) {
    const entry =
      map.get(r.test_case_id) ??
      ({
        test_case_id: r.test_case_id,
        total: 0,
        passed: 0,
        failed: 0,
        blocked: 0,
        last_status: null,
        last_executed_at: null,
      } satisfies CaseRunHistory);
    entry.total++;
    if (r.status === 'passed') entry.passed++;
    else if (r.status === 'failed') entry.failed++;
    else if (r.status === 'blocked') entry.blocked++;
    entry.last_status = r.status;
    entry.last_executed_at = r.executed_at ?? r.created_at;
    map.set(r.test_case_id, entry);
  }
  return map;
}

/** Total recorded defects per test case, used for the defect-history risk factor. */
export function defectCountPerCase(projectId: string): Map<string, number> {
  const rows = db
    .prepare(
      `SELECT test_case_id, COUNT(*) AS n FROM defects
        WHERE project_id = ? AND test_case_id IS NOT NULL
        GROUP BY test_case_id`,
    )
    .all(projectId) as Array<{ test_case_id: string; n: number }>;
  return new Map(rows.map((r) => [r.test_case_id, Number(r.n)]));
}

/**
 * Flakiness from flip history: a case is flaky when its chronological result sequence
 * changes status at least twice and it both passed and failed within the window.
 */
export interface FlakyCase {
  test_case_id: string;
  code: string;
  title: string;
  flips: number;
  pass_rate: number;
  executions: number;
  last_status: string | null;
}

export function flakyCases(projectId: string, opts: { minFlips?: number; days?: number } = {}): FlakyCase[] {
  const minFlips = opts.minFlips ?? 2;
  const days = opts.days ?? 90;
  const since = new Date(Date.now() - days * 86_400_000).toISOString();

  const rows = db
    .prepare(
      `SELECT rr.test_case_id, rr.status, COALESCE(rr.executed_at, rr.created_at) AS at
         FROM run_results rr
         JOIN test_runs tr ON tr.id = rr.run_id
        WHERE tr.project_id = ? AND COALESCE(rr.executed_at, rr.created_at) >= ?
        ORDER BY at ASC`,
    )
    .all(projectId, since) as Array<{ test_case_id: string; status: string; at: string }>;

  const grouped = new Map<string, Array<{ status: string; at: string }>>();
  for (const r of rows) {
    const list = grouped.get(r.test_case_id) ?? [];
    list.push({ status: r.status, at: r.at });
    grouped.set(r.test_case_id, list);
  }

  const meta = new Map(
    (
      db
        .prepare('SELECT id, code, title FROM test_cases WHERE project_id = ?')
        .all(projectId) as Array<{ id: string; code: string; title: string }>
    ).map((t) => [t.id, t]),
  );

  const out: FlakyCase[] = [];
  for (const [testCaseId, history] of grouped) {
    if (history.length < 3) continue;
    let flips = 0;
    let passed = 0;
    let failed = 0;
    for (let i = 0; i < history.length; i++) {
      const s = history[i]!.status;
      if (s === 'passed') passed++;
      if (s === 'failed') failed++;
      if (i > 0 && history[i]!.status !== history[i - 1]!.status) flips++;
    }
    if (flips < minFlips || !passed || !failed) continue;
    const tc = meta.get(testCaseId);
    out.push({
      test_case_id: testCaseId,
      code: tc?.code ?? testCaseId,
      title: tc?.title ?? '(test case dihapus)',
      flips,
      pass_rate: Number(((passed / history.length) * 100).toFixed(1)),
      executions: history.length,
      last_status: history[history.length - 1]!.status,
    });
  }
  return out.sort((a, b) => b.flips - a.flips || a.pass_rate - b.pass_rate);
}

/* -------------------------------- helpers -------------------------------- */

function normalizeKind(v: unknown): string {
  const s = String(v ?? 'manual');
  return (RUN_KINDS as readonly string[]).includes(s) ? s : 'manual';
}

function normalizeEngine(v: unknown): string {
  const s = String(v ?? 'manual');
  return (RUN_ENGINES as readonly string[]).includes(s) ? s : 'manual';
}

function normalizeResultStatus(v: unknown): string {
  const s = String(v ?? 'not_run');
  return ['passed', 'failed', 'blocked', 'skipped', 'not_run'].includes(s) ? s : 'not_run';
}

/**
 * Manual recording gets a sensible default duration so effort metrics are never zero,
 * while engine results always carry their real measured time.
 */
function toDuration(v: unknown, runEngine: string, engine: string): number {
  const n = Number(v);
  if (Number.isFinite(n) && n >= 0) return Math.round(n);
  if (engine === 'manual' || runEngine === 'manual') return 3 * 60_000;
  return 0;
}

function jsonOrNull(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v === 'string') return v;
  return JSON.stringify(v);
}
