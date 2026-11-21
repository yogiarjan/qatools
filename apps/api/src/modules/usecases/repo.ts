/**
 * Use cases repository — `use_cases` table only.
 */

import { db, findById, insertRow, updateRow, deleteById, nextCode } from '../../db/index.js';
import type { UseCase } from '@qatools/shared';

export interface UseCaseFilter {
  priority?: string;
  status?: string;
  q?: string;
}

export function listUseCases(projectId: string, filter: UseCaseFilter = {}): UseCase[] {
  const where = ['project_id = ?'];
  const params: unknown[] = [projectId];

  if (filter.priority) {
    where.push('priority = ?');
    params.push(filter.priority);
  }
  if (filter.status) {
    where.push('status = ?');
    params.push(filter.status);
  }
  if (filter.q) {
    where.push(`(LOWER(name) LIKE ? OR LOWER(code) LIKE ? OR LOWER(COALESCE(goal, '')) LIKE ?)`);
    const needle = `%${filter.q.toLowerCase()}%`;
    params.push(needle, needle, needle);
  }

  return db
    .prepare(
      `SELECT * FROM use_cases WHERE ${where.join(' AND ')}
       ORDER BY code COLLATE NOCASE ASC, created_at ASC`,
    )
    .all(...params) as unknown as UseCase[];
}

export function getUseCase(id: string): UseCase | undefined {
  return findById<UseCase>('use_cases', id);
}

export function nextUseCaseCode(projectId: string): string {
  return nextCode('use_cases', 'UC', projectId);
}

export interface UseCaseInput {
  project_id: string;
  code: string;
  name: string;
  goal?: string | null;
  actors?: string | null;
  preconditions?: string | null;
  postconditions?: string | null;
  main_flow?: string | null;
  alternate_flows?: string | null;
  business_rules?: string | null;
  priority?: string;
  risk?: string;
  status?: string;
  generated_by?: string;
  ai_generation_id?: string | null;
}

export function createUseCase(input: UseCaseInput): string {
  return insertRow('use_cases', { ...input }, 'uc_');
}

export function updateUseCase(id: string, patch: Record<string, unknown>): number {
  return updateRow('use_cases', id, patch);
}

export function deleteUseCase(id: string): number {
  return deleteById('use_cases', id);
}

export function existingUseCaseCodes(projectId: string): Set<string> {
  const rows = db.prepare('SELECT code FROM use_cases WHERE project_id = ?').all(projectId) as Array<{
    code: string;
  }>;
  return new Set(rows.map((r) => r.code));
}

/** Scenarios + test cases hanging off a use case, used by the detail view. */
export function descendantsOf(useCaseId: string): {
  scenarios: unknown[];
  test_cases: unknown[];
} {
  return {
    scenarios: db
      .prepare('SELECT * FROM scenarios WHERE use_case_id = ? ORDER BY code COLLATE NOCASE')
      .all(useCaseId),
    test_cases: db
      .prepare('SELECT * FROM test_cases WHERE use_case_id = ? ORDER BY code COLLATE NOCASE')
      .all(useCaseId),
  };
}
