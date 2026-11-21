/**
 * defects module — lifecycle stage 9 (catat, triase, lacak defect).
 *
 * Routes (mounted at /api):
 *   GET    /projects/:projectId/defects            ?status=&severity=&priority=&search=&open_only=
 *   POST   /projects/:projectId/defects            auto code BUG-nnn
 *   GET    /projects/:projectId/defects/stats      by severity/status/age
 *   GET    /defects/:id                            full detail (case + run result + env)
 *   PATCH  /defects/:id
 *   DELETE /defects/:id
 *   PATCH  /defects/:id/status                     legal-transition guard
 *   POST   /defects/:id/promote-from-result        { run_result_id }
 *   POST   /defects/:id/ai-triage                  lane-ai, graceful 503
 */

import type { FastifyInstance } from 'fastify';
import { list, one, fail, notFound, badRequest } from '../../lib/http.js';
import { logActivity, findById, updateRow, toJson, db } from '../../db/index.js';
import {
  listDefects,
  getDefect,
  getDefectDetail,
  createDefect,
  updateDefect,
  removeDefect,
  transitionStatus,
  allowedNext,
  canTransition,
  promoteResult,
  defectStats,
  LEGAL_TRANSITIONS,
} from './repo.js';

const SEVERITIES = ['cosmetic', 'minor', 'major', 'critical', 'blocker'];
const PRIORITIES = ['low', 'medium', 'high', 'critical'];
const SOURCES = ['manual', 'api', 'web', 'db', 'ai', 'regression', 'exploratory'];

function asString(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  return s ? s : undefined;
}

interface TriageShape {
  severity?: string;
  priority?: string;
  component?: string;
  likely_root_cause?: string;
  reproduction_hint?: string;
  suggested_owner_role?: string;
  duplicate_risk?: string;
  rationale?: string;
}

