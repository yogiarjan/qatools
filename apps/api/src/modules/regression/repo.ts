/**
 * regression repository — the data-gathering half of the King of the Test.
 *
 * Gathers every candidate test case with the four inputs `riskScore()` needs:
 *   business criticality (use-case / requirement priority), usage frequency (case type),
 *   complexity (layer + step count), defect history, last-run failure, regression flag,
 *   automation status.
 *
 * This module READS `test_cases`, `defects`, `run_results` and `test_runs`; it only WRITES
 * `test_cases.is_regression` (regression membership), which no other module owns.
 */

import type { TestCase } from '@qatools/shared';
import { db } from '../../db/index.js';

/** A candidate test case plus every explainability input we resolved for it. */
export interface Candidate {
  id: string;
  code: string;
  title: string;
  type: string;
  layer: string;
  priority: string;
  severity: string;
  automation_status: string;
  engine: string;
  is_regression: number;
  stored_risk_score: number;
  estimated_minutes: number;
  scenario_id: string | null;
  use_case_id: string | null;

  /** Resolved inputs for riskScore(). */
  business_criticality: string;
  business_criticality_source: string;
  usage_frequency: string;
  complexity: string;
  defect_history: number;
  last_run_failed: boolean;
  last_run_status: string | null;
  last_run_at: string | null;
  executions: number;
  pass_count: number;
  fail_count: number;
  step_count: number;
  flips: number;
}

/**
 * Business criticality = the highest priority found on the case itself or any ancestor
 * (scenario → use case → requirement). A case verifying a critical requirement is critical,
 * no matter what the tester typed on the case row.
 */
interface AncestryRow {
  id: string;
  code: string;
  title: string;
  type: string;
  layer: string;
  priority: string;
  severity: string;
  automation_status: string;
  engine: string;
  is_regression: number;
  risk_score: number;
  estimated_minutes: number;
  scenario_id: string | null;
  use_case_id: string | null;
  scenario_priority: string | null;
  use_case_priority: string | null;
  requirement_priority: string | null;
  use_case_code: string | null;
  step_count: number;
}

const PRIORITY_RANK: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };

