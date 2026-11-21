/**
 * Scenarios module — CRUD, grouped by use case, with automatic usecase→scenario linking.
 */

import type { FastifyInstance } from 'fastify';
import { db, logActivity } from '../../db/index.js';
import { list, one, badRequest, notFound } from '../../lib/http.js';
import { PRIORITIES, type Priority } from '@qatools/shared';
import { matrixService } from '../matrix/service.js';
import { withTransaction } from '../matrix/tx.js';
import {
  listScenarios,
  getScenario,
  createScenario,
  updateScenario,
  deleteScenario,
  existingScenarioCodes,
  testCasesOfScenario,
} from './repo.js';

export const SCENARIO_KINDS = [
  'happy_path',
  'alternative',
  'negative',
  'edge',
  'security',
  'performance',
] as const;

const GENERATED_BY = ['manual', 'ai', 'import'] as const;

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

function priority(v: unknown, fallback: Priority = 'medium'): Priority {
  return PRIORITIES.includes(v as never) ? (v as Priority) : fallback;
}

function allocateCode(projectId: string): string {
  const used = existingScenarioCodes(projectId);
  let n =
    Number(
      (db.prepare('SELECT COUNT(*) AS n FROM scenarios WHERE project_id = ?').get(projectId) as
        | { n: number }
        | undefined)?.n ?? 0,
    ) + 1;
  let code: string;
  do {
    code = `SC-${String(n).padStart(3, '0')}`;
    n += 1;
  } while (used.has(code));
  return code;
}

