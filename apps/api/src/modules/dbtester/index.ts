/**
 * dbtester module — database testing REST surface, mounted at /api.
 *
 *   GET    /projects/:projectId/db-connections          (dsn masked, raw dsn NEVER returned)
 *   POST   /projects/:projectId/db-connections
 *   GET    /db-connections/:id
 *   PATCH  /db-connections/:id
 *   DELETE /db-connections/:id
 *   POST   /db-connections/:id/test                     (connectivity probe)
 *   GET    /db-connections/:id/schema                   (sqlite schema browser)
 *   GET    /projects/:projectId/db-checks
 *   POST   /projects/:projectId/db-checks
 *   GET    /db-checks/:id
 *   PATCH  /db-checks/:id
 *   DELETE /db-checks/:id
 *   POST   /db-checks/:id/run                           (setup → sql → assertions → teardown)
 *   POST   /db-checks/:id/explain
 *   GET    /db-check-dialects                           (honest dialect capability matrix)
 */

import type { FastifyInstance, FastifyReply } from 'fastify';
import { list, one, fail, notFound, badRequest, paging } from '../../lib/http.js';
import { logActivity } from '../../db/index.js';
import { EngineError } from '../execute/engine-utils.js';
import { analyzeSql } from './guard.js';
import {
  type SchemaTable,
  dialectCapability,
  executeDbCheck,
  explainCheck,
  readSchema,
  renderRowsAsText,
  testConnection,
} from './engine.js';
import {
  createCheck,
  createConnection,
  getCheck,
  getConnection,
  listChecks,
  listConnections,
  removeCheck,
  removeConnection,
  toSafeConnection,
  touchCheckRun,
  updateCheck,
  updateConnection,
} from './repo.js';

type Body = Record<string, unknown>;

function engineFail(reply: FastifyReply, err: unknown) {
  if (err instanceof EngineError) return fail(reply, err.status, err.code, err.message, err.details);
  const message = err instanceof Error ? err.message : String(err);
  return fail(reply, 500, 'engine_error', message);
}

function str(body: Body, key: string): string | undefined {
  const v = body[key];
  return typeof v === 'string' ? v : undefined;
}