export function gatherCandidates(projectId: string): Candidate[] {
  const rows = db
    .prepare(
      `SELECT tc.id, tc.code, tc.title, tc.type, tc.layer, tc.priority, tc.severity,
              tc.automation_status, tc.engine, tc.is_regression, tc.risk_score,
              tc.estimated_minutes, tc.scenario_id, tc.use_case_id,
              sc.priority AS scenario_priority,
              uc.priority AS use_case_priority,
              uc.code     AS use_case_code,
              (SELECT MAX(r.priority) FROM requirements r
                 JOIN matrix_links ml ON ml.to_id = r.id AND ml.to_kind = 'requirement'
                WHERE ml.from_kind = 'testcase' AND ml.from_id = tc.id) AS requirement_priority,
              (SELECT COUNT(*) FROM test_steps ts WHERE ts.test_case_id = tc.id) AS step_count
         FROM test_cases tc
         LEFT JOIN scenarios sc ON sc.id = tc.scenario_id
         LEFT JOIN use_cases uc ON uc.id = tc.use_case_id
        WHERE tc.project_id = ? AND tc.status <> 'deprecated'
        ORDER BY tc.risk_score DESC, tc.code ASC`,
    )
    .all(projectId) as unknown as AncestryRow[];

  // Requirement priority is also reachable through the use case (requirement_to_testcase links
  // are not always populated, but usecase links usually are).
  const requirementByUseCase = new Map<string, string>();
  const ucReqRows = db
    .prepare(
      `SELECT ml.from_id AS use_case_id, MAX(r.priority) AS priority
         FROM matrix_links ml
         JOIN requirements r ON r.id = ml.to_id AND ml.to_kind = 'requirement'
        WHERE ml.project_id = ? AND ml.from_kind = 'usecase'
        GROUP BY ml.from_id`,
    )
    .all(projectId) as Array<{ use_case_id: string; priority: string }>;
  for (const r of ucReqRows) requirementByUseCase.set(r.use_case_id, r.priority);

  const history = runHistory(projectId);
  const defects = defectHistory(projectId);

  return rows.map((r) => {
    const reqPriority = r.requirement_priority ?? (r.use_case_id ? requirementByUseCase.get(r.use_case_id) ?? null : null);
    const criticality = highestPriority([
      { value: r.priority, source: 'test case' },
      { value: r.scenario_priority, source: `skenario ${r.code}` },
      { value: r.use_case_priority, source: `use case ${r.use_case_code ?? ''}`.trim() },
      { value: reqPriority, source: 'requirement terkait' },
    ]);

    const h = history.get(r.id);
    const executions = h?.executions ?? 0;
    const passCount = h?.passed ?? 0;
    const failCount = h?.failed ?? 0;

    return {
      id: r.id,
      code: r.code,
      title: r.title,
      type: r.type,
      layer: r.layer,
      priority: r.priority,
      severity: r.severity,
      automation_status: r.automation_status,
      engine: r.engine,
      is_regression: Number(r.is_regression ?? 0),
      stored_risk_score: Number(r.risk_score ?? 0),
      estimated_minutes: Number(r.estimated_minutes ?? 10) || 10,
      scenario_id: r.scenario_id,
      use_case_id: r.use_case_id,
      business_criticality: criticality.value,
      business_criticality_source: criticality.source,
      usage_frequency: usageFromType(r.type, r.severity),
      complexity: complexityFrom(r.layer, Number(r.step_count ?? 0), r.type),
      defect_history: defects.get(r.id) ?? 0,
      last_run_failed: h?.last_status === 'failed',
      last_run_status: h?.last_status ?? null,
      last_run_at: h?.last_at ?? null,
      executions,
      pass_count: passCount,
      fail_count: failCount,
      step_count: Number(r.step_count ?? 0),
      flips: h?.flips ?? 0,
    };
  });
}

/** Usage frequency is inferred from case type + severity: happy paths and blockers run most. */
function usageFromType(type: string, severity: string): string {
  if (severity === 'blocker' || severity === 'critical') return 'always';
  switch (type) {
    case 'functional':
      return 'always';
    case 'regression':
    case 'boundary':
      return 'often';
    case 'negative':
    case 'security':
      return 'often';
    case 'compatibility':
    case 'performance':
      return 'sometimes';
    default:
      return 'rarely';
  }
}

/** Complexity blends interaction layer with scenario length and case type. */
function complexityFrom(layer: string, stepCount: number, type: string): string {
  let points = 0;
  if (layer === 'web') points += 2;
  else if (layer === 'api') points += 1;
  else if (layer === 'mobile') points += 2;
  else if (layer === 'db') points += 1;

  if (stepCount >= 8) points += 2;
  else if (stepCount >= 4) points += 1;

  if (type === 'security' || type === 'performance' || type === 'compatibility') points += 1;

  return points >= 4 ? 'high' : points >= 2 ? 'medium' : 'low';
}

interface HistoryEntry {
  executions: number;
  passed: number;
  failed: number;
  last_status: string | null;
  last_at: string | null;
  flips: number;
}

