/**
 * environment repository — CRUD against `environments` and `test_data_sets`.
 * Only this module writes to those tables (ARCHITECTURE.md §7).
 *
 * Invariant enforced here: **at most one default environment per project**.
 */

import type { Environment, TestDataSet } from '@qatools/shared';
import { nowIso } from '@qatools/shared';
import { db, findById, insertRow, updateRow, deleteById, parseJson, toJson } from '../../db/index.js';

export const ENVIRONMENT_KINDS = ['dev', 'staging', 'uat', 'prod', 'local'] as const;

/* ------------------------------ environments ----------------------------- */

export interface EnvironmentInput {
  project_id: string;
  name: string;
  base_url?: string | null;
  db_uri?: string | null;
  api_base?: string | null;
  kind?: string | null;
  variables?: unknown;
  is_default?: unknown;
  notes?: string | null;
}

export function listEnvironments(projectId: string): Environment[] {
  return db
    .prepare('SELECT * FROM environments WHERE project_id = ? ORDER BY is_default DESC, name ASC')
    .all(projectId) as unknown as Environment[];
}

export function getEnvironment(id: string): Environment | undefined {
  return findById<Environment>('environments', id);
}

export function defaultEnvironment(projectId: string): Environment | undefined {
  return db
    .prepare('SELECT * FROM environments WHERE project_id = ? AND is_default = 1 ORDER BY created_at ASC LIMIT 1')
    .get(projectId) as Environment | undefined;
}

export function createEnvironment(input: EnvironmentInput): Environment {
  const id = insertRow(
    'environments',
    {
      project_id: input.project_id,
      name: input.name,
      base_url: input.base_url ?? null,
      db_uri: input.db_uri ?? null,
      api_base: input.api_base ?? null,
      kind: normalizeKind(input.kind),
      variables: input.variables === undefined ? null : toJson(input.variables),
      is_default: 0,
      notes: input.notes ?? null,
    },
    'env_',
  );
  // First environment of a project becomes the default so execution never lacks a target.
  const count = db
    .prepare('SELECT COUNT(*) AS n FROM environments WHERE project_id = ?')
    .get(input.project_id) as { n: number } | undefined;
  if (Number(count?.n ?? 0) === 1 || input.is_default === true || input.is_default === 1) {
    markDefault(id);
    // A second explicit default request must clear the previous one first.
    clearOtherDefaults(input.project_id, id);
  }
  return getEnvironment(id) as Environment;
}

export function updateEnvironment(id: string, patch: Record<string, unknown>): Environment | undefined {
  const current = getEnvironment(id);
  if (!current) return undefined;
  const clean: Record<string, unknown> = {};
  for (const key of ['name', 'base_url', 'db_uri', 'api_base', 'notes'] as const) {
    if (patch[key] !== undefined) clean[key] = patch[key];
  }
  if (patch.kind !== undefined) clean.kind = normalizeKind(patch.kind);
  if (patch.variables !== undefined) clean.variables = toJson(patch.variables);
  updateRow('environments', id, clean);
  if (patch.is_default !== undefined) {
    const wanted = patch.is_default === true || patch.is_default === 1 || patch.is_default === '1';
    if (wanted) markDefault(id);
    else updateRow('environments', id, { is_default: 0 });
  }
  return getEnvironment(id);
}

export function removeEnvironment(id: string): number {
  return deleteById('environments', id);
}

/** Makes `id` the only default environment of its project. Returns the updated row. */
export function markDefault(id: string): Environment | undefined {
  const env = getEnvironment(id);
  if (!env) return undefined;
  db.transaction(() => {
    db.prepare('UPDATE environments SET is_default = 0, updated_at = ? WHERE project_id = ?').run(
      nowIso(),
      env.project_id,
    );
    db.prepare('UPDATE environments SET is_default = 1, updated_at = ? WHERE id = ?').run(nowIso(), id);
  });
  return getEnvironment(id);
}

function clearOtherDefaults(projectId: string, keepId: string): void {
  db.prepare(
    'UPDATE environments SET is_default = 0, updated_at = ? WHERE project_id = ? AND id <> ?',
  ).run(nowIso(), projectId, keepId);
}

/** Environment `variables` merged as a flat string map — used by the engines. */
export function environmentVariables(env: Environment | undefined): Record<string, string> {
  const raw = parseJson<Record<string, unknown>>(env?.variables ?? null, {}) ?? {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (v === null || v === undefined) continue;
    out[k] = typeof v === 'string' ? v : JSON.stringify(v);
  }
  return out;
}

