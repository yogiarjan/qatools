/**
 * defects repository — CRUD for `defects`, the legal status-transition state machine,
 * defect statistics, and the run-result → defect promotion write.
 *
 * Only this module writes to `defects` (ARCHITECTURE.md §7).
 */

import type { Defect, DefectStatus, RunResult } from '@qatools/shared';
import { db, findById, insertRow, updateRow, deleteById, nextCode } from '../../db/index.js';

/* ----------------------------- state machine ----------------------------- */

/**
 * Legal transitions. The canonical happy path is:
 *   new → triaged → in_progress → fixed → retest → verified → closed
 * plus the lateral moves every QA team needs: reopened (from verified/closed/retest),
 * rejected (from new/triaged/in_progress), deferred (from any non-closed working state).
 */
export const LEGAL_TRANSITIONS: Record<DefectStatus, DefectStatus[]> = {
  new: ['triaged', 'in_progress', 'rejected', 'deferred'],
  triaged: ['in_progress', 'rejected', 'deferred'],
  in_progress: ['fixed', 'rejected', 'deferred'],
  fixed: ['retest', 'reopened', 'deferred'],
  retest: ['verified', 'reopened', 'deferred'],
  verified: ['closed', 'reopened'],
  reopened: ['in_progress', 'triaged', 'rejected', 'deferred'],
  closed: ['reopened'],
  rejected: ['reopened', 'triaged'],
  deferred: ['triaged', 'in_progress', 'rejected'],
};

export function canTransition(from: string, to: string): boolean {
  const allowed = LEGAL_TRANSITIONS[from as DefectStatus];
  return Boolean(allowed && allowed.includes(to as DefectStatus));
}

export function allowedNext(from: string): DefectStatus[] {
  return LEGAL_TRANSITIONS[from as DefectStatus] ?? [];
}

/** Statuses that still count as "open work" for the quality metrics. */
export const OPEN_DEFECT_STATUSES: DefectStatus[] = [
  'new',
  'triaged',
  'in_progress',
  'fixed',
  'retest',
  'reopened',
  'deferred',
];

/* ---------------------------------- CRUD --------------------------------- */

export interface DefectInput {
  project_id: string;
  code?: string | null;
  title: string;
  description?: string | null;
  steps_to_reproduce?: string | null;
  expected_result?: string | null;
  actual_result?: string | null;
  severity?: string | null;
  priority?: string | null;
  status?: string | null;
  source?: string | null;
  test_case_id?: string | null;
  run_result_id?: string | null;
  environment_id?: string | null;
  assignee?: string | null;
  reporter?: string | null;
  found_in_cycle_id?: string | null;
  fixed_in_build?: string | null;
  is_escaped?: unknown;
}

export interface DefectQuery {
  status?: string;
  severity?: string;
  priority?: string;
  source?: string;
  test_case_id?: string;
  assignee?: string;
  search?: string;
  open_only?: boolean;
}

export function listDefects(projectId: string, q: DefectQuery = {}): Defect[] {
  const where: string[] = ['d.project_id = ?'];
  const params: unknown[] = [projectId];

  if (q.status) {
    where.push('d.status = ?');
    params.push(q.status);
  }
  if (q.severity) {
    where.push('d.severity = ?');
    params.push(q.severity);
  }
  if (q.priority) {
    where.push('d.priority = ?');
    params.push(q.priority);
  }
  if (q.source) {
    where.push('d.source = ?');
    params.push(q.source);
  }
  if (q.test_case_id) {
    where.push('d.test_case_id = ?');
    params.push(q.test_case_id);
  }
  if (q.assignee) {
    where.push('d.assignee = ?');
    params.push(q.assignee);
  }
  if (q.search) {
    where.push('(d.title LIKE ? OR d.code LIKE ? OR COALESCE(d.description, \'\') LIKE ?)');
    const needle = `%${q.search}%`;
    params.push(needle, needle, needle);
  }
  if (q.open_only) {
    where.push(`d.status IN (${OPEN_DEFECT_STATUSES.map(() => '?').join(', ')})`);
    params.push(...OPEN_DEFECT_STATUSES);
  }

  return db
    .prepare(
      `SELECT d.*, tc.code AS tc_code, tc.title AS tc_title
         FROM defects d
         LEFT JOIN test_cases tc ON tc.id = d.test_case_id
        WHERE ${where.join(' AND ')}
        ORDER BY
          CASE d.severity WHEN 'blocker' THEN 0 WHEN 'critical' THEN 1 WHEN 'major' THEN 2
                          WHEN 'minor' THEN 3 ELSE 4 END,
          d.created_at DESC`,
    )
    .all(...params) as unknown as Defect[];
}

