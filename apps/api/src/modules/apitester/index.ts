/**
 * apitester module — Postman-like API automation REST surface, mounted at /api.
 *
 *   GET    /projects/:projectId/collections
 *   POST   /projects/:projectId/collections
 *   GET    /collections/:collectionId
 *   PATCH  /collections/:collectionId
 *   DELETE /collections/:collectionId
 *   GET    /collections/:collectionId/requests
 *   POST   /collections/:collectionId/requests
 *   GET    /requests/:id
 *   PATCH  /requests/:id
 *   DELETE /requests/:id
 *   POST   /requests/:id/run
 *   POST   /collections/:collectionId/run
 *   POST   /requests/:id/import-openapi   (also accepts /collections/:id/import-openapi)
 *
 * Default export is a Fastify plugin — the Lead registers it at prefix `/api`.
 */

import type { FastifyInstance, FastifyReply } from 'fastify';
import type { ApiRequest, EngineResult } from '@qatools/shared';
import { list, one, fail, notFound, badRequest, paging } from '../../lib/http.js';
import { db, logActivity } from '../../db/index.js';
import { EngineError } from '../execute/engine-utils.js';
import { hasUnresolved } from '../execute/scripting.js';
import { runApiRequestById } from './engine.js';
import { parseOpenApi } from './openapi.js';
import {
  createCollection,
  createRequest,
  getCollection,
  getRequest,
  listCollections,
  listRequests,
  removeCollection,
  removeRequest,
  updateCollection,
  updateRequest,
} from './repo.js';

type Body = Record<string, unknown>;

/** Maps an EngineError onto the frozen error envelope. */
function engineFail(reply: FastifyReply, err: unknown) {
  if (err instanceof EngineError) {
    return fail(reply, err.status, err.code, err.message, err.details);
  }
  const message = err instanceof Error ? err.message : String(err);
  return fail(reply, 500, 'engine_error', message);
}