export default async function routes(app: FastifyInstance): Promise<void> {
  /* --------------------------------- list ---------------------------------- */

  app.get<{
    Params: { projectId: string };
    Querystring: {
      status?: string;
      severity?: string;
      priority?: string;
      source?: string;
      test_case_id?: string;
      assignee?: string;
      search?: string;
      open_only?: string;
    };
  }>('/projects/:projectId/defects', async (req) => {
    const q = req.query ?? {};
    return list(
      listDefects(req.params.projectId, {
        status: asString(q.status),
        severity: asString(q.severity),
        priority: asString(q.priority),
        source: asString(q.source),
        test_case_id: asString(q.test_case_id),
        assignee: asString(q.assignee),
        search: asString(q.search),
        open_only: q.open_only === '1' || q.open_only === 'true',
      }),
    );
  });

  app.get<{ Params: { projectId: string } }>('/projects/:projectId/defects/stats', async (req) =>
    one(defectStats(req.params.projectId)),
  );

  /* -------------------------------- create --------------------------------- */

  app.post<{ Params: { projectId: string }; Body: Record<string, unknown> }>(
    '/projects/:projectId/defects',
    async (req, reply) => {
      const body = req.body ?? {};
      const title = asString(body.title);
      if (!title) return badRequest(reply, 'title wajib diisi');
      const severity = asString(body.severity);
      if (severity && !SEVERITIES.includes(severity)) {
        return badRequest(reply, `severity harus salah satu dari: ${SEVERITIES.join(', ')}`);
      }
      const priority = asString(body.priority);
      if (priority && !PRIORITIES.includes(priority)) {
        return badRequest(reply, `priority harus salah satu dari: ${PRIORITIES.join(', ')}`);
      }
      const source = asString(body.source);
      if (source && !SOURCES.includes(source)) {
        return badRequest(reply, `source harus salah satu dari: ${SOURCES.join(', ')}`);
      }
      const row = createDefect({
        project_id: req.params.projectId,
        code: asString(body.code) ?? null,
        title,
        description: asString(body.description) ?? null,
        steps_to_reproduce: asString(body.steps_to_reproduce) ?? null,
        expected_result: asString(body.expected_result) ?? null,
        actual_result: asString(body.actual_result) ?? null,
        severity: severity ?? null,
        priority: priority ?? null,
        source: source ?? null,
        test_case_id: asString(body.test_case_id) ?? null,
        run_result_id: asString(body.run_result_id) ?? null,
        environment_id: asString(body.environment_id) ?? null,
        assignee: asString(body.assignee) ?? null,
        reporter: asString(body.reporter) ?? null,
        found_in_cycle_id: asString(body.found_in_cycle_id) ?? null,
        fixed_in_build: asString(body.fixed_in_build) ?? null,
        is_escaped: body.is_escaped,
      });
      logActivity({
        project_id: req.params.projectId,
        action: 'defect.create',
        entity_kind: 'defect',
        entity_id: row.id,
        summary: `${row.code} dibuat: ${row.title}`,
      });
      return reply.code(201).send(one(row));
    },
  );

  /* -------------------------------- detail --------------------------------- */

  app.get<{ Params: { id: string } }>('/defects/:id', async (req, reply) => {
    const row = getDefectDetail(req.params.id);
    if (!row) return notFound(reply, 'Defect');
    return one({ ...row, allowed_next: allowedNext(row.status) });
  });

  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>('/defects/:id', async (req, reply) => {
    const row = updateDefect(req.params.id, req.body ?? {});
    if (!row) return notFound(reply, 'Defect');
    return one(row);
  });

  app.delete<{ Params: { id: string } }>('/defects/:id', async (req, reply) => {
    const existing = getDefect(req.params.id);
    if (!existing) return notFound(reply, 'Defect');
    removeDefect(req.params.id);
    return one({ id: req.params.id, deleted: true });
  });

  /* ------------------------- status transition guard ----------------------- */

  app.get<{ Params: { id: string } }>('/defects/:id/transitions', async (req, reply) => {
    const defect = getDefect(req.params.id);
    if (!defect) return notFound(reply, 'Defect');
    return one({
      status: defect.status,
      allowed_next: allowedNext(defect.status),
      matrix: LEGAL_TRANSITIONS,
    });
  });

  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/defects/:id/status',
    async (req, reply) => {
      const body = req.body ?? {};
      const to = asString(body.status) ?? asString(body.to);
      if (!to) return badRequest(reply, 'status wajib diisi');

      const defect = getDefect(req.params.id);
      if (!defect) return notFound(reply, 'Defect');

      if (defect.status === to) {
        return badRequest(reply, `Defect sudah berstatus ${to}`);
      }
      if (!canTransition(defect.status, to)) {
        return fail(
          reply,
          409,
          'illegal_transition',
          `Transisi ${defect.status} → ${to} tidak diizinkan oleh alur defect`,
          { from: defect.status, to, allowed_next: allowedNext(defect.status) },
        );
      }

      const res = transitionStatus(req.params.id, to, {
        assignee: asString(body.assignee) ?? null,
        fixed_in_build: asString(body.fixed_in_build) ?? null,
        note: asString(body.note) ?? null,
      });
      if (!res.ok) {
        return res.code === 'not_found'
          ? notFound(reply, 'Defect')
          : fail(reply, 409, res.code, res.message, { allowed_next: res.allowed });
      }

      logActivity({
        project_id: res.defect.project_id,
        action: 'defect.status',
        entity_kind: 'defect',
        entity_id: res.defect.id,
        summary: `${res.defect.code}: ${defect.status} → ${to}`,
      });
      return one({ ...res.defect, allowed_next: allowedNext(res.defect.status) });
    },
  );

  /* --------------------------- promote from result ------------------------- */

  app.post<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/defects/:id/promote-from-result',
    async (req, reply) => {
      // `:id` may be either a defect id or the literal `new` for "create from this result".
      const runResultId = asString(req.body?.run_result_id);
      if (!runResultId) return badRequest(reply, 'run_result_id wajib diisi');
      if (!findById('run_results', runResultId)) return notFound(reply, 'Run result');

      const res = promoteResult(runResultId, {
        severity: asString(req.body?.severity),
        priority: asString(req.body?.priority),
        title: asString(req.body?.title),
        description: asString(req.body?.description),
        assignee: asString(req.body?.assignee),
      });
      if (!res.ok) {
        return res.code === 'not_found' ? notFound(reply, res.message) : badRequest(reply, res.message);
      }

      const linkedToRequested = req.params.id === 'new' || req.params.id === res.data.defect.id;
      logActivity({
        project_id: res.data.defect.project_id,
        action: 'defect.promote',
        entity_kind: 'defect',
        entity_id: res.data.defect.id,
        summary: `${res.data.defect.code} dibuat dari run result ${runResultId}`,
      });
      return reply.code(201).send(one({ ...res.data, linked_to_requested: linkedToRequested }));
    },
  );

  /** Bulk promote every failed result of a run that has no defect yet. */
  app.post<{ Params: { projectId: string }; Body: Record<string, unknown> }>(
    '/projects/:projectId/defects/promote-failures',
    async (req, reply) => {
      const runId = asString(req.body?.run_id);
      if (!runId) return badRequest(reply, 'run_id wajib diisi');
      const run = findById<{ id: string }>('test_runs', runId);
      if (!run) return notFound(reply, 'Test run');

      const failed = db
        .prepare("SELECT id FROM run_results WHERE run_id = ? AND status = 'failed' AND defect_id IS NULL")
        .all(runId) as Array<{ id: string }>;

      const created: string[] = [];
      for (const row of failed) {
        const res = promoteResult(row.id, { reporter: asString(req.body?.reporter) });
        if (res.ok) created.push(res.data.defect.id);
      }
      return reply.code(201).send(one({ created: created.length, defect_ids: created }));
    },
  );

  /* ------------------------------- ai triage ------------------------------- */

  app.post<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/defects/:id/ai-triage',
    async (req, reply) => {
      const defect = getDefect(req.params.id);
      if (!defect) return notFound(reply, 'Defect');

      // The AI module is owned by lane-ai and may not exist yet: dynamic import + graceful 503.
      // The specifier is built at runtime so TypeScript does not require the module to exist
      // before lane-ai lands; the import itself is still fully dynamic.
      let aiService: {
        generate: <T>(task: string, input: Record<string, unknown>, ctx?: Record<string, unknown>) => Promise<{
          ok: boolean;
          data: T | null;
          error: string | null;
          meta: Record<string, unknown>;
        }>;
      };
      try {
        const dynamicImport = new Function('specifier', 'return import(specifier)') as (
          specifier: string,
        ) => Promise<{ aiService?: typeof aiService }>;
        const mod = await dynamicImport('../ai/index.js');
        if (!mod.aiService || typeof mod.aiService.generate !== 'function') {
          throw new Error('aiService tidak tersedia');
        }
        aiService = mod.aiService;
      } catch (err) {
        return fail(
          reply,
          503,
          'ai_unavailable',
          `Layanan AI belum tersedia: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      let result: { ok: boolean; data: TriageShape | null; error: string | null; meta: Record<string, unknown> };
      try {
        result = await aiService.generate<TriageShape>(
          'triage_defect',
          {
            title: defect.title,
            description: defect.description,
            actual_result: defect.actual_result,
            expected_result: defect.expected_result,
            steps_to_reproduce: defect.steps_to_reproduce,
            severity: defect.severity,
            priority: defect.priority,
          },
          { project_id: defect.project_id, input_ref: defect.id },
        );
      } catch (err) {
        return fail(
          reply,
          502,
          'ai_failed',
          `Triase AI gagal: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      if (!result.ok || !result.data) {
        return fail(reply, 502, 'ai_failed', result.error ?? 'AI tidak mengembalikan hasil triase');
      }

      const payload = {
        ...result.data,
        generated_at: new Date().toISOString(),
        meta: result.meta,
      };
      updateRow('defects', defect.id, { ai_triage: toJson(payload) });
      logActivity({
        project_id: defect.project_id,
        action: 'defect.ai_triage',
        entity_kind: 'defect',
        entity_id: defect.id,
        summary: `Triase AI dijalankan untuk ${defect.code}`,
      });

      const suggestions: Record<string, unknown> = {};
      if (asString(req.body?.apply) === 'true' || req.body?.apply === true) {
        if (payload.severity && SEVERITIES.includes(String(payload.severity))) {
          suggestions.severity = payload.severity;
        }
        if (payload.priority && PRIORITIES.includes(String(payload.priority))) {
          suggestions.priority = payload.priority;
        }
        if (Object.keys(suggestions).length) updateDefect(defect.id, suggestions);
      }

      return one({
        defect: getDefect(defect.id),
        triage: payload,
        applied: suggestions,
      });
    },
  );
}
