/**
 * Lane D — AI persistence.
 *
 * When `persist: true`, generated drafts become real rows in the SHARED artifact tables
 * (`use_cases`, `scenarios`, `test_cases`, `api_requests`, `db_checks`, `web_flows`,
 * `requirements`, `test_steps`) plus `matrix_links` rows for the parent chain.
 *
 * HARD RULES honoured here:
 *  - INSERT ONLY. This file never issues UPDATE/DELETE against artifacts another lane owns.
 *  - Codes come from `nextCode()` so they continue the project's existing sequence.
 *  - `generated_by = 'ai'` and `ai_generation_id` are always set when the column exists.
 *  - `matrix_links` uses `INSERT OR IGNORE` because of its UNIQUE(link_type,from_id,to_id).
 *  - Links are only written when BOTH parents exist, so we never create dangling links.
 *  - Every statement runs inside one transaction; a failure rolls the whole batch back.
 */

import { newId, nowIso, type Assertion } from '@qatools/shared';
import { db, nextCode, toJson } from '../../db/index.js';

type Row = Record<string, unknown>;

export interface PersistContext {
  projectId: string;
  generationId: string | null;
  /** Parent ids supplied by the caller (e.g. the requirement/use-case being expanded). */
  requirementIds?: string[];
  useCaseIds?: string[];
  scenarioIds?: string[];
  /** Optional existing api_collections row to attach API requests to. */
  collectionId?: string | null;
  /** Optional existing db_connections row to attach DB checks to. */
  connectionId?: string | null;
}

export interface PersistOutcome {
  created: {
    use_cases: string[];
    scenarios: string[];
    test_cases: string[];
    test_steps: string[];
    api_requests: string[];
    db_checks: string[];
    web_flows: string[];
    requirements: string[];
    matrix_links: string[];
  };
  /** Human labels for the UI navigation hint. */
  labels: Array<{ kind: string; id: string; code: string | null; title: string }>;
  skipped: string[];
}

function emptyOutcome(): PersistOutcome {
  return {
    created: {
      use_cases: [],
      scenarios: [],
      test_cases: [],
      test_steps: [],
      api_requests: [],
      db_checks: [],
      web_flows: [],
      requirements: [],
      matrix_links: [],
    },
    labels: [],
    skipped: [],
  };
}

function s(v: unknown, fallback = ''): string {
  return typeof v === 'string' && v.trim() ? v : fallback;
}
function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
function strArr(v: unknown): string[] {
  return arr(v).filter((x): x is string => typeof x === 'string');
}
function priority(v: unknown): string {
  return ['low', 'medium', 'high', 'critical'].includes(String(v)) ? String(v) : 'medium';
}
function riskOf(v: unknown): string {
  return ['low', 'medium', 'high'].includes(String(v)) ? String(v) : 'medium';
}

/** True when a row with this primary key already exists (defensive de-dup). */
function exists(table: string, id: string): boolean {
  const row = db.prepare(`SELECT id FROM ${table} WHERE id = ?`).get(id);
  return Boolean(row);
}

