/**
 * regression module — 👑 KING OF THE TEST (lifecycle stage 10).
 *
 * Exports `regressionService` (ARCHITECTURE.md §6.1) consumed in-process by lane-auto and by
 * these HTTP routes:
 *
 *   GET  /projects/:projectId/regression/plan?strategy=&budget_minutes=&impact_of=  -> RegressionPlan
 *   GET  /projects/:projectId/regression/strategies
 *   GET  /projects/:projectId/regression/suite            current regression membership
 *   PUT  /projects/:projectId/regression/suite            { test_case_ids: [] } set membership
 *   POST /projects/:projectId/regression/suite            { test_case_ids: [] } add membership
 *   DELETE /projects/:projectId/regression/suite          { test_case_ids: [] } remove membership
 *   POST /projects/:projectId/regression/run              create + execute the suite (lane-auto)
 *   GET  /projects/:projectId/regression/flaky            flaky cases from run_results flip history
 *   GET  /projects/:projectId/regression/explain/:caseId  per-case score breakdown
 *
 * CROSS-LANE RULE: `executeService` (lane-auto) is loaded DYNAMICALLY inside the handler and
 * degrades to 503 `engine_unavailable` — never a top-level import.
 */

import type { FastifyInstance } from 'fastify';
import { list, one, fail, notFound, badRequest } from '../../lib/http.js';
import { logActivity, findById } from '../../db/index.js';
import { regressionService, REGRESSION_STRATEGIES } from './service.js';
import {
  regressionSuite,
  setRegressionSuite,
  addToRegressionSuite,
  removeFromRegressionSuite,
  gatherCandidates,
  impactedTestCaseIds,
} from './repo.js';
import { flakyCases, createRun, recordResults, completeRun, runDetail, listRuns } from '../runs/repo.js';
import { riskScore } from '@qatools/shared';

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
}

async function loadExecuteService(): Promise<
  { ok: true; service: ExecuteServiceShape } | { ok: false; message: string }
> {
  try {
    // Runtime-built specifier: lane-auto's module may not exist yet, and a static import
    // would break boot/typecheck before it lands.
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

function asString(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  return s ? s : undefined;
}

function idList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x)).filter(Boolean);
}

export { regressionService } from './service.js';