function normalizeKind(kind: unknown): string {
  const k = String(kind ?? 'staging');
  return (ENVIRONMENT_KINDS as readonly string[]).includes(k) ? k : 'staging';
}

/* ------------------------------ test data sets --------------------------- */

export interface TestDataSetInput {
  project_id: string;
  environment_id?: string | null;
  name: string;
  description?: string | null;
  columns?: unknown;
  rows?: unknown;
  generated_by?: string | null;
}

export function listDataSets(projectId: string, environmentId?: string): TestDataSet[] {
  if (environmentId) {
    return db
      .prepare('SELECT * FROM test_data_sets WHERE project_id = ? AND environment_id = ? ORDER BY created_at DESC')
      .all(projectId, environmentId) as unknown as TestDataSet[];
  }
  return db
    .prepare('SELECT * FROM test_data_sets WHERE project_id = ? ORDER BY created_at DESC')
    .all(projectId) as unknown as TestDataSet[];
}

export function getDataSet(id: string): TestDataSet | undefined {
  return findById<TestDataSet>('test_data_sets', id);
}

export function createDataSet(input: TestDataSetInput): TestDataSet {
  const columns = normalizeColumns(input.columns, input.rows);
  const id = insertRow(
    'test_data_sets',
    {
      project_id: input.project_id,
      environment_id: input.environment_id ?? null,
      name: input.name,
      description: input.description ?? null,
      columns: toJson(columns),
      rows: toJson(normalizeRows(input.rows, columns)),
      generated_by: input.generated_by ?? 'manual',
    },
    'tds_',
  );
  return getDataSet(id) as TestDataSet;
}

export function updateDataSet(id: string, patch: Record<string, unknown>): TestDataSet | undefined {
  const current = getDataSet(id);
  if (!current) return undefined;
  const clean: Record<string, unknown> = {};
  for (const key of ['name', 'description', 'environment_id', 'generated_by'] as const) {
    if (patch[key] !== undefined) clean[key] = patch[key];
  }
  if (patch.columns !== undefined || patch.rows !== undefined) {
    const columns = normalizeColumns(
      patch.columns !== undefined
        ? patch.columns
        : parseJson<string[]>(current.columns, []),
      patch.rows !== undefined ? patch.rows : parseJson<unknown[]>(current.rows, []),
    );
    const rows = normalizeRows(
      patch.rows !== undefined ? patch.rows : parseJson<unknown[]>(current.rows, []),
      columns,
    );
    clean.columns = toJson(columns);
    clean.rows = toJson(rows);
  }
  updateRow('test_data_sets', id, clean);
  return getDataSet(id);
}

export function removeDataSet(id: string): number {
  return deleteById('test_data_sets', id);
}

/** Column list is authoritative: derive it from rows when the caller omitted it. */
function normalizeColumns(columns: unknown, rows: unknown): string[] {
  const parsed = parseJson<unknown>(columns ?? null, null);
  if (Array.isArray(parsed) && parsed.length) return parsed.map((c) => String(c));
  const rowList = parseJson<unknown>(rows ?? null, []);
  const seen: string[] = [];
  if (Array.isArray(rowList)) {
    for (const row of rowList) {
      if (row && typeof row === 'object') {
        for (const k of Object.keys(row as Record<string, unknown>)) {
          if (!seen.includes(k)) seen.push(k);
        }
      }
    }
  }
  return seen;
}

/** Rows are keyed objects; scalar cells become strings. */
function normalizeRows(rows: unknown, columns: string[]): Array<Record<string, string>> {
  const parsed = parseJson<unknown>(rows ?? null, []);
  const out: Array<Record<string, string>> = [];
  if (!Array.isArray(parsed)) return out;
  for (const row of parsed) {
    if (row === null || row === undefined) continue;
    if (Array.isArray(row)) {
      const obj: Record<string, string> = {};
      columns.forEach((c, i) => {
        obj[c] = row[i] === undefined || row[i] === null ? '' : String(row[i]);
      });
      out.push(obj);
      continue;
    }
    if (typeof row === 'object') {
      const obj: Record<string, string> = {};
      const source = row as Record<string, unknown>;
      const keys = columns.length ? columns : Object.keys(source);
      for (const k of keys) {
        const v = source[k];
        obj[k] = v === undefined || v === null ? '' : typeof v === 'string' ? v : JSON.stringify(v);
      }
      out.push(obj);
    }
  }
  return out;
}