export default async function routes(app: FastifyInstance): Promise<void> {
  /* ---------------------------- dialect matrix --------------------------- */

  app.get('/db-check-dialects', async () => {
    const dialects = (['sqlite', 'postgres', 'mysql'] as const).map((d) => dialectCapability(d));
    return one({
      dialects,
      fully_working: dialects.filter((d) => d.available).map((d) => d.dialect),
      note: 'Hanya sqlite yang aktif tanpa dependensi tambahan. postgres/mysql memerlukan driver yang dipasang sendiri oleh pengguna.',
    });
  });

  /* ----------------------------- connections ----------------------------- */

  app.get('/projects/:projectId/db-connections', async (req) => {
    const { projectId } = req.params as { projectId: string };
    const { limit, offset } = paging(req.query as Record<string, unknown>);
    const all = listConnections(projectId);
    return list(all.slice(offset, offset + limit).map(toSafeConnection), all.length);
  });

  app.post('/projects/:projectId/db-connections', async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    const body = (req.body ?? {}) as Body;
    const name = str(body, 'name');
    const dsn = str(body, 'dsn');
    if (!name) return badRequest(reply, 'Field "name" wajib diisi');
    if (!dsn) return badRequest(reply, 'Field "dsn" wajib diisi (contoh sqlite: "data/qatools.db")');

    const dialect = str(body, 'dialect') ?? 'sqlite';
    if (!['sqlite', 'postgres', 'mysql'].includes(dialect)) {
      return badRequest(reply, `Dialect "${dialect}" tidak dikenal. Pilih sqlite, postgres, atau mysql.`);
    }

    const created = createConnection({
      project_id: projectId,
      name,
      dialect,
      dsn,
      readonly_guard: body.readonly_guard === undefined ? true : Boolean(body.readonly_guard),
      created_by: str(body, 'created_by') ?? 'system',
    });
    logActivity({ project_id: projectId, action: 'create', entity_kind: 'db_connection', entity_id: created.id, summary: name });
    return reply.code(201).send(one(toSafeConnection(created)));
  });

  app.get('/db-connections/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const conn = getConnection(id);
    if (!conn) return notFound(reply, 'DB connection');
    return one({ ...toSafeConnection(conn), capability: dialectCapability(conn.dialect) });
  });

  app.patch('/db-connections/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!getConnection(id)) return notFound(reply, 'DB connection');
    const updated = updateConnection(id, (req.body ?? {}) as Body);
    return one(updated ? toSafeConnection(updated) : null);
  });

  app.delete('/db-connections/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!getConnection(id)) return notFound(reply, 'DB connection');
    removeConnection(id);
    return one({ deleted: true, id });
  });

  app.post('/db-connections/:id/test', async (req, reply) => {
    const { id } = req.params as { id: string };
    const conn = getConnection(id);
    if (!conn) return notFound(reply, 'DB connection');
    try {
      const result = await testConnection(conn);
      return reply.code(result.ok ? 200 : 502).send(one(result));
    } catch (err) {
      return engineFail(reply, err);
    }
  });

  app.get('/db-connections/:id/schema', async (req, reply) => {
    const { id } = req.params as { id: string };
    const conn = getConnection(id);
    if (!conn) return notFound(reply, 'DB connection');
    try {
      const schema = (await readSchema(conn)) as { dialect: string; tables: SchemaTable[] };
      return one({ connection_id: id, ...schema });
    } catch (err) {
      return engineFail(reply, err);
    }
  });

  /* -------------------------------- checks ------------------------------- */

  app.get('/projects/:projectId/db-checks', async (req) => {
    const { projectId } = req.params as { projectId: string };
    const q = req.query as Record<string, unknown>;
    const connectionId = typeof q.connection_id === 'string' ? q.connection_id : undefined;
    const rows = listChecks(projectId, connectionId);
    return list(rows, rows.length);
  });

  app.post('/projects/:projectId/db-checks', async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    const body = (req.body ?? {}) as Body;

    const connectionId = str(body, 'connection_id');
    if (!connectionId) return badRequest(reply, 'Field "connection_id" wajib diisi');
    const connection = getConnection(connectionId);
    if (!connection) return notFound(reply, 'DB connection');

    const sql = str(body, 'sql');
    if (!sql?.trim()) return badRequest(reply, 'Field "sql" wajib diisi');

    // Warn early (but do not block) when a guarded connection receives a write.
    const guardOn = Number(connection.readonly_guard ?? 1) === 1;
    const analysis = analyzeSql(sql);
    const warning =
      guardOn && !analysis.readonly_safe
        ? `readonly_guard aktif pada connection ini; statement "${analysis.verbs[0] ?? '?'}" akan ditolak saat dijalankan.`
        : null;

    const created = createCheck({
      project_id: projectId,
      connection_id: connectionId,
      test_case_id: str(body, 'test_case_id') ?? null,
      name: str(body, 'name') ?? 'DB Check',
      sql,
      assertions: body.assertions,
      setup_sql: str(body, 'setup_sql') ?? null,
      teardown_sql: str(body, 'teardown_sql') ?? null,
      generated_by: str(body, 'generated_by') ?? 'manual',
    });

    return reply.code(201).send(one(warning ? { ...created, warning } : created));
  });

  app.get('/db-checks/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const check = getCheck(id);
    if (!check) return notFound(reply, 'DB check');
    const connection = getConnection(check.connection_id);
    return one({ ...check, connection: connection ? toSafeConnection(connection) : null });
  });

  app.patch('/db-checks/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!getCheck(id)) return notFound(reply, 'DB check');
    return one(updateCheck(id, (req.body ?? {}) as Body));
  });

  app.delete('/db-checks/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!getCheck(id)) return notFound(reply, 'DB check');
    removeCheck(id);
    return one({ deleted: true, id });
  });

  app.post('/db-checks/:id/run', async (req, reply) => {
    const { id } = req.params as { id: string };
    const check = getCheck(id);
    if (!check) return notFound(reply, 'DB check');
    const connection = getConnection(check.connection_id);
    if (!connection) return notFound(reply, 'DB connection');

    const body = (req.body ?? {}) as Body;

    try {
      const result = await executeDbCheck(check, connection, {
        dry_run: body.dry_run === true,
        timeout_ms: typeof body.timeout_ms === 'number' ? body.timeout_ms : undefined,
        vars: (body.variables as Record<string, unknown>) ?? {},
      });

      // Persist last-run metadata (never for a dry run).
      if (body.dry_run !== true) {
        try {
          touchCheckRun(id, result.status, result.row_count);
        } catch {
          /* metadata persistence must not fail the run */
        }
      }

      return reply.send(
        one({
          ...result,
          result_text: renderRowsAsText(result.columns, result.rows),
        }),
      );
    } catch (err) {
      return engineFail(reply, err);
    }
  });

  app.post('/db-checks/:id/explain', async (req, reply) => {
    const { id } = req.params as { id: string };
    const check = getCheck(id);
    if (!check) return notFound(reply, 'DB check');
    const connection = getConnection(check.connection_id);
    if (!connection) return notFound(reply, 'DB connection');
    try {
      return one(await explainCheck(check, connection));
    } catch (err) {
      return engineFail(reply, err);
    }
  });
}
