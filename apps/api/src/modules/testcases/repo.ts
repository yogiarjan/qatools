/**
 * Test cases repository — `test_cases` and `test_steps`.
 */

import { db, findById, insertRow, updateRow, deleteById, newId, nowIso } from '../../db/index.js';
import { withTransaction } from '../matrix/tx.js';
import type { TestCase, TestStep } from '@qatools/shared';

export interface TestCaseFilter {
  type?: string;
  layer?: string;
  priority?: string;
  engine?: string;
  automation_status?: string;
  is_regression?: boolean;
  scenario_id?: string;
  use_case_id?: string;
  q?: string;
}

export function listTestCases(projectId: string, filter: TestCaseFilter = {}): TestCase[] {
  const where = ['project_id = ?'];
  const params: unknown[] = [projectId];

  for (const [key, column] of [
    ['type', 'type'],
    ['layer', 'layer'],
    ['priority', 'priority'],
    ['engine', 'engine'],
    ['automation_status', 'automation_status'],
    ['scenario_id', 'scenario_id'],
    ['use_case_id', 'use_case_id'],
  ] as const) {
    const value = filter[key];
    if (value !== undefined && value !== null && value !== '') {
      where.push(`${column} = ?`);
      params.push(value);
    }
  }
  if (filter.is_regression !== undefined) {
    where.push('is_regression = ?');
    params.push(filter.is_regression ? 1 : 0);
  }
  if (filter.q) {
    where.push(`(LOWER(title) LIKE ? OR LOWER(code) LIKE ? OR LOWER(COALESCE(objective, '')) LIKE ?)`);
    const needle = `%${filter.q.toLowerCase()}%`;
    params.push(needle, needle, needle);
  }

  return db
    .prepare(
      `SELECT * FROM test_cases WHERE ${where.join(' AND ')}
       ORDER BY code COLLATE NOCASE ASC, created_at ASC`,
    )
    .all(...params) as unknown as TestCase[];
}

export function getTestCase(id: string): TestCase | undefined {
  return findById<TestCase>('test_cases', id);
}

export function createTestCase(input: Record<string, unknown>): string {
  return insertRow('test_cases', input, 'tc_');
}

export function updateTestCase(id: string, patch: Record<string, unknown>): number {
  return updateRow('test_cases', id, patch);
}

export function deleteTestCase(id: string): number {
  return deleteById('test_cases', id);
}

export function existingTestCaseCodes(projectId: string): Set<string> {
  const rows = db.prepare('SELECT code FROM test_cases WHERE project_id = ?').all(projectId) as Array<{
    code: string;
  }>;
  return new Set(rows.map((r) => r.code));
}

/* -------------------------------- test steps ------------------------------- */

export function listSteps(testCaseId: string): TestStep[] {
  return db
    .prepare('SELECT * FROM test_steps WHERE test_case_id = ? ORDER BY order_index ASC')
    .all(testCaseId) as unknown as TestStep[];
}

/** Replaces the whole ordered step list — the API contract for PUT /steps. */
export function replaceSteps(
  testCaseId: string,
  steps: Array<{ action: string; expected?: string | null; data?: string | null }>,
): TestStep[] {
  withTransaction(() => {
    db.prepare('DELETE FROM test_steps WHERE test_case_id = ?').run(testCaseId);
    const stmt = db.prepare(
      `INSERT INTO test_steps (id, test_case_id, order_index, action, expected, data, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    steps.forEach((step, index) => {
      stmt.run(
        newId('tst_'),
        testCaseId,
        index + 1,
        step.action,
        step.expected ?? null,
        step.data ?? null,
        nowIso(),
      );
    });
  });
  return listSteps(testCaseId);
}

export function countSteps(testCaseId: string): number {
  const row = db
    .prepare('SELECT COUNT(*) AS n FROM test_steps WHERE test_case_id = ?')
    .get(testCaseId) as { n: number } | undefined;
  return Number(row?.n ?? 0);
}
