/**
 * webtester module — web automation REST surface, mounted at /api.
 *
 *   GET    /projects/:projectId/web-flows
 *   POST   /projects/:projectId/web-flows
 *   GET    /web-flows/:id
 *   PATCH  /web-flows/:id
 *   DELETE /web-flows/:id
 *   POST   /web-flows/:id/run           (real execution; reports the mode honestly)
 *   POST   /web-flows/:id/record-hint   (fetch URL → SUGGESTED steps + selectors)
 *   GET    /web-modes                   (http vs playwright capability)
 */

import type { FastifyInstance, FastifyReply } from 'fastify';
import type { WebFlow, WebStep } from '@qatools/shared';
import { list, one, fail, notFound, badRequest, paging } from '../../lib/http.js';
import { db, findById, insertRow, updateRow, deleteById, logActivity, toJson, parseJson } from '../../db/index.js';
import { EngineError } from '../execute/engine-utils.js';
import { executeWebFlow, parseSteps, recordHint, webModeCapabilities } from './engine.js';

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

/* --------------------------- repository (module-local) -------------------- */

function listFlows(projectId: string): WebFlow[] {
  return db
    .prepare('SELECT * FROM web_flows WHERE project_id = ? ORDER BY created_at ASC')
    .all(projectId) as unknown as WebFlow[];
}

function getFlow(id: string): WebFlow | undefined {
  return findById<WebFlow>('web_flows', id);
}

