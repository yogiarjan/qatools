/**
 * cycles repository — CRUD for `cycles`, `sprints` and `sprint_scope`,
 * plus the planned-vs-actual effort aggregation used by the planning page and the gantt.
 *
 * Only this module writes to those three tables (ARCHITECTURE.md §7).
 */

import type { Cycle, Sprint, SprintScope } from '@qatools/shared';
import { db, findById, insertRow, updateRow, deleteById, nextCode, nextCodeBy } from '../../db/index.js';

export const CYCLE_STATUSES = ['planned', 'active', 'completed', 'archived'] as const;
export const SPRINT_STATUSES = ['planned', 'active', 'completed'] as const;
export const SCOPE_STATUSES = ['todo', 'in_progress', 'done'] as const;

/* --------------------------------- cycles -------------------------------- */

export interface CycleInput {
  project_id: string;
  code?: string | null;
  name: string;
  goal?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  status?: string | null;
  entry_criteria?: unknown;
  exit_criteria?: unknown;
}

export function listCycles(projectId: string): Cycle[] {
  return db
    .prepare(
      `SELECT * FROM cycles WHERE project_id = ?
       ORDER BY COALESCE(start_date, created_at) ASC, created_at ASC`,
    )
    .all(projectId) as unknown as Cycle[];
}

export function getCycle(id: string): Cycle | undefined {
  return findById<Cycle>('cycles', id);
}

export function createCycle(input: CycleInput): Cycle {
  const year = new Date().getFullYear();
  const code =
    input.code?.trim() ||
    uniqueCycleCode(input.project_id, `${year}-C${String(countCycles(input.project_id) + 1).padStart(2, '0')}`);
  const id = insertRow(
    'cycles',
    {
      project_id: input.project_id,
      code,
      name: input.name,
      goal: input.goal ?? null,
      start_date: input.start_date ?? null,
      end_date: input.end_date ?? null,
      status: normalizeCycleStatus(input.status),
      entry_criteria: jsonOrNull(input.entry_criteria),
      exit_criteria: jsonOrNull(input.exit_criteria),
    },
    'cyc_',
  );
  return getCycle(id) as Cycle;
}

export function updateCycle(id: string, patch: Record<string, unknown>): Cycle | undefined {
  const clean: Record<string, unknown> = {};
  for (const key of ['code', 'name', 'goal', 'start_date', 'end_date'] as const) {
    if (patch[key] !== undefined) clean[key] = patch[key];
  }
  if (patch.status !== undefined) clean.status = normalizeCycleStatus(patch.status);
  for (const key of ['entry_criteria', 'exit_criteria'] as const) {
    if (patch[key] !== undefined) clean[key] = jsonOrNull(patch[key]);
  }
  updateRow('cycles', id, clean);
  return getCycle(id);
}

export function removeCycle(id: string): number {
  return deleteById('cycles', id);
}

function countCycles(projectId: string): number {
  const row = db.prepare('SELECT COUNT(*) AS n FROM cycles WHERE project_id = ?').get(projectId) as
    | { n: number }
    | undefined;
  return Number(row?.n ?? 0);
}

function uniqueCycleCode(projectId: string, base: string): string {
  let code = `CYC-${base}`;
  let n = 1;
  while (db.prepare('SELECT 1 FROM cycles WHERE project_id = ? AND code = ?').get(projectId, code)) {
    code = `CYC-${base}-${++n}`;
  }
  return code;
}

/* --------------------------------- sprints ------------------------------- */

export interface SprintInput {
  cycle_id: string;
  project_id: string;
  code?: string | null;
  name: string;
  goal?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  capacity_points?: unknown;
  status?: string | null;
}

export function listSprints(cycleId: string): Sprint[] {
  return db
    .prepare(
      `SELECT * FROM sprints WHERE cycle_id = ?
       ORDER BY COALESCE(start_date, created_at) ASC, created_at ASC`,
    )
    .all(cycleId) as unknown as Sprint[];
}

export function listSprintsByProject(projectId: string): Sprint[] {
  return db
    .prepare(
      `SELECT * FROM sprints WHERE project_id = ?
       ORDER BY COALESCE(start_date, created_at) ASC, created_at ASC`,
    )
    .all(projectId) as unknown as Sprint[];
}

export function getSprint(id: string): Sprint | undefined {
  return findById<Sprint>('sprints', id);
}

