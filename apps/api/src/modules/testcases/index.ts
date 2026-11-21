/**
 * Test cases module — CRUD, ordered steps sub-resource, regression toggle and
 * automatic matrix derivation. `risk_score` is always computed by `riskScore()`
 * from the frozen shared vocabulary (never accepted from the client).
 */

import type { FastifyInstance } from 'fastify';
import { db, logActivity, parseJson, toJson } from '../../db/index.js';
import { list, one, badRequest, notFound } from '../../lib/http.js';
import {
  AUTOMATION_STATUSES,
  CASE_TYPES,
  EXEC_ENGINES,
  LAYER_KINDS,
  PRIORITIES,
  SEVERITIES,
  riskScore,
  type AutomationStatus,
  type CaseType,
  type ExecEngine,
  type LayerKind,
  type Priority,
  type Severity,
} from '@qatools/shared';
import { matrixService } from '../matrix/service.js';
import { withTransaction } from '../matrix/tx.js';
import {
  listTestCases,
  getTestCase,
  createTestCase,
  updateTestCase,
  deleteTestCase,
  existingTestCaseCodes,
  listSteps,
  replaceSteps,
  countSteps,
} from './repo.js';

const STATUSES = ['draft', 'ready', 'deprecated'] as const;
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
      .split(/[\r\n,]/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

/** Test data is stored as `{field, value}[]`; a plain object is accepted too. */
function asTestData(v: unknown): Array<{ field: string; value: string }> {
  if (Array.isArray(v)) {
    return v
      .map((item) => {
        if (typeof item === 'string') return { field: item, value: '' };
        const obj = item as Record<string, unknown>;
        return { field: String(obj.field ?? obj.name ?? ''), value: String(obj.value ?? '') };
      })
      .filter((r) => r.field.trim() !== '');
  }
  if (v && typeof v === 'object') {
    return Object.entries(v as Record<string, unknown>).map(([field, value]) => ({
      field,
      value: String(value ?? ''),
    }));
  }
  return [];
}

function asSteps(v: unknown): Array<{ action: string; expected: string | null; data: string | null }> {
  if (!Array.isArray(v)) return [];
  return v
    .map((item) => {
      if (typeof item === 'string') return { action: item, expected: null, data: null };
      const obj = item as Record<string, unknown>;
      return {
        action: String(obj.action ?? obj.step ?? '').trim(),
        expected: str(obj.expected),
        data: str(obj.data),
      };
    })
    .filter((s) => s.action !== '');
}

function oneOf<T extends string>(list_: readonly T[], v: unknown, fallback: T): T {
  return list_.includes(v as never) ? (v as T) : fallback;
}

/** Deterministic, explainable risk score from the frozen helper. */
function computeRisk(input: {
  priority: string;
  type: string;
  layer: string;
  is_regression: number;
  automation_status: string;
  defectHistory?: number;
}): { score: number; level: string; factors: string[] } {
  return riskScore({
    businessCriticality: input.priority,
    usageFrequency: input.type === 'functional' ? 'always' : input.type === 'regression' ? 'often' : 'sometimes',
    complexity: input.layer === 'web' ? 'high' : input.layer === 'api' ? 'medium' : 'low',
    defectHistory: input.defectHistory ?? 0,
    isRegression: input.is_regression === 1,
    hasAutomation: input.automation_status === 'automated',
  });
}

function decorate(tc: Record<string, unknown>): Record<string, unknown> {
  return {
    ...tc,
    is_regression: Number(tc.is_regression ?? 0),
    tags_list: parseJson<string[]>(tc.tags, []),
    test_data_list: parseJson<Array<{ field: string; value: string }>>(tc.test_data, []),
  };
}

export default async function routes(app: FastifyInstance): Promise<void> {
  const projectExists = (id: string) =>
    Boolean(db.prepare('SELECT id FROM projects WHERE id = ?').get(id));

  /* ---------------------------------- list --------------------------------- */
  app.get('/projects/:projectId/testcases', async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    if (!projectExists(projectId)) return notFound(reply, 'Project');
    const query = req.query as Record<string, unknown>;

    const regressionRaw = query.regression ?? query.is_regression;
    const is_regression =
      regressionRaw === undefined || regressionRaw === ''
        ? undefined
        : String(regressionRaw) === 'true' || String(regressionRaw) === '1';

    const rows = listTestCases(projectId, {
      type: typeof query.type === 'string' ? query.type : undefined,
      layer: typeof query.layer === 'string' ? query.layer : undefined,
      priority: typeof query.priority === 'string' ? query.priority : undefined,
      engine: typeof query.engine === 'string' ? query.engine : undefined,
      automation_status:
        typeof query.automation_status === 'string' ? query.automation_status : undefined,
      scenario_id: typeof query.scenario_id === 'string' ? query.scenario_id : undefined,
      use_case_id: typeof query.use_case_id === 'string' ? query.use_case_id : undefined,
      is_regression,
      q: typeof query.q === 'string' ? query.q : undefined,
    });

    const scStmt = db.prepare('SELECT id, code, title FROM scenarios WHERE id = ?');
    const ucStmt = db.prepare('SELECT id, code, name FROM use_cases WHERE id = ?');

    return list(
      rows.map((tc) => ({
        ...decorate(tc as unknown as Record<string, unknown>),
        scenario: tc.scenario_id ? scStmt.get(tc.scenario_id) : null,
        use_case: tc.use_case_id ? ucStmt.get(tc.use_case_id) : null,
        step_count: countSteps(tc.id),
      })),
      rows.length,
    );
  });

  /* --------------------------------- create -------------------------------- */
  app.post('/projects/:projectId/testcases', async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    if (!projectExists(projectId)) return notFound(reply, 'Project');

    const body = (req.body ?? {}) as Record<string, unknown>;
    const title = str(body.title);
    if (!title) return badRequest(reply, 'Judul test case wajib diisi.');

    let scenarioId = str(body.scenario_id);
    let useCaseId = str(body.use_case_id);

    if (scenarioId) {
      const sc = db.prepare('SELECT id, project_id, use_case_id FROM scenarios WHERE id = ?').get(
        scenarioId,
      ) as { id: string; project_id: string; use_case_id: string | null } | undefined;
      if (!sc || sc.project_id !== projectId) return badRequest(reply, 'Skenario tidak valid.');
      if (!useCaseId && sc.use_case_id) useCaseId = sc.use_case_id;
    }
    if (useCaseId) {
      const uc = db.prepare('SELECT id, project_id FROM use_cases WHERE id = ?').get(useCaseId) as
        | { id: string; project_id: string }
        | undefined;
      if (!uc || uc.project_id !== projectId) return badRequest(reply, 'Use case tidak valid.');
    }

    const used = existingTestCaseCodes(projectId);
    let code = str(body.code) ?? '';
    if (code && used.has(code)) return badRequest(reply, `Kode "${code}" sudah dipakai.`);
    if (!code) {
      let n =
        Number(
          (db.prepare('SELECT COUNT(*) AS n FROM test_cases WHERE project_id = ?').get(projectId) as
            | { n: number }
            | undefined)?.n ?? 0,
        ) + 1;
      do {
        code = `TC-${String(n).padStart(3, '0')}`;
        n += 1;
      } while (used.has(code));
    }

    const type = oneOf<CaseType>(CASE_TYPES, body.type, 'functional');
    const layer = oneOf<LayerKind>(LAYER_KINDS, body.layer, 'web');
    const priority = oneOf<Priority>(PRIORITIES, body.priority, 'medium');
    const severity = oneOf<Severity>(SEVERITIES, body.severity, 'major');
    const automation_status = oneOf<AutomationStatus>(
      AUTOMATION_STATUSES,
      body.automation_status,
      'manual',
    );
    const engine = oneOf<ExecEngine>(EXEC_ENGINES, body.engine, 'manual');
    const is_regression = body.is_regression ? 1 : 0;

    const risk = computeRisk({ priority, type, layer, is_regression, automation_status });

    const id = withTransaction(() => {
      const created = createTestCase({
        project_id: projectId,
        scenario_id: scenarioId,
        use_case_id: useCaseId,
        code,
        title,
        objective: str(body.objective),
        preconditions: str(body.preconditions),
        type,
        layer,
        priority,
        severity,
        automation_status,
        engine,
        risk_score: risk.score,
        estimated_minutes: Number.isFinite(Number(body.estimated_minutes))
          ? Math.max(0, Number(body.estimated_minutes))
          : 10,
        tags: toJson(asStringList(body.tags ?? body.tags_list)),
        test_data: toJson(asTestData(body.test_data ?? body.test_data_list)),
        expected_result: str(body.expected_result),
        is_regression,
        status: oneOf(STATUSES, body.status, 'ready'),
        generated_by: oneOf(GENERATED_BY, body.generated_by, 'manual'),
        ai_generation_id: str(body.ai_generation_id),
      });

      const steps = asSteps(body.steps);
      if (steps.length) replaceSteps(created, steps);

      const requirementIds = asStringList(body.requirement_ids);
      for (const reqId of requirementIds) matrixService.linkRequirementToTestCase(reqId, created);
      matrixService.deriveForTestCase(created);

      return created;
    });

    logActivity({
      project_id: projectId,
      actor: 'lane-docs',
      action: 'create',
      entity_kind: 'test_case',
      entity_id: id,
      summary: `${code} dibuat (risk ${risk.score})`,
    });

    const row = getTestCase(id) as unknown as Record<string, unknown>;
    return reply
      .code(201)
      .send(one({ ...decorate(row), steps: listSteps(id), risk_factors: risk.factors }));
  });

  /* ---------------------------------- read --------------------------------- */
  app.get('/testcases/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const tc = getTestCase(id);
    if (!tc) return notFound(reply, 'Test case');
    const requirements = db
      .prepare(
        `SELECT r.id, r.code, r.title FROM requirements r
           JOIN matrix_links m ON m.from_id = r.id
          WHERE m.link_type = 'requirement_to_testcase' AND m.to_id = ?
          ORDER BY r.code`,
      )
      .all(id);
    return one({
      ...decorate(tc as unknown as Record<string, unknown>),
      steps: listSteps(id),
      requirements,
      impact: await matrixService.impactOf(id),
    });
  });

  /* --------------------------------- update -------------------------------- */
  app.patch('/testcases/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const tc = getTestCase(id);
    if (!tc) return notFound(reply, 'Test case');

    const body = (req.body ?? {}) as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    let parentsChanged = false;

    if (body.title !== undefined) {
      const title = str(body.title);
      if (!title) return badRequest(reply, 'Judul test case tidak boleh kosong.');
      patch.title = title;
    }
    if (body.code !== undefined) {
      const code = str(body.code);
      if (!code) return badRequest(reply, 'Kode tidak boleh kosong.');
      const clash = db
        .prepare('SELECT id FROM test_cases WHERE project_id = ? AND code = ? AND id <> ?')
        .get(tc.project_id, code, id);
      if (clash) return badRequest(reply, `Kode "${code}" sudah dipakai.`);
      patch.code = code;
    }
    for (const f of ['objective', 'preconditions', 'expected_result'] as const) {
      if (body[f] !== undefined) patch[f] = str(body[f]);
    }

    if (body.scenario_id !== undefined) {
      const next = str(body.scenario_id);
      if (next) {
        const sc = db.prepare('SELECT id, project_id FROM scenarios WHERE id = ?').get(next) as
          | { id: string; project_id: string }
          | undefined;
        if (!sc || sc.project_id !== tc.project_id) {
          return badRequest(reply, 'Skenario tidak valid untuk project ini.');
        }
      }
      patch.scenario_id = next;
      parentsChanged = true;
    }
    if (body.use_case_id !== undefined) {
      const next = str(body.use_case_id);
      if (next) {
        const uc = db.prepare('SELECT id, project_id FROM use_cases WHERE id = ?').get(next) as
          | { id: string; project_id: string }
          | undefined;
        if (!uc || uc.project_id !== tc.project_id) {
          return badRequest(reply, 'Use case tidak valid untuk project ini.');
        }
      }
      patch.use_case_id = next;
      parentsChanged = true;
    }

    const type = body.type !== undefined ? oneOf<CaseType>(CASE_TYPES, body.type, tc.type) : tc.type;
    if (body.type !== undefined) patch.type = type;

    const layer =
      body.layer !== undefined ? oneOf<LayerKind>(LAYER_KINDS, body.layer, tc.layer) : tc.layer;
    if (body.layer !== undefined) patch.layer = layer;

    const priority =
      body.priority !== undefined
        ? oneOf<Priority>(PRIORITIES, body.priority, tc.priority)
        : tc.priority;
    if (body.priority !== undefined) patch.priority = priority;

    if (body.severity !== undefined) {
      patch.severity = oneOf<Severity>(SEVERITIES, body.severity, tc.severity);
    }
    if (body.automation_status !== undefined) {
      patch.automation_status = oneOf<AutomationStatus>(
        AUTOMATION_STATUSES,
        body.automation_status,
        tc.automation_status,
      );
    }
    if (body.engine !== undefined) {
      patch.engine = oneOf<ExecEngine>(EXEC_ENGINES, body.engine, tc.engine);
    }
    if (body.estimated_minutes !== undefined) {
      const minutes = Number(body.estimated_minutes);
      if (!Number.isFinite(minutes)) return badRequest(reply, 'estimated_minutes harus angka.');
      patch.estimated_minutes = Math.max(0, minutes);
    }
    if (body.tags !== undefined || body.tags_list !== undefined) {
      patch.tags = toJson(asStringList(body.tags ?? body.tags_list));
    }
    if (body.test_data !== undefined || body.test_data_list !== undefined) {
      patch.test_data = toJson(asTestData(body.test_data ?? body.test_data_list));
    }
    if (body.status !== undefined) patch.status = oneOf(STATUSES, body.status, tc.status);
    if (body.is_regression !== undefined) patch.is_regression = body.is_regression ? 1 : 0;

    // Always recompute the risk score from the *effective* values.
    const effective = {
      priority: (patch.priority as string) ?? tc.priority,
      type: (patch.type as string) ?? tc.type,
      layer: (patch.layer as string) ?? tc.layer,
      is_regression: Number(patch.is_regression ?? tc.is_regression),
      automation_status: (patch.automation_status as string) ?? tc.automation_status,
    };
    const defectHistory = Number(
      (
        db.prepare('SELECT COUNT(*) AS n FROM defects WHERE test_case_id = ?').get(id) as
          | { n: number }
          | undefined
      )?.n ?? 0,
    );
    const risk = computeRisk({ ...effective, defectHistory });
    patch.risk_score = risk.score;

    withTransaction(() => {
      updateTestCase(id, patch);
      if (body.steps !== undefined) replaceSteps(id, asSteps(body.steps));
      if (parentsChanged) {
        matrixService.retargetTestCaseParents(
          id,
          (patch.scenario_id as string | null | undefined) ?? tc.scenario_id,
          (patch.use_case_id as string | null | undefined) ?? tc.use_case_id,
        );
      } else {
        matrixService.deriveForTestCase(id);
      }
      if (body.requirement_ids !== undefined) {
        const wanted = new Set(asStringList(body.requirement_ids));
        const current = db
          .prepare(
            `SELECT id, from_id FROM matrix_links
              WHERE link_type = 'requirement_to_testcase' AND to_id = ?`,
          )
          .all(id) as Array<{ id: string; from_id: string }>;
        for (const l of current) {
          if (!wanted.has(l.from_id) && wanted.size) {
            db.prepare('DELETE FROM matrix_links WHERE id = ?').run(l.id);
          }
        }
        for (const reqId of wanted) matrixService.linkRequirementToTestCase(reqId, id);
      }
    });

    const row = getTestCase(id) as unknown as Record<string, unknown>;
    return one({ ...decorate(row), risk_factors: risk.factors });
  });

  /* --------------------------------- delete -------------------------------- */
  app.delete('/testcases/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const tc = getTestCase(id);
    if (!tc) return notFound(reply, 'Test case');

    withTransaction(() => {
      matrixService.unlinkArtifact(id);
      deleteTestCase(id);
    });

    logActivity({
      project_id: tc.project_id,
      actor: 'lane-docs',
      action: 'delete',
      entity_kind: 'test_case',
      entity_id: id,
      summary: `${tc.code} dihapus`,
    });
    return one({ id, deleted: true });
  });

  /* ------------------------------ steps sub-resource ------------------------ */
  app.get('/testcases/:id/steps', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!getTestCase(id)) return notFound(reply, 'Test case');
    const steps = listSteps(id);
    return list(steps, steps.length);
  });

  /** Replaces the full ordered step list. */
  app.put('/testcases/:id/steps', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!getTestCase(id)) return notFound(reply, 'Test case');
    const body = (req.body ?? {}) as Record<string, unknown>;
    const raw = Array.isArray(body) ? body : body.steps;
    const steps = asSteps(raw);
    if (!steps.length && raw !== undefined && Array.isArray(raw) && raw.length > 0) {
      return badRequest(reply, 'Setiap langkah harus memiliki "action".');
    }
    const saved = replaceSteps(id, steps);
    return one(saved);
  });

  /* --------------------------- regression toggle --------------------------- */
  app.post('/testcases/:id/regression', async (req, reply) => {
    const { id } = req.params as { id: string };
    const tc = getTestCase(id);
    if (!tc) return notFound(reply, 'Test case');

    const body = (req.body ?? {}) as Record<string, unknown>;
    const next = body.is_regression === undefined ? (Number(tc.is_regression) === 1 ? 0 : 1) : body.is_regression ? 1 : 0;

    const defectHistory = Number(
      (
        db.prepare('SELECT COUNT(*) AS n FROM defects WHERE test_case_id = ?').get(id) as
          | { n: number }
          | undefined
      )?.n ?? 0,
    );
    const risk = computeRisk({
      priority: tc.priority,
      type: tc.type,
      layer: tc.layer,
      is_regression: next,
      automation_status: tc.automation_status,
      defectHistory,
    });

    updateTestCase(id, { is_regression: next, risk_score: risk.score });

    logActivity({
      project_id: tc.project_id,
      actor: 'lane-docs',
      action: next ? 'add_regression' : 'remove_regression',
      entity_kind: 'test_case',
      entity_id: id,
      summary: `${tc.code} ${next ? 'masuk' : 'keluar'} suite regresi`,
    });

    const row = getTestCase(id) as unknown as Record<string, unknown>;
    return one({ ...decorate(row), risk_factors: risk.factors });
  });
}