/** Normalises an incoming steps payload into the frozen WebStep shape. */
function coerceSteps(input: unknown): WebStep[] | null {
  if (input === undefined) return null;
  const parsed = typeof input === 'string' ? safeParse(input) : input;
  if (!Array.isArray(parsed)) return null;
  const out: WebStep[] = [];
  for (const item of parsed) {
    if (item === null || typeof item !== 'object') continue;
    const raw = item as Record<string, unknown>;
    if (typeof raw.action !== 'string') continue;
    const step: WebStep = { action: raw.action as WebStep['action'] };
    if (typeof raw.selector === 'string') step.selector = raw.selector;
    if (typeof raw.value === 'string') step.value = raw.value;
    if (typeof raw.expected === 'string') step.expected = raw.expected;
    if (typeof raw.timeout_ms === 'number') step.timeout_ms = raw.timeout_ms;
    if (typeof raw.description === 'string') step.description = raw.description;
    out.push(step);
  }
  return out;
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export default async function routes(app: FastifyInstance): Promise<void> {
  /* ------------------------------- modes --------------------------------- */

  app.get('/web-modes', async () => {
    const modes = await webModeCapabilities(true);
    const active = modes.find((m) => m.available && m.mode === 'playwright') ? 'playwright' : 'http';
    return one({
      active_mode: active,
      modes,
      note:
        'Mode HTTP selalu aktif dan menjalankan pengambilan halaman + verifikasi nyata terhadap HTML. ' +
        'Mode Playwright hanya aktif bila paket dan peramban dipasang sendiri oleh pengguna.',
    });
  });

  /* -------------------------------- flows -------------------------------- */

  app.get('/projects/:projectId/web-flows', async (req) => {
    const { projectId } = req.params as { projectId: string };
    const { limit, offset } = paging(req.query as Record<string, unknown>);
    const all = listFlows(projectId);
    return list(all.slice(offset, offset + limit), all.length);
  });

  app.post('/projects/:projectId/web-flows', async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    const body = (req.body ?? {}) as Body;
    const name = str(body, 'name');
    if (!name) return badRequest(reply, 'Field "name" wajib diisi');

    const steps = coerceSteps(body.steps);
    if (!steps) return badRequest(reply, 'Field "steps" harus berupa array WebStep.');
    if (!steps.length) return badRequest(reply, 'Flow harus punya minimal satu langkah.');

    const id = insertRow(
      'web_flows',
      {
        project_id: projectId,
        test_case_id: str(body, 'test_case_id') ?? null,
        name,
        start_url: str(body, 'start_url') ?? null,
        steps: toJson(steps),
        viewport: body.viewport === undefined ? null : toJson(body.viewport),
        generated_by: str(body, 'generated_by') ?? 'manual',
      },
      'wbf_',
    );
    const created = getFlow(id) as WebFlow;
    logActivity({ project_id: projectId, action: 'create', entity_kind: 'web_flow', entity_id: id, summary: name });
    return reply.code(201).send(one(created));
  });

  app.get('/web-flows/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const flow = getFlow(id);
    if (!flow) return notFound(reply, 'Web flow');
    return one({ ...flow, parsed_steps: parseSteps(flow.steps) });
  });

  app.patch('/web-flows/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!getFlow(id)) return notFound(reply, 'Web flow');
    const body = (req.body ?? {}) as Body;
    const patch: Record<string, unknown> = {};
    for (const key of ['name', 'start_url', 'test_case_id'] as const) {
      if (body[key] !== undefined) patch[key] = body[key];
    }
    if (body.steps !== undefined) {
      const steps = coerceSteps(body.steps);
      if (!steps) return badRequest(reply, 'Field "steps" harus berupa array WebStep.');
      patch.steps = toJson(steps);
    }
    if (body.viewport !== undefined) patch.viewport = toJson(body.viewport);
    updateRow('web_flows', id, patch);
    return one(getFlow(id));
  });

  app.delete('/web-flows/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!getFlow(id)) return notFound(reply, 'Web flow');
    deleteById('web_flows', id);
    return one({ deleted: true, id });
  });

  /* --------------------------------- run --------------------------------- */

  app.post('/web-flows/:id/run', async (req, reply) => {
    const { id } = req.params as { id: string };
    const flow = getFlow(id);
    if (!flow) return notFound(reply, 'Web flow');

    const body = (req.body ?? {}) as Body;
    let vars: Record<string, unknown> = {};
    const envId = str(body, 'environment_id');
    if (envId) {
      try {
        const row = db.prepare('SELECT variables FROM environments WHERE id = ?').get(envId) as
          | { variables: string | null }
          | undefined;
        vars = parseJson<Record<string, unknown>>(row?.variables ?? null, {}) ?? {};
      } catch {
        vars = {};
      }
    }

    try {
      const result = await executeWebFlow(flow, {
        dry_run: body.dry_run === true,
        environment_id: envId ?? null,
        timeout_ms: typeof body.timeout_ms === 'number' ? body.timeout_ms : undefined,
        overrides: (body.overrides as Record<string, unknown>) ?? undefined,
        vars,
      });

      if (body.dry_run !== true) {
        try {
          updateRow('web_flows', id, { last_status: result.status, last_run_at: new Date().toISOString() });
        } catch {
          /* metadata persistence must not fail the run */
        }
      }

      return reply.send(one(result));
    } catch (err) {
      return engineFail(reply, err);
    }
  });

  /* ----------------------------- record hint ----------------------------- */

  const hintHandler = async (req: import('fastify').FastifyRequest, reply: FastifyReply) => {
    const params = req.params as { id?: string };
    const body = (req.body ?? {}) as Body;

    let url = str(body, 'url') ?? str(body, 'start_url') ?? '';
    if (!url && params.id) {
      const flow = getFlow(params.id);
      if (!flow) return notFound(reply, 'Web flow');
      url = flow.start_url ?? '';
    }
    if (!url.trim()) {
      return badRequest(reply, 'Sertakan "url" pada body, atau simpan start_url pada flow terlebih dahulu.');
    }

    try {
      const hint = await recordHint(url.trim(), {
        timeout_ms: typeof body.timeout_ms === 'number' ? body.timeout_ms : undefined,
        max_elements: typeof body.max_elements === 'number' ? body.max_elements : undefined,
      });
      return reply.send(one(hint));
    } catch (err) {
      return engineFail(reply, err);
    }
  };

  app.post('/web-flows/:id/record-hint', hintHandler);
  app.post('/web-flows/record-hint', hintHandler);
}
