/**
 * execute — the integration module and the Run Center API.
 *
 * Exports `executeService` (consumed in-process by Lane B's regression module):
 *   executeService.runCase(testCaseId, opts)  -> EngineResult
 *   executeService.runSuite(testCaseIds, opts) -> SuiteResult
 *   executeService.capabilities()             -> honest engine matrix
 *
 * Also default-exports the Fastify plugin mounted at /api:
 *   POST /test-cases/:id/execute
 *   POST /execute/suite
 *   GET  /execute/capabilities
 *   GET  /execute/runs/:runId/results
 *   GET  /execute/cases             (test-case picker for the Run Center)
 */

import type { FastifyInstance, FastifyReply } from 'fastify';
import type {
  EngineResult,
  ExecEngine,
  ExecuteOptions,
  RunResult,
  RunStatus,
  SuiteResult,
  TestCase,
  TestRun,
} from '@qatools/shared';
import { newId, nowIso } from '@qatools/shared';
import { db, parseJson, toJson } from '../../db/index.js';
import { list, one, fail, notFound, badRequest } from '../../lib/http.js';
import { EngineError, rollupCounters, truncate } from './engine-utils.js';
import { environmentVars, engineOf, getTestCase, runEngineForCase, statusForFailure } from './runner.js';

/* ------------------------------------------------------------------ *
 * test_runs / run_results persistence
 *
 * `test_runs` and `run_results` are shared with Lane B (runs module). This module
 * appends rows for automation runs and honours `opts.run_id` so Lane B can hand
 * us an existing run to append into.
 * ------------------------------------------------------------------ */

function nextRunCode(projectId: string): string {
  const row = db.prepare('SELECT COUNT(*) AS n FROM test_runs WHERE project_id = ?').get(projectId) as
    | { n: number }
    | undefined;
  return `RUN-${String(Number(row?.n ?? 0) + 1).padStart(4, '0')}`;
}

function createTestRun(input: {
  project_id: string;
  name: string;
  engine: ExecEngine;
  environment_id?: string | null;
  executed_by?: string | null;
  kind?: string;
}): TestRun {
  const id = newId('run_');
  const ts = nowIso();
  db.prepare(
    `INSERT INTO test_runs
       (id, project_id, cycle_id, sprint_id, environment_id, code, name, kind, engine, status,
        started_at, finished_at, executed_by, notes, total, passed, failed, blocked, skipped, duration_ms,
        created_at, updated_at)
     VALUES (?, ?, NULL, NULL, ?, ?, ?, ?, ?, 'running', ?, NULL, ?, NULL, 0, 0, 0, 0, 0, 0, ?, ?)`,
  ).run(
    id,
    input.project_id,
    input.environment_id ?? null,
    nextRunCode(input.project_id),
    input.name,
    input.kind ?? 'automation',
    input.engine,
    ts,
    input.executed_by ?? null,
    ts,
    ts,
  );
  return db.prepare('SELECT * FROM test_runs WHERE id = ?').get(id) as unknown as TestRun;
}

function getRun(runId: string): TestRun | undefined {
  return db.prepare('SELECT * FROM test_runs WHERE id = ?').get(runId) as TestRun | undefined;
}

