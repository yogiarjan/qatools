/**
 * runs module — lifecycle stage 8 (eksekusi manual) + the execution bridge to lane-auto.
 *
 * Routes (mounted at /api):
 *   GET    /projects/:projectId/runs           ?kind=&status=&limit=
 *   POST   /projects/:projectId/runs           auto code RUN-nnnn
 *   GET    /runs/:id                           run detail + results
 *   PATCH  /runs/:id
 *   DELETE /runs/:id
 *   POST   /runs/:id/results                   record a manual result (upsert per test case)
 *   GET    /runs/:id/results
 *   PATCH  /run-results/:id
 *   DELETE /run-results/:id
 *   POST   /runs/:id/complete                  roll counters into test_runs totals
 *   POST   /runs/:id/execute                   bridge to executeService.runSuite (lane-auto)
 *
 * CROSS-LANE RULE: `executeService` lives in ../execute/index.js and is owned by lane-auto.
 * It is imported DYNAMICALLY inside the handler (never at module top level, which would
 * break boot before lane-auto lands) and degrades to 503 `engine_unavailable`.
 */

import type { FastifyInstance } from 'fastify';
import { list, one, fail, notFound, badRequest } from '../../lib/http.js';
import { logActivity, findById, db } from '../../db/index.js';
import {
  listRuns,
  createRun,
  getRun,
  updateRun,
  removeRun,
  runDetail,
  listResults,
  recordResult,
  recordResults,
  updateResult,
  removeResult,
  completeRun,
  findResult,
  RUN_KINDS,
  RUN_ENGINES,
} from './repo.js';

function asString(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  return s ? s : undefined;
}

function idList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x)).filter(Boolean);
}

/* --------------------------- engine bridge (lane-auto) -------------------- */

interface EngineResultShape {
  status: string;
  engine: string;
  duration_ms: number;
  logs: unknown[];
  assertions: unknown[];
  evidence: Record<string, unknown>;
  error: string | null;
  used_ai: boolean;
}

interface SuiteResultShape {
  run_id: string;
  total: number;
  passed: number;
  failed: number;
  blocked: number;
  skipped: number;
  duration_ms: number;
  results: Array<{
    test_case_id: string;
    code: string;
    title: string;
    status: string;
    duration_ms: number;
    error: string | null;
  }>;
}

interface ExecuteServiceShape {
  runSuite: (testCaseIds: string[], opts: Record<string, unknown>) => Promise<SuiteResultShape>;
  runCase: (testCaseId: string, opts: Record<string, unknown>) => Promise<EngineResultShape>;
}

type LoadResult =
  | { ok: true; service: ExecuteServiceShape }
  | { ok: false; message: string };

/**
 * Loads lane-auto's execute service. Returns a discriminated result instead of throwing so
 * every caller can answer with the same 503 envelope.
 *
 * The specifier is built at runtime and reached through `Function` so TypeScript does not try
 * to resolve a module that lane-auto may not have landed yet. The import stays fully dynamic
 * at runtime, which is what the cross-lane contract requires.
 */
