/**
 * metrics module — lifecycle stages 11 & 12 (release gate + QA metrics & reporting).
 *
 * Exports `metricsService` (ARCHITECTURE.md §6.1), consumed in-process by lanes A, C and E:
 *   metricsService.snapshot(projectId): Promise<MetricsSnapshot>
 *
 * Routes (mounted at /api):
 *   GET /projects/:projectId/metrics                 full MetricsSnapshot
 *   GET /projects/:projectId/metrics/trend?days=30   pass/fail trend only
 *   GET /projects/:projectId/metrics/readiness       { go_no_go, blockers, quality_gate, pass_rate }
 *
 * Metrics are READ-ONLY over every table; this module is the single source of truth for the
 * QA metric catalog documented in docs/project-management/qa-pm-and-regression.md.
 */

import type { MetricsSnapshot } from '@qatools/shared';
import { nowIso, pct } from '@qatools/shared';
import { db, findById } from '../../db/index.js';
import { flakyCases } from '../runs/repo.js';
import { OPEN_DEFECT_STATUSES } from '../defects/repo.js';

export interface ReadinessView {
  go_no_go: 'go' | 'conditional' | 'no_go';
  blockers: string[];
  quality_gate: number;
  pass_rate: number;
}

/* --------------------------------- counts -------------------------------- */

/** Every scalar query below aliases its single column as `n`. */
function scalar(sql: string, ...params: unknown[]): number {
  const row = db.prepare(sql).get(...params) as { n?: number } | undefined;
  return Number(row?.n ?? 0);
}

/**
 * "Executed" means a result that carries a real verdict. `not_run` rows exist so the run
 * detail can list unexecuted scope, but they must never inflate execution coverage.
 */
const EXECUTED = "status IN ('passed', 'failed', 'blocked', 'skipped')";

function totals(projectId: string): MetricsSnapshot['totals'] {
  return {
    requirements: scalar('SELECT COUNT(*) AS n FROM requirements WHERE project_id = ?', projectId),
    use_cases: scalar('SELECT COUNT(*) AS n FROM use_cases WHERE project_id = ?', projectId),
    scenarios: scalar('SELECT COUNT(*) AS n FROM scenarios WHERE project_id = ?', projectId),
    test_cases: scalar(
      "SELECT COUNT(*) AS n FROM test_cases WHERE project_id = ? AND status <> 'deprecated'",
      projectId,
    ),
    automated: scalar(
      `SELECT COUNT(*) AS n FROM test_cases
        WHERE project_id = ? AND status <> 'deprecated'
          AND (automation_status = 'automated' OR engine <> 'manual')`,
      projectId,
    ),
    defects_open: scalar(
      `SELECT COUNT(*) AS n FROM defects
        WHERE project_id = ? AND status IN (${OPEN_DEFECT_STATUSES.map(() => '?').join(', ')})`,
      projectId,
      ...OPEN_DEFECT_STATUSES,
    ),
    defects_total: scalar('SELECT COUNT(*) AS n FROM defects WHERE project_id = ?', projectId),
    runs: scalar('SELECT COUNT(*) AS n FROM test_runs WHERE project_id = ?', projectId),
  };
}

/**
 * Requirement coverage — ARCHITECTURE.md §5.4 makes `matrixService.document()` the canonical
 * implementation, and requires metrics to delegate to it so the matrix page and the metrics page
 * can never disagree.
 *
 * The loader is dynamic and returns a discriminated result: if lane A's module is unavailable we
 * fall back to `requirementCoverageLocal()`, which implements the same §5.4 direction.
 */
/**
 * Structural view of lane A's `MatrixDocument.summary` (ARCHITECTURE.md §5.4).
 * Declared locally so a lane-A refactor surfaces as a graceful fallback, not a build break.
 */
interface MatrixSummary {
  requirements: number;
  covered: number;
  partial: number;
  gaps: number;
  orphans: number;
  coverage_pct: number;
  automation_pct: number;
}

async function matrixCoverage(projectId: string): Promise<MatrixSummary | null> {
  try {
    const mod = (await import('../matrix/index.js')) as unknown as {
      matrixService?: { document: (id: string) => Promise<{ summary?: MatrixSummary }> };
    };
    const doc = await mod?.matrixService?.document(projectId);
    const summary = doc?.summary;
    if (!summary || typeof summary.coverage_pct !== 'number') return null;
    return summary;
  } catch {
    return null;
  }
}