export default async function routes(app: FastifyInstance): Promise<void> {
  /* --------------------------------- plan ---------------------------------- */

  app.get<{
    Params: { projectId: string };
    Querystring: { strategy?: string; budget_minutes?: string; impact_of?: string };
  }>('/projects/:projectId/regression/plan', async (req, reply) => {
    const q = req.query ?? {};
    // An unrecognised strategy degrades to risk_based (the service's documented default)
    // rather than erroring — the caller still gets a usable, explained plan.
    const strategy = asString(q.strategy);
    const impactOf = asString(q.impact_of);
    if (strategy === 'impact_only' && impactOf) {
      // Fail loudly when the referenced artifact does not exist: an empty plan must be
      // distinguishable from a typo in impact_of.
      const exists =
        findById('test_cases', impactOf) ??
        findById('requirements', impactOf) ??
        findById('use_cases', impactOf) ??
        findById('scenarios', impactOf);
      if (!exists) return notFound(reply, `Artefak dampak ${impactOf}`);
    }
    const plan = regressionService.selectSuite(req.params.projectId, {
      strategy,
      budget_minutes: q.budget_minutes,
      impact_of: impactOf,
    });
    return one(plan);
  });

  app.get<{ Params: { projectId: string } }>('/projects/:projectId/regression/strategies', async () =>
    list(regressionService.strategies()),
  );

  /* ---------------------------------- suite -------------------------------- */

  app.get<{ Params: { projectId: string } }>('/projects/:projectId/regression/suite', async (req) => {
    const rows = regressionSuite(req.params.projectId);
    const minutes = rows.reduce((s, r) => s + Number(r.estimated_minutes ?? 0), 0);
    return {
      data: rows,
      total: rows.length,
      summary: {
        size: rows.length,
        estimated_minutes: minutes,
        automated: rows.filter((r) => r.automation_status === 'automated' || r.engine !== 'manual').length,
        by_priority: countBy(rows.map((r) => r.priority)),
        by_engine: countBy(rows.map((r) => r.engine)),
      },
    };
  });

  app.put<{ Params: { projectId: string }; Body: Record<string, unknown> }>(
    '/projects/:projectId/regression/suite',
    async (req, reply) => {
      const ids = idList(req.body?.test_case_ids);
      const invalid = ids.filter((id) => !findById('test_cases', id));
      if (invalid.length) {
        return badRequest(reply, `Test case tidak ditemukan: ${invalid.join(', ')}`, { invalid });
      }
      setRegressionSuite(req.params.projectId, ids);
      const rows = regressionSuite(req.params.projectId);
      logActivity({
        project_id: req.params.projectId,
        action: 'regression.suite.set',
        entity_kind: 'test_case',
        entity_id: null,
        summary: `Suite regresi diatur ke ${rows.length} test case`,
      });
      // Same list envelope as GET so callers can treat both responses identically.
      return { data: rows, total: rows.length };
    },
  );

  app.post<{ Params: { projectId: string }; Body: Record<string, unknown> }>(
    '/projects/:projectId/regression/suite',
    async (req, reply) => {
      const ids = idList(req.body?.test_case_ids);
      if (!ids.length) return badRequest(reply, 'test_case_ids wajib berisi minimal satu test case');
      const invalid = ids.filter((id) => !findById('test_cases', id));
      if (invalid.length) {
        return badRequest(reply, `Test case tidak ditemukan: ${invalid.join(', ')}`, { invalid });
      }
      const touched = addToRegressionSuite(req.params.projectId, ids);
      return { added: touched, data: regressionSuite(req.params.projectId), total: touched };
    },
  );

  app.delete<{ Params: { projectId: string }; Body: Record<string, unknown> }>(
    '/projects/:projectId/regression/suite',
    async (req, reply) => {
      const ids = idList(req.body?.test_case_ids);
      if (!ids.length) return badRequest(reply, 'test_case_ids wajib berisi minimal satu test case');
      const touched = removeFromRegressionSuite(req.params.projectId, ids);
      return { removed: touched, data: regressionSuite(req.params.projectId), total: touched };
    },
  );

  /* ---------------------------------- run ---------------------------------- */

  app.post<{ Params: { projectId: string }; Body: Record<string, unknown> }>(
    '/projects/:projectId/regression/run',
    async (req, reply) => {
      const body = req.body ?? {};
      const strategy = asString(body.strategy) ?? 'risk_based';
      if (!(REGRESSION_STRATEGIES as string[]).includes(strategy)) {
        return badRequest(reply, `strategy harus salah satu dari: ${REGRESSION_STRATEGIES.join(', ')}`);
      }

      // Either honour an explicit list (the UI lets the user toggle cases), or re-plan server-side
      // so the plan the user saw is the plan that runs.
      const explicit = idList(body.test_case_ids);
      const plan = regressionService.selectSuite(req.params.projectId, {
        strategy,
        budget_minutes: body.budget_minutes,
        impact_of: asString(body.impact_of),
      });
      const planIds = plan.selected.map((s) => s.test_case_id);
      const testCaseIds = explicit.length ? explicit : planIds;

      if (!testCaseIds.length) {
        return badRequest(
          reply,
          'Tidak ada test case untuk dijalankan. Pilih strategi yang menghasilkan suite atau kirim test_case_ids.',
          { strategy, plan },
        );
      }

      const loaded = await loadExecuteService();
      if (!loaded.ok) {
        return fail(
          reply,
          503,
          'engine_unavailable',
          `Mesin eksekusi belum tersedia: ${loaded.message}`,
        );
      }

      const run = createRun({
        project_id: req.params.projectId,
        name: asString(body.name) ?? `Regresi ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
        cycle_id: asString(body.cycle_id) ?? null,
        sprint_id: asString(body.sprint_id) ?? null,
        environment_id: asString(body.environment_id) ?? null,
        kind: 'regression',
        engine: asString(body.engine) ?? 'api',
        executed_by: asString(body.executed_by) ?? null,
        notes: asString(body.notes) ?? `Strategi regresi: ${strategy}`,
      });

      let suite: SuiteResultShape;
      try {
        suite = await loaded.service.runSuite(testCaseIds, {
          run_id: run.id,
          environment_id: asString(body.environment_id) ?? null,
          dry_run: body.dry_run === true || body.dry_run === 'true',
          timeout_ms: body.timeout_ms === undefined ? undefined : Number(body.timeout_ms),
          overrides: (body.overrides as Record<string, unknown>) ?? undefined,
          executed_by: asString(body.executed_by) ?? null,
          ai_assist: body.ai_assist === true || body.ai_assist === 'true',
          strategy,
        });
      } catch (err) {
        completeRun(run.id, { status: 'aborted', notes: `engine error: ${String(err)}` });
        return fail(
          reply,
          502,
          'engine_error',
          `Suite regresi gagal dijalankan: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      if (Array.isArray(suite?.results) && suite.results.length) {
        recordResults(
          run.id,
          suite.results.map((r) => ({
            test_case_id: r.test_case_id,
            status: r.status,
            engine: asString(body.engine) ?? 'api',
            duration_ms: r.duration_ms,
            actual_result: r.error ?? null,
            error_message: r.error ?? null,
            evidence: { source: 'regression', strategy, code: r.code, title: r.title },
            executed_by: asString(body.executed_by) ?? null,
          })),
        );
      }
      completeRun(run.id, { status: 'completed' });

      logActivity({
        project_id: req.params.projectId,
        action: 'regression.run',
        entity_kind: 'test_run',
        entity_id: run.id,
        summary: `Regresi ${run.code} (${strategy}): ${suite?.passed ?? 0}/${suite?.total ?? 0} lulus`,
      });

      // Expose the gate verdict inline so the UI can render it without another round-trip.
      const gate = regressionGate(plan.selected.length, suite);
      return reply.code(201).send(
        one({
          suite,
          run: runDetail(run.id),
          plan,
          gate,
        }),
      );
    },
  );

  /* --------------------------------- flaky --------------------------------- */

  app.get<{ Params: { projectId: string }; Querystring: { days?: string; min_flips?: string } }>(
    '/projects/:projectId/regression/flaky',
    async (req) => {
      const q = req.query ?? {};
      const rows = flakyCases(req.params.projectId, {
        days: q.days ? Number(q.days) : 90,
        minFlips: q.min_flips ? Number(q.min_flips) : 2,
      });
      return { data: rows, total: rows.length };
    },
  );

  /* -------------------------------- explain -------------------------------- */

  /** Per-case risk breakdown — powers the "kenapa kasus ini masuk?" popover on the King page. */
  app.get<{ Params: { projectId: string; caseId: string } }>(
    '/projects/:projectId/regression/explain/:caseId',
    async (req, reply) => {
      const candidate = gatherCandidates(req.params.projectId).find((c) => c.id === req.params.caseId);
      if (!candidate) return notFound(reply, 'Test case');
      const risk = riskScore({
        businessCriticality: candidate.business_criticality,
        usageFrequency: candidate.usage_frequency,
        complexity: candidate.complexity,
        defectHistory: candidate.defect_history,
        lastRunFailed: candidate.last_run_failed,
        isRegression: candidate.is_regression === 1,
        hasAutomation: candidate.automation_status === 'automated',
      });
      return one({
        test_case_id: candidate.id,
        code: candidate.code,
        title: candidate.title,
        score: risk.score,
        level: risk.level,
        factors: risk.factors,
        inputs: {
          business_criticality: candidate.business_criticality,
          business_criticality_source: candidate.business_criticality_source,
          usage_frequency: candidate.usage_frequency,
          complexity: candidate.complexity,
          defect_history: candidate.defect_history,
          last_run_failed: candidate.last_run_failed,
          last_run_status: candidate.last_run_status,
          is_regression: candidate.is_regression === 1,
          has_automation: candidate.automation_status === 'automated',
          executions: candidate.executions,
          flips: candidate.flips,
          step_count: candidate.step_count,
        },
        threshold: 65,
        qualifies_for_default_suite: risk.score >= 65,
      });
    },
  );

  /** Cases structurally reachable from a change — the impact_only preview. */
  app.get<{ Params: { projectId: string }; Querystring: { artifact_id?: string } }>(
    '/projects/:projectId/regression/impact',
    async (req, reply) => {
      const artifactId = asString(req.query.artifact_id);
      if (!artifactId) return badRequest(reply, 'query artifact_id wajib diisi');
      const ids = impactedTestCaseIds(req.params.projectId, artifactId);
      return list(ids);
    },
  );

  /* ------------------------------ latest runs ------------------------------ */

  app.get<{ Params: { projectId: string } }>('/projects/:projectId/regression/runs', async (req) =>
    list(listRuns(req.params.projectId, { kind: 'regression', limit: 25 })),
  );
}

/* -------------------------------- helpers -------------------------------- */

function countBy(values: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of values) out[v] = (out[v] ?? 0) + 1;
  return out;
}

/**
 * The release-gate verdict for a regression run. A regression run passes only when nothing
 * failed and nothing was blocked — a blocked regression case is an unverified release.
 * `planned` (how many cases the strategy selected) is reported for context.
 */
function regressionGate(
  planned: number,
  suite: SuiteResultShape | undefined,
): {  verdict: 'go' | 'conditional' | 'no_go';
  pass_rate: number;
  total: number;
  passed: number;
  failed: number;
  blocked: number;
  message: string;
} {
  const total = Number(suite?.total ?? 0);
  const passed = Number(suite?.passed ?? 0);
  const failed = Number(suite?.failed ?? 0);
  const blocked = Number(suite?.blocked ?? 0);
  const passRate = total ? Number(((passed / total) * 100).toFixed(1)) : 0;

  let verdict: 'go' | 'conditional' | 'no_go';
  let message: string;
  if (!total) {
    verdict = 'no_go';
    message = 'Suite regresi tidak menghasilkan eksekusi apa pun — rilis tidak dapat dinilai.';
  } else if (failed === 0 && blocked === 0) {
    verdict = 'go';
    message = `Regresi bersih: ${passed}/${total} lulus tanpa kegagalan atau blokir. Gerbang rilis terbuka.`;
  } else if (failed === 0) {
    verdict = 'conditional';
    message = `${blocked} test case terblokir dan tidak ada kegagalan — selesaikan blokir sebelum rilis.`;
  } else {
    verdict = 'no_go';
    message = `${failed} test case gagal (${passRate}% lulus). Perbaiki dan ulangi regresi sebelum rilis.`;
  }

  const scopeNote = planned && planned !== total ? ` Rencana awal mencakup ${planned} test case.` : '';
  return {
    verdict,
    pass_rate: passRate,
    total,
    passed,
    failed,
    blocked,
    message: `${message}${scopeNote}`,
  };
}
