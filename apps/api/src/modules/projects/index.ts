/**
 * Projects module — CRUD for the top-level QA project.
 * Registered by the Lead in server.ts under the `/api` prefix.
 */

import type { FastifyInstance } from 'fastify';
import { db, logActivity } from '../../db/index.js';
import { list, one, badRequest, notFound, conflict, paging } from '../../lib/http.js';
import {
  listProjects,
  getProject,
  getProjectByKey,
  createProject,
  updateProject,
  deleteProject,
  projectArtifactCounts,
  createDefaultEnvironment,
  countEnvironments,
} from './repo.js';

const PROJECT_STATUSES = ['active', 'on_hold', 'archived'] as const;

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

function normaliseKey(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 24);
}

export default async function routes(app: FastifyInstance): Promise<void> {
  /* ---------------------------------- list --------------------------------- */
  app.get('/projects', async (req) => {
    const query = req.query as Record<string, unknown>;
    const { limit, offset } = paging(query, 200);
    const rows = listProjects({
      status: typeof query.status === 'string' && query.status ? query.status : undefined,
      q: typeof query.q === 'string' && query.q ? query.q : undefined,
    });
    const page = rows.slice(offset, offset + limit);
    const withCounts = page.map((p) => ({ ...p, counts: projectArtifactCounts(p.id) }));
    return list(withCounts, rows.length);
  });

  /* --------------------------------- create -------------------------------- */
  app.post('/projects', async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const key = normaliseKey(String(body.key ?? ''));
    const name = str(body.name);

    if (!key) return badRequest(reply, 'Key project wajib diisi (contoh: SHOP).');
    if (!name) return badRequest(reply, 'Nama project wajib diisi.');
    if (getProjectByKey(key)) return conflict(reply, `Project dengan key "${key}" sudah ada.`);

    const gateRaw = Number(body.quality_gate ?? 90);
    const quality_gate = Number.isFinite(gateRaw) ? Math.max(0, Math.min(100, gateRaw)) : 90;
    const status = PROJECT_STATUSES.includes(body.status as never)
      ? String(body.status)
      : 'active';

    const id = createProject({
      key,
      name,
      description: str(body.description),
      target_url: str(body.target_url),
      repo_url: str(body.repo_url),
      owner: str(body.owner),
      status,
      quality_gate,
      metadata: str(body.metadata),
    });

    // Every project starts with one usable environment so execution has a target.
    const envId = createDefaultEnvironment(id, name, str(body.target_url));

    logActivity({
      project_id: id,
      actor: 'lane-docs',
      action: 'create',
      entity_kind: 'project',
      entity_id: id,
      summary: `Project ${key} dibuat`,
    });

    return reply.code(201).send(one({ ...getProject(id), default_environment_id: envId }));
  });

  /* ---------------------------------- read --------------------------------- */
  app.get('/projects/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const project = getProject(id);
    if (!project) return notFound(reply, 'Project');
    return one({
      ...project,
      counts: projectArtifactCounts(id),
      environments: db
        .prepare('SELECT * FROM environments WHERE project_id = ? ORDER BY is_default DESC, name')
        .all(id),
    });
  });

  /* --------------------------------- update -------------------------------- */
  app.patch('/projects/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const project = getProject(id);
    if (!project) return notFound(reply, 'Project');

    const body = (req.body ?? {}) as Record<string, unknown>;
    const patch: Record<string, unknown> = {};

    if (body.key !== undefined) {
      const key = normaliseKey(String(body.key));
      if (!key) return badRequest(reply, 'Key project tidak boleh kosong.');
      const existing = getProjectByKey(key);
      if (existing && existing.id !== id) return conflict(reply, `Project dengan key "${key}" sudah ada.`);
      patch.key = key;
    }
    if (body.name !== undefined) {
      const name = str(body.name);
      if (!name) return badRequest(reply, 'Nama project tidak boleh kosong.');
      patch.name = name;
    }
    for (const field of ['description', 'target_url', 'repo_url', 'owner'] as const) {
      if (body[field] !== undefined) patch[field] = str(body[field]);
    }
    if (body.status !== undefined) {
      if (!PROJECT_STATUSES.includes(body.status as never)) {
        return badRequest(reply, `Status tidak valid. Pilihan: ${PROJECT_STATUSES.join(', ')}.`);
      }
      patch.status = String(body.status);
    }
    if (body.quality_gate !== undefined) {
      const gate = Number(body.quality_gate);
      if (!Number.isFinite(gate)) return badRequest(reply, 'quality_gate harus berupa angka 0–100.');
      patch.quality_gate = Math.max(0, Math.min(100, gate));
    }
    if (body.metadata !== undefined) patch.metadata = str(body.metadata);

    if (Object.keys(patch).length) {
      updateProject(id, patch);
      logActivity({
        project_id: id,
        actor: 'lane-docs',
        action: 'update',
        entity_kind: 'project',
        entity_id: id,
        summary: `Project ${project.key} diperbarui`,
      });
    }

    return one(getProject(id));
  });

  /* --------------------------------- delete -------------------------------- */
  app.delete('/projects/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const project = getProject(id);
    if (!project) return notFound(reply, 'Project');

    const force = String((req.query as Record<string, unknown>).force ?? '') === 'true';
    const counts = projectArtifactCounts(id);
    const total = counts.requirements + counts.use_cases + counts.scenarios + counts.test_cases;
    if (total > 0 && !force) {
      return conflict(
        reply,
        `Project "${project.key}" masih memiliki ${total} artefak. Hapus dengan ?force=true bila yakin.`,
      );
    }

    deleteProject(id);
    logActivity({
      project_id: null,
      actor: 'lane-docs',
      action: 'delete',
      entity_kind: 'project',
      entity_id: id,
      summary: `Project ${project.key} dihapus`,
    });
    return one({ id, deleted: true, cascaded: counts });
  });

  /* --------------------------- stats for the cards -------------------------- */
  app.get('/projects/:id/stats', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!getProject(id)) return notFound(reply, 'Project');
    const counts = projectArtifactCounts(id);
    const coverage = db
      .prepare(
        `SELECT COUNT(*) AS n FROM requirements r
          WHERE r.project_id = ?
            AND EXISTS (SELECT 1 FROM matrix_links m
                         WHERE m.link_type = 'requirement_to_usecase' AND m.from_id = r.id)`,
      )
      .get(id) as { n: number } | undefined;
    return one({
      ...counts,
      environments: countEnvironments(id),
      covered_requirements: Number(coverage?.n ?? 0),
    });
  });
}
