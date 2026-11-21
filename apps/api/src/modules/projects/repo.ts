/**
 * Projects repository — SQL against the frozen schema.
 * Lane A owns `projects` (+ the single auto-created default `environments` row).
 */

import { db, findById, insertRow, updateRow, deleteById, parseJson } from '../../db/index.js';
import type { Project } from '@qatools/shared';

export interface ProjectListFilter {
  status?: string;
  q?: string;
}

export function listProjects(filter: ProjectListFilter = {}): Project[] {
  const where: string[] = [];
  const params: unknown[] = [];

  if (filter.status) {
    where.push('status = ?');
    params.push(filter.status);
  }
  if (filter.q) {
    where.push('(LOWER(name) LIKE ? OR LOWER(key) LIKE ? OR LOWER(COALESCE(description, \'\')) LIKE ?)');
    const needle = `%${filter.q.toLowerCase()}%`;
    params.push(needle, needle, needle);
  }

  const sql = `SELECT * FROM projects ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
               ORDER BY created_at DESC, id DESC`;
  return db.prepare(sql).all(...params) as unknown as Project[];
}

export function getProject(id: string): Project | undefined {
  return findById<Project>('projects', id);
}

export function getProjectByKey(key: string): Project | undefined {
  return db.prepare('SELECT * FROM projects WHERE LOWER(key) = LOWER(?)').get(key) as
    | Project
    | undefined;
}

export interface ProjectInput {
  key: string;
  name: string;
  description?: string | null;
  target_url?: string | null;
  repo_url?: string | null;
  owner?: string | null;
  status?: string;
  quality_gate?: number;
  metadata?: string | null;
}

export function createProject(input: ProjectInput): string {
  return insertRow('projects', { ...input }, 'prj_');
}

export function updateProject(id: string, patch: Record<string, unknown>): number {
  return updateRow('projects', id, patch);
}

export function deleteProject(id: string): number {
  return deleteById('projects', id);
}

/** Counts used by the project cards on the Projects page. */
export function projectArtifactCounts(projectId: string): {
  requirements: number;
  use_cases: number;
  scenarios: number;
  test_cases: number;
} {
  const count = (table: string): number => {
    const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE project_id = ?`).get(projectId) as
      | { n: number }
      | undefined;
    return Number(row?.n ?? 0);
  };
  return {
    requirements: count('requirements'),
    use_cases: count('use_cases'),
    scenarios: count('scenarios'),
    test_cases: count('test_cases'),
  };
}

/** Reads the JSON metadata blob of a project without throwing on malformed data. */
export function projectMetadata(project: Project): Record<string, unknown> {
  return parseJson<Record<string, unknown>>(project.metadata, {});
}

/* ------------------------- environments (default row) ------------------------- */
/*
 * Lane exception agreed with the Lead: lane-pm owns the `/environments` routes;
 * lane A inserts exactly one default environment row when a project is created so
 * that execution has somewhere to point immediately.
 */

export function createDefaultEnvironment(projectId: string, name: string, baseUrl: string | null): string {
  return insertRow(
    'environments',
    {
      project_id: projectId,
      name: `Default · ${name}`,
      base_url: baseUrl,
      db_uri: null,
      api_base: baseUrl,
      kind: 'staging',
      variables: null,
      is_default: 1,
      notes: 'Dibuat otomatis saat project dibuat (Lane A).',
    },
    'env_',
  );
}

export function countEnvironments(projectId: string): number {
  const row = db.prepare('SELECT COUNT(*) AS n FROM environments WHERE project_id = ?').get(projectId) as
    | { n: number }
    | undefined;
  return Number(row?.n ?? 0);
}
