/**
 * Scenarios repository — `scenarios` table only.
 */

import { db, findById, insertRow, updateRow, deleteById, nextCode } from '../../db/index.js';
import type { Scenario } from '@qatools/shared';

export interface ScenarioFilter {
  use_case_id?: string;
  kind?: string;
  priority?: string;
}

export function listScenarios(projectId: string, filter: ScenarioFilter = {}): Scenario[] {
  const where = ['project_id = ?'];
  const params: unknown[] = [projectId];

  if (filter.use_case_id) {
    where.push('use_case_id = ?');
    params.push(filter.use_case_id);
  }
  if (filter.kind) {
    where.push('kind = ?');
    params.push(filter.kind);
  }
  if (filter.priority) {
    where.push('priority = ?');
    params.push(filter.priority);
  }

  return db
    .prepare(
      `SELECT * FROM scenarios WHERE ${where.join(' AND ')}
       ORDER BY code COLLATE NOCASE ASC, created_at ASC`,
    )
    .all(...params) as unknown as Scenario[];
}

export function getScenario(id: string): Scenario | undefined {
  return findById<Scenario>('scenarios', id);
}

export function nextScenarioCode(projectId: string): string {
  return nextCode('scenarios', 'SC', projectId);
}

export interface ScenarioInput {
  project_id: string;
  use_case_id: string | null;
  code: string;
  title: string;
  kind?: string;
  given_text?: string | null;
  when_text?: string | null;
  then_text?: string | null;
  priority?: string;
  generated_by?: string;
  ai_generation_id?: string | null;
}

export function createScenario(input: ScenarioInput): string {
  return insertRow('scenarios', { ...input }, 'sc_');
}

export function updateScenario(id: string, patch: Record<string, unknown>): number {
  return updateRow('scenarios', id, patch);
}

export function deleteScenario(id: string): number {
  return deleteById('scenarios', id);
}

export function existingScenarioCodes(projectId: string): Set<string> {
  const rows = db.prepare('SELECT code FROM scenarios WHERE project_id = ?').all(projectId) as Array<{
    code: string;
  }>;
  return new Set(rows.map((r) => r.code));
}

export function testCasesOfScenario(scenarioId: string): unknown[] {
  return db
    .prepare('SELECT * FROM test_cases WHERE scenario_id = ? ORDER BY code COLLATE NOCASE')
    .all(scenarioId);
}