/** Chronological run history per case: last status, pass/fail counts and flip count. */
export function runHistory(projectId: string): Map<string, HistoryEntry> {
  const rows = db
    .prepare(
      `SELECT rr.test_case_id, rr.status, COALESCE(rr.executed_at, rr.created_at) AS at
         FROM run_results rr
         JOIN test_runs tr ON tr.id = rr.run_id
        WHERE tr.project_id = ?
        ORDER BY at ASC`,
    )
    .all(projectId) as Array<{ test_case_id: string; status: string; at: string }>;

  const map = new Map<string, HistoryEntry>();
  for (const r of rows) {
    const e =
      map.get(r.test_case_id) ??
      ({ executions: 0, passed: 0, failed: 0, last_status: null, last_at: null, flips: 0 } satisfies HistoryEntry);
    if (e.last_status !== null && e.last_status !== r.status) e.flips++;
    e.executions++;
    if (r.status === 'passed') e.passed++;
    else if (r.status === 'failed') e.failed++;
    e.last_status = r.status;
    e.last_at = r.at;
    map.set(r.test_case_id, e);
  }
  return map;
}

export function defectHistory(projectId: string): Map<string, number> {
  const rows = db
    .prepare(
      `SELECT test_case_id, COUNT(*) AS n FROM defects
        WHERE project_id = ? AND test_case_id IS NOT NULL
        GROUP BY test_case_id`,
    )
    .all(projectId) as Array<{ test_case_id: string; n: number }>;
  return new Map(rows.map((r) => [r.test_case_id, Number(r.n)]));
}

/** Open (unfixed) defects per case — a failed case with an open bug must stay selected. */
export function openDefectsByCase(projectId: string): Map<string, Array<{ code: string; severity: string; status: string }>> {
  const rows = db
    .prepare(
      `SELECT test_case_id, code, severity, status FROM defects
        WHERE project_id = ? AND test_case_id IS NOT NULL
          AND status NOT IN ('closed', 'rejected')
        ORDER BY created_at DESC`,
    )
    .all(projectId) as Array<{ test_case_id: string; code: string; severity: string; status: string }>;
  const map = new Map<string, Array<{ code: string; severity: string; status: string }>>();
  for (const r of rows) {
    const list = map.get(r.test_case_id) ?? [];
    list.push({ code: r.code, severity: r.severity, status: r.status });
    map.set(r.test_case_id, list);
  }
  return map;
}

/** Impacted test cases for one artifact — the `impact_of` input for the impact_only strategy. */
export function impactedTestCaseIds(projectId: string, artifactId: string): string[] {
  const ids = new Set<string>();
  const seen = new Set<string>([artifactId]);

  const asTestCase = (id: string): boolean => {
    const tc = db
      .prepare('SELECT id FROM test_cases WHERE project_id = ? AND id = ?')
      .get(projectId, id) as { id: string } | undefined;
    if (tc) {
      ids.add(tc.id);
      return true;
    }
    return false;
  };

  asTestCase(artifactId);

  // Walk the traceability graph outward. Depth 4 covers requirement → use case → scenario → case.
  let frontier = [artifactId];
  for (let depth = 0; depth < 4 && frontier.length; depth++) {
    const placeholders = frontier.map(() => '?').join(', ');
    const links = db
      .prepare(
        `SELECT from_id, to_id FROM matrix_links
          WHERE project_id = ? AND (from_id IN (${placeholders}) OR to_id IN (${placeholders}))`,
      )
      .all(projectId, ...frontier, ...frontier) as Array<{ from_id: string; to_id: string }>;

    const next: string[] = [];
    for (const l of links) {
      for (const id of [l.from_id, l.to_id]) {
        if (seen.has(id)) continue;
        seen.add(id);
        next.push(id);
        asTestCase(id);
      }
    }
    frontier = next;
  }

  // Structural containment: a test case whose owning scenario or use case is touched is impacted
  // even when the matrix link rows were never created. The artifact itself is the first hop —
  // pointing impact_of straight at a use case or scenario must find its cases.
  const containers = [...seen];
  if (containers.length) {
    const placeholders = containers.map(() => '?').join(', ');
    const structural = db
      .prepare(
        `SELECT id FROM test_cases
          WHERE project_id = ? AND (scenario_id IN (${placeholders}) OR use_case_id IN (${placeholders}))`,
      )
      .all(projectId, ...containers, ...containers) as Array<{ id: string }>;
    for (const s of structural) ids.add(s.id);
  }

  return [...ids];
}

