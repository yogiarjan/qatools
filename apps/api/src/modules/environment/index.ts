/**
 * environment module — lifecycle stage 7 (Environment & Test Data).
 *
 * Routes (mounted at /api):
 *   GET    /projects/:projectId/environments
 *   POST   /projects/:projectId/environments
 *   GET    /environments/:id
 *   PATCH  /environments/:id
 *   DELETE /environments/:id
 *   POST   /environments/:id/default          -> single default per project
 *   GET    /projects/:projectId/testdata
 *   POST   /projects/:projectId/testdata
 *   GET    /testdata/:id
 *   PATCH  /testdata/:id
 *   DELETE /testdata/:id
 */

import type { FastifyInstance } from 'fastify';
import { list, one, notFound, badRequest } from '../../lib/http.js';
import { logActivity } from '../../db/index.js';
import {
  listEnvironments,
  createEnvironment,
  getEnvironment,
  updateEnvironment,
  removeEnvironment,
  markDefault,
  listDataSets,
  createDataSet,
  getDataSet,
  updateDataSet,
  removeDataSet,
  ENVIRONMENT_KINDS,
} from './repo.js';

function asString(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  return s ? s : undefined;
}

export default async function routes(app: FastifyInstance): Promise<void> {
  /* ----------------------------- environments ---------------------------- */

  app.get<{ Params: { projectId: string } }>('/projects/:projectId/environments', async (req) =>
    list(listEnvironments(req.params.projectId)),
  );

  app.post<{ Params: { projectId: string }; Body: Record<string, unknown> }>(
    '/projects/:projectId/environments',
    async (req, reply) => {
      const body = req.body ?? {};
      const name = asString(body.name);
      if (!name) return badRequest(reply, 'name wajib diisi');
      const kind = asString(body.kind);
      if (kind && !(ENVIRONMENT_KINDS as readonly string[]).includes(kind)) {
        return badRequest(reply, `kind harus salah satu dari: ${ENVIRONMENT_KINDS.join(', ')}`);
      }
      const row = createEnvironment({
        project_id: req.params.projectId,
        name,
        base_url: asString(body.base_url) ?? null,
        db_uri: asString(body.db_uri) ?? null,
        api_base: asString(body.api_base) ?? null,
        kind: kind ?? null,
        variables: body.variables,
        is_default: body.is_default,
        notes: asString(body.notes) ?? null,
      });
      logActivity({
        project_id: req.params.projectId,
        action: 'environment.create',
        entity_kind: 'environment',
        entity_id: row.id,
        summary: `Environment ${row.name} dibuat`,
      });
      return reply.code(201).send(one(row));
    },
  );

  app.get<{ Params: { id: string } }>('/environments/:id', async (req, reply) => {
    const row = getEnvironment(req.params.id);
    if (!row) return notFound(reply, 'Environment');
    return one(row);
  });

  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/environments/:id',
    async (req, reply) => {
      const row = updateEnvironment(req.params.id, req.body ?? {});
      if (!row) return notFound(reply, 'Environment');
      return one(row);
    },
  );

  app.delete<{ Params: { id: string } }>('/environments/:id', async (req, reply) => {
    const existing = getEnvironment(req.params.id);
    if (!existing) return notFound(reply, 'Environment');
    removeEnvironment(req.params.id);
    // Never leave a project without a default when another environment remains.
    if (existing.is_default) {
      const rest = listEnvironments(existing.project_id);
      if (rest.length) markDefault(rest[0]!.id);
    }
    return one({ id: req.params.id, deleted: true });
  });

  app.post<{ Params: { id: string } }>('/environments/:id/default', async (req, reply) => {
    const row = markDefault(req.params.id);
    if (!row) return notFound(reply, 'Environment');
    logActivity({
      project_id: row.project_id,
      action: 'environment.default',
      entity_kind: 'environment',
      entity_id: row.id,
      summary: `Environment default diubah ke ${row.name}`,
    });
    return one(row);
  });

  /* ----------------------------- test data sets -------------------------- */

  app.get<{ Params: { projectId: string }; Querystring: { environment_id?: string } }>(
    '/projects/:projectId/testdata',
    async (req) => list(listDataSets(req.params.projectId, asString(req.query.environment_id))),
  );

  app.post<{ Params: { projectId: string }; Body: Record<string, unknown> }>(
    '/projects/:projectId/testdata',
    async (req, reply) => {
      const body = req.body ?? {};
      const name = asString(body.name);
      if (!name) return badRequest(reply, 'name wajib diisi');
      const row = createDataSet({
        project_id: req.params.projectId,
        environment_id: asString(body.environment_id) ?? null,
        name,
        description: asString(body.description) ?? null,
        columns: body.columns,
        rows: body.rows,
        generated_by: asString(body.generated_by) ?? 'manual',
      });
      return reply.code(201).send(one(row));
    },
  );

  app.get<{ Params: { id: string } }>('/testdata/:id', async (req, reply) => {
    const row = getDataSet(req.params.id);
    if (!row) return notFound(reply, 'Test data set');
    return one(row);
  });

  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/testdata/:id',
    async (req, reply) => {
      const row = updateDataSet(req.params.id, req.body ?? {});
      if (!row) return notFound(reply, 'Test data set');
      return one(row);
    },
  );

  app.delete<{ Params: { id: string } }>('/testdata/:id', async (req, reply) => {
    const existing = getDataSet(req.params.id);
    if (!existing) return notFound(reply, 'Test data set');
    removeDataSet(req.params.id);
    return one({ id: req.params.id, deleted: true });
  });
}