export default async function routes(app: FastifyInstance): Promise<void> {
  const projectExists = (id: string) =>
    Boolean(db.prepare('SELECT id FROM projects WHERE id = ?').get(id));

  /* ---------------------------------- list --------------------------------- */
  app.get('/projects/:projectId/scenarios', async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    if (!projectExists(projectId)) return notFound(reply, 'Project');
    const query = req.query as Record<string, unknown>;
    const rows = listScenarios(projectId, {
      use_case_id: typeof query.use_case_id === 'string' ? query.use_case_id : undefined,
      kind: typeof query.kind === 'string' ? query.kind : undefined,
      priority: typeof query.priority === 'string' ? query.priority : undefined,
    });

    const ucStmt = db.prepare('SELECT id, code, name FROM use_cases WHERE id = ?');
    const tcCount = db.prepare('SELECT COUNT(*) AS n FROM test_cases WHERE scenario_id = ?');

    return list(
      rows.map((s) => ({
        ...s,
        use_case: s.use_case_id ? ucStmt.get(s.use_case_id) : null,
        test_case_count: Number((tcCount.get(s.id) as { n: number } | undefined)?.n ?? 0),
      })),
      rows.length,
    );
  });

  /* --------------------------------- create -------------------------------- */
  app.post('/projects/:projectId/scenarios', async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    if (!projectExists(projectId)) return notFound(reply, 'Project');

    const body = (req.body ?? {}) as Record<string, unknown>;
    const title = str(body.title);
    if (!title) return badRequest(reply, 'Judul skenario wajib diisi.');

    let useCaseId = str(body.use_case_id);
    if (useCaseId) {
      const uc = db.prepare('SELECT id, project_id FROM use_cases WHERE id = ?').get(useCaseId) as
        | { id: string; project_id: string }
        | undefined;
      if (!uc) return badRequest(reply, 'Use case tidak ditemukan.');
      if (uc.project_id !== projectId) return badRequest(reply, 'Use case berasal dari project lain.');
    }
    if (body.use_case_code) {
      const uc = db
        .prepare('SELECT id FROM use_cases WHERE project_id = ? AND code = ?')
        .get(projectId, String(body.use_case_code)) as { id: string } | undefined;
      if (uc) useCaseId = uc.id;
    }

    const used = existingScenarioCodes(projectId);
    let code = str(body.code) ?? '';
    if (code && used.has(code)) return badRequest(reply, `Kode "${code}" sudah dipakai.`);
    if (!code) code = allocateCode(projectId);

    const id = withTransaction(() => {
      const created = createScenario({
        project_id: projectId,
        use_case_id: useCaseId,
        code,
        title,
        kind: SCENARIO_KINDS.includes(body.kind as never) ? String(body.kind) : 'happy_path',
        given_text: str(body.given_text ?? body.given),
        when_text: str(body.when_text ?? body.when),
        then_text: str(body.then_text ?? body.then),
        priority: priority(body.priority),
        generated_by: GENERATED_BY.includes(body.generated_by as never)
          ? String(body.generated_by)
          : 'manual',
        ai_generation_id: str(body.ai_generation_id),
      });
      if (useCaseId) matrixService.linkUseCaseToScenario(useCaseId, created);
      return created;
    });

    logActivity({
      project_id: projectId,
      actor: 'lane-docs',
      action: 'create',
      entity_kind: 'scenario',
      entity_id: id,
      summary: `${code} dibuat`,
    });

    return reply.code(201).send(one(getScenario(id)));
  });

  /* ---------------------------------- read --------------------------------- */
  app.get('/scenarios/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const sc = getScenario(id);
    if (!sc) return notFound(reply, 'Skenario');
    return one({
      ...sc,
      use_case: sc.use_case_id
        ? db.prepare('SELECT id, code, name FROM use_cases WHERE id = ?').get(sc.use_case_id)
        : null,
      test_cases: testCasesOfScenario(id),
      impact: await matrixService.impactOf(id),
    });
  });

  /* --------------------------------- update -------------------------------- */
  app.patch('/scenarios/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const sc = getScenario(id);
    if (!sc) return notFound(reply, 'Skenario');

    const body = (req.body ?? {}) as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    let parentChanged = false;

    if (body.title !== undefined) {
      const title = str(body.title);
      if (!title) return badRequest(reply, 'Judul skenario tidak boleh kosong.');
      patch.title = title;
    }
    if (body.code !== undefined) {
      const code = str(body.code);
      if (!code) return badRequest(reply, 'Kode tidak boleh kosong.');
      const clash = db
        .prepare('SELECT id FROM scenarios WHERE project_id = ? AND code = ? AND id <> ?')
        .get(sc.project_id, code, id);
      if (clash) return badRequest(reply, `Kode "${code}" sudah dipakai.`);
      patch.code = code;
    }
    for (const f of ['given_text', 'when_text', 'then_text'] as const) {
      if (body[f] !== undefined) patch[f] = str(body[f]);
    }
    for (const [alias, column] of [
      ['given', 'given_text'],
      ['when', 'when_text'],
      ['then', 'then_text'],
    ] as const) {
      if (body[alias] !== undefined) patch[column] = str(body[alias]);
    }
    if (body.kind !== undefined) {
      if (!SCENARIO_KINDS.includes(body.kind as never)) {
        return badRequest(reply, `Kind tidak valid. Pilihan: ${SCENARIO_KINDS.join(', ')}.`);
      }
      patch.kind = String(body.kind);
    }
    if (body.priority !== undefined) {
      if (!PRIORITIES.includes(body.priority as never)) {
        return badRequest(reply, `Priority tidak valid. Pilihan: ${PRIORITIES.join(', ')}.`);
      }
      patch.priority = String(body.priority);
    }
    if (body.use_case_id !== undefined) {
      const next = str(body.use_case_id);
      if (next) {
        const uc = db.prepare('SELECT id, project_id FROM use_cases WHERE id = ?').get(next) as
          | { id: string; project_id: string }
          | undefined;
        if (!uc || uc.project_id !== sc.project_id) {
          return badRequest(reply, 'Use case tidak valid untuk project ini.');
        }
      }
      patch.use_case_id = next;
      parentChanged = true;
    }

    withTransaction(() => {
      if (Object.keys(patch).length) updateScenario(id, patch);
      if (parentChanged) {
        matrixService.retargetScenarioParent(id, (patch.use_case_id as string | null) ?? null);
      }
    });

    return one(getScenario(id));
  });

  /* --------------------------------- delete -------------------------------- */
  app.delete('/scenarios/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const sc = getScenario(id);
    if (!sc) return notFound(reply, 'Skenario');

    withTransaction(() => {
      const testCases = db
        .prepare('SELECT id FROM test_cases WHERE scenario_id = ?')
        .all(id) as Array<{ id: string }>;
      matrixService.unlinkArtifact(id);
      deleteScenario(id);
      // test_cases.scenario_id is ON DELETE SET NULL — re-derive their remaining edges.
      for (const t of testCases) matrixService.deriveForTestCase(t.id);
    });

    logActivity({
      project_id: sc.project_id,
      actor: 'lane-docs',
      action: 'delete',
      entity_kind: 'scenario',
      entity_id: id,
      summary: `${sc.code} dihapus`,
    });
    return one({ id, deleted: true });
  });
}