/** Whether a test case is directly bound to any execution artifact (used for smoke strategy). */
export function automationArtifactCount(testCaseIds: string[]): Map<string, number> {
  const map = new Map<string, number>();
  if (!testCaseIds.length) return map;
  const placeholders = testCaseIds.map(() => '?').join(', ');
  const rows = db
    .prepare(
      `SELECT test_case_id, COUNT(*) AS n FROM (
          SELECT test_case_id FROM api_requests WHERE test_case_id IN (${placeholders})
          UNION ALL
          SELECT test_case_id FROM db_checks   WHERE test_case_id IN (${placeholders})
          UNION ALL
          SELECT test_case_id FROM web_flows   WHERE test_case_id IN (${placeholders})
       ) GROUP BY test_case_id`,
    )
    .all(...testCaseIds, ...testCaseIds, ...testCaseIds) as Array<{ test_case_id: string; n: number }>;
  for (const r of rows) map.set(r.test_case_id, Number(r.n));
  return map;
}

/* --------------------------- regression membership ------------------------ */

export function regressionSuite(projectId: string): Array<{
  id: string;
  code: string;
  title: string;
  priority: string;
  type: string;
  engine: string;
  automation_status: string;
  risk_score: number;
  estimated_minutes: number;
}> {
  return db
    .prepare(
      `SELECT id, code, title, priority, type, engine, automation_status, risk_score, estimated_minutes
         FROM test_cases
        WHERE project_id = ? AND is_regression = 1 AND status <> 'deprecated'
        ORDER BY risk_score DESC, code ASC`,
    )
    .all(projectId) as unknown as ReturnType<typeof regressionSuite>;
}

/** Sets exact regression membership: the ids given are members, every other case is cleared. */
export function setRegressionSuite(projectId: string, testCaseIds: string[]): number {
  let touched = 0;
  db.transaction(() => {
    db.prepare(
      "UPDATE test_cases SET is_regression = 0, updated_at = ? WHERE project_id = ? AND is_regression = 1",
    ).run(new Date().toISOString(), projectId);

    const now = new Date().toISOString();
    for (const id of testCaseIds) {
      touched += db
        .prepare('UPDATE test_cases SET is_regression = 1, updated_at = ? WHERE id = ? AND project_id = ?')
        .run(now, id, projectId).changes;
    }
  });
  return touched;
}

export function addToRegressionSuite(projectId: string, testCaseIds: string[]): number {
  const now = new Date().toISOString();
  let touched = 0;
  for (const id of testCaseIds) {
    touched += db
      .prepare('UPDATE test_cases SET is_regression = 1, updated_at = ? WHERE id = ? AND project_id = ?')
      .run(now, id, projectId).changes;
  }
  return touched;
}

export function removeFromRegressionSuite(projectId: string, testCaseIds: string[]): number {
  const now = new Date().toISOString();
  let touched = 0;
  for (const id of testCaseIds) {
    touched += db
      .prepare('UPDATE test_cases SET is_regression = 0, updated_at = ? WHERE id = ? AND project_id = ?')
      .run(now, id, projectId).changes;
  }
  return touched;
}

export function getCase(id: string): TestCase | undefined {
  return db.prepare('SELECT * FROM test_cases WHERE id = ?').get(id) as TestCase | undefined;
}

export function highestPriority(entries: Array<{ value: string | null | undefined; source: string }>): {
  value: string;
  source: string;
} {
  let best: { value: string; source: string; rank: number } = {
    value: 'medium',
    source: 'default',
    rank: 0,
  };
  for (const e of entries) {
    if (!e.value) continue;
    const rank = PRIORITY_RANK[e.value] ?? 0;
    if (rank > best.rank) best = { value: e.value, source: e.source, rank };
  }
  return { value: best.value, source: best.rank ? best.source : 'default' };
}