/**
 * Local fallback, honouring §5.4: `from_id` is the upstream artifact, so a requirement covers
 * whatever is reachable from `from_id = <requirement>`.
 *
 * Reachability is: direct `requirement_to_testcase` links, plus the multi-hop path
 * requirement → usecase → scenario → testcase (including the derived shortcut links).
 */
function requirementCoverageLocal(projectId: string, summary?: MatrixSummary | null): number {
  const total = scalar('SELECT COUNT(*) AS n FROM requirements WHERE project_id = ?', projectId);

  // No requirements means there is nothing to cover — and the matrix reports 0% in that case.
  // Returning 100 here would make metrics and matrix disagree, which §5.4 forbids.
  if (!total) return 0;

  const covered = scalar(
    `SELECT COUNT(DISTINCT r.id) AS n
       FROM requirements r
      WHERE r.project_id = ?
        AND (
          -- 1. direct shortcut link: requirement → testcase (§5.4 direction)
          EXISTS (SELECT 1 FROM matrix_links ml
                    JOIN test_cases tc ON tc.id = ml.to_id
                   WHERE ml.project_id = r.project_id
                     AND ml.from_id = r.id
                     AND ml.link_type IN ('requirement_to_testcase'))
          -- 2. requirement → usecase, and that use case owns a test case (directly or via scenario)
          OR EXISTS (SELECT 1 FROM matrix_links ml
                       JOIN use_cases uc ON uc.id = ml.to_id
                      WHERE ml.project_id = r.project_id
                        AND ml.from_id = r.id
                        AND ml.link_type = 'requirement_to_usecase'
                        AND (EXISTS (SELECT 1 FROM test_cases tc WHERE tc.use_case_id = uc.id)
                          OR EXISTS (SELECT 1 FROM matrix_links ml2
                                       JOIN test_cases tc2 ON tc2.id = ml2.to_id
                                      WHERE ml2.from_id = uc.id
                                        AND ml2.link_type IN ('usecase_to_testcase', 'usecase_to_scenario'))))
          -- 3. structural fallback: a test case inherits the requirement through its use case row
          OR EXISTS (SELECT 1 FROM use_cases uc
                       JOIN test_cases tc ON tc.use_case_id = uc.id
                      WHERE uc.project_id = r.project_id
                        AND EXISTS (SELECT 1 FROM matrix_links ml
                                     WHERE ml.project_id = r.project_id
                                       AND ml.from_id = r.id
                                       AND ml.to_id = uc.id))
        )`,
    projectId,
  );

  // `covered + partial` counts toward coverage, matching matrixService's summary.
  if (summary && summary.requirements) {
    return pct(summary.covered + summary.partial, summary.requirements);
  }
  return pct(covered, total);
}

function executionCoverage(projectId: string): number {
  const total = scalar(
    "SELECT COUNT(*) AS n FROM test_cases WHERE project_id = ? AND status <> 'deprecated'",
    projectId,
  );
  if (!total) return 0;
  const executed = scalar(
    `SELECT COUNT(DISTINCT rr.test_case_id) AS n
       FROM run_results rr
       JOIN test_runs tr ON tr.id = rr.run_id
      WHERE tr.project_id = ? AND rr.${EXECUTED}`,
    projectId,
  );
  return pct(executed, total);
}