/** Defect plus the joined context the detail modal needs. */
export interface DefectDetail extends Defect {
  test_case: { id: string; code: string; title: string } | null;
  run_result: RunResult | null;
  run: { id: string; code: string; name: string; kind: string } | null;
  environment: { id: string; name: string; kind: string } | null;
  sibling_defects: number;
}

export function getDefect(id: string): Defect | undefined {
  return findById<Defect>('defects', id);
}

export function getDefectDetail(id: string): DefectDetail | undefined {
  const defect = getDefect(id);
  if (!defect) return undefined;

  const tc = defect.test_case_id
    ? (db
        .prepare('SELECT id, code, title FROM test_cases WHERE id = ?')
        .get(defect.test_case_id) as { id: string; code: string; title: string } | undefined)
    : undefined;

  const runResult = defect.run_result_id
    ? (findById<RunResult>('run_results', defect.run_result_id) ?? null)
    : null;

  const run = runResult
    ? (db
        .prepare('SELECT id, code, name, kind FROM test_runs WHERE id = ?')
        .get(runResult.run_id) as { id: string; code: string; name: string; kind: string } | undefined)
    : undefined;

  const env = defect.environment_id
    ? (db
        .prepare('SELECT id, name, kind FROM environments WHERE id = ?')
        .get(defect.environment_id) as { id: string; name: string; kind: string } | undefined)
    : undefined;

  const siblings = defect.test_case_id
    ? (db
        .prepare('SELECT COUNT(*) AS n FROM defects WHERE test_case_id = ? AND id <> ?')
        .get(defect.test_case_id, defect.id) as { n: number } | undefined)
    : undefined;

  return {
    ...defect,
    test_case: tc ?? null,
    run_result: runResult,
    run: run ?? null,
    environment: env ?? null,
    sibling_defects: Number(siblings?.n ?? 0),
  };
}

export function createDefect(input: DefectInput): Defect {
  const code =
    input.code?.trim() ||
    nextCode('defects', 'BUG', input.project_id, 3);
  const id = insertRow(
    'defects',
    {
      project_id: input.project_id,
      code,
      title: input.title,
      description: input.description ?? null,
      steps_to_reproduce: input.steps_to_reproduce ?? null,
      expected_result: input.expected_result ?? null,
      actual_result: input.actual_result ?? null,
      severity: input.severity ?? 'major',
      priority: input.priority ?? 'medium',
      status: input.status ?? 'new',
      source: input.source ?? 'manual',
      test_case_id: input.test_case_id ?? null,
      run_result_id: input.run_result_id ?? null,
      environment_id: input.environment_id ?? null,
      assignee: input.assignee ?? null,
      reporter: input.reporter ?? null,
      found_in_cycle_id: input.found_in_cycle_id ?? null,
      fixed_in_build: input.fixed_in_build ?? null,
      is_escaped: input.is_escaped === true || input.is_escaped === 1 ? 1 : 0,
      closed_at: input.status === 'closed' ? new Date().toISOString() : null,
    },
    'bug_',
  );
  return getDefect(id) as Defect;
}

export function updateDefect(id: string, patch: Record<string, unknown>): Defect | undefined {
  const clean: Record<string, unknown> = {};
  for (const key of [
    'code',
    'title',
    'description',
    'steps_to_reproduce',
    'expected_result',
    'actual_result',
    'severity',
    'priority',
    'source',
    'test_case_id',
    'run_result_id',
    'environment_id',
    'assignee',
    'reporter',
    'found_in_cycle_id',
    'fixed_in_build',
    'ai_triage',
  ] as const) {
    if (patch[key] !== undefined) clean[key] = patch[key];
  }
  if (patch.is_escaped !== undefined) {
    clean.is_escaped = patch.is_escaped === true || patch.is_escaped === 1 ? 1 : 0;
  }
  updateRow('defects', id, clean);
  return getDefect(id);
}