export function createSprint(input: SprintInput): Sprint {
  const code = input.code?.trim() || nextCodeBy('sprints', 'cycle_id', input.cycle_id, 'SPR', 2);
  const id = insertRow(
    'sprints',
    {
      cycle_id: input.cycle_id,
      project_id: input.project_id,
      code,
      name: input.name,
      goal: input.goal ?? null,
      start_date: input.start_date ?? null,
      end_date: input.end_date ?? null,
      capacity_points: toPositiveInt(input.capacity_points, 40),
      status: normalizeSprintStatus(input.status),
    },
    'spr_',
  );
  return getSprint(id) as Sprint;
}

export function updateSprint(id: string, patch: Record<string, unknown>): Sprint | undefined {
  const clean: Record<string, unknown> = {};
  for (const key of ['code', 'name', 'goal', 'start_date', 'end_date'] as const) {
    if (patch[key] !== undefined) clean[key] = patch[key];
  }
  if (patch.capacity_points !== undefined) clean.capacity_points = toPositiveInt(patch.capacity_points, 40);
  if (patch.status !== undefined) clean.status = normalizeSprintStatus(patch.status);
  updateRow('sprints', id, clean);
  return getSprint(id);
}

export function removeSprint(id: string): number {
  return deleteById('sprints', id);
}

/* ------------------------------- sprint scope ---------------------------- */

export interface ScopeInput {
  sprint_id: string;
  test_case_id: string;
  assignee?: string | null;
  estimate_minutes?: unknown;
  status?: string | null;
}

export interface ScopeRow extends SprintScope {
  /** Joined test-case fields the UI needs without a second request. */
  tc_code: string;
  tc_title: string;
  tc_priority: string;
  tc_automation_status: string;
  tc_engine: string;
  tc_risk_score: number;
  tc_estimated_minutes: number;
}

export function listScope(sprintId: string): ScopeRow[] {
  return db
    .prepare(
      `SELECT s.*, tc.code AS tc_code, tc.title AS tc_title, tc.priority AS tc_priority,
              tc.automation_status AS tc_automation_status, tc.engine AS tc_engine,
              tc.risk_score AS tc_risk_score, tc.estimated_minutes AS tc_estimated_minutes
         FROM sprint_scope s
         JOIN test_cases tc ON tc.id = s.test_case_id
        WHERE s.sprint_id = ?
        ORDER BY tc.risk_score DESC, tc.code ASC`,
    )
    .all(sprintId) as unknown as ScopeRow[];
}

export function getScopeItem(id: string): SprintScope | undefined {
  return findById<SprintScope>('sprint_scope', id);
}

/** Adds cases to a sprint; already-present cases are updated instead of duplicated. */
export function addScope(sprintId: string, items: Array<Omit<ScopeInput, 'sprint_id'>>): ScopeRow[] {
  db.transaction(() => {
    for (const item of items) {
      const existing = db
        .prepare('SELECT id FROM sprint_scope WHERE sprint_id = ? AND test_case_id = ?')
        .get(sprintId, item.test_case_id) as { id: string } | undefined;
      if (existing) {
        updateRow('sprint_scope', existing.id, {
          assignee: item.assignee ?? null,
          estimate_minutes: toPositiveInt(item.estimate_minutes, estimateForCase(item.test_case_id)),
          status: normalizeScopeStatus(item.status),
        });
      } else {
        insertRow(
          'sprint_scope',
          {
            sprint_id: sprintId,
            test_case_id: item.test_case_id,
            assignee: item.assignee ?? null,
            estimate_minutes: toPositiveInt(item.estimate_minutes, estimateForCase(item.test_case_id)),
            status: normalizeScopeStatus(item.status),
          },
          'sps_',
        );
      }
    }
  });
  return listScope(sprintId);
}

export function updateScopeItem(id: string, patch: Record<string, unknown>): SprintScope | undefined {
  const clean: Record<string, unknown> = {};
  if (patch.assignee !== undefined) clean.assignee = patch.assignee;
  if (patch.estimate_minutes !== undefined) clean.estimate_minutes = toPositiveInt(patch.estimate_minutes, 10);
  if (patch.status !== undefined) clean.status = normalizeScopeStatus(patch.status);
  updateRow('sprint_scope', id, clean);
  return getScopeItem(id);
}

export function removeScopeItem(id: string): number {
  return deleteById('sprint_scope', id);
}

export function removeScopeByCase(sprintId: string, testCaseId: string): number {
  return db.prepare('DELETE FROM sprint_scope WHERE sprint_id = ? AND test_case_id = ?').run(sprintId, testCaseId)
    .changes;
}