function qualityTotals(projectId: string): {
  total: number;
  passed: number;
  failed: number;
  blocked: number;
  skipped: number;
  duration: number;
} {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(CASE WHEN rr.status = 'passed'  THEN 1 ELSE 0 END), 0) AS passed,
              COALESCE(SUM(CASE WHEN rr.status = 'failed'  THEN 1 ELSE 0 END), 0) AS failed,
              COALESCE(SUM(CASE WHEN rr.status = 'blocked' THEN 1 ELSE 0 END), 0) AS blocked,
              COALESCE(SUM(CASE WHEN rr.status = 'skipped' THEN 1 ELSE 0 END), 0) AS skipped,
              COALESCE(SUM(rr.duration_ms), 0) AS duration
         FROM run_results rr
         JOIN test_runs tr ON tr.id = rr.run_id
        WHERE tr.project_id = ? AND rr.${EXECUTED}`,
    )
    .get(projectId) as Record<string, number> | undefined;
  return {
    total: Number(row?.total ?? 0),
    passed: Number(row?.passed ?? 0),
    failed: Number(row?.failed ?? 0),
    blocked: Number(row?.blocked ?? 0),
    skipped: Number(row?.skipped ?? 0),
    duration: Number(row?.duration ?? 0),
  };
}

/** Pass rate over regression-kind runs only — the number the release gate actually cares about. */
function regressionPassRate(projectId: string): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(CASE WHEN rr.status = 'passed' THEN 1 ELSE 0 END), 0) AS passed
         FROM run_results rr
         JOIN test_runs tr ON tr.id = rr.run_id
        WHERE tr.project_id = ? AND tr.kind = 'regression' AND rr.${EXECUTED}`,
    )
    .get(projectId) as Record<string, number> | undefined;
  return pct(Number(row?.passed ?? 0), Number(row?.total ?? 0));
}

function quality(projectId: string, t: MetricsSnapshot['totals']): MetricsSnapshot['quality'] {
  const q = qualityTotals(projectId);
  const reopenRate = t.defects_total
    ? pct(
        scalar("SELECT COUNT(*) AS n FROM defects WHERE project_id = ? AND status = 'reopened'", projectId),
        t.defects_total,
      )
    : 0;

  return {
    pass_rate: pct(q.passed, q.total),
    fail_rate: pct(q.failed, q.total),
    block_rate: pct(q.blocked, q.total),
    defect_density: t.test_cases ? Number((t.defects_total / t.test_cases).toFixed(3)) : 0,
    defect_leakage_pct: t.defects_total
      ? pct(scalar('SELECT COUNT(*) AS n FROM defects WHERE project_id = ? AND is_escaped = 1', projectId), t.defects_total)
      : 0,
    reopen_rate: reopenRate,
    regression_suite_pass_pct: regressionPassRate(projectId),
  };
}

/**
 * Efficiency is deliberately conservative: a manual case is credited with a nominal
 * 3-minute execution baseline, and automation is credited with the measured duration of
 * the automated runs that actually replaced it.
 */
function efficiency(projectId: string, t: MetricsSnapshot['totals']): MetricsSnapshot['efficiency'] {
  const auto = db
    .prepare(
      `SELECT COUNT(*) AS total, COALESCE(SUM(rr.duration_ms), 0) AS duration
         FROM run_results rr
         JOIN test_runs tr ON tr.id = rr.run_id
        WHERE tr.project_id = ? AND rr.engine <> 'manual' AND rr.${EXECUTED}`,
    )
    .get(projectId) as Record<string, number> | undefined;

  const manual = db
    .prepare(
      `SELECT COUNT(*) AS total, COALESCE(SUM(rr.duration_ms), 0) AS duration
         FROM run_results rr
         JOIN test_runs tr ON tr.id = rr.run_id
        WHERE tr.project_id = ? AND rr.engine = 'manual' AND rr.${EXECUTED}`,
    )
    .get(projectId) as Record<string, number> | undefined;

  const autoCount = Number(auto?.total ?? 0);
  const autoDuration = Number(auto?.duration ?? 0);
  const manualCount = Number(manual?.total ?? 0);
  const manualDuration = Number(manual?.duration ?? 0);
  const executedTotal = autoCount + manualCount;

  // Baseline: what a manual execution of the automated cases would have cost.
  const manualBaselineMs = 3 * 60_000;
  const baseline = autoCount * manualBaselineMs;
  const savedMs = Math.max(0, baseline - autoDuration);

  return {
    avg_case_duration_ms: executedTotal ? Math.round((autoDuration + manualDuration) / executedTotal) : 0,
    automation_roi_minutes_saved: Math.round(savedMs / 60_000),
    estimated_hours_saved_per_run: Number((savedMs / 3_600_000).toFixed(2)),
  };
}

/* -------------------------------- readiness ------------------------------- */

const BLOCKER_SEVERITIES = ['blocker', 'critical'];

