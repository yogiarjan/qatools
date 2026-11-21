/**
 * execute — THE integration module.
 *
 * Resolves a test case's `engine` column (manual | db | api | web | ai) and
 * dispatches to the owning Lane C engine. Lane B (regression) consumes
 * `executeService.runCase` / `runSuite` in-process — see ARCHITECTURE.md §6.1.
 *
 * Cross-lane safety:
 *  - Lane A owns `test_cases`; this module only READS that table (the schema has
 *    no reverse FK from engines, so binding is by `test_case_id` on the
 *    api_requests / db_checks / web_flows rows).
 *  - Lane D owns the AI engine; it is imported DYNAMICALLY inside the handler so
 *    this module boots even before lane D lands.
 */

import type { EngineResult, ExecEngine, RunStatus, TestCase } from '@qatools/shared';
import { db } from '../../db/index.js';
import { EngineError, emptyEngineResult, infoLog } from './engine-utils.js';
import type { ExecuteOptions } from '@qatools/shared';

/** Reads the test case row without importing another lane's repo module. */
export function getTestCase(id: string): TestCase | undefined {
  return db.prepare('SELECT * FROM test_cases WHERE id = ?').get(id) as TestCase | undefined;
}

export function engineOf(testCase: TestCase): ExecEngine {
  const engine = String(testCase.engine ?? 'manual');
  return (['manual', 'db', 'api', 'web', 'ai'] as const).includes(engine as ExecEngine)
    ? (engine as ExecEngine)
    : 'manual';
}

/**
 * Runs one test case through its engine.
 * Assertion failures throw `EngineError` with the user-facing 501 for missing
 * drivers only at the route layer — here an unavailable engine becomes a
 * `blocked` EngineResult so a suite can continue.
 */
export async function runEngineForCase(testCase: TestCase, opts: ExecuteOptions = {}): Promise<EngineResult> {
  const engine = engineOf(testCase);
  const started = Date.now();

  switch (engine) {
    /* ------------------------------- manual ---------------------------- */
    case 'manual':
      return {
        ...emptyEngineResult('manual', 'not_run', null),
        logs: [
          infoLog(
            0,
            'manual',
            'Test case ini ber-engine "manual". Eksekusi manual dicatat melalui Test Runs ' +
              '(POST /runs/:id/results) oleh tester, bukan dijalankan oleh server.',
          ),
        ],
        evidence: {
          mode: 'manual',
          instruction:
            'Buka test case, ikuti langkah-langkahnya, lalu catat status (passed/failed/blocked) pada run yang sesuai.',
          steps_hint: readStepHint(testCase.id),
        },
        duration_ms: Date.now() - started,
      };

    /* --------------------------------- db ------------------------------ */
    case 'db': {
      const check = findRow('db_checks', testCase.id);
      if (!check) {
        throw new EngineError(
          400,
          'no_db_check',
          `Test case ${testCase.code ?? testCase.id} ber-engine "db" tetapi belum punya DB check yang tertaut. ` +
            'Buat check di Database Testing dan isi test_case_id-nya.',
        );
      }
      const { executeDbCheck } = await import('../dbtester/engine.js');
      const { getCheck, getConnection } = await import('../dbtester/repo.js');
      const full = getCheck(check.id as string);
      if (!full) throw EngineError.notFound('DB check');
      const connection = getConnection(full.connection_id);
      if (!connection) throw EngineError.notFound('DB connection');
      return executeDbCheck(full, connection, { ...opts, vars: await environmentVars(opts.environment_id) });
    }

    /* --------------------------------- api ----------------------------- */
    case 'api': {
      const request = findRow('api_requests', testCase.id);
      if (!request) {
        throw new EngineError(
          400,
          'no_api_request',
          `Test case ${testCase.code ?? testCase.id} ber-engine "api" tetapi belum punya API request yang tertaut. ` +
            'Buat request di API Automation dan isi test_case_id-nya.',
        );
      }
      const { runApiRequestById } = await import('../apitester/engine.js');
      const result = await runApiRequestById(request.id as string, opts, await environmentVars(opts.environment_id));
      return result;
    }

    /* --------------------------------- web ----------------------------- */
    case 'web': {
      const flow = findRow('web_flows', testCase.id);
      if (!flow) {
        throw new EngineError(
          400,
          'no_web_flow',
          `Test case ${testCase.code ?? testCase.id} ber-engine "web" tetapi belum punya web flow yang tertaut. ` +
            'Buat flow di Web Automation dan isi test_case_id-nya.',
        );
      }
      const { executeWebFlow } = await import('../webtester/engine.js');
      const full = db.prepare('SELECT * FROM web_flows WHERE id = ?').get(flow.id as string) as
        | import('@qatools/shared').WebFlow
        | undefined;
      if (!full) throw EngineError.notFound('Web flow');
      const result = await executeWebFlow(full, { ...opts, vars: await environmentVars(opts.environment_id) });
      return result;
    }

    /* ---------------------------------- ai ----------------------------- */
    case 'ai':
      return runAiEngine(testCase, opts);

    default:
      return emptyEngineResult('manual', 'not_run', `Engine "${String(engine)}" tidak dikenal.`);
  }
}

/**
 * Binds a test case to an engine artifact by `test_case_id`.
 * Returns null when no artifact is linked yet.
 */
