/**
 * Use cases module — CRUD + duplicate, with automatic requirement→use case linking.
 *
 * JSON columns (actors, preconditions, postconditions, main_flow, alternate_flows,
 * business_rules) are encoded through `toJson` / decoded through `parseJson`.
 */

import type { FastifyInstance } from 'fastify';
import { db, logActivity, parseJson, toJson } from '../../db/index.js';
import { list, one, badRequest, notFound } from '../../lib/http.js';
import { PRIORITIES, RISK_LEVELS, type Priority, type RiskLevel } from '@qatools/shared';
import { matrixService } from '../matrix/service.js';
import { withTransaction } from '../matrix/tx.js';
import {
  listUseCases,
  getUseCase,
  createUseCase,
  updateUseCase,
  deleteUseCase,
  existingUseCaseCodes,
  descendantsOf,
} from './repo.js';

const UC_STATUSES = ['draft', 'review', 'approved', 'deprecated'] as const;
const GENERATED_BY = ['manual', 'ai', 'import'] as const;

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

function asStringList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x)).filter((x) => x.trim() !== '');
  if (typeof v === 'string' && v.trim()) {
    return v
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

/** Alternate flows are stored as `{ name, steps[] }[]`; plain strings are upgraded. */
function asAlternateFlows(v: unknown): Array<{ name: string; steps: string[] }> {
  if (!Array.isArray(v)) return [];
  return v
    .map((item) => {
      if (typeof item === 'string') return { name: item, steps: [] };
      const obj = item as Record<string, unknown>;
      return {
        name: String(obj.name ?? obj.title ?? 'Alternate flow'),
        steps: asStringList(obj.steps),
      };
    })
    .filter((f) => f.name.trim() !== '');
}

function priority(v: unknown, fallback: Priority = 'medium'): Priority {
  return PRIORITIES.includes(v as never) ? (v as Priority) : fallback;
}

function risk(v: unknown, fallback: RiskLevel = 'medium'): RiskLevel {
  return RISK_LEVELS.includes(v as never) ? (v as RiskLevel) : fallback;
}

/** Expands JSON columns so the web app can render them without re-parsing. */
function decorate(uc: Record<string, unknown>): Record<string, unknown> {
  return {
    ...uc,
    actors_list: parseJson<string[]>(uc.actors, []),
    preconditions_list: parseJson<string[]>(uc.preconditions, []),
    postconditions_list: parseJson<string[]>(uc.postconditions, []),
    main_flow_list: parseJson<string[]>(uc.main_flow, []),
    alternate_flows_list: parseJson<Array<{ name: string; steps: string[] }>>(uc.alternate_flows, []),
    business_rules_list: parseJson<string[]>(uc.business_rules, []),
  };
}

export default async function routes(app: FastifyInstance): Promise<void> {
  const projectExists = (id: string) =>
    Boolean(db.prepare('SELECT id FROM projects WHERE id = ?').get(id));

  /* ---------------------------------- list --------------------------------- */
  app.get('/projects/:projectId/usecases', async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    if (!projectExists(projectId)) return notFound(reply, 'Project');
    const query = req.query as Record<string, unknown>;
    const rows = listUseCases(projectId, {
      priority: typeof query.priority === 'string' ? query.priority : undefined,
      status: typeof query.status === 'string' ? query.status : undefined,
      q: typeof query.q === 'string' ? query.q : undefined,
    });

    const scenarioCount = db.prepare('SELECT COUNT(*) AS n FROM scenarios WHERE use_case_id = ?');
    const testCaseCount = db.prepare('SELECT COUNT(*) AS n FROM test_cases WHERE use_case_id = ?');
    const requirementLinks = db.prepare(
      `SELECT m.from_id AS requirement_id, r.code, r.title
         FROM matrix_links m JOIN requirements r ON r.id = m.from_id
        WHERE m.link_type = 'requirement_to_usecase' AND m.to_id = ?`,
    );

    return list(
      rows.map((uc) => ({
        ...decorate(uc as unknown as Record<string, unknown>),
        scenario_count: Number((scenarioCount.get(uc.id) as { n: number } | undefined)?.n ?? 0),
        test_case_count: Number((testCaseCount.get(uc.id) as { n: number } | undefined)?.n ?? 0),
        requirements: requirementLinks.all(uc.id),
      })),
      rows.length,
    );
  });

  /* --------------------------------- create -------------------------------- */
  app.post('/projects/:projectId/usecases', async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    if (!projectExists(projectId)) return notFound(reply, 'Project');

    const body = (req.body ?? {}) as Record<string, unknown>;
    const name = str(body.name);
    if (!name) return badRequest(reply, 'Nama use case wajib diisi.');

    const used = existingUseCaseCodes(projectId);
    let code = str(body.code) ?? '';
    if (code && used.has(code)) return badRequest(reply, `Kode "${code}" sudah dipakai.`);
    if (!code) {
      let n = Number(
        (db.prepare('SELECT COUNT(*) AS n FROM use_cases WHERE project_id = ?').get(projectId) as
          | { n: number }
          | undefined)?.n ?? 0,
      ) + 1;
      do {
        code = `UC-${String(n).padStart(3, '0')}`;
        n += 1;
      } while (used.has(code));
    }

    const id = withTransaction(() => {
      const newIdValue = createUseCase({
        project_id: projectId,
        code,
        name,
        goal: str(body.goal),
        actors: toJson(asStringList(body.actors ?? body.actors_list)),
        preconditions: toJson(asStringList(body.preconditions ?? body.preconditions_list)),
        postconditions: toJson(asStringList(body.postconditions ?? body.postconditions_list)),
        main_flow: toJson(asStringList(body.main_flow ?? body.main_flow_list)),
        alternate_flows: toJson(asAlternateFlows(body.alternate_flows ?? body.alternate_flows_list)),
        business_rules: toJson(asStringList(body.business_rules ?? body.business_rules_list)),
        priority: priority(body.priority),
        risk: risk(body.risk),
        status: UC_STATUSES.includes(body.status as never) ? String(body.status) : 'draft',
        generated_by: GENERATED_BY.includes(body.generated_by as never)
          ? String(body.generated_by)
          : 'manual',
        ai_generation_id: str(body.ai_generation_id),
      });

      // Auto-derive requirement → use case links for every referenced requirement.
      for (const reqId of asStringList(body.requirement_ids)) {
        matrixService.linkRequirementToUseCase(reqId, newIdValue);
      }
      return newIdValue;
    });

    logActivity({
      project_id: projectId,
      actor: 'lane-docs',
      action: 'create',
      entity_kind: 'use_case',
      entity_id: id,
      summary: `${code} dibuat`,
    });

    return reply.code(201).send(one(decorate(getUseCase(id) as unknown as Record<string, unknown>)));
  });

  /* ---------------------------------- read --------------------------------- */
  app.get('/usecases/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const uc = getUseCase(id);
    if (!uc) return notFound(reply, 'Use case');
    const { scenarios, test_cases } = descendantsOf(id);
    const requirements = db
      .prepare(
        `SELECT r.* FROM requirements r
           JOIN matrix_links m ON m.from_id = r.id
          WHERE m.link_type = 'requirement_to_usecase' AND m.to_id = ?
          ORDER BY r.code`,
      )
      .all(id);
    return one({
      ...decorate(uc as unknown as Record<string, unknown>),
      requirements,
      scenarios,
      test_cases,
      impact: await matrixService.impactOf(id),
    });
  });

  /* --------------------------------- update -------------------------------- */
  app.patch('/usecases/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const uc = getUseCase(id);
    if (!uc) return notFound(reply, 'Use case');

    const body = (req.body ?? {}) as Record<string, unknown>;
    const patch: Record<string, unknown> = {};

    if (body.name !== undefined) {
      const name = str(body.name);
      if (!name) return badRequest(reply, 'Nama use case tidak boleh kosong.');
      patch.name = name;
    }
    if (body.code !== undefined) {
      const code = str(body.code);
      if (!code) return badRequest(reply, 'Kode tidak boleh kosong.');
      const clash = db
        .prepare('SELECT id FROM use_cases WHERE project_id = ? AND code = ? AND id <> ?')
        .get(uc.project_id, code, id);
      if (clash) return badRequest(reply, `Kode "${code}" sudah dipakai.`);
      patch.code = code;
    }
    if (body.goal !== undefined) patch.goal = str(body.goal);
    if (body.actors !== undefined || body.actors_list !== undefined) {
      patch.actors = toJson(asStringList(body.actors ?? body.actors_list));
    }
    if (body.preconditions !== undefined || body.preconditions_list !== undefined) {
      patch.preconditions = toJson(asStringList(body.preconditions ?? body.preconditions_list));
    }
    if (body.postconditions !== undefined || body.postconditions_list !== undefined) {
      patch.postconditions = toJson(asStringList(body.postconditions ?? body.postconditions_list));
    }
    if (body.main_flow !== undefined || body.main_flow_list !== undefined) {
      patch.main_flow = toJson(asStringList(body.main_flow ?? body.main_flow_list));
    }
    if (body.alternate_flows !== undefined || body.alternate_flows_list !== undefined) {
      patch.alternate_flows = toJson(
        asAlternateFlows(body.alternate_flows ?? body.alternate_flows_list),
      );
    }
    if (body.business_rules !== undefined || body.business_rules_list !== undefined) {
      patch.business_rules = toJson(asStringList(body.business_rules ?? body.business_rules_list));
    }
    if (body.priority !== undefined) {
      if (!PRIORITIES.includes(body.priority as never)) {
        return badRequest(reply, `Priority tidak valid. Pilihan: ${PRIORITIES.join(', ')}.`);
      }
      patch.priority = String(body.priority);
    }
    if (body.risk !== undefined) {
      if (!RISK_LEVELS.includes(body.risk as never)) {
        return badRequest(reply, `Risk tidak valid. Pilihan: ${RISK_LEVELS.join(', ')}.`);
      }
      patch.risk = String(body.risk);
    }
    if (body.status !== undefined) {
      if (!UC_STATUSES.includes(body.status as never)) {
        return badRequest(reply, `Status tidak valid. Pilihan: ${UC_STATUSES.join(', ')}.`);
      }
      patch.status = String(body.status);
    }
    if (body.ai_generation_id !== undefined) patch.ai_generation_id = str(body.ai_generation_id);

    withTransaction(() => {
      if (Object.keys(patch).length) updateUseCase(id, patch);

      // Re-sync the requirement links when the caller sends a new set.
      if (body.requirement_ids !== undefined) {
        const wanted = new Set(asStringList(body.requirement_ids));
        const current = db
          .prepare(
            `SELECT id, from_id FROM matrix_links
              WHERE link_type = 'requirement_to_usecase' AND to_id = ?`,
          )
          .all(id) as Array<{ id: string; from_id: string }>;
        for (const l of current) {
          if (!wanted.has(l.from_id)) db.prepare('DELETE FROM matrix_links WHERE id = ?').run(l.id);
        }
        for (const reqId of wanted) matrixService.linkRequirementToUseCase(reqId, id);
      }
    });

    return one(decorate(getUseCase(id) as unknown as Record<string, unknown>));
  });

  /* --------------------------------- delete -------------------------------- */
  app.delete('/usecases/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const uc = getUseCase(id);
    if (!uc) return notFound(reply, 'Use case');

    withTransaction(() => {
      // Children keep existing (scenario.use_case_id has ON DELETE CASCADE) — drop their links.
      const scenarios = db.prepare('SELECT id FROM scenarios WHERE use_case_id = ?').all(id) as Array<{
        id: string;
      }>;
      const testCases = db.prepare('SELECT id FROM test_cases WHERE use_case_id = ?').all(id) as Array<{
        id: string;
      }>;
      for (const s of scenarios) matrixService.unlinkArtifact(s.id);
      for (const t of testCases) matrixService.unlinkArtifact(t.id);
      matrixService.unlinkArtifact(id);
      deleteUseCase(id);
    });

    logActivity({
      project_id: uc.project_id,
      actor: 'lane-docs',
      action: 'delete',
      entity_kind: 'use_case',
      entity_id: id,
      summary: `${uc.code} dihapus`,
    });
    return one({ id, deleted: true });
  });

  /* -------------------------------- duplicate ------------------------------- */
  app.post('/usecases/:id/duplicate', async (req, reply) => {
    const { id } = req.params as { id: string };
    const uc = getUseCase(id);
    if (!uc) return notFound(reply, 'Use case');

    const body = (req.body ?? {}) as Record<string, unknown>;
    const used = existingUseCaseCodes(uc.project_id);
    let n = Number(
      (db.prepare('SELECT COUNT(*) AS n FROM use_cases WHERE project_id = ?').get(uc.project_id) as
        | { n: number }
        | undefined)?.n ?? 0,
    ) + 1;
    let code: string;
    do {
      code = `UC-${String(n).padStart(3, '0')}`;
      n += 1;
    } while (used.has(code));

    const newIdValue = withTransaction(() => {
      const created = createUseCase({
        project_id: uc.project_id,
        code,
        name: str(body.name) ?? `${uc.name} (salinan)`,
        goal: uc.goal,
        actors: uc.actors,
        preconditions: uc.preconditions,
        postconditions: uc.postconditions,
        main_flow: uc.main_flow,
        alternate_flows: uc.alternate_flows,
        business_rules: uc.business_rules,
        priority: uc.priority,
        risk: uc.risk,
        status: 'draft',
        generated_by: 'manual',
        ai_generation_id: null,
      });

      // A duplicate keeps the same upstream requirement links.
      const reqLinks = db
        .prepare(
          `SELECT from_id FROM matrix_links
            WHERE link_type = 'requirement_to_usecase' AND to_id = ?`,
        )
        .all(id) as Array<{ from_id: string }>;
      for (const l of reqLinks) matrixService.linkRequirementToUseCase(l.from_id, created);

      return created;
    });

    logActivity({
      project_id: uc.project_id,
      actor: 'lane-docs',
      action: 'duplicate',
      entity_kind: 'use_case',
      entity_id: newIdValue,
      summary: `${uc.code} → ${code}`,
    });

    return reply
      .code(201)
      .send(one(decorate(getUseCase(newIdValue) as unknown as Record<string, unknown>)));
  });
}