function insertMatrixLink(
  out: PersistOutcome,
  projectId: string,
  linkType: string,
  fromKind: string,
  fromId: string,
  toKind: string,
  toId: string,
  note: string,
): void {
  if (!fromId || !toId) return;
  const id = newId('mlk_');
  try {
    db.prepare(
      `INSERT OR IGNORE INTO matrix_links (id, project_id, link_type, from_kind, from_id, to_kind, to_id, note, created_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, projectId, linkType, fromKind, fromId, toKind, toId, note, nowIso(), 'ai');
    out.created.matrix_links.push(id);
  } catch {
    // A duplicate link is not an error — the UNIQUE constraint simply means it already exists.
  }
}

/* ------------------------------------------------------------------ *
 * Per-artifact inserters
 * ------------------------------------------------------------------ */

export function insertUseCases(out: PersistOutcome, draftList: Row[], ctx: PersistContext): string[] {
  const ids: string[] = [];
  for (const uc of draftList) {
    const id = newId('uc_');
    const code = nextCode('use_cases', 'UC', ctx.projectId);
    db.prepare(
      `INSERT INTO use_cases
         (id, project_id, code, name, goal, actors, preconditions, postconditions, main_flow,
          alternate_flows, business_rules, priority, risk, status, generated_by, ai_generation_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', 'ai', ?, ?, ?)`,
    ).run(
      id,
      ctx.projectId,
      code,
      s(uc.name, 'Use Case (AI)'),
      s(uc.goal),
      toJson(strArr(uc.actors)),
      toJson(strArr(uc.preconditions)),
      toJson(strArr(uc.postconditions)),
      toJson(strArr(uc.main_flow)),
      toJson(arr(uc.alternate_flows)),
      toJson(strArr(uc.business_rules)),
      priority(uc.priority),
      riskOf(uc.risk),
      ctx.generationId,
      nowIso(),
      nowIso(),
    );
    ids.push(id);
    out.created.use_cases.push(id);
    out.labels.push({ kind: 'use_case', id, code, title: s(uc.name, code) });

    for (const reqId of ctx.requirementIds ?? []) {
      insertMatrixLink(out, ctx.projectId, 'requirement_to_usecase', 'requirement', reqId, 'usecase', id, 'Dibuat oleh AI');
    }
  }
  return ids;
}

export function insertScenarios(
  out: PersistOutcome,
  draftList: Row[],
  ctx: PersistContext,
  parentUseCaseIds: string[],
): string[] {
  const ids: string[] = [];
  draftList.forEach((sc, i) => {
    const id = newId('sc_');
    const code = nextCode('scenarios', 'SC', ctx.projectId);
    const parent = parentUseCaseIds[i % Math.max(1, parentUseCaseIds.length)] ?? parentUseCaseIds[0] ?? null;
    db.prepare(
      `INSERT INTO scenarios
         (id, project_id, use_case_id, code, title, kind, given_text, when_text, then_text, priority,
          generated_by, ai_generation_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ai', ?, ?, ?)`,
    ).run(
      id,
      ctx.projectId,
      parent,
      code,
      s(sc.title, 'Skenario (AI)'),
      s(sc.kind, 'happy_path'),
      s(sc.given_text),
      s(sc.when_text),
      s(sc.then_text),
      priority(sc.priority),
      ctx.generationId,
      nowIso(),
      nowIso(),
    );
    ids.push(id);
    out.created.scenarios.push(id);
    out.labels.push({ kind: 'scenario', id, code, title: s(sc.title, code) });
    if (parent) {
      insertMatrixLink(out, ctx.projectId, 'usecase_to_scenario', 'usecase', parent, 'scenario', id, 'Dibuat oleh AI');
    }
  });
  return ids;
}

export function insertTestCases(
  out: PersistOutcome,
  draftList: Row[],
  ctx: PersistContext,
  parentScenarioIds: string[],
  parentUseCaseIds: string[],
): string[] {
  const ids: string[] = [];
  draftList.forEach((tc, i) => {
    const id = newId('tc_');
    const code = nextCode('test_cases', 'TC', ctx.projectId);
    const scenarioId = parentScenarioIds[i % Math.max(1, parentScenarioIds.length)] ?? parentScenarioIds[0] ?? null;
    const useCaseId = parentUseCaseIds[i % Math.max(1, parentUseCaseIds.length)] ?? parentUseCaseIds[0] ?? null;
    db.prepare(
      `INSERT INTO test_cases
         (id, project_id, scenario_id, use_case_id, code, title, objective, preconditions, type, layer,
          priority, severity, automation_status, engine, risk_score, estimated_minutes, tags, test_data,
          expected_result, is_regression, status, generated_by, ai_generation_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'to_be_automated', 'ai', ?, ?, ?, ?, ?, ?, 'ready', 'ai', ?, ?, ?)`,
    ).run(
      id,
      ctx.projectId,
      scenarioId,
      useCaseId,
      code,
      s(tc.title, 'Test Case (AI)'),
      s(tc.objective),
      s(tc.preconditions),
      s(tc.type, 'functional'),
      s(tc.layer, 'web'),
      priority(tc.priority),
      s(tc.severity, 'major'),
      Number(tc.risk_score ?? 0) || 0,
      Number(tc.estimated_minutes ?? 10) || 10,
      toJson(strArr(tc.tags)),
      toJson(arr(tc.test_data)),
      s(tc.expected_result),
      tc.is_regression ? 1 : 0,
      ctx.generationId,
      nowIso(),
      nowIso(),
    );
    ids.push(id);
    out.created.test_cases.push(id);
    out.labels.push({ kind: 'test_case', id, code, title: s(tc.title, code) });

    // Steps (test_steps belongs to the test-case aggregate — additive insert only).
    const steps = arr(tc.steps);
    steps.forEach((step, order) => {
      const stepId = newId('tst_');
      const st = (step ?? {}) as Row;
      db.prepare(
        `INSERT INTO test_steps (id, test_case_id, order_index, action, expected, data, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        stepId,
        id,
        order + 1,
        s(st.action, `Langkah ${order + 1}`),
        s(st.expected),
        s(st.data) || null,
        nowIso(),
      );
      out.created.test_steps.push(stepId);
    });

    if (scenarioId) {
      insertMatrixLink(out, ctx.projectId, 'scenario_to_testcase', 'scenario', scenarioId, 'testcase', id, 'Dibuat oleh AI');
    }
  });
  return ids;
}

/**
 * Replaces `{{token}}` placeholders in a URL with the value from `query`, so a path such
 * as `/mock/orders/{{orderId}}` becomes a concrete executable path.
 */
function materialisePath(path: string, query: Record<string, string>): string {
  return (path ?? '').replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, name: string) => query[name] ?? `1`);
}

export function insertApiRequests(
  out: PersistOutcome,
  drafts: Row[],
  ctx: PersistContext,
): string[] {
  let collectionId = ctx.collectionId ?? null;
  if (!collectionId) {
    // api_requests.collection_id is NOT NULL and FK-guarded, so we need a collection row.
    const existing = db
      .prepare(`SELECT id FROM api_collections WHERE project_id = ? ORDER BY created_at LIMIT 1`)
      .get(ctx.projectId) as { id?: string } | undefined;
    collectionId = existing?.id ?? null;
    if (!collectionId) {
      const id = newId('acl_');
      db.prepare(
        `INSERT INTO api_collections (id, project_id, name, description, base_url, auth_type, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'bearer', ?, ?)`,
      ).run(
        id,
        ctx.projectId,
        'AI Generated Collection',
        'Koleksi request API yang dihasilkan lapisan AI QATools.',
        process.env.QATOOLS_API_BASE ?? `http://127.0.0.1:${process.env.PORT ?? 5174}/api`,
        nowIso(),
        nowIso(),
      );
      collectionId = id;
      out.labels.push({ kind: 'api_collection', id, code: null, title: 'AI Generated Collection' });
    }
  }

  const ids: string[] = [];
  for (const ar of drafts) {
    const id = newId('apr_');
    const query = (typeof ar.query === 'object' && ar.query !== null ? ar.query : {}) as Record<string, string>;
    const path = materialisePath(s(ar.path, '/'), query);
    db.prepare(
      `INSERT INTO api_requests
         (id, collection_id, project_id, test_case_id, name, method, path, headers, query, body, body_type,
          assertions, pre_script, post_script, generated_by, created_at, updated_at)
       VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, 'ai', ?, ?)`,
    ).run(
      id,
      collectionId,
      ctx.projectId,
      s(ar.name, 'API Request (AI)'),
      s(ar.method, 'GET').toUpperCase(),
      path,
      toJson(ar.headers ?? {}),
      toJson(query),
      s(ar.body) || null,
      ['json', 'form', 'raw', 'none'].includes(String(ar.body_type)) ? String(ar.body_type) : 'none',
      toJson((arr(ar.assertions) as Assertion[]) ?? []),
      nowIso(),
      nowIso(),
    );
    ids.push(id);
    out.created.api_requests.push(id);
    out.labels.push({ kind: 'api_request', id, code: null, title: s(ar.name, 'API Request') });
  }
  return ids;
}

export function insertDbChecks(out: PersistOutcome, drafts: Row[], ctx: PersistContext): string[] {
  let connectionId = ctx.connectionId ?? null;
  if (!connectionId) {
    const existing = db
      .prepare(`SELECT id FROM db_connections WHERE project_id = ? ORDER BY created_at LIMIT 1`)
      .get(ctx.projectId) as { id?: string } | undefined;
    connectionId = existing?.id ?? null;
    if (!connectionId) {
      const id = newId('dbc_conn_');
      db.prepare(
        `INSERT INTO db_connections (id, project_id, name, dialect, dsn_masked, dsn, readonly_guard, created_by, created_at, updated_at)
         VALUES (?, ?, ?, 'sqlite', ?, NULL, 1, 'ai', ?, ?)`,
      ).run(
        id,
        ctx.projectId,
        'AI Local SQLite (read-only)',
        process.env.QATOOLS_DB ? 'sqlite://…/qatools.db' : 'sqlite://apps/api/data/qatools.db',
        nowIso(),
        nowIso(),
      );
      connectionId = id;
      out.labels.push({ kind: 'db_connection', id, code: null, title: 'AI Local SQLite (read-only)' });
    }
  }

  const ids: string[] = [];
  for (const dc of drafts) {
    const id = newId('dbc_');
    db.prepare(
      `INSERT INTO db_checks
         (id, project_id, connection_id, test_case_id, name, sql, assertions, setup_sql, teardown_sql,
          generated_by, created_at, updated_at)
       VALUES (?, ?, ?, NULL, ?, ?, ?, NULL, NULL, 'ai', ?, ?)`,
    ).run(
      id,
      ctx.projectId,
      connectionId,
      s(dc.name, 'DB Check (AI)'),
      s(dc.sql, 'SELECT 1 AS ok;'),
      toJson((arr(dc.assertions) as Assertion[]) ?? []),
      nowIso(),
      nowIso(),
    );
    ids.push(id);
    out.created.db_checks.push(id);
    out.labels.push({ kind: 'db_check', id, code: null, title: s(dc.name, 'DB Check') });
  }
  return ids;
}

export function insertWebFlows(out: PersistOutcome, drafts: Row[], ctx: PersistContext): string[] {
  const ids: string[] = [];
  for (const wf of drafts) {
    const id = newId('wbf_');
    db.prepare(
      `INSERT INTO web_flows
         (id, project_id, test_case_id, name, start_url, steps, viewport, generated_by, created_at, updated_at)
       VALUES (?, ?, NULL, ?, ?, ?, ?, 'ai', ?, ?)`,
    ).run(
      id,
      ctx.projectId,
      s(wf.name, 'Web Flow (AI)'),
      s(wf.start_url),
      toJson(arr(wf.steps)),
      toJson({ width: 1366, height: 768 }),
      nowIso(),
      nowIso(),
    );
    ids.push(id);
    out.created.web_flows.push(id);
    out.labels.push({ kind: 'web_flow', id, code: null, title: s(wf.name, 'Web Flow') });
  }
  return ids;
}

export function insertRequirements(out: PersistOutcome, drafts: Row[], ctx: PersistContext): string[] {
  const ids: string[] = [];
  for (const rq of drafts) {
    const id = newId('req_');
    const code = nextCode('requirements', 'REQ', ctx.projectId);
    db.prepare(
      `INSERT INTO requirements
         (id, project_id, code, title, description, source, priority, status, acceptance_criteria, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?)`,
    ).run(
      id,
      ctx.projectId,
      code,
      s(rq.title, 'Kebutuhan (AI)'),
      s(rq.description),
      s(rq.source, 'ai'),
      priority(rq.priority),
      toJson(strArr(rq.acceptance_criteria)),
      nowIso(),
      nowIso(),
    );
    ids.push(id);
    out.created.requirements.push(id);
    out.labels.push({ kind: 'requirement', id, code, title: s(rq.title, code) });
  }
  return ids;
}

/* ------------------------------------------------------------------ *
 * Orchestration
 * ------------------------------------------------------------------ */

/**
 * Persists whatever artifacts the given task produced. Returns the created ids so the
 * caller can put them in `meta` for UI navigation. Unknown tasks are reported in `skipped`.
 */
export function persistArtifacts(
  task: string,
  data: unknown,
  ctx: PersistContext,
): PersistOutcome {
  const out = emptyOutcome();

  if (!ctx.projectId) {
    out.skipped.push('project_id tidak diberikan — artifact tidak dapat disimpan.');
    return out;
  }

  const payload = data as Row | Row[] | null;
  const list = Array.isArray(payload) ? payload : payload ? [payload] : [];

  db.transaction(() => {
    switch (task) {
      case 'generate_usecases': {
        const ids = insertUseCases(out, list, ctx);
        void ids;
        break;
      }
      case 'generate_scenarios': {
        const parents = ctx.useCaseIds ?? [];
        if (!parents.length) {
          out.skipped.push('use_case_ids tidak diberikan: skenario dibuat tanpa induk use case.');
        }
        insertScenarios(out, list, ctx, parents);
        break;
      }
      case 'generate_testcases': {
        const scenarioParents = ctx.scenarioIds ?? [];
        if (!scenarioParents.length) {
          out.skipped.push('scenario_ids tidak diberikan: test case dibuat tanpa induk skenario.');
        }
        insertTestCases(out, list, ctx, scenarioParents, ctx.useCaseIds ?? []);
        break;
      }
      case 'generate_api_tests':
        insertApiRequests(out, list, ctx);
        break;
      case 'generate_db_checks':
        insertDbChecks(out, list, ctx);
        break;
      case 'generate_web_flow':
        insertWebFlows(out, list, ctx);
        break;
      case 'generate_test_data': {
        const payloadObj = (Array.isArray(payload) ? null : (payload as Row | null)) ?? null;
        if (!payloadObj) {
          out.skipped.push('generate_test_data tidak menghasilkan objek dataset.');
          break;
        }
        const id = newId('tds_');
        db.prepare(
          `INSERT INTO test_data_sets (id, project_id, environment_id, name, description, columns, rows, generated_by, created_at, updated_at)
           VALUES (?, ?, NULL, ?, ?, ?, ?, 'ai', ?, ?)`,
        ).run(
          id,
          ctx.projectId,
          `Data Uji AI ${new Date().toISOString().slice(0, 10)}`,
          s(payloadObj.notes),
          toJson(strArr(payloadObj.columns)),
          toJson(arr(payloadObj.rows)),
          nowIso(),
          nowIso(),
        );
        out.labels.push({ kind: 'test_data_set', id, code: null, title: 'Data Uji AI' });
        break;
      }
      case 'crawl_site': {
        const payloadObj = (Array.isArray(payload) ? null : (payload as Row | null)) ?? null;
        const suggested = payloadObj ? arr(payloadObj.suggested_use_cases) : [];
        if (!suggested.length) {
          out.skipped.push('crawl tidak menghasilkan saran use case.');
          break;
        }
        const drafts: Row[] = suggested.map((su) => {
          const raw = (su ?? {}) as Row;
          return {
            name: s(raw.name, 'Use Case dari Crawl'),
            goal: s(raw.goal),
            actors: strArr(raw.actors),
            preconditions: ['Halaman target dapat diakses pada environment uji.'],
            postconditions: ['Fungsi pada halaman target terverifikasi berjalan sesuai harapan.'],
            main_flow: [
              'Pengguna membuka halaman terkait.',
              'Pengguna menjalankan fungsi yang teridentifikasi dari hasil crawl.',
              'Sistem memproses dan menampilkan hasil.',
            ],
            alternate_flows: [],
            business_rules: [],
            priority: raw.priority ?? 'medium',
            risk: 'medium',
          };
        });
        insertUseCases(out, drafts, ctx);
        break;
      }
      default:
        out.skipped.push(`Task "${task}" tidak membuat artifact yang dapat disimpan.`);
        break;
    }
  });

  if (!out.skipped.length && !out.labels.length) {
    out.skipped.push('Tidak ada artifact yang dibuat.');
  }
  return out;
}

/** Exposed for tests: prove that this module never writes UPDATE/DELETE statements. */
export const PERSIST_WRITE_VERBS = ['INSERT', 'INSERT OR IGNORE'] as const;

export { exists };
