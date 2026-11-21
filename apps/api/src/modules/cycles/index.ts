/**
 * cycles module — lifecycle stage 6 (QA perencanaan proyek: cycle, sprint, scope) + gantt plan.
 *
 * Routes (mounted at /api):
 *   GET    /projects/:projectId/cycles
 *   POST   /projects/:projectId/cycles
 *   GET    /cycles/:id
 *   PATCH  /cycles/:id
 *   DELETE /cycles/:id
 *   GET    /cycles/:cycleId/sprints
 *   POST   /cycles/:cycleId/sprints
 *   GET    /sprints/:id
 *   PATCH  /sprints/:id
 *   DELETE /sprints/:id
 *   POST   /sprints/:id/scope            { test_case_ids: [], assignee?, estimate_minutes? }
 *   GET    /sprints/:id/scope
 *   PATCH  /sprint-scope/:id
 *   DELETE /sprint-scope/:id
 *   GET    /projects/:projectId/plan      planned vs actual effort + gantt-friendly rows
 */

import type { FastifyInstance } from 'fastify';
import { list, one, notFound, badRequest } from '../../lib/http.js';
import { db, logActivity } from '../../db/index.js';
import {
  listCycles,
  createCycle,
  getCycle,
  updateCycle,
  removeCycle,
  listSprints,
  createSprint,
  getSprint,
  updateSprint,
  removeSprint,
  listScope,
  addScope,
  updateScopeItem,
  removeScopeItem,
  removeScopeByCase,
  buildPlan,
  CYCLE_STATUSES,
  SPRINT_STATUSES,
  SCOPE_STATUSES,
} from './repo.js';

function asString(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  return s ? s : undefined;
}

function idList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x)).filter(Boolean);
}

function assertEnum(
  value: unknown,
  allowed: readonly string[],
  field: string,
): { ok: true; value?: string } | { ok: false; message: string } {
  if (value === undefined || value === null || value === '') return { ok: true };
  const s = String(value);
  if (!allowed.includes(s)) return { ok: false, message: `${field} harus salah satu dari: ${allowed.join(', ')}` };
  return { ok: true, value: s };
}