function findRow(table: 'api_requests' | 'db_checks' | 'web_flows', testCaseId: string): Record<string, unknown> | null {
  try {
    const row = db.prepare(`SELECT * FROM ${table} WHERE test_case_id = ? LIMIT 1`).get(testCaseId);
    return (row as Record<string, unknown> | undefined) ?? null;
  } catch {
    return null;
  }
}

function readStepHint(testCaseId: string): Array<{ action: string; expected: string | null }> {
  try {
    const rows = db
      .prepare('SELECT action, expected FROM test_steps WHERE test_case_id = ? ORDER BY order_index ASC')
      .all(testCaseId) as Array<{ action: string; expected: string | null }>;
    return rows;
  } catch {
    return [];
  }
}

/** Environment variables from lane B's `environments` table, when present. */
export async function environmentVars(environmentId: string | null | undefined): Promise<Record<string, unknown>> {
  if (!environmentId) return {};
  try {
    const row = db.prepare('SELECT variables FROM environments WHERE id = ?').get(environmentId) as
      | { variables: string | null }
      | undefined;
    if (!row?.variables) return {};
    const parsed = JSON.parse(row.variables) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/* ------------------------------------------------------------------ *
 * AI engine — Lane D, imported DYNAMICALLY so this module boots without it
 * ------------------------------------------------------------------ */

/**
 * Delegates to lane D's `aiService`. The import is dynamic and guarded: if
 * `modules/ai/index.ts` has not landed yet (or throws on import), the case is
 * reported as `blocked` with an honest message instead of crashing the server.
 */
async function runAiEngine(testCase: TestCase, opts: ExecuteOptions): Promise<EngineResult> {
  const started = Date.now();
  const logs = [
    infoLog(0, 'ai', `Menjalankan test case ${testCase.code ?? testCase.id} melalui engine AI.`),
  ];

  let aiModule: { aiService?: unknown; evaluateTestCase?: unknown } | null = null;
  try {
    // Runtime specifier: lane D's module is optional and must not break tsc/boot.
    const specifier = '../ai/index.js';
    aiModule = (await import(/* @vite-ignore */ specifier)) as { aiService?: unknown; evaluateTestCase?: unknown };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logs.push({
      index: 1,
      action: 'ai',
      status: 'fail',
      message: `Modul AI belum tersedia: ${reason}. Engine AI tidak dapat dijalankan.`,
      duration_ms: 0,
    });
    return {
      ...emptyEngineResult('ai', 'blocked', `Modul AI tidak tersedia: ${reason}`),
      logs,
      duration_ms: Date.now() - started,
      evidence: { mode: 'ai', available: false },
    };
  }

  if (!aiModule) {
    return {
      ...emptyEngineResult('ai', 'blocked', 'Modul AI tidak tersedia.'),
      logs,
      duration_ms: Date.now() - started,
      evidence: { mode: 'ai', available: false },
    };
  }

  // Prefer a purpose-built `evaluateTestCase` when lane D exports one.
  const evaluator = (aiModule as { evaluateTestCase?: unknown }).evaluateTestCase;
  if (typeof evaluator === 'function') {
    try {
      const result = (await (evaluator as (tc: TestCase, o: ExecuteOptions) => Promise<EngineResult>)(
        testCase,
        opts,
      )) as EngineResult;
      return { ...result, used_ai: true };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      logs.push({ index: 1, action: 'ai', status: 'fail', message: reason, duration_ms: 0 });
      return {
        ...emptyEngineResult('ai', 'failed', reason),
        logs,
        duration_ms: Date.now() - started,
        used_ai: true,
        evidence: { mode: 'ai', available: true },
      };
    }
  }

  // Otherwise fall back to asking the AI layer for its status so the user gets
  // an actionable message rather than a silent "blocked".
  const service = (aiModule as { aiService?: { status?: () => Promise<unknown> } }).aiService;
  if (service && typeof service.status === 'function') {
    try {
      const status = (await service.status()) as { message?: string; mode?: string; provider?: string };
      logs.push({
        index: 1,
        action: 'ai',
        status: 'info',
        message: `Status AI: ${status?.mode ?? 'tidak diketahui'} (${status?.provider ?? '—'}). ${status?.message ?? ''}`,
        duration_ms: 0,
      });
      return {
        ...emptyEngineResult(
          'ai',
          'blocked',
          'Engine AI terdeteksi tetapi belum menyediakan evaluasi test case (evaluateTestCase).',
        ),
        logs,
        duration_ms: Date.now() - started,
        used_ai: true,
        evidence: { mode: 'ai', available: true, ai_status: status },
      };
    } catch {
      /* fall through to the generic message below */
    }
  }

  logs.push({
    index: 1,
    action: 'ai',
    status: 'fail',
    message: 'Modul AI tersedia tetapi tidak mengekspor evaluateTestCase maupun aiService.status().',
    duration_ms: 0,
  });

  return {
    ...emptyEngineResult('ai', 'blocked', 'Engine AI belum siap dipakai.'),
    logs,
    duration_ms: Date.now() - started,
    evidence: { mode: 'ai', available: true },
  };
}

/** Maps a thrown engine failure onto a RunStatus for suite roll-ups. */
export function statusForFailure(err: unknown): RunStatus {
  if (err instanceof EngineError) {
    if (err.status === 502) return 'blocked';
    if (err.code === 'driver_not_installed') return 'blocked';
    if (err.status === 404 || err.status === 400) return 'blocked';
  }
  return 'failed';
}