export function removeDefect(id: string): number {
  return deleteById('defects', id);
}

/**
 * Applies a status change through the guard. `closed_at` is stamped on close and cleared
 * whenever the defect leaves the closed state.
 */
export function transitionStatus(
  id: string,
  to: string,
  extra: { assignee?: string | null; fixed_in_build?: string | null; note?: string | null } = {},
): { ok: true; defect: Defect } | { ok: false; code: string; message: string; allowed?: string[] } {
  const defect = getDefect(id);
  if (!defect) return { ok: false, code: 'not_found', message: 'Defect tidak ditemukan' };

  if (defect.status === to) {
    return { ok: false, code: 'no_change', message: `Defect sudah berstatus ${to}` };
  }
  if (!canTransition(defect.status, to)) {
    return {
      ok: false,
      code: 'illegal_transition',
      message: `Transisi status ${defect.status} → ${to} tidak diizinkan`,
      allowed: allowedNext(defect.status),
    };
  }

  const patch: Record<string, unknown> = { status: to };
  if (extra.assignee !== undefined && extra.assignee !== null) patch.assignee = extra.assignee;
  if (extra.fixed_in_build !== undefined && extra.fixed_in_build !== null) {
    patch.fixed_in_build = extra.fixed_in_build;
  }
  patch.closed_at = to === 'closed' ? new Date().toISOString() : null;
  updateRow('defects', id, patch);

  // Keep the free-text timeline in `description` untouched; the transition history lives in
  // activity_log, which is append-only and queryable per project.
  return { ok: true, defect: getDefect(id) as Defect };
}

/* -------------------------------- promote -------------------------------- */

export interface PromotionResult {
  defect: Defect;
  run_result: RunResult;
}

/**
 * Creates a defect from a failed run result and writes `defects.id` back into
 * `run_results.defect_id`. Idempotent: promoting the same result twice returns the
 * already-linked defect instead of creating a duplicate.
 */
export function promoteResult(
  runResultId: string,
  overrides: Partial<DefectInput> = {},
): { ok: true; data: PromotionResult } | { ok: false; code: string; message: string } {
  const result = findById<RunResult>('run_results', runResultId);
  if (!result) return { ok: false, code: 'not_found', message: 'Run result tidak ditemukan' };

  if (result.defect_id) {
    const existing = getDefect(result.defect_id);
    if (existing) return { ok: true, data: { defect: existing, run_result: result } };
  }

  const testCase = db
    .prepare('SELECT id, project_id, code, title, expected_result FROM test_cases WHERE id = ?')
    .get(result.test_case_id) as
    | { id: string; project_id: string; code: string; title: string; expected_result: string | null }
    | undefined;
  if (!testCase) return { ok: false, code: 'not_found', message: 'Test case tidak ditemukan' };

  const run = db
    .prepare('SELECT id, project_id, code, name, kind, environment_id, cycle_id FROM test_runs WHERE id = ?')
    .get(result.run_id) as
    | {
        id: string;
        project_id: string;
        code: string;
        name: string;
        kind: string;
        environment_id: string | null;
        cycle_id: string | null;
      }
    | undefined;

  const steps = db
    .prepare('SELECT action, expected FROM test_steps WHERE test_case_id = ? ORDER BY order_index ASC')
    .all(testCase.id) as Array<{ action: string; expected: string | null }>;
  const stepsText = steps.length
    ? steps.map((s, i) => `${i + 1}. ${s.action}${s.expected ? ` → harapan: ${s.expected}` : ''}`).join('\n')
    : null;

  let created: Defect;
  db.transaction(() => {
    created = createDefect({
      project_id: overrides.project_id ?? testCase.project_id,
      title: overrides.title ?? `[${testCase.code}] ${testCase.title} gagal saat eksekusi`,
      description:
        overrides.description ??
        `Defect otomatis dari run result ${result.id} pada run ${run?.code ?? result.run_id}.`,
      steps_to_reproduce: overrides.steps_to_reproduce ?? stepsText,
      expected_result: overrides.expected_result ?? testCase.expected_result ?? null,
      actual_result: overrides.actual_result ?? result.actual_result ?? null,
      severity: overrides.severity ?? 'major',
      priority: overrides.priority ?? 'high',
      status: 'new',
      // The source mirrors the engine that produced the failure (ai/regression get their own tag).
      source:
        overrides.source ??
        (run?.kind === 'regression' ? 'regression' : (result.engine as string) || 'manual'),
      test_case_id: testCase.id,
      run_result_id: result.id,
      environment_id: overrides.environment_id ?? run?.environment_id ?? null,
      found_in_cycle_id: overrides.found_in_cycle_id ?? run?.cycle_id ?? null,
      reporter: overrides.reporter ?? result.executed_by ?? 'system',
    });

    // The link is bidirectional: the result points back at the defect it produced.
    updateRow('run_results', result.id, { defect_id: created.id });
  });

  const defect = created!;
  const linked = findById<RunResult>('run_results', result.id) as RunResult;
  return { ok: true, data: { defect, run_result: linked } };
}