export default async function routes(app: FastifyInstance): Promise<void> {
  /* --------------------------------- cycles -------------------------------- */

  app.get<{ Params: { projectId: string } }>('/projects/:projectId/cycles', async (req) =>
    list(listCycles(req.params.projectId)),
  );

  app.post<{ Params: { projectId: string }; Body: Record<string, unknown> }>(
    '/projects/:projectId/cycles',
    async (req, reply) => {
      const body = req.body ?? {};
      const name = asString(body.name);
      if (!name) return badRequest(reply, 'name wajib diisi');
      const status = assertEnum(body.status, CYCLE_STATUSES, 'status');
      if (!status.ok) return badRequest(reply, status.message);
      const row = createCycle({
        project_id: req.params.projectId,
        code: asString(body.code) ?? null,
        name,
        goal: asString(body.goal) ?? null,
        start_date: asString(body.start_date) ?? null,
        end_date: asString(body.end_date) ?? null,
        status: status.value ?? null,
        entry_criteria: body.entry_criteria,
        exit_criteria: body.exit_criteria,
      });
      logActivity({
        project_id: req.params.projectId,
        action: 'cycle.create',
        entity_kind: 'cycle',
        entity_id: row.id,
        summary: `Cycle ${row.code} dibuat`,
      });
      return reply.code(201).send(one(row));
    },
  );

  app.get<{ Params: { id: string } }>('/cycles/:id', async (req, reply) => {
    const cycle = getCycle(req.params.id);
    if (!cycle) return notFound(reply, 'Cycle');
    return one({ ...cycle, sprints: listSprints(cycle.id) });
  });

  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>('/cycles/:id', async (req, reply) => {
    const status = assertEnum(req.body?.status, CYCLE_STATUSES, 'status');
    if (!status.ok) return badRequest(reply, status.message);
    const row = updateCycle(req.params.id, req.body ?? {});
    if (!row) return notFound(reply, 'Cycle');
    return one(row);
  });

  app.delete<{ Params: { id: string } }>('/cycles/:id', async (req, reply) => {
    const cycle = getCycle(req.params.id);
    if (!cycle) return notFound(reply, 'Cycle');
    removeCycle(req.params.id);
    return one({ id: req.params.id, deleted: true });
  });

  /* -------------------------------- sprints -------------------------------- */

  app.get<{ Params: { cycleId: string } }>('/cycles/:cycleId/sprints', async (req, reply) => {
    if (!getCycle(req.params.cycleId)) return notFound(reply, 'Cycle');
    return list(listSprints(req.params.cycleId));
  });

  app.post<{ Params: { cycleId: string }; Body: Record<string, unknown> }>(
    '/cycles/:cycleId/sprints',
    async (req, reply) => {
      const cycle = getCycle(req.params.cycleId);
      if (!cycle) return notFound(reply, 'Cycle');
      const body = req.body ?? {};
      const name = asString(body.name);
      if (!name) return badRequest(reply, 'name wajib diisi');
      const status = assertEnum(body.status, SPRINT_STATUSES, 'status');
      if (!status.ok) return badRequest(reply, status.message);
      const row = createSprint({
        cycle_id: cycle.id,
        project_id: cycle.project_id,
        code: asString(body.code) ?? null,
        name,
        goal: asString(body.goal) ?? null,
        start_date: asString(body.start_date) ?? cycle.start_date,
        end_date: asString(body.end_date) ?? cycle.end_date,
        capacity_points: body.capacity_points,
        status: status.value ?? null,
      });
      logActivity({
        project_id: cycle.project_id,
        action: 'sprint.create',
        entity_kind: 'sprint',
        entity_id: row.id,
        summary: `Sprint ${row.code} dibuat di cycle ${cycle.code}`,
      });
      return reply.code(201).send(one(row));
    },
  );

  app.get<{ Params: { id: string } }>('/sprints/:id', async (req, reply) => {
    const sprint = getSprint(req.params.id);
    if (!sprint) return notFound(reply, 'Sprint');
    return one({ ...sprint, scope: listScope(sprint.id) });
  });

  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>('/sprints/:id', async (req, reply) => {
    const status = assertEnum(req.body?.status, SPRINT_STATUSES, 'status');
    if (!status.ok) return badRequest(reply, status.message);
    const row = updateSprint(req.params.id, req.body ?? {});
    if (!row) return notFound(reply, 'Sprint');
    return one(row);
  });

  app.delete<{ Params: { id: string } }>('/sprints/:id', async (req, reply) => {
    const sprint = getSprint(req.params.id);
    if (!sprint) return notFound(reply, 'Sprint');
    removeSprint(req.params.id);
    return one({ id: req.params.id, deleted: true });
  });

  /* ------------------------------ sprint scope ----------------------------- */

  app.get<{ Params: { id: string } }>('/sprints/:id/scope', async (req, reply) => {
    if (!getSprint(req.params.id)) return notFound(reply, 'Sprint');
    return list(listScope(req.params.id));
  });

  app.post<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/sprints/:id/scope',
    async (req, reply) => {
      const sprint = getSprint(req.params.id);
      if (!sprint) return notFound(reply, 'Sprint');
      const body = req.body ?? {};

      // Two accepted shapes: { test_case_ids: [] } (bulk, from the picker) or { test_case_id }.
      const ids = idList(body.test_case_ids);
      const single = asString(body.test_case_id);
      if (single) ids.push(single);
      if (!ids.length) return badRequest(reply, 'test_case_ids wajib berisi minimal satu test case');

      const found = ids.filter((id) =>
        Boolean(db.prepare('SELECT 1 FROM test_cases WHERE id = ?').get(id)),
      );
      const missing = ids.filter((id) => !found.includes(id));
      if (!found.length) {
        return badRequest(reply, 'Tidak ada test case valid pada test_case_ids', { missing });
      }
      if (missing.length) {
        return badRequest(reply, `Test case tidak ditemukan: ${missing.join(', ')}`, { missing });
      }

      const status = assertEnum(body.status, SCOPE_STATUSES, 'status');
      if (!status.ok) return badRequest(reply, status.message);

      const rows = addScope(
        sprint.id,
        found.map((test_case_id) => ({
          test_case_id,
          assignee: asString(body.assignee) ?? null,
          estimate_minutes: body.estimate_minutes,
          status: status.value ?? null,
        })),
      );
      logActivity({
        project_id: sprint.project_id,
        action: 'sprint.scope.add',
        entity_kind: 'sprint',
        entity_id: sprint.id,
        summary: `${found.length} test case ditambahkan ke scope ${sprint.code}`,
      });
      return reply.code(201).send(list(rows));
    },
  );

  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/sprint-scope/:id',
    async (req, reply) => {
      const status = assertEnum(req.body?.status, SCOPE_STATUSES, 'status');
      if (!status.ok) return badRequest(reply, status.message);
      const row = updateScopeItem(req.params.id, req.body ?? {});
      if (!row) return notFound(reply, 'Sprint scope');
      return one(row);
    },
  );

  app.delete<{ Params: { id: string } }>('/sprint-scope/:id', async (req, reply) => {
    const existing = db.prepare('SELECT id FROM sprint_scope WHERE id = ?').get(req.params.id);
    if (!existing) return notFound(reply, 'Sprint scope');
    removeScopeItem(req.params.id);
    return one({ id: req.params.id, deleted: true });
  });

  /** Convenience for the UI: remove by (sprint_id, test_case_id). */
  app.delete<{ Params: { id: string }; Querystring: { test_case_id?: string } }>(
    '/sprints/:id/scope',
    async (req, reply) => {
      const sprint = getSprint(req.params.id);
      if (!sprint) return notFound(reply, 'Sprint');
      const testCaseId = asString(req.query.test_case_id);
      if (!testCaseId) return badRequest(reply, 'query test_case_id wajib diisi');
      const changes = removeScopeByCase(sprint.id, testCaseId);
      if (!changes) return notFound(reply, 'Sprint scope');
      return one({ sprint_id: sprint.id, test_case_id: testCaseId, deleted: true });
    },
  );

  /* ---------------------------------- plan --------------------------------- */

  app.get<{ Params: { projectId: string } }>('/projects/:projectId/plan', async (req) =>
    one(buildPlan(req.params.projectId)),
  );
}