async function loadExecuteService(): Promise<LoadResult> {
  try {
    const dynamicImport = new Function('specifier', 'return import(specifier)') as (
      specifier: string,
    ) => Promise<{ executeService?: ExecuteServiceShape }>;
    const mod = await dynamicImport('../execute/index.js');
    const service = mod?.executeService;
    if (!service || typeof service.runSuite !== 'function') {
      return { ok: false, message: 'executeService.runSuite belum tersedia' };
    }
    return { ok: true, service };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

function engineUnavailable(reply: Parameters<typeof fail>[0], message: string) {
  return fail(reply, 503, 'engine_unavailable', `Mesin eksekusi belum tersedia: ${message}`);
}

export default async function routes(app: FastifyInstance): Promise<void> {
  /* --------------------------------- list ---------------------------------- */

  app.get<{
    Params: { projectId: string };
    Querystring: { kind?: string; status?: string; limit?: string };
  }>('/projects/:projectId/runs', async (req) => {
    const q = req.query ?? {};
    return list(
      listRuns(req.params.projectId, {
        kind: asString(q.kind),
        status: asString(q.status),
        limit: q.limit ? Number(q.limit) : undefined,
      }),
    );
  });

  /* -------------------------------- create --------------------------------- */

  app.post<{ Params: { projectId: string }; Body: Record<string, unknown> }>(
    '/projects/:projectId/runs',
    async (req, reply) => {
      const body = req.body ?? {};
      const kind = asString(body.kind) ?? 'manual';
      if (!(RUN_KINDS as readonly string[]).includes(kind)) {
        return badRequest(reply, `kind harus salah satu dari: ${RUN_KINDS.join(', ')}`);
      }
      const engine = asString(body.engine) ?? (kind === 'manual' ? 'manual' : 'api');
      if (!(RUN_ENGINES as readonly string[]).includes(engine)) {
        return badRequest(reply, `engine harus salah satu dari: ${RUN_ENGINES.join(', ')}`);
      }
      const name = asString(body.name) ?? `Run ${kind} ${new Date().toISOString().slice(0, 10)}`;

      const row = createRun({
        project_id: req.params.projectId,
        name,
        cycle_id: asString(body.cycle_id) ?? null,
        sprint_id: asString(body.sprint_id) ?? null,
        environment_id: asString(body.environment_id) ?? null,
        code: asString(body.code) ?? null,
        kind,
        engine,
        executed_by: asString(body.executed_by) ?? asString(body.executor) ?? null,
        notes: asString(body.notes) ?? null,
      });

      // An optional initial scope lets the UI create "a run of these cases" in one call.
      const testCaseIds = idList(body.test_case_ids);
      const validIds = testCaseIds.filter((id) => findById('test_cases', id));
      if (validIds.length) {
        recordResults(
          row.id,
          validIds.map((test_case_id) => ({ test_case_id, status: 'not_run', engine })),
        );
      }

      logActivity({
        project_id: req.params.projectId,
        action: 'run.create',
        entity_kind: 'test_run',
        entity_id: row.id,
        summary: `Run ${row.code} (${kind}) dibuat dengan ${validIds.length} test case`,
      });
      return reply.code(201).send(one(runDetail(row.id)));
    },
  );

  /* -------------------------------- detail --------------------------------- */

  app.get<{ Params: { id: string } }>('/runs/:id', async (req, reply) => {
    const row = runDetail(req.params.id);
    if (!row) return notFound(reply, 'Test run');
    return one(row);
  });

  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>('/runs/:id', async (req, reply) => {
    const row = updateRun(req.params.id, req.body ?? {});
    if (!row) return notFound(reply, 'Test run');
    return one(row);
  });

  app.delete<{ Params: { id: string } }>('/runs/:id', async (req, reply) => {
    const existing = getRun(req.params.id);
    if (!existing) return notFound(reply, 'Test run');
    removeRun(req.params.id);
    return one({ id: req.params.id, deleted: true });
  });

  /* ------------------------------- results --------------------------------- */

  app.get<{ Params: { id: string } }>('/runs/:id/results', async (req, reply) => {
    if (!getRun(req.params.id)) return notFound(reply, 'Test run');
    return list(listResults(req.params.id));
  });

  app.post<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/runs/:id/results',
    async (req, reply) => {
      const run = getRun(req.params.id);
      if (!run) return notFound(reply, 'Test run');
      const body = req.body ?? {};

      // Accept one result, or a batch as { results: [...] }.
      const batch: Array<Record<string, unknown>> = Array.isArray(body.results)
        ? (body.results as Array<Record<string, unknown>>)
        : [body];

      const recorded: unknown[] = [];
      for (const item of batch) {
        const testCaseId = asString(item.test_case_id);
        if (!testCaseId) return badRequest(reply, 'test_case_id wajib diisi');
        if (!findById('test_cases', testCaseId)) return notFound(reply, `Test case ${testCaseId}`);
        const row = recordResult(run.id, {
          test_case_id: testCaseId,
          status: asString(item.status) ?? 'passed',
          engine: asString(item.engine) ?? run.engine,
          duration_ms: item.duration_ms,
          actual_result: asString(item.actual_result) ?? null,
          error_message: asString(item.error_message) ?? null,
          evidence: item.evidence,
          executed_by: asString(item.executed_by) ?? run.executed_by,
          executed_at: asString(item.executed_at) ?? null,
          defect_id: asString(item.defect_id) ?? null,
        });
        recorded.push(row);
      }

      logActivity({
        project_id: run.project_id,
        action: 'run.result.record',
        entity_kind: 'test_run',
        entity_id: run.id,
        summary: `${recorded.length} hasil manual dicatat pada ${run.code}`,
      });
      return reply.code(201).send(list(recorded, recorded.length));
    },
  );

  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/run-results/:id',
    async (req, reply) => {
      const row = updateResult(req.params.id, req.body ?? {});
      if (!row) return notFound(reply, 'Run result');
      return one(row);
    },
  );

  app.delete<{ Params: { id: string } }>('/run-results/:id', async (req, reply) => {
    const changes = removeResult(req.params.id);
    if (!changes) return notFound(reply, 'Run result');
    return one({ id: req.params.id, deleted: true });
  });

  /* ------------------------------- complete -------------------------------- */

  app.post<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/runs/:id/complete',
    async (req, reply) => {
      const body = req.body ?? {};
      const current = getRun(req.params.id);
      if (!current) return notFound(reply, 'Test run');
      const row = completeRun(req.params.id, {
        status: asString(body.status) ?? 'completed',
        duration_ms: body.duration_ms === undefined ? undefined : Number(body.duration_ms),
        notes: asString(body.notes) ?? null,
      });
      if (!row) return notFound(reply, 'Test run');
      logActivity({
        project_id: row.project_id,
        action: 'run.complete',
        entity_kind: 'test_run',
        entity_id: row.id,
        summary: `${row.code} selesai: ${row.passed}/${row.total} lulus`,
      });
      return one(runDetail(row.id));
    },
  );

  /* -------------------------------- execute -------------------------------- */

  app.post<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/runs/:id/execute',
    async (req, reply) => {
      const run = getRun(req.params.id);
      if (!run) return notFound(reply, 'Test run');
      const body = req.body ?? {};

      const engine = asString(body.engine) ?? run.engine;
      if (!(RUN_ENGINES as readonly string[]).includes(engine)) {
        return badRequest(reply, `engine harus salah satu dari: ${RUN_ENGINES.join(', ')}`);
      }

      // Explicit ids win; otherwise execute whatever the run already scoped.
      let testCaseIds = idList(body.test_case_ids);
      if (!testCaseIds.length) {
        testCaseIds = listResults(run.id).map((r) => r.test_case_id);
      }
      if (!testCaseIds.length) {
        return badRequest(reply, 'Tidak ada test case untuk dieksekusi. Kirim test_case_ids atau isi scope run.');
      }
      const unknown = testCaseIds.filter((id) => !findById('test_cases', id));
      if (unknown.length) {
        return badRequest(reply, `Test case tidak ditemukan: ${unknown.join(', ')}`, { missing: unknown });
      }

      const loaded = await loadExecuteService();
      if (!loaded.ok) return engineUnavailable(reply, loaded.message);

      const options = {
        run_id: run.id,
        environment_id: asString(body.environment_id) ?? run.environment_id,
        dry_run: body.dry_run === true || body.dry_run === 'true',
        timeout_ms: body.timeout_ms === undefined ? undefined : Number(body.timeout_ms),
        overrides: (body.overrides as Record<string, unknown>) ?? undefined,
        executed_by: asString(body.executed_by) ?? run.executed_by,
        ai_assist: body.ai_assist === true || body.ai_assist === 'true',
        engine,
      };

      let suite: SuiteResultShape;
      try {
        suite = await loaded.service.runSuite(testCaseIds, options);
      } catch (err) {
        return fail(
          reply,
          502,
          'engine_error',
          `Mesin ${engine} gagal menjalankan suite: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      // Persist whatever the engine produced so the run detail and metrics stay consistent.
      if (Array.isArray(suite?.results) && suite.results.length) {
        recordResults(
          run.id,
          suite.results.map((r) => ({
            test_case_id: r.test_case_id,
            status: r.status,
            engine,
            duration_ms: r.duration_ms,
            actual_result: r.error ?? null,
            error_message: r.error ?? null,
            evidence: { source: 'engine', code: r.code, title: r.title },
            executed_by: options.executed_by,
          })),
        );
      }

      logActivity({
        project_id: run.project_id,
        action: 'run.execute',
        entity_kind: 'test_run',
        entity_id: run.id,
        summary: `Run ${run.code} dieksekusi via engine ${engine}: ${suite?.passed ?? 0}/${suite?.total ?? 0} lulus`,
      });

      return one({ suite, run: runDetail(run.id) });
    },
  );

  /**
   * Convenience: create the run and execute it in one call. The Regression page and the
   * automation pages use this so the user never has to think about run bookkeeping.
   */
  app.post<{ Params: { projectId: string }; Body: Record<string, unknown> }>(
    '/projects/:projectId/runs/execute',
    async (req, reply) => {
      const body = req.body ?? {};
      const engine = asString(body.engine) ?? 'api';
      if (!(RUN_ENGINES as readonly string[]).includes(engine)) {
        return badRequest(reply, `engine harus salah satu dari: ${RUN_ENGINES.join(', ')}`);
      }
      const kind = asString(body.kind) ?? (engine === 'manual' ? 'manual' : 'automation');
      if (!(RUN_KINDS as readonly string[]).includes(kind)) {
        return badRequest(reply, `kind harus salah satu dari: ${RUN_KINDS.join(', ')}`);
      }

      let testCaseIds = idList(body.test_case_ids);
      if (!testCaseIds.length && body.use_regression_suite === true) {
        testCaseIds = (
          db.prepare('SELECT id FROM test_cases WHERE project_id = ? AND is_regression = 1').all(
            req.params.projectId,
          ) as Array<{ id: string }>
        ).map((r) => r.id);
      }
      if (!testCaseIds.length) return badRequest(reply, 'test_case_ids wajib berisi minimal satu test case');

      const unknown = testCaseIds.filter((id) => !findById('test_cases', id));
      if (unknown.length) {
        return badRequest(reply, `Test case tidak ditemukan: ${unknown.join(', ')}`, { missing: unknown });
      }

      const loaded = await loadExecuteService();
      if (!loaded.ok) return engineUnavailable(reply, loaded.message);

      const run = createRun({
        project_id: req.params.projectId,
        name: asString(body.name) ?? `Run ${kind} ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
        cycle_id: asString(body.cycle_id) ?? null,
        sprint_id: asString(body.sprint_id) ?? null,
        environment_id: asString(body.environment_id) ?? null,
        kind,
        engine,
        executed_by: asString(body.executed_by) ?? null,
        notes: asString(body.notes) ?? null,
      });

      const options = {
        run_id: run.id,
        environment_id: asString(body.environment_id) ?? null,
        dry_run: body.dry_run === true || body.dry_run === 'true',
        timeout_ms: body.timeout_ms === undefined ? undefined : Number(body.timeout_ms),
        overrides: (body.overrides as Record<string, unknown>) ?? undefined,
        executed_by: asString(body.executed_by) ?? null,
        ai_assist: body.ai_assist === true || body.ai_assist === 'true',
        engine,
      };

      let suite: SuiteResultShape;
      try {
        suite = await loaded.service.runSuite(testCaseIds, options);
      } catch (err) {
        completeRun(run.id, { status: 'aborted', notes: `engine error: ${String(err)}` });
        return fail(
          reply,
          502,
          'engine_error',
          `Mesin ${engine} gagal menjalankan suite: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      if (Array.isArray(suite?.results) && suite.results.length) {
        recordResults(
          run.id,
          suite.results.map((r) => ({
            test_case_id: r.test_case_id,
            status: r.status,
            engine,
            duration_ms: r.duration_ms,
            actual_result: r.error ?? null,
            error_message: r.error ?? null,
            evidence: { source: 'engine', code: r.code, title: r.title },
            executed_by: options.executed_by,
          })),
        );
      }
      completeRun(run.id, { status: 'completed' });

      logActivity({
        project_id: req.params.projectId,
        action: 'run.execute',
        entity_kind: 'test_run',
        entity_id: run.id,
        summary: `Run ${run.code} (${kind}/${engine}) selesai`,
      });

      return reply.code(201).send(one({ suite, run: runDetail(run.id) }));
    },
  );

  /* ------------------------------- case-level ------------------------------ */

  /** Executes a single case through lane-auto's `runCase`, used by the run detail row action. */
  app.post<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/runs/:id/execute-case',
    async (req, reply) => {
      const run = getRun(req.params.id);
      if (!run) return notFound(reply, 'Test run');
      const testCaseId = asString(req.body?.test_case_id);
      if (!testCaseId) return badRequest(reply, 'test_case_id wajib diisi');
      if (!findById('test_cases', testCaseId)) return notFound(reply, 'Test case');

      const loaded = await loadExecuteService();
      if (!loaded.ok) return engineUnavailable(reply, loaded.message);
      if (typeof loaded.service.runCase !== 'function') {
        return engineUnavailable(reply, 'executeService.runCase belum tersedia');
      }

      const engine = asString(req.body?.engine) ?? run.engine;
      let result: EngineResultShape;
      try {
        result = await loaded.service.runCase(testCaseId, {
          run_id: run.id,
          environment_id: asString(req.body?.environment_id) ?? run.environment_id,
          dry_run: req.body?.dry_run === true,
          executed_by: asString(req.body?.executed_by) ?? run.executed_by,
          engine,
        });
      } catch (err) {
        return fail(
          reply,
          502,
          'engine_error',
          `Mesin ${engine} gagal: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      const recorded = recordResult(run.id, {
        test_case_id: testCaseId,
        status: result?.status ?? 'not_run',
        engine,
        duration_ms: result?.duration_ms ?? 0,
        actual_result: result?.error ?? null,
        error_message: result?.error ?? null,
        evidence: { logs: result?.logs ?? [], assertions: result?.assertions ?? [], ...(result?.evidence ?? {}) },
        executed_by: asString(req.body?.executed_by) ?? run.executed_by,
      });

      return one({ result: recorded, engine_result: result, run: runDetail(run.id) });
    },
  );

  /** Photos the existing result of a case (used for the "promote to defect" shortcut). */
  app.get<{ Params: { id: string }; Querystring: { test_case_id?: string } }>(
    '/runs/:id/result',
    async (req, reply) => {
      if (!getRun(req.params.id)) return notFound(reply, 'Test run');
      const testCaseId = asString(req.query.test_case_id);
      if (!testCaseId) return badRequest(reply, 'query test_case_id wajib diisi');
      const row = findResult(req.params.id, testCaseId);
      if (!row) return notFound(reply, 'Run result');
      return one(row);
    },
  );
}