/** Falls back to the test case's own estimate when the caller does not supply one. */
function estimateForCase(testCaseId: string): number {
  const row = db.prepare('SELECT estimated_minutes FROM test_cases WHERE id = ?').get(testCaseId) as
    | { estimated_minutes: number }
    | undefined;
  return Number(row?.estimated_minutes ?? 10) || 10;
}

/* ---------------------------------- plan --------------------------------- */

export interface PlanSprint {
  sprint_id: string;
  code: string;
  name: string;
  goal: string | null;
  status: string;
  start_date: string | null;
  end_date: string | null;
  capacity_points: number;
  scope_count: number;
  estimate_sum: number;
  actual_minutes: number;
  done_count: number;
  progress_pct: number;
  capacity_used_pct: number;
  status_counts: { todo: number; in_progress: number; done: number };
  /** Gantt-friendly offset/length in days, relative to the cycle window. */
  offset_days: number;
  duration_days: number;
}

export interface PlanCycle {
  cycle_id: string;
  code: string;
  name: string;
  status: string;
  start_date: string | null;
  end_date: string | null;
  total_days: number;
  scope_count: number;
  estimate_sum: number;
  actual_minutes: number;
  capacity_points: number;
  progress_pct: number;
  sprints: PlanSprint[];
}

export interface PlanView {
  project_id: string;
  generated_at: string;
  window: { start: string | null; end: string | null; total_days: number };
  totals: {
    cycles: number;
    sprints: number;
    scope_count: number;
    estimate_minutes: number;
    actual_minutes: number;
    capacity_points: number;
    capacity_used_pct: number;
    progress_pct: number;
  };
  cycles: PlanCycle[];
}

/**
 * Planned vs actual effort. "Actual" is derived from the recorded run results of the
 * sprint's scope: a scope row that has a matching result in a run of that sprint counts its
 * real `duration_ms`, otherwise the planned estimate stands in.
 */
export function buildPlan(projectId: string): PlanView {
  const cycles = listCycles(projectId);
  const sprints = listSprintsByProject(projectId);

  const out: PlanCycle[] = [];
  let totalScope = 0;
  let totalEstimate = 0;
  let totalActual = 0;
  let totalCapacity = 0;
  let totalDone = 0;
  for (const cycle of cycles) {
    const cycleSprints = sprints.filter((s) => s.cycle_id === cycle.id);
    const planSprints: PlanSprint[] = [];
    let cycleScope = 0;
    let cycleEstimate = 0;
    let cycleCapacity = 0;
    let cycleDone = 0;
    let cycleActual = 0;

    for (const sprint of cycleSprints) {
      const agg = aggregateSprint(sprint.id);
      const duration = daySpan(sprint.start_date, sprint.end_date);
      planSprints.push({
        sprint_id: sprint.id,
        code: sprint.code,
        name: sprint.name,
        goal: sprint.goal,
        status: sprint.status,
        start_date: sprint.start_date,
        end_date: sprint.end_date,
        capacity_points: sprint.capacity_points,
        scope_count: agg.scope_count,
        estimate_sum: agg.estimate_sum,
        actual_minutes: agg.actual_minutes,
        done_count: agg.status_counts.done,
        progress_pct: agg.progress_pct,
        capacity_used_pct: agg.capacity_used_pct,
        status_counts: agg.status_counts,
        offset_days: dayOffset(cycle.start_date, sprint.start_date),
        duration_days: duration,
      });
      cycleScope += agg.scope_count;
      cycleEstimate += agg.estimate_sum;
      cycleCapacity += sprint.capacity_points;
      cycleDone += agg.status_counts.done;
      cycleActual += agg.actual_minutes;
      totalActual += agg.actual_minutes;
    }

    const cycleSpan = daySpan(cycle.start_date, cycle.end_date);
    out.push({
      cycle_id: cycle.id,
      code: cycle.code,
      name: cycle.name,
      status: cycle.status,
      start_date: cycle.start_date,
      end_date: cycle.end_date,
      total_days: cycleSpan,
      scope_count: cycleScope,
      estimate_sum: cycleEstimate,
      actual_minutes: cycleActual,
      capacity_points: cycleCapacity,
      progress_pct: pct(cycleDone, cycleScope),
      sprints: planSprints,
    });

    totalScope += cycleScope;
    totalEstimate += cycleEstimate;
    totalCapacity += cycleCapacity;
    totalDone += cycleDone;
  }

  const allSprints = sprints;
  return {
    project_id: projectId,
    generated_at: new Date().toISOString(),
    window: {
      start: allSprints.map((s) => s.start_date).filter(Boolean).sort()[0] ?? null,
      end: allSprints.map((s) => s.end_date).filter(Boolean).sort().slice(-1)[0] ?? null,
      total_days: daySpan(
        allSprints.map((s) => s.start_date).filter(Boolean).sort()[0] ?? null,
        allSprints.map((s) => s.end_date).filter(Boolean).sort().slice(-1)[0] ?? null,
      ),
    },
    totals: {
      cycles: cycles.length,
      sprints: allSprints.length,
      scope_count: totalScope,
      estimate_minutes: totalEstimate,
      actual_minutes: totalActual,
      capacity_points: totalCapacity,
      capacity_used_pct: pct(totalEstimate, totalCapacity * 60),
      progress_pct: pct(totalDone, totalScope),
    },
    cycles: out,
  };
}

