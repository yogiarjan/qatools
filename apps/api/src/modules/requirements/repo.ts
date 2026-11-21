/**
 * Requirements repository — `requirements` table only.
 */

import { db, findById, insertRow, updateRow, deleteById, nextCode } from '../../db/index.js';
import type { Requirement } from '@qatools/shared';

export interface RequirementFilter {
  priority?: string;
  status?: string;
  q?: string;
}

export function listRequirements(projectId: string, filter: RequirementFilter = {}): Requirement[] {
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
    where.push(`(LOWER(title) LIKE ? OR LOWER(code) LIKE ? OR LOWER(COALESCE(description, '')) LIKE ?)`);
    const needle = `%${filter.q.toLowerCase()}%`;
    params.push(needle, needle, needle);
  }

  return db
    .prepare(
      `SELECT * FROM requirements WHERE ${where.join(' AND ')}
       ORDER BY code COLLATE NOCASE ASC, created_at ASC`,
    )
    .all(...params) as unknown as Requirement[];
}

export function getRequirement(id: string): Requirement | undefined {
  return findById<Requirement>('requirements', id);
}

export function nextRequirementCode(projectId: string): string {
  return nextCode('requirements', 'REQ', projectId);
}

export interface RequirementInput {
  project_id: string;
  code: string;
  title: string;
  description?: string | null;
  source?: string | null;
  priority?: string;
  status?: string;
  acceptance_criteria?: string | null;
}

export function createRequirement(input: RequirementInput): string {
  return insertRow('requirements', { ...input }, 'req_');
}

export function updateRequirement(id: string, patch: Record<string, unknown>): number {
  return updateRow('requirements', id, patch);
}

export function deleteRequirement(id: string): number {
  return deleteById('requirements', id);
}

/** Codes already used inside a project — used to avoid UNIQUE(project_id, code) collisions. */
export function existingCodes(projectId: string): Set<string> {
  const rows = db.prepare('SELECT code FROM requirements WHERE project_id = ?').all(projectId) as Array<{
    code: string;
  }>;
  return new Set(rows.map((r) => r.code));
}