/** Environment variables are read from the `environments` table when scope allows. */
function environmentVariables(environmentId: string | null | undefined): Record<string, unknown> {
  if (!environmentId) return {};
  try {
    const row = db.prepare('SELECT variables FROM environments WHERE id = ?').get(environmentId) as
      | { variables: string | null }
      | undefined;
    if (!row?.variables) return {};
    const parsed = JSON.parse(row.variables) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Extracts audit fields so a client cannot spoof `project_id`. */
function pickString(body: Body, key: string): string | undefined {
  const v = body[key];
  return typeof v === 'string' ? v : undefined;
}

export default async function routes(app: FastifyInstance): Promise<void> {
  /* ------------------------------ collections ---------------------------- */

  app.get('/projects/:projectId/collections', async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    const q = req.query as Record<string, unknown>;
    const { limit, offset } = paging(q);
    const all = listCollections(projectId);
    return list(all.slice(offset, offset + limit), all.length);
  });

  app.post('/projects/:projectId/collections', async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    const body = (req.body ?? {}) as Body;
    const name = pickString(body, 'name');
    if (!name) return badRequest(reply, 'Field "name" wajib diisi');

    const coll = createCollection({
      project_id: projectId,
      name,
      description: pickString(body, 'description') ?? null,
      base_url: pickString(body, 'base_url') ?? null,
      auth_type: pickString(body, 'auth_type') ?? 'none',
      auth_config: body.auth_config,
      variables: body.variables,
    });
    logActivity({ project_id: projectId, action: 'create', entity_kind: 'api_collection', entity_id: coll.id, summary: name });
    return reply.code(201).send(one(coll));
  });

  app.get('/collections/:collectionId', async (req, reply) => {
    const { collectionId } = req.params as { collectionId: string };
    const coll = getCollection(collectionId);
    if (!coll) return notFound(reply, 'Collection');
    const requests = listRequests(collectionId);
    return one({ ...coll, requests });
  });

  app.patch('/collections/:collectionId', async (req, reply) => {
    const { collectionId } = req.params as { collectionId: string };
    if (!getCollection(collectionId)) return notFound(reply, 'Collection');
    const updated = updateCollection(collectionId, (req.body ?? {}) as Body);
    return one(updated);
  });

  app.delete('/collections/:collectionId', async (req, reply) => {
    const { collectionId } = req.params as { collectionId: string };
    if (!getCollection(collectionId)) return notFound(reply, 'Collection');
    removeCollection(collectionId);
    return one({ deleted: true, id: collectionId });
  });

  /* ------------------------------- requests ------------------------------ */

  app.get('/collections/:collectionId/requests', async (req, reply) => {
    const { collectionId } = req.params as { collectionId: string };
    if (!getCollection(collectionId)) return notFound(reply, 'Collection');
    const rows = listRequests(collectionId);
    return list(rows, rows.length);
  });

  app.post('/collections/:collectionId/requests', async (req, reply) => {
    const { collectionId } = req.params as { collectionId: string };
    const coll = getCollection(collectionId);
    if (!coll) return notFound(reply, 'Collection');

    const body = (req.body ?? {}) as Body;
    const name = pickString(body, 'name') ?? `${pickString(body, 'method') ?? 'GET'} ${pickString(body, 'path') ?? '/'}`;
    const path = pickString(body, 'path');
    if (!path) return badRequest(reply, 'Field "path" wajib diisi');

    const created = createRequest({
      collection_id: collectionId,
      project_id: coll.project_id,
      test_case_id: pickString(body, 'test_case_id') ?? null,
      name,
      method: pickString(body, 'method') ?? 'GET',
      path,
      headers: body.headers,
      query: body.query,
      body: typeof body.body === 'string' ? body.body : null,
      body_type: pickString(body, 'body_type') ?? 'none',
      assertions: body.assertions,
      pre_script: typeof body.pre_script === 'string' ? body.pre_script : null,
      post_script: typeof body.post_script === 'string' ? body.post_script : null,
      generated_by: pickString(body, 'generated_by') ?? 'manual',
    });
    return reply.code(201).send(one(created));
  });

  app.get('/requests/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const request = getRequest(id);
    if (!request) return notFound(reply, 'API request');
    return one(request);
  });

  app.patch('/requests/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!getRequest(id)) return notFound(reply, 'API request');
    const updated = updateRequest(id, (req.body ?? {}) as Body);
    return one(updated);
  });

  app.delete('/requests/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!getRequest(id)) return notFound(reply, 'API request');
    removeRequest(id);
    return one({ deleted: true, id });
  });

  /* --------------------------------- runs -------------------------------- */

  app.post('/requests/:id/run', async (req, reply) => {
    const { id } = req.params as { id: string };
    const request = getRequest(id);
    if (!request) return notFound(reply, 'API request');

    const body = (req.body ?? {}) as Body;
    const vars = {
      ...environmentVariables(pickString(body, 'environment_id')),
      ...((body.variables as Record<string, unknown>) ?? {}),
    };

    try {
      const result = await runApiRequestById(
        id,
        {
          dry_run: body.dry_run === true,
          environment_id: pickString(body, 'environment_id') ?? null,
          timeout_ms: typeof body.timeout_ms === 'number' ? body.timeout_ms : undefined,
          overrides: (body.overrides as Record<string, unknown>) ?? undefined,
        },
        vars,
      );
      return reply.send(one(result));
    } catch (err) {
      return engineFail(reply, err);
    }
  });

  app.post('/collections/:collectionId/run', async (req, reply) => {
    const { collectionId } = req.params as { collectionId: string };
    const coll = getCollection(collectionId);
    if (!coll) return notFound(reply, 'Collection');

    const body = (req.body ?? {}) as Body;
    const vars = {
      ...environmentVariables(pickString(body, 'environment_id')),
      ...((body.variables as Record<string, unknown>) ?? {}),
    };
    const rows = listRequests(collectionId);

    const results: Array<{ id: string; name: string; status: string; duration_ms: number; error: string | null }> = [];
    for (const row of rows) {
      try {
        const res = await runApiRequestById(
          row.id,
          { dry_run: body.dry_run === true, environment_id: pickString(body, 'environment_id') ?? null, run_id: null },
          vars,
        );
        results.push({
          id: row.id,
          name: row.name,
          status: res.status,
          duration_ms: res.duration_ms,
          error: res.error,
        });
      } catch (err) {
        results.push({
          id: row.id,
          name: row.name,
          status: err instanceof EngineError && err.status === 502 ? 'blocked' : 'failed',
          duration_ms: 0,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const passed = results.filter((r) => r.status === 'passed').length;
    return one({
      collection_id: collectionId,
      total: results.length,
      passed,
      failed: results.filter((r) => r.status === 'failed').length,
      blocked: results.filter((r) => r.status === 'blocked').length,
      skipped: results.filter((r) => r.status === 'skipped').length,
      results,
    });
  });

  /* -------------------------------- dry run ------------------------------ */

  app.post('/requests/:id/validate', async (req, reply) => {
    const { id } = req.params as { id: string };
    const request = getRequest(id);
    if (!request) return notFound(reply, 'API request');
    const problems = lintRequest(request);
    return one({ request_id: id, ok: problems.length === 0, problems });
  });

  /* ---------------------------- OpenAPI import --------------------------- */

  const importHandler = async (req: import('fastify').FastifyRequest, reply: FastifyReply) => {
    const params = req.params as { id?: string; collectionId?: string };
    const body = (req.body ?? {}) as Body;

    // Accept either the raw document (`spec`) or an `{ openapi: ... }` payload.
    const raw =
      typeof body.spec === 'string'
        ? body.spec
        : typeof body.openapi === 'string'
          ? body.openapi
          : body.document !== undefined
            ? JSON.stringify(body.document)
            : null;

    if (!raw) {
      return badRequest(
        reply,
        'Kirim dokumen OpenAPI/Swagger JSON pada field "spec" (string), "openapi" (string), atau "document" (objek).',
      );
    }

    const collectionId = params.collectionId ?? params.id ?? pickString(body, 'collection_id');
    const coll = collectionId ? getCollection(collectionId) : undefined;
    if (!coll) return notFound(reply, 'Collection');

    let parsed;
    try {
      parsed = parseOpenApi(raw, coll.base_url);
    } catch (err) {
      return badRequest(reply, err instanceof Error ? err.message : String(err));
    }

    // Optionally persist the base_url discovered from `servers[0].url`.
    const applyBase = body.apply_base_url !== false;
    if (applyBase && parsed.base_url && !coll.base_url) {
      updateCollection(coll.id, { base_url: parsed.base_url });
    }

    const existing = new Set(listRequests(coll.id).map((r) => `${r.method} ${r.path}`));
    const createdIds: string[] = [];
    let skippedExisting = 0;

    for (const op of parsed.operations) {
      if (existing.has(`${op.method} ${op.path}`)) {
        skippedExisting++;
        continue;
      }
      const created = createRequest({
        collection_id: coll.id,
        project_id: coll.project_id,
        name: op.name,
        method: op.method,
        path: op.path,
        headers: op.headers,
        query: op.query,
        body: op.body,
        body_type: op.body_type,
        assertions: op.assertions,
        generated_by: 'import',
      });
      createdIds.push(created.id);
    }

    logActivity({
      project_id: coll.project_id,
      action: 'import',
      entity_kind: 'api_collection',
      entity_id: coll.id,
      summary: `OpenAPI ${parsed.version}: ${createdIds.length} request dibuat`,
    });

    return reply.code(201).send(
      one({
        collection_id: coll.id,
        title: parsed.title,
        version: parsed.version,
        base_url: parsed.base_url,
        created: createdIds.length,
        skipped_existing: skippedExisting,
        skipped_paths: parsed.skipped,
        request_ids: createdIds,
      }),
    );
  };

  app.post('/requests/:id/import-openapi', importHandler);
  app.post('/collections/:collectionId/import-openapi', importHandler);
}

/**
 * Static validation for the "Validasi" button — catches the mistakes a user
 * makes before firing a request at a real target.
 */
function lintRequest(request: ApiRequest): Array<{ level: 'error' | 'warn'; field: string; message: string }> {
  const problems: Array<{ level: 'error' | 'warn'; field: string; message: string }> = [];

  if (!request.path?.trim()) problems.push({ level: 'error', field: 'path', message: 'Path belum diisi.' });

  const coll = getCollection(request.collection_id);
  const absolute = /^https?:\/\//i.test(request.path ?? '');
  if (!absolute && !coll?.base_url) {
    problems.push({
      level: 'warn',
      field: 'base_url',
      message: 'Collection belum punya base_url dan path bersifat relatif; panggilan akan gagal.',
    });
  }

  if (hasUnresolved(request.path ?? '')) {
    problems.push({ level: 'warn', field: 'path', message: 'Path masih memuat placeholder {{var}} yang belum terisi.' });
  }

  try {
    JSON.parse(request.headers ?? '{}');
  } catch {
    problems.push({ level: 'error', field: 'headers', message: 'Headers bukan JSON yang valid.' });
  }
  try {
    JSON.parse(request.query ?? '{}');
  } catch {
    problems.push({ level: 'error', field: 'query', message: 'Query bukan JSON yang valid.' });
  }
  try {
    JSON.parse(request.assertions ?? '[]');
  } catch {
    problems.push({ level: 'error', field: 'assertions', message: 'Assertions bukan JSON yang valid.' });
  }

  if (request.body_type === 'json' && request.body?.trim()) {
    try {
      JSON.parse(request.body);
    } catch {
      problems.push({ level: 'warn', field: 'body', message: 'Body diberi tipe JSON tetapi bukan JSON valid.' });
    }
  }

  return problems;
}

export { runApiRequestById };
export type { EngineResult };