interface SprintAggregate {
  scope_count: number;
  estimate_sum: number;
  actual_minutes: number;
  progress_pct: number;
  capacity_used_pct: number;
  status_counts: { todo: number; in_progress: number; done: number };
}

function aggregateSprint(sprintId: string): SprintAggregate {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS scope_count,
              COALESCE(SUM(estimate_minutes), 0) AS estimate_sum,
              COALESCE(SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END), 0) AS done_count,
              COALESCE(SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END), 0) AS in_progress_count,
              COALESCE(SUM(CASE WHEN status = 'todo' THEN 1 ELSE 0 END), 0) AS todo_count
         FROM sprint_scope WHERE sprint_id = ?`,
    )
    .get(sprintId) as Record<string, number> | undefined;

  const scopeCount = Number(row?.scope_count ?? 0);
  const estimate = Number(row?.estimate_sum ?? 0);
  const done = Number(row?.done_count ?? 0);

  // Actual effort: real recorded durations for cases scoped in this sprint, else the plan.
  // Correlated subquery (not a join) so extra runs for the same case cannot multiply rows.
  const actualRow = db
    .prepare(
      `SELECT COALESCE(SUM(
                COALESCE(
                  (SELECT MAX(rr.duration_ms) FROM run_results rr
                     JOIN test_runs tr ON tr.id = rr.run_id
                    WHERE tr.sprint_id = sc.sprint_id
                      AND rr.test_case_id = sc.test_case_id
                      AND rr.duration_ms > 0),
                  sc.estimate_minutes * 60000
                )
              ), 0) / 60000.0 AS actual
         FROM sprint_scope sc
        WHERE sc.sprint_id = ?`,
    )
    .get(sprintId) as { actual: number } | undefined;

  const sprint = getSprint(sprintId);
  const capacityMinutes = Number(sprint?.capacity_points ?? 0) * 60;

  return {
    scope_count: scopeCount,
    estimate_sum: Number(estimate.toFixed(1)),
    actual_minutes: Number(Number(actualRow?.actual ?? 0).toFixed(1)),
    progress_pct: pct(done, scopeCount),
    capacity_used_pct: pct(estimate, capacityMinutes),
    status_counts: {
      todo: Number(row?.todo_count ?? 0),
      in_progress: Number(row?.in_progress_count ?? 0),
      done,
    },
  };
}

/* -------------------------------- helpers -------------------------------- */

function pct(n: number, d: number): number {
  if (!d) return 0;
  return Number(((n / d) * 100).toFixed(1));
}

/** Inclusive day span between two ISO dates; 0 when either is missing. */
function daySpan(start: string | null | undefined, end: string | null | undefined): number {
  if (!start || !end) return 0;
  const a = Date.parse(start);
  const b = Date.parse(end);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.max(0, Math.round((b - a) / 86_400_000) + 1);
}

function dayOffset(from: string | null | undefined, to: string | null | undefined): number {
  if (!from || !to) return 0;
  const a = Date.parse(from);
  const b = Date.parse(to);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

function jsonOrNull(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v === 'string') return v;
  return JSON.stringify(v);
}

function normalizeCycleStatus(v: unknown): string {
  const s = String(v ?? 'planned');
  return (CYCLE_STATUSES as readonly string[]).includes(s) ? s : 'planned';
}

function normalizeSprintStatus(v: unknown): string {
  const s = String(v ?? 'planned');
  return (SPRINT_STATUSES as readonly string[]).includes(s) ? s : 'planned';
}

function normalizeScopeStatus(v: unknown): string {
  const s = String(v ?? 'todo');
  return (SCOPE_STATUSES as readonly string[]).includes(s) ? s : 'todo';
}

function toPositiveInt(v: unknown, fallback: number): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.round(n);
}

/** Re-exported so the routes file does not need to know the db helper. */
export { nextCode };