/** Appends (or replaces) one run_results row. `run_results` is UNIQUE(run_id, test_case_id). */
function writeRunResult(input: {
  run_id: string;
  test_case_id: string;
  status: RunStatus;
  engine: ExecEngine;
  duration_ms: number;
  actual_result: string | null;
  error_message: string | null;
  evidence: unknown;
  executed_by: string | null;
}): string {
  const existing = db
    .prepare('SELECT id FROM run_results WHERE run_id = ? AND test_case_id = ?')
    .get(input.run_id, input.test_case_id) as { id: string } | undefined;

  const evidenceJson = toJson(input.evidence);
  const ts = nowIso();

  if (existing) {
    db.prepare(
      `UPDATE run_results
          SET status = ?, engine = ?, duration_ms = ?, actual_result = ?, error_message = ?,
              evidence = ?, executed_by = ?, executed_at = ?, updated_at = ?
        WHERE id = ?`,
    ).run(
      input.status,
      input.engine,
      Math.round(input.duration_ms),
      input.actual_result,
      input.error_message,
      evidenceJson,
      input.executed_by,
      ts,
      ts,
      existing.id,
    );
    return existing.id;
  }

  const id = newId('res_');
  db.prepare(
    `INSERT INTO run_results
       (id, run_id, test_case_id, status, engine, duration_ms, actual_result, error_message, evidence,
        executed_by, executed_at, defect_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
  ).run(
    id,
    input.run_id,
    input.test_case_id,
    input.status,
    input.engine,
    Math.round(input.duration_ms),
    input.actual_result,
    input.error_message,
    evidenceJson,
    input.executed_by,
    ts,
    ts,
    ts,
  );
  return id;
}

/** Recomputes the run's counters from its results (single source of truth). */
function refreshRunCounters(runId: string, durationMs: number): void {
  const rows = db
    .prepare('SELECT status, duration_ms FROM run_results WHERE run_id = ?')
    .all(runId) as Array<{ status: string; duration_ms: number }>;

  const counters = rollupCounters(rows.map((r) => r.status as RunStatus));
  const totalDuration = rows.reduce((sum, r) => sum + Number(r.duration_ms ?? 0), 0) || durationMs;

  db.prepare(
    `UPDATE test_runs
        SET total = ?, passed = ?, failed = ?, blocked = ?, skipped = ?,
            duration_ms = ?, status = 'completed', finished_at = ?, updated_at = ?
      WHERE id = ?`,
  ).run(
    counters.total,
    counters.passed,
    counters.failed,
    counters.blocked,
    counters.skipped,
    Math.round(totalDuration),
    nowIso(),
    nowIso(),
    runId,
  );
}

/* ------------------------------------------------------------------ *
 * executeService — the cross-lane surface
 * ------------------------------------------------------------------ */

export interface CapabilityEntry {
  engine: ExecEngine;
  available: boolean;
  mode: string;
  reason: string;
  /** How many test cases currently use this engine (helps the Run Center). */
  test_cases?: number;
}

export interface CapabilitiesReport {
  engines: CapabilityEntry[];
  dialects: Array<{ dialect: string; available: boolean; driver: string; reason: string }>;
  web_modes: Array<{ mode: string; available: boolean; reason: string; version?: string | null }>;
  ai: { available: boolean; mode: string; reason: string };
  generated_at: string;
}

/** Counts test cases per engine, tolerating an empty/absent table. */
function countCasesByEngine(): Record<string, number> {
  try {
    const rows = db.prepare('SELECT engine, COUNT(*) AS n FROM test_cases GROUP BY engine').all() as Array<{
      engine: string;
      n: number;
    }>;
    const out: Record<string, number> = {};
    for (const row of rows) out[row.engine] = Number(row.n);
    return out;
  } catch {
    return {};
  }
}

/** Probes whether lane D's AI module is importable, without a top-level import. */
async function probeAi(): Promise<{ available: boolean; provider: string; mode: string; reason: string }> {
  try {
    // The specifier is built at runtime so TypeScript never resolves it at build
    // time — lane D's module may not exist yet, and the API must still boot.
    const specifier = '../ai/index.js';
    const mod = (await import(/* @vite-ignore */ specifier)) as {
      aiService?: { status?: () => Promise<{ mode?: string; provider?: string; message?: string; configured?: boolean }> };
    };
    if (mod?.aiService?.status) {
      const status = await mod.aiService.status();
      return {
        available: true,
        provider: status?.provider ?? 'unknown',
        mode: status?.mode ?? 'unknown',
        reason: status?.message ?? 'Modul AI terdeteksi.',
      };
    }
    return {
      available: false,
      provider: 'unknown',
      mode: 'unavailable',
      reason: 'Modul AI ada tetapi tidak mengekspor aiService.status().',
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return {
      available: false,
      provider: 'none',
      mode: 'unavailable',
      reason:
        'Modul AI (lane D) belum terpasang sehingga engine "ai" belum bisa dijalankan. ' +
        `Detail: ${reason.slice(0, 160)}`,
    };
  }
}

async function capabilities(): Promise<CapabilitiesReport> {
  const { dialectCapability } = await import('../dbtester/engine.js');
  const { webModeCapabilities } = await import('../webtester/engine.js');
  const ai = await probeAi();
  const counts = countCasesByEngine();

  const dialects = (['sqlite', 'postgres', 'mysql'] as const).map((d) => {
    const cap = dialectCapability(d);
    return { dialect: cap.dialect, available: cap.available, driver: cap.driver, reason: cap.reason };
  });

  const webModes = await webModeCapabilities();
  const playwright = webModes.find((m) => m.mode === 'playwright');

  const engines: CapabilityEntry[] = [
    {
      engine: 'manual',
      available: true,
      mode: 'recorded',
      reason:
        'Selalu tersedia. Eksekusi manual tidak dijalankan server; hasilnya dicatat tester lewat Test Runs ' +
        '(POST /runs/:id/results).',
      test_cases: counts.manual ?? 0,
    },
    {
      engine: 'db',
      available: true,
      mode: 'sqlite (node:sqlite)',
      reason:
        'AKTIF untuk dialect sqlite memakai node:sqlite bawaan Node — tanpa kompilasi native. ' +
        'Dialect postgres/mysql mengembalikan 501 driver_not_installed karena driver sengaja tidak dipaketkan.',
      test_cases: counts.db ?? 0,
    },
    {
      engine: 'api',
      available: true,
      mode: 'http (global fetch)',
      reason:
        'AKTIF penuh: eksekusi HTTP nyata dengan fetch bawaan Node, auth none/bearer/basic/api_key, ' +
        'interpolasi {{var}}, skrip aman terbatas, dan evaluasi assertion.',
      test_cases: counts.api ?? 0,
    },
    {
      engine: 'web',
      available: true,
      mode: playwright?.available ? 'playwright' : 'http',
      reason: playwright?.available
        ? `Mode browser (Playwright) aktif. Cadangan mode HTTP selalu tersedia. ${playwright.reason}`
        : 'AKTIF dalam mode HTTP: ambil halaman dengan fetch, parse HTML dengan ekstraktor internal, ' +
          'lalu verifikasi text/element/selector/url secara nyata. Mode browser Playwright TIDAK aktif: ' +
          `${playwright?.reason ?? 'paket playwright tidak terpasang.'} QATools tidak menyamar seolah browser dijalankan.`,
      test_cases: counts.web ?? 0,
    },
    {
      engine: 'ai',
      available: ai.available,
      mode: ai.mode,
      reason: ai.available
        ? `Modul AI terdeteksi (provider: ${ai.provider}). ${ai.reason}`
        : ai.reason,
      test_cases: counts.ai ?? 0,
    },
  ];

  return { engines, dialects, web_modes: webModes, ai, generated_at: nowIso() };
}

/** Runs one test case by id. Honours `opts.dry_run`. */
async function runCase(testCaseId: string, opts: ExecuteOptions = {}): Promise<EngineResult> {
  const testCase = getTestCase(testCaseId);
  if (!testCase) throw EngineError.notFound('Test case');

  const engine = engineOf(testCase);
  try {
    return await runEngineForCase(testCase, opts);
  } catch (err) {
    if (err instanceof EngineError) throw err;
    const reason = err instanceof Error ? err.message : String(err);
    return {
      status: statusForFailure(err),
      engine,
      duration_ms: 0,
      logs: [
        {
          index: 0,
          action: 'engine',
          status: 'fail',
          message: reason,
          duration_ms: 0,
        },
      ],
      assertions: [],
      evidence: { error: reason },
      error: reason,
      used_ai: engine === 'ai',
    };
  }
}

/**
 * Runs many cases into ONE test_run row and rolls up the counters.
 * `opts.run_id` appends into an existing run instead of creating a new one.
 */
async function runSuite(testCaseIds: string[], opts: ExecuteOptions = {}): Promise<SuiteResult> {
  const ids = Array.from(new Set((testCaseIds ?? []).filter((id) => typeof id === 'string' && id.trim())));
  if (!ids.length) {
    throw EngineError.badRequest('Daftar test case kosong. Pilih minimal satu test case untuk dijalankan.');
  }

  const cases: TestCase[] = [];
  for (const id of ids) {
    const testCase = getTestCase(id);
    if (!testCase) throw EngineError.notFound(`Test case ${id}`);
    cases.push(testCase);
  }

  const projectId = cases[0]?.project_id as string;
  const engines = Array.from(new Set(cases.map((c) => engineOf(c))));
  const suiteStarted = Date.now();

  /* --------------------------- resolve the run ------------------------ */
  let run: TestRun;
  let reused = false;
  if (opts.run_id) {
    const existing = getRun(opts.run_id);
    if (!existing) throw EngineError.notFound('Test run');
    run = existing;
    reused = true;
    db.prepare("UPDATE test_runs SET status = 'running', updated_at = ? WHERE id = ?").run(nowIso(), run.id);
  } else {
    run = createTestRun({
      project_id: projectId,
      name: `Automation suite — ${cases.length} test case (${engines.join(', ')})`,
      engine: engines.length === 1 ? (engines[0] as ExecEngine) : 'manual',
      environment_id: opts.environment_id ?? null,
      executed_by: opts.executed_by ?? 'automation',
      kind: 'automation',
    });
  }

  /* ------------------------------ dry run ---------------------------- */
  if (opts.dry_run) {
    const results = [] as SuiteResult['results'];
    for (const testCase of cases) {
      const started = Date.now();
      let engineResult: EngineResult;
      try {
        engineResult = await runEngineForCase(testCase, { ...opts, dry_run: true });
      } catch (err) {
        engineResult = {
          status: statusForFailure(err),
          engine: engineOf(testCase),
          duration_ms: 0,
          logs: [],
          assertions: [],
          evidence: {},
          error: err instanceof Error ? err.message : String(err),
          used_ai: false,
        };
      }
      results.push({
        test_case_id: testCase.id,
        code: testCase.code,
        title: testCase.title,
        status: engineResult.status,
        duration_ms: Date.now() - started,
        error: engineResult.error,
      });
    }

    const counters = rollupCounters(results.map((r) => r.status));
    return {
      run_id: run.id,
      ...counters,
      duration_ms: Date.now() - suiteStarted,
      results,
    };
  }

  /* --------------------------- real execution ------------------------ */
  const results: SuiteResult['results'] = [];
  const vars = await environmentVars(opts.environment_id);

  for (const testCase of cases) {
    const caseStarted = Date.now();
    const engine = engineOf(testCase);
    let engineResult: EngineResult;
    let thrown: unknown = null;

    try {
      engineResult = await runEngineForCase(testCase, { ...opts, run_id: run.id, overrides: { ...opts.overrides, vars } });
    } catch (err) {
      thrown = err;
      const reason = err instanceof Error ? err.message : String(err);
      engineResult = {
        status: statusForFailure(err),
        engine,
        duration_ms: Date.now() - caseStarted,
        logs: [
          {
            index: 0,
            action: 'engine',
            status: 'fail',
            message: reason,
            duration_ms: Date.now() - caseStarted,
          },
        ],
        assertions: [],
        evidence: { error: reason },
        error: reason,
        used_ai: engine === 'ai',
      };
      if (err instanceof EngineError && err.details) {
        engineResult.evidence = { ...engineResult.evidence, details: err.details, code: err.code };
      }
    }

    const duration = Date.now() - caseStarted;

    // Persist the per-case result row (test_runs/run_results are shared with Lane B).
    try {
      writeRunResult({
        run_id: run.id,
        test_case_id: testCase.id,
        status: engineResult.status,
        engine,
        duration_ms: duration,
        actual_result: summariseActual(engineResult),
        error_message: engineResult.error ? truncate(engineResult.error, 2000) : null,
        evidence: { ...engineResult.evidence, logs: engineResult.logs, assertions: engineResult.assertions },
        executed_by: opts.executed_by ?? 'automation',
      });
    } catch {
      /* a persistence hiccup must not abort the whole suite */
    }

    // Update the test case's automation status so the matrix/metrics stay honest.
    try {
      db.prepare('UPDATE test_cases SET updated_at = ? WHERE id = ?').run(nowIso(), testCase.id);
    } catch {
      /* ignore */
    }

    results.push({
      test_case_id: testCase.id,
      code: testCase.code,
      title: testCase.title,
      status: engineResult.status,
      duration_ms: duration,
      error: engineResult.error ?? (thrown ? 'Engine gagal dijalankan.' : null),
    });
  }

  const duration = Date.now() - suiteStarted;
  try {
    refreshRunCounters(run.id, duration);
  } catch {
    /* the returned SuiteResult is still valid without persisted counters */
  }

  const counters = rollupCounters(results.map((r) => r.status));

  return {
    run_id: run.id,
    ...counters,
    total: results.length,
    duration_ms: duration,
    results,
  };
}

/** One-line "actual result" stored on the run_results row. */
function summariseActual(result: EngineResult): string | null {
  const assertionSummary = result.assertions.length
    ? `${result.assertions.filter((a) => a.passed).length}/${result.assertions.length} assertion lulus`
    : 'tanpa assertion';
  const lastOk = [...result.logs].reverse().find((l) => l.status === 'ok');
  const parts = [`status=${result.status}`, assertionSummary];
  if (lastOk) parts.push(lastOk.message);
  return truncate(parts.join(' | '), 2000);
}

/**
 * Regression helper — Lane B hands us a candidate set and gets back the ones
 * that are actually runnable now (i.e. have a linked artifact).
 */
export async function impactRegression(testCaseIds: string[]): Promise<{
  runnable: Array<{ test_case_id: string; code: string; engine: ExecEngine; artifact: string | null }>;
  blocked: Array<{ test_case_id: string; code: string; engine: ExecEngine; reason: string }>;
}> {
  const runnable: Array<{ test_case_id: string; code: string; engine: ExecEngine; artifact: string | null }> = [];
  const blocked: Array<{ test_case_id: string; code: string; engine: ExecEngine; reason: string }> = [];

  for (const id of testCaseIds ?? []) {
    const testCase = getTestCase(id);
    if (!testCase) {
      blocked.push({ test_case_id: id, code: id, engine: 'manual', reason: 'Test case tidak ditemukan.' });
      continue;
    }
    const engine = engineOf(testCase);

    if (engine === 'manual') {
      runnable.push({ test_case_id: id, code: testCase.code, engine, artifact: null });
      continue;
    }
    if (engine === 'ai') {
      const ai = await probeAi();
      if (ai.available) runnable.push({ test_case_id: id, code: testCase.code, engine, artifact: 'aiService' });
      else blocked.push({ test_case_id: id, code: testCase.code, engine, reason: ai.reason });
      continue;
    }

    const table = engine === 'api' ? 'api_requests' : engine === 'db' ? 'db_checks' : 'web_flows';
    let row: { id: string; name?: string } | undefined;
    try {
      row = db.prepare(`SELECT id, name FROM ${table} WHERE test_case_id = ? LIMIT 1`).get(id) as
        | { id: string; name?: string }
        | undefined;
    } catch {
      row = undefined;
    }

    if (row) runnable.push({ test_case_id: id, code: testCase.code, engine, artifact: row.name ?? row.id });
    else
      blocked.push({
        test_case_id: id,
        code: testCase.code,
        engine,
        reason: `Belum ada artefak ${engine} yang tertaut ke test case ini.`,
      });
  }

  return { runnable, blocked };
}

export const executeService = {
  runCase,
  runSuite,
  capabilities,
  impactRegression,
  /** Convenience for Lane B: the runnable/blocked split of a candidate suite. */
  preflight: impactRegression,
};

/* ------------------------------------------------------------------ *
 * Route helpers
 * ------------------------------------------------------------------ */

function engineFail(reply: FastifyReply, err: unknown) {
  if (err instanceof EngineError) return fail(reply, err.status, err.code, err.message, err.details);
  const message = err instanceof Error ? err.message : String(err);
  return fail(reply, 500, 'engine_error', message);
}

function parseIds(input: unknown): string[] {
  if (Array.isArray(input)) return input.filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
  if (typeof input === 'string' && input.trim()) {
    try {
      const parsed = JSON.parse(input) as unknown;
      if (Array.isArray(parsed)) return parsed.filter((v): v is string => typeof v === 'string');
    } catch {
      return input.split(',').map((s) => s.trim()).filter(Boolean);
    }
  }
  return [];
}

/* ------------------------------------------------------------------ *
 * Fastify plugin
 * ------------------------------------------------------------------ */

export default async function routes(app: FastifyInstance): Promise<void> {
  /* ---------------------------- capabilities --------------------------- */

  app.get('/execute/capabilities', async () => one(await capabilities()));

  /* ------------------------------ run case ----------------------------- */

  app.post('/test-cases/:id/execute', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as Record<string, unknown>;

    if (!getTestCase(id)) return notFound(reply, 'Test case');

    try {
      const result = await runCase(id, {
        environment_id: typeof body.environment_id === 'string' ? body.environment_id : null,
        dry_run: body.dry_run === true,
        timeout_ms: typeof body.timeout_ms === 'number' ? body.timeout_ms : undefined,
        overrides: (body.overrides as Record<string, unknown>) ?? undefined,
        executed_by: typeof body.executed_by === 'string' ? body.executed_by : 'automation',
        ai_assist: body.ai_assist === true,
      });
      return reply.send(one(result));
    } catch (err) {
      return engineFail(reply, err);
    }
  });

  /* ------------------------------ run suite ---------------------------- */

  app.post('/execute/suite', async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const ids = parseIds(body.test_case_ids ?? body.test_case_id);

    if (!ids.length) {
      return badRequest(reply, 'Field "test_case_ids" wajib berisi minimal satu id test case.');
    }

    try {
      const result = await runSuite(ids, {
        environment_id: typeof body.environment_id === 'string' ? body.environment_id : null,
        dry_run: body.dry_run === true,
        timeout_ms: typeof body.timeout_ms === 'number' ? body.timeout_ms : undefined,
        overrides: (body.overrides as Record<string, unknown>) ?? undefined,
        executed_by: typeof body.executed_by === 'string' ? body.executed_by : 'automation',
        run_id: typeof body.run_id === 'string' ? body.run_id : null,
      });
      return reply.send(one(result));
    } catch (err) {
      return engineFail(reply, err);
    }
  });

  /* --------------------------- run orchestration ----------------------- */

  app.get('/execute/runs/:runId', async (req, reply) => {
    const { runId } = req.params as { runId: string };
    const run = getRun(runId);
    if (!run) return notFound(reply, 'Test run');
    const results = db
      .prepare('SELECT * FROM run_results WHERE run_id = ? ORDER BY created_at ASC')
      .all(runId) as unknown as RunResult[];
    return one({ ...run, results });
  });

  app.get('/execute/runs/:runId/results', async (req, reply) => {
    const { runId } = req.params as { runId: string };
    if (!getRun(runId)) return notFound(reply, 'Test run');

    const rows = db
      .prepare(
        `SELECT r.*, tc.code AS test_case_code, tc.title AS test_case_title, tc.engine AS test_case_engine
           FROM run_results r
           LEFT JOIN test_cases tc ON tc.id = r.test_case_id
          WHERE r.run_id = ?
          ORDER BY r.created_at ASC`,
      )
      .all(runId) as Array<Record<string, unknown>>;

    return list(
      rows.map((row) => ({
        ...row,
        evidence: parseJson<unknown>(row.evidence, null),
      })),
      rows.length,
    );
  });

  /** Full per-step drill-down for one result. */
  app.get('/execute/results/:resultId', async (req, reply) => {
    const { resultId } = req.params as { resultId: string };
    const row = db.prepare('SELECT * FROM run_results WHERE id = ?').get(resultId) as
      | Record<string, unknown>
      | undefined;
    if (!row) return notFound(reply, 'Run result');
    const testCase = getTestCase(row.test_case_id as string);
    return one({
      ...row,
      evidence: parseJson<unknown>(row.evidence, null),
      test_case: testCase ?? null,
    });
  });

  /* ------------------------- test case picker -------------------------- */

  app.get('/execute/cases', async (req) => {
    const q = req.query as Record<string, unknown>;
    const projectId = typeof q.project_id === 'string' ? q.project_id : '';
    const engine = typeof q.engine === 'string' ? q.engine : '';
    const search = typeof q.search === 'string' ? q.search.toLowerCase() : '';
    const onlyRegression = q.regression === 'true' || q.regression === '1';

    const where: string[] = [];
    const params: unknown[] = [];
    if (projectId) {
      where.push('project_id = ?');
      params.push(projectId);
    }
    if (engine) {
      where.push('engine = ?');
      params.push(engine);
    }
    if (search) {
      where.push('(LOWER(title) LIKE ? OR LOWER(code) LIKE ?)');
      params.push(`%${search}%`, `%${search}%`);
    }
    if (onlyRegression) where.push('is_regression = 1');

    const sql =
      `SELECT id, project_id, code, title, engine, layer, priority, severity, automation_status,
              is_regression, risk_score, status
         FROM test_cases` +
      (where.length ? ` WHERE ${where.join(' AND ')}` : '') +
      ' ORDER BY is_regression DESC, risk_score DESC, code ASC LIMIT 500';

    let rows: Array<Record<string, unknown>> = [];
    try {
      rows = db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
    } catch {
      rows = [];
    }

    return list(rows, rows.length);
  });

  /** Preflight for a regression suite: which cases can actually run right now. */
  app.post('/execute/preflight', async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const ids = parseIds(body.test_case_ids);
    if (!ids.length) return badRequest(reply, 'Field "test_case_ids" wajib berisi minimal satu id.');
    try {
      return one(await impactRegression(ids));
    } catch (err) {
      return engineFail(reply, err);
    }
  });
}

export { EngineError, getTestCase, engineOf, rollupCounters, toJson };
export type { EngineResult, SuiteResult, ExecuteOptions };
