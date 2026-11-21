/**
 * apitester repository — SQL against the frozen schema (api_collections, api_requests).
 * Only this module writes to those tables.
 */

import type { ApiCollection, ApiRequest } from '@qatools/shared';
import { newId, nowIso } from '@qatools/shared';
import { db, findById, insertRow, updateRow, deleteById, parseJson, toJson } from '../../db/index.js';

/* ------------------------------- collections ----------------------------- */

export interface CollectionInput {
  project_id: string;
  name: string;
  description?: string | null;
  base_url?: string | null;
  auth_type?: string | null;
  auth_config?: unknown;
  variables?: unknown;
}

export function listCollections(projectId: string): ApiCollection[] {
  return db
    .prepare('SELECT * FROM api_collections WHERE project_id = ? ORDER BY created_at ASC')
    .all(projectId) as unknown as ApiCollection[];
}

export function getCollection(id: string): ApiCollection | undefined {
  return findById<ApiCollection>('api_collections', id);
}

export function createCollection(input: CollectionInput): ApiCollection {
  const id = insertRow(
    'api_collections',
    {
      project_id: input.project_id,
      name: input.name,
      description: input.description ?? null,
      base_url: input.base_url ?? null,
      auth_type: input.auth_type ?? 'none',
      auth_config: input.auth_config === undefined ? null : toJson(input.auth_config),
      variables: input.variables === undefined ? null : toJson(input.variables),
    },
    'col_',
  );
  return getCollection(id) as ApiCollection;
}

export function updateCollection(id: string, patch: Record<string, unknown>): ApiCollection | undefined {
  const clean: Record<string, unknown> = {};
  const passthrough = ['name', 'description', 'base_url', 'auth_type'] as const;
  for (const key of passthrough) {
    if (patch[key] !== undefined) clean[key] = patch[key];
  }
  for (const key of ['auth_config', 'variables'] as const) {
    if (patch[key] !== undefined) clean[key] = toJson(patch[key]);
  }
  updateRow('api_collections', id, clean);
  return getCollection(id);
}

export function removeCollection(id: string): number {
  return deleteById('api_collections', id);
}

/** Collection variables merged as `{ name: value }` strings. */
export function collectionVariables(coll: ApiCollection | undefined): Record<string, string> {
  const raw = parseJson<Record<string, unknown>>(coll?.variables ?? null, {});
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw ?? {})) {
    if (v === null || v === undefined) continue;
    out[k] = typeof v === 'string' ? v : JSON.stringify(v);
  }
  return out;
}

export function collectionAuthConfig(coll: ApiCollection | undefined): Record<string, unknown> {
  return parseJson<Record<string, unknown>>(coll?.auth_config ?? null, {}) ?? {};
}

/* -------------------------------- requests ------------------------------- */

export interface RequestInput {
  collection_id: string;
  project_id: string;
  test_case_id?: string | null;
  name: string;
  method?: string | null;
  path: string;
  headers?: unknown;
  query?: unknown;
  body?: string | null;
  body_type?: string | null;
  assertions?: unknown;
  pre_script?: string | null;
  post_script?: string | null;
  generated_by?: string | null;
}

export function listRequests(collectionId: string): ApiRequest[] {
  return db
    .prepare('SELECT * FROM api_requests WHERE collection_id = ? ORDER BY created_at ASC')
    .all(collectionId) as unknown as ApiRequest[];
}

export function listRequestsByProject(projectId: string, testCaseId?: string): ApiRequest[] {
  if (testCaseId) {
    return db
      .prepare('SELECT * FROM api_requests WHERE project_id = ? AND test_case_id = ? ORDER BY created_at ASC')
      .all(projectId, testCaseId) as unknown as ApiRequest[];
  }
  return db
    .prepare('SELECT * FROM api_requests WHERE project_id = ? ORDER BY created_at ASC')
    .all(projectId) as unknown as ApiRequest[];
}

export function getRequest(id: string): ApiRequest | undefined {
  return findById<ApiRequest>('api_requests', id);
}

/** The request bound to a test case, when the engine runs a case of layer=api. */
export function findRequestForCase(testCaseId: string): ApiRequest | undefined {
  return db
    .prepare('SELECT * FROM api_requests WHERE test_case_id = ? ORDER BY created_at ASC LIMIT 1')
    .get(testCaseId) as ApiRequest | undefined;
}

export function createRequest(input: RequestInput): ApiRequest {
  const id = insertRow(
    'api_requests',
    {
      collection_id: input.collection_id,
      project_id: input.project_id,
      test_case_id: input.test_case_id ?? null,
      name: input.name,
      method: (input.method ?? 'GET').toUpperCase(),
      path: input.path,
      headers: input.headers === undefined ? null : toJson(input.headers),
      query: input.query === undefined ? null : toJson(input.query),
      body: input.body ?? null,
      body_type: input.body_type ?? 'none',
      assertions: input.assertions === undefined ? null : toJson(input.assertions),
      pre_script: input.pre_script ?? null,
      post_script: input.post_script ?? null,
      generated_by: input.generated_by ?? 'manual',
    },
    'apr_',
  );
  return getRequest(id) as ApiRequest;
}

export function updateRequest(id: string, patch: Record<string, unknown>): ApiRequest | undefined {
  const clean: Record<string, unknown> = {};
  for (const key of ['name', 'path', 'body', 'pre_script', 'post_script', 'test_case_id'] as const) {
    if (patch[key] !== undefined) clean[key] = patch[key];
  }
  if (patch.method !== undefined) clean.method = String(patch.method).toUpperCase();
  if (patch.body_type !== undefined) clean.body_type = patch.body_type;
  for (const key of ['headers', 'query', 'assertions'] as const) {
    if (patch[key] !== undefined) clean[key] = toJson(patch[key]);
  }
  updateRow('api_requests', id, clean);
  return getRequest(id);
}

export function removeRequest(id: string): number {
  return deleteById('api_requests', id);
}

/** Persists the outcome of a manual/automated send on the request row. */
export function touchRequestRun(id: string, status: number | null, durationMs: number | null): void {
  updateRow('api_requests', id, {
    last_status: status,
    last_duration_ms: durationMs,
    last_run_at: nowIso(),
  });
}

/** Creates a request row with a generated name/id — used by the OpenAPI importer. */
export function createImportedRequest(input: RequestInput & { id?: string }): string {
  return insertRow(
    'api_requests',
    {
      id: input.id ?? newId('apr_'),
      collection_id: input.collection_id,
      project_id: input.project_id,
      test_case_id: input.test_case_id ?? null,
      name: input.name,
      method: (input.method ?? 'GET').toUpperCase(),
      path: input.path,
      headers: input.headers === undefined ? null : toJson(input.headers),
      query: input.query === undefined ? null : toJson(input.query),
      body: input.body ?? null,
      body_type: input.body_type ?? 'none',
      assertions: input.assertions === undefined ? null : toJson(input.assertions),
      pre_script: input.pre_script ?? null,
      post_script: input.post_script ?? null,
      generated_by: input.generated_by ?? 'import',
    },
    'apr_',
  );
}