export function readiness(projectId: string): ReadinessView {
  const project = findById<{ quality_gate: number }>('projects', projectId);
  const qualityGate = Number(project?.quality_gate ?? 90);
  const q = qualityTotals(projectId);
  const passRate = pct(q.passed, q.total);
  const blockers: string[] = [];

  const openBlockers = db
    .prepare(
      `SELECT code, title, severity, status FROM defects
        WHERE project_id = ? AND severity IN (${BLOCKER_SEVERITIES.map(() => '?').join(', ')})
          AND status IN (${OPEN_DEFECT_STATUSES.map(() => '?').join(', ')})
        ORDER BY CASE severity WHEN 'blocker' THEN 0 ELSE 1 END, created_at ASC`,
    )
    .all(projectId, ...BLOCKER_SEVERITIES, ...OPEN_DEFECT_STATUSES) as Array<{
    code: string;
    title: string;
    severity: string;
    status: string;
  }>;
  for (const d of openBlockers) {
    blockers.push(`${d.code} (${d.severity}/${d.status}) masih terbuka: ${d.title}`);
  }

  if (!q.total) {
    blockers.push('Belum ada eksekusi test yang tercatat untuk project ini');
  } else if (passRate < qualityGate) {
    blockers.push(
      `Pass rate ${passRate}% berada di bawah quality gate ${qualityGate}% (${q.failed} gagal, ${q.blocked} terblokir dari ${q.total} eksekusi)`,
    );
  }

  if (q.blocked > 0) {
    blockers.push(`${q.blocked} test case terblokir — hasil belum dapat diverifikasi`);
  }

  const regressionSize = scalar(
    'SELECT COUNT(*) AS n FROM test_cases WHERE project_id = ? AND is_regression = 1',
    projectId,
  );
  if (!regressionSize) {
    blockers.push('Suite regresi masih kosong — gerbang rilis belum dapat dijalankan');
  }

  const pendingRegression = db
    .prepare(
      `SELECT COUNT(*) AS n FROM defects d
        WHERE d.project_id = ? AND d.status IN ('fixed', 'retest')`,
    )
    .get(projectId) as { n: number } | undefined;
  const awaitingRetest = Number(pendingRegression?.n ?? 0);
  if (awaitingRetest) {
    blockers.push(`${awaitingRetest} defect menunggu retest/verifikasi sebelum rilis`);
  }

  const escaped = scalar('SELECT COUNT(*) AS n FROM defects WHERE project_id = ? AND is_escaped = 1', projectId);
  if (escaped) {
    blockers.push(`${escaped} defect lolos ke production (escaped) — tambahkan test case penutup`);
  }

  let goNoGo: ReadinessView['go_no_go'];
  if (!q.total || passRate < qualityGate) goNoGo = 'no_go';
  else if (blockers.length) goNoGo = 'conditional';
  else goNoGo = 'go';

  return { go_no_go: goNoGo, blockers, quality_gate: qualityGate, pass_rate: passRate };
}

/* ---------------------------------- trend --------------------------------- */

export interface TrendPoint {
  date: string;
  passed: number;
  failed: number;
  blocked: number;
  total: number;
}

/** Day-bucketed trend; days without executions are emitted as zeros so charts stay continuous. */
export function trend(projectId: string, days = 30): TrendPoint[] {
  const span = Math.min(365, Math.max(1, Math.round(days) || 30));
  const rows = db
    .prepare(
      `SELECT substr(COALESCE(rr.executed_at, rr.created_at), 1, 10) AS date,
              COUNT(*) AS total,
              COALESCE(SUM(CASE WHEN rr.status = 'passed'  THEN 1 ELSE 0 END), 0) AS passed,
              COALESCE(SUM(CASE WHEN rr.status = 'failed'  THEN 1 ELSE 0 END), 0) AS failed,
              COALESCE(SUM(CASE WHEN rr.status = 'blocked' THEN 1 ELSE 0 END), 0) AS blocked
         FROM run_results rr
         JOIN test_runs tr ON tr.id = rr.run_id
        WHERE tr.project_id = ? AND rr.${EXECUTED}
        GROUP BY date
        ORDER BY date ASC`,
    )
    .all(projectId) as Array<{ date: string; total: number; passed: number; failed: number; blocked: number }>;

  const byDate = new Map(rows.map((r) => [r.date, r]));
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - (span - 1));

  const out: TrendPoint[] = [];
  for (let i = 0; i < span; i++) {
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() + i);
    const key = d.toISOString().slice(0, 10);
    const hit = byDate.get(key);
    out.push({
      date: key,
      passed: Number(hit?.passed ?? 0),
      failed: Number(hit?.failed ?? 0),
      blocked: Number(hit?.blocked ?? 0),
      total: Number(hit?.total ?? 0),
    });
  }
  return out;
}