/** Defects created for a failed case, used by the "promote all failures" affordance. */
export function promotedResultIds(defectId: string): string[] {
  return (
    db.prepare('SELECT id FROM run_results WHERE defect_id = ?').all(defectId) as Array<{ id: string }>
  ).map((r) => r.id);
}

/* --------------------------------- stats --------------------------------- */

export interface DefectStats {
  project_id: string;
  total: number;
  open: number;
  closed: number;
  by_severity: Record<string, number>;
  by_status: Record<string, number>;
  by_source: Record<string, number>;
  age: {
    avg_days_open: number;
    oldest_open_days: number;
    buckets: { lt_1d: number; d1_3: number; d3_7: number; d7_14: number; gt_14d: number };
  };
  escaped: number;
  reopen_rate: number;
  top_components: Array<{ test_case_id: string; code: string; title: string; count: number }>;
}

export function defectStats(projectId: string): DefectStats {
  const rows = listDefects(projectId);
  const now = Date.now();

  const bySeverity: Record<string, number> = {};
  const byStatus: Record<string, number> = {};
  const bySource: Record<string, number> = {};
  const buckets = { lt_1d: 0, d1_3: 0, d3_7: 0, d7_14: 0, gt_14d: 0 };
  let open = 0;
  let closed = 0;
  let escaped = 0;
  let reopened = 0;
  let ageSum = 0;
  let ageCount = 0;
  let oldest = 0;

  for (const d of rows) {
    bySeverity[d.severity] = (bySeverity[d.severity] ?? 0) + 1;
    byStatus[d.status] = (byStatus[d.status] ?? 0) + 1;
    bySource[d.source] = (bySource[d.source] ?? 0) + 1;
    if (d.is_escaped) escaped++;
    if (d.status === 'reopened') reopened++;
    if (d.status === 'closed' || d.status === 'rejected') closed++;
    else open++;

    if (OPEN_DEFECT_STATUSES.includes(d.status)) {
      const days = Math.max(0, (now - Date.parse(d.created_at)) / 86_400_000);
      ageSum += days;
      ageCount++;
      if (days > oldest) oldest = days;
      if (days < 1) buckets.lt_1d++;
      else if (days < 3) buckets.d1_3++;
      else if (days < 7) buckets.d3_7++;
      else if (days < 14) buckets.d7_14++;
      else buckets.gt_14d++;
    }
  }

  const topComponents = db
    .prepare(
      `SELECT d.test_case_id, tc.code, tc.title, COUNT(*) AS count
         FROM defects d
         JOIN test_cases tc ON tc.id = d.test_case_id
        WHERE d.project_id = ? AND d.test_case_id IS NOT NULL
        GROUP BY d.test_case_id
        ORDER BY count DESC, tc.code ASC
        LIMIT 10`,
    )
    .all(projectId) as Array<{ test_case_id: string; code: string; title: string; count: number }>;

  return {
    project_id: projectId,
    total: rows.length,
    open,
    closed,
    by_severity: bySeverity,
    by_status: byStatus,
    by_source: bySource,
    age: {
      avg_days_open: ageCount ? Number((ageSum / ageCount).toFixed(1)) : 0,
      oldest_open_days: Number(oldest.toFixed(1)),
      buckets,
    },
    escaped,
    reopen_rate: rows.length ? Number(((reopened / rows.length) * 100).toFixed(1)) : 0,
    top_components: topComponents.map((r) => ({ ...r, count: Number(r.count) })),
  };
}