/* -------------------------------- breakdowns ------------------------------ */

/** Both breakdown queries select `<key>, COUNT(*) AS n`, so the shape is always known. */
function countMap(sql: string, ...params: unknown[]): Record<string, number> {
  const rows = db.prepare(sql).all(...params) as Array<{ key: string; n: number }>;
  const out: Record<string, number> = {};
  for (const r of rows) out[String(r.key)] = Number(r.n ?? 0);
  return out;
}

/* --------------------------------- snapshot ------------------------------- */

export const metricsService = {
  /**
   * Async because coverage delegates to lane A's canonical `matrixService.document()`
   * (ARCHITECTURE.md §5.4 consequence 4). Only the coverage block is delegated; every other
   * metric stays local so a matrix hiccup degrades one number instead of the whole snapshot.
   */
  async snapshot(projectId: string): Promise<MetricsSnapshot> {
    const t = totals(projectId);
    const q = qualityTotals(projectId);
    const ready = readiness(projectId);
    const regressionSize = scalar(
      "SELECT COUNT(*) AS n FROM test_cases WHERE project_id = ? AND is_regression = 1 AND status <> 'deprecated'",
      projectId,
    );

    const matrix = await matrixCoverage(projectId);

    return {
      project_id: projectId,
      generated_at: nowIso(),
      totals: t,
      coverage: {
        // §5.4 consequence 4: the canonical matrix implementation is authoritative for
        // requirement coverage. Falls back to the local §5.4 traversal if lane A is unavailable.
        requirement_coverage_pct: matrix
          ? matrix.coverage_pct
          : requirementCoverageLocal(projectId),
        test_case_execution_pct: executionCoverage(projectId),
        // Deliberately NOT delegated: the matrix counts `automation_status = 'automated'` only,
        // while `totals.automated` follows the shared TestCase contract (engine ≠ manual counts
        // as automated too). Both are correct for their own question; metrics owns this one.
        automation_pct: pct(t.automated, t.test_cases),
        regression_suite_size: regressionSize,
      },
      quality: {
        pass_rate: pct(q.passed, q.total),
        fail_rate: pct(q.failed, q.total),
        block_rate: pct(q.blocked, q.total),
        defect_density: t.test_cases ? Number((t.defects_total / t.test_cases).toFixed(3)) : 0,
        defect_leakage_pct: t.defects_total
          ? pct(
              scalar('SELECT COUNT(*) AS n FROM defects WHERE project_id = ? AND is_escaped = 1', projectId),
              t.defects_total,
            )
          : 0,
        reopen_rate: t.defects_total
          ? pct(
              scalar("SELECT COUNT(*) AS n FROM defects WHERE project_id = ? AND status = 'reopened'", projectId),
              t.defects_total,
            )
          : 0,
        regression_suite_pass_pct: regressionPassRate(projectId),
      },
      efficiency: efficiency(projectId, t),
      readiness: {
        release_gate_pct: ready.quality_gate,
        go_no_go: ready.go_no_go,
        blockers: ready.blockers,
      },
      trend: trend(projectId, 30),
      defects_by_severity: countMap(
        'SELECT severity AS key, COUNT(*) AS n FROM defects WHERE project_id = ? GROUP BY severity',
        projectId,
      ),
      defects_by_status: countMap(
        'SELECT status AS key, COUNT(*) AS n FROM defects WHERE project_id = ? GROUP BY status',
        projectId,
      ),
      flaky_cases: flakyCases(projectId, { minFlips: 2, days: 90 }).map((f) => ({
        test_case_id: f.test_case_id,
        code: f.code,
        title: f.title,
        flips: f.flips,
        pass_rate: f.pass_rate,
      })),
    };
  },

  trend,
  readiness,
};

/** Re-exported so the metrics routes can stay free of SQL. */
export { qualityTotals, executionCoverage, regressionPassRate, requirementCoverageLocal };
