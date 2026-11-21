/**
 * Artifact gathering for codegen.
 *
 * Reads the QATools artifacts a generated project is built from — test cases,
 * their steps, the linked web flows, API requests (with collection defaults) and
 * DB checks (with their connection dialect) — and resolves the
 * requirement → use case → scenario → test case chain so every generated test can
 * carry its provenance as a comment (ARCHITECTURE.md §5.4).
 *
 * Read-only: this module never writes to any table. Persistence of the *generated*
 * row lives in `repo.ts`.
 */

import type {
  ApiCollection,
  ApiRequest,
  Assertion,
  CodegenFramework,
  CodegenRequest,
  DbCheck,
  DbConnection,
  MatrixLink,
  Requirement,
  Scenario,
  TestCase,
  TestStep,
  UseCase,
  WebFlow,
  WebStep,
} from '@qatools/shared';
import { CODEGEN_FRAMEWORKS } from '@qatools/shared';
import { db, logActivity } from '../../db/index.js';
import {
  blank,
  clampInt,
  dataRows,
  joinUrl,
  labelOf,
  normaliseUrl,
  numOf,
  packageSegment,
  slugify,
  stringArray,
  stringRecord,
  textOf,
} from './util.js';
import {
  toGeneratorLayer,
  type Ancestry,
  type GenerateContext,
  type GeneratorLayer,
  type ResolvedCase,
  type ResolvedDbCheck,
  type ResolvedFlow,
  type ResolvedRequest,
} from './types.js';

/* ------------------------------------------------------------------ *
 * Low-level row readers
 * ------------------------------------------------------------------ */

function rows<T>(sql: string, ...params: unknown[]): T[] {
  return db.prepare(sql).all(...params) as unknown as T[];
}

function row<T>(sql: string, ...params: unknown[]): T | undefined {
  return db.prepare(sql).get(...params) as unknown as T | undefined;
}

/** `Assertion[]` from a JSON column; unusable entries are dropped, not guessed at. */
export function parseAssertions(value: unknown): Assertion[] {
  if (!value) return [];
  let parsed: unknown = value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];
    try {
      parsed = JSON.parse(trimmed) as unknown;
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  const out: Assertion[] = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== 'object') continue;
    const a = entry as Partial<Assertion>;
    if (typeof a.operator !== 'string' || typeof a.source !== 'string') continue;
    out.push({
      source: a.source,
      path: typeof a.path === 'string' ? a.path : undefined,
      operator: a.operator,
      expected: a.expected,
      message: typeof a.message === 'string' ? a.message : undefined,
    } as Assertion);
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Ancestry (requirement → use case → scenario)
 * ------------------------------------------------------------------ */

interface CaseAncestry extends Ancestry {
  requirement_code: string | null;
  use_case_code: string | null;
  scenario_code: string | null;
  scenario_kind: string | null;
}

function emptyAncestry(): CaseAncestry {
  return {
    requirement: null,
    use_case: null,
    scenario: null,
    requirement_code: null,
    use_case_code: null,
    scenario_code: null,
    scenario_kind: null,
  };
}

function ancestryFor(testCase: TestCase): CaseAncestry {
  const out = emptyAncestry();

  const scenario =
    (testCase.scenario_id ? row<Scenario>('SELECT * FROM scenarios WHERE id = ?', testCase.scenario_id) : undefined) ??
    (testCase.use_case_id
      ? undefined
      : undefined);
  if (scenario) {
    out.scenario = scenario.title;
    out.scenario_code = scenario.code;
    out.scenario_kind = scenario.kind;
  }

  const useCaseId = testCase.use_case_id ?? scenario?.use_case_id ?? null;
  let useCase: UseCase | undefined;
  if (useCaseId) {
    useCase = row<UseCase>('SELECT * FROM use_cases WHERE id = ?', useCaseId);
    if (useCase) {
      out.use_case = useCase.name;
      out.use_case_code = useCase.code;
    }
  }

  // Requirements are reached through the frozen matrix_links direction:
  // `from_id` is upstream (requirement), `to_id` is downstream (test case/use case).
  const requirementId = firstRequirementId(testCase.id, useCaseId);
  if (requirementId) {
    const requirement = row<Requirement>('SELECT * FROM requirements WHERE id = ?', requirementId);
    if (requirement) {
      out.requirement = requirement.title;
      out.requirement_code = requirement.code;
    }
  }

  return out;
}

/** Walks the shortcut then the long path; never assumes a link exists. */
function firstRequirementId(testCaseId: string, useCaseId: string | null): string | null {
  const direct = row<Pick<MatrixLink, 'from_id'>>(
    `SELECT from_id FROM matrix_links
      WHERE link_type = 'requirement_to_testcase' AND to_id = ?
      ORDER BY created_at ASC LIMIT 1`,
    testCaseId,
  );
  if (direct?.from_id) return direct.from_id;

  if (useCaseId) {
    const viaUseCase = row<Pick<MatrixLink, 'from_id'>>(
      `SELECT from_id FROM matrix_links
        WHERE link_type = 'requirement_to_usecase' AND to_id = ?
        ORDER BY created_at ASC LIMIT 1`,
      useCaseId,
    );
    if (viaUseCase?.from_id) return viaUseCase.from_id;
  }
  return null;
}

/** A one-line "REQ-001 › UC-003 › SC-002" breadcrumb used as a code comment. */
export function ancestryLine(a: Ancestry): string {
  const parts: string[] = [];
  if (!blank(a.requirement)) parts.push(textOf(a.requirement, ''));
  if (!blank(a.use_case)) parts.push(textOf(a.use_case, ''));
  if (!blank(a.scenario)) parts.push(textOf(a.scenario, ''));
  return parts.join(' > ');
}

/* ------------------------------------------------------------------ *
 * Test cases
 * ------------------------------------------------------------------ */

/** Cases that can be automated at all — `cannot_automate` is filtered out early. */
function projectCases(projectId: string): TestCase[] {
  return rows<TestCase>(
    `SELECT * FROM test_cases
      WHERE project_id = ? AND status <> 'deprecated'
      ORDER BY code ASC, created_at ASC`,
    projectId,
  );
}

function resolveCases(
  projectId: string,
  request: CodegenRequest,
  warnings: string[],
): ResolvedCase[] {
  const all = projectCases(projectId);
  const wanted = Array.isArray(request.test_case_ids) ? request.test_case_ids.filter(Boolean) : [];

  let selected: TestCase[];
  if (wanted.length) {
    const byId = new Map(all.map((c) => [c.id, c]));
    selected = [];
    const missing: string[] = [];
    for (const id of wanted) {
      const hit = byId.get(id);
      if (hit) selected.push(hit);
      else missing.push(id);
    }
    if (missing.length) {
      warnings.push(
        `${missing.length} test case id diminta tetapi tidak ditemukan di proyek ini: ${missing
          .slice(0, 5)
          .join(', ')}${missing.length > 5 ? '…' : ''}`,
      );
    }
  } else {
    selected = all;
  }

  const automatable: TestCase[] = [];
  const skippedManual: string[] = [];
  for (const c of selected) {
    if (c.automation_status === 'cannot_automate') {
      skippedManual.push(c.code);
      continue;
    }
    automatable.push(c);
  }
  if (skippedManual.length) {
    warnings.push(
      `${skippedManual.length} test case ditandai "cannot_automate" dan dilewati: ${skippedManual
        .slice(0, 8)
        .join(', ')}${skippedManual.length > 8 ? '…' : ''}`,
    );
  }

  return automatable.map((testCase) => {
    const steps = rows<TestStep>(
      'SELECT * FROM test_steps WHERE test_case_id = ? ORDER BY order_index ASC',
      testCase.id,
    );
    const ancestry = ancestryFor(testCase);
    return {
      test_case: testCase,
      steps,
      data: dataRows(testCase.test_data),
      tags: stringArray(testCase.tags),
      preconditions: stringArray(testCase.preconditions),
      ancestry: {
        requirement: ancestry.requirement,
        use_case: ancestry.use_case,
        scenario: ancestry.scenario,
      },
    } satisfies ResolvedCase;
  });
}

/* ------------------------------------------------------------------ *
 * Web flows
 * ------------------------------------------------------------------ */

function resolveFlows(
  projectId: string,
  caseIds: Set<string>,
  defaultBaseUrl: string,
): ResolvedFlow[] {
  const flows = rows<WebFlow>(
    'SELECT * FROM web_flows WHERE project_id = ? ORDER BY created_at ASC',
    projectId,
  );

  const out: ResolvedFlow[] = [];
  for (const flow of flows) {
    // Honour the case filter: an unbound flow stays, a flow bound to an excluded
    // case is dropped (generating it would silently widen the requested scope).
    if (flow.test_case_id && caseIds.size && !caseIds.has(flow.test_case_id)) continue;

    const rawSteps = safeParse<WebStep[]>(flow.steps, []);
    const steps = Array.isArray(rawSteps) ? rawSteps.filter(isWebStep) : [];
    const viewportRaw = safeParse<{ width?: unknown; height?: unknown }>(flow.viewport, {});
    const bound = flow.test_case_id
      ? row<Pick<TestCase, 'code' | 'title'>>('SELECT code, title FROM test_cases WHERE id = ?', flow.test_case_id)
      : undefined;

    out.push({
      flow,
      steps,
      viewport: {
        width: clampInt(viewportRaw?.width, 320, 3840),
        height: Math.max(1, clampInt(viewportRaw?.height, 240, 2160)),
      },
      start_url: normaliseUrl(flow.start_url, defaultBaseUrl),
      test_case_id: flow.test_case_id,
      test_case_code: bound?.code ?? null,
      test_case_title: bound?.title ?? null,
    });
  }
  return out;
}

function isWebStep(value: unknown): value is WebStep {
  if (!value || typeof value !== 'object') return false;
  const action = (value as WebStep).action;
  return typeof action === 'string' && action.trim() !== '';
}

function safeParse<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value !== 'string') return (value as T) ?? fallback;
  try {
    return (JSON.parse(value) as T) ?? fallback;
  } catch {
    return fallback;
  }
}

/* ------------------------------------------------------------------ *
 * API requests + collections
 * ------------------------------------------------------------------ */

function resolveRequests(
  projectId: string,
  caseIds: Set<string>,
  explicitBaseUrl: string,
  warnings: string[],
): ResolvedRequest[] {
  const requests = rows<ApiRequest>(
    'SELECT * FROM api_requests WHERE project_id = ? ORDER BY created_at ASC',
    projectId,
  );
  const collections = new Map<string, ApiCollection>();
  for (const c of rows<ApiCollection>('SELECT * FROM api_collections WHERE project_id = ?', projectId)) {
    collections.set(c.id, c);
  }

  const out: ResolvedRequest[] = [];
  for (const request of requests) {
    if (request.test_case_id && caseIds.size && !caseIds.has(request.test_case_id)) continue;

    const collection = collections.get(request.collection_id);
    if (!collection) {
      warnings.push(
        `API request "${labelOf(request.name)}" dilewati: collection ${request.collection_id} tidak ditemukan.`,
      );
      continue;
    }

    const rawUrl = textOf(request.path, '');
    const collectionBase = normaliseUrl(collection.base_url, '');
    const base = normaliseUrl(explicitBaseUrl, collectionBase);
    if (!/^https?:\/\//i.test(rawUrl) && !base) {
      warnings.push(
        `API request "${labelOf(request.name)}" memakai path relatif "${rawUrl}" tetapi tidak ada base_url; ` +
          'request tetap dibuat dan wajib diisi manual.',
      );
    }

    const authConfig = stringRecord(collection.auth_config);
    const bound = request.test_case_id
      ? row<Pick<TestCase, 'code' | 'title'>>('SELECT code, title FROM test_cases WHERE id = ?', request.test_case_id)
      : undefined;

    out.push({
      request,
      assertions: parseAssertions(request.assertions),
      headers: stringRecord(request.headers),
      query: stringRecord(request.query),
      collection_name: labelOf(collection.name, 'Collection'),
      base_url: base,
      auth: {
        type: normaliseAuthType(collection.auth_type),
        token: pick(authConfig, ['token', 'bearer_token', 'access_token']),
        username: pick(authConfig, ['username', 'user']),
        password: pick(authConfig, ['password', 'pass']),
        header: pick(authConfig, ['header', 'header_name', 'key_name']),
        key: pick(authConfig, ['key', 'api_key_name']),
        value: pick(authConfig, ['value', 'api_key', 'api_key_value']),
      },
      collection_variables: stringRecord(collection.variables),
      test_case_id: request.test_case_id,
      test_case_code: bound?.code ?? null,
      test_case_title: bound?.title ?? null,
    });
  }
  return out;
}

function normaliseAuthType(value: unknown): 'none' | 'bearer' | 'basic' | 'api_key' {
  const v = textOf(value, 'none').toLowerCase();
  if (v === 'bearer' || v === 'basic' || v === 'api_key') return v;
  return 'none';
}

function pick(bag: Record<string, string>, keys: string[]): string | null {
  for (const key of keys) {
    const v = bag[key];
    if (v !== undefined && v !== '') return v;
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * DB checks
 * ------------------------------------------------------------------ */

function resolveDbChecks(
  projectId: string,
  caseIds: Set<string>,
  warnings: string[],
): ResolvedDbCheck[] {
  const checks = rows<DbCheck>(
    'SELECT * FROM db_checks WHERE project_id = ? ORDER BY created_at ASC',
    projectId,
  );
  const connections = new Map<string, DbConnection>();
  for (const c of rows<DbConnection>('SELECT * FROM db_connections WHERE project_id = ?', projectId)) {
    connections.set(c.id, c);
  }

  const out: ResolvedDbCheck[] = [];
  for (const check of checks) {
    if (check.test_case_id && caseIds.size && !caseIds.has(check.test_case_id)) continue;

    const connection = connections.get(check.connection_id);
    if (!connection) {
      warnings.push(
        `DB check "${labelOf(check.name)}" dilewati: koneksi ${check.connection_id} tidak ditemukan.`,
      );
      continue;
    }
    if (blank(check.sql)) {
      warnings.push(`DB check "${labelOf(check.name)}" tidak punya SQL dan dilewati.`);
      continue;
    }

    const bound = check.test_case_id
      ? row<Pick<TestCase, 'code' | 'title'>>('SELECT code, title FROM test_cases WHERE id = ?', check.test_case_id)
      : undefined;

    out.push({
      check,
      assertions: parseAssertions(check.assertions),
      dialect: normaliseDialect(connection.dialect),
      connection_name: labelOf(connection.name, 'Database'),
      dsn_masked: textOf(connection.dsn_masked, ''),
      test_case_id: check.test_case_id,
      test_case_code: bound?.code ?? null,
      test_case_title: bound?.title ?? null,
    });
  }
  return out;
}

function normaliseDialect(value: unknown): 'sqlite' | 'postgres' | 'mysql' {
  const v = textOf(value, 'sqlite').toLowerCase();
  if (v === 'postgres' || v === 'postgresql' || v === 'pg') return 'postgres';
  if (v === 'mysql' || v === 'mariadb') return 'mysql';
  return 'sqlite';
}

/* ------------------------------------------------------------------ *
 * Project + framework resolution
 * ------------------------------------------------------------------ */

export interface ProjectRef {
  id: string;
  key: string;
  name: string;
  target_url: string | null;
}

export function getProject(projectId: string): ProjectRef | undefined {
  const project = row<ProjectRef>(
    'SELECT id, key, name, target_url FROM projects WHERE id = ?',
    projectId,
  );
  return project ?? undefined;
}

/**
 * The default environment's base_url wins over the project's target_url: an
 * environment is what a QA engineer actually points a run at.
 */
export function defaultBaseUrl(projectId: string, fallback: string | null): string {
  const env = row<{ base_url: string | null; api_base: string | null; is_default: number }>(
    `SELECT base_url, api_base, is_default FROM environments
      WHERE project_id = ? ORDER BY is_default DESC, created_at ASC LIMIT 1`,
    projectId,
  );
  const candidates = [env?.base_url, env?.api_base, fallback];
  for (const c of candidates) {
    const url = normaliseUrl(c, '');
    if (url) return url;
  }
  return 'http://localhost:3000';
}

/** Layers the framework itself can serve, intersected with the caller's request. */
export function resolveLayers(
  framework: CodegenFramework,
  request: CodegenRequest,
  warnings: string[],
): GeneratorLayer[] {
  const supported = new Set<GeneratorLayer>(frameworkSupports(framework));
  const asked = Array.isArray(request.layers)
    ? request.layers.map((l) => textOf(l, '').toLowerCase()).filter(Boolean)
    : [];

  if (!asked.length) return [...supported];

  const chosen = new Set<GeneratorLayer>();
  for (const layer of asked) {
    if (layer === 'performance' && framework === 'k6') {
      chosen.add('performance');
      continue;
    }
    if (supported.has(layer as GeneratorLayer)) {
      chosen.add(layer as GeneratorLayer);
    } else {
      warnings.push(
        `Layer "${layer}" tidak didukung framework "${framework}" dan diabaikan ` +
          `(didukung: ${[...supported].join(', ')}).`,
      );
    }
  }

  // Asking for something the framework supports but the project has no artifacts for
  // is NOT a warning here — `buildContext` reports that once it has looked.
  return chosen.size ? [...chosen] : [...supported];
}

function frameworkSupports(framework: CodegenFramework): Array<'web' | 'api' | 'db' | 'performance'> {
  switch (framework) {
    case 'playwright':
      return ['web', 'api'];
    case 'robotframework':
      return ['web', 'api'];
    case 'pytest':
      return ['api', 'db'];
    case 'cypress':
      return ['web'];
    case 'selenium-java':
      return ['web'];
    case 'k6':
      return ['api', 'performance'];
    case 'postman':
      return ['api'];
    case 'rest-assured':
      return ['api'];
    default:
      return ['web', 'api'];
  }
}

export function isCodegenFramework(value: unknown): value is CodegenFramework {
  return typeof value === 'string' && (CODEGEN_FRAMEWORKS as readonly string[]).includes(value);
}

/* ------------------------------------------------------------------ *
 * The gather entry point
 * ------------------------------------------------------------------ */

export interface BuildContextResult {
  ctx: GenerateContext;
  /** Cases that survived filtering — used to scope flows/requests/db checks. */
  caseIds: Set<string>;
}

/**
 * Builds the `GenerateContext` for one codegen request.
 *
 * Never throws for missing artifacts: an empty project produces a context with
 * zero cases and a populated `warnings[]`, and the caller decides whether that is
 * fatal (it is not — ARCHITECTURE.md §11.7 requires a warning, not an exception).
 */
export function buildContext(
  projectId: string,
  request: CodegenRequest,
  project: ProjectRef,
): GenerateContext {
  const warnings: string[] = [];

  const layers = resolveLayers(request.framework, request, warnings);
  const cases = resolveCases(projectId, request, warnings);

  // Restrict the layer set to what the project actually has artifacts for.
  const caseIds = new Set(cases.map((c) => c.test_case.id));
  const resolvedBase = normaliseUrl(
    request.base_url,
    defaultBaseUrl(projectId, project.target_url),
  );

  const flows = layers.includes('web')
    ? resolveFlows(projectId, caseIds, resolvedBase)
    : [];
  const requests = layers.includes('api')
    ? resolveRequests(projectId, caseIds, resolvedBase, warnings)
    : [];
  const dbChecks = layers.includes('db') ? resolveDbChecks(projectId, caseIds, warnings) : [];

  if (!cases.length) {
    warnings.push(
      'Tidak ada test case yang bisa digenerate: proyek ini belum punya test case (atau semua yang dipilih ' +
        'bertanda cannot_automate). Proyek tetap dibuat dengan struktur, config, dan README yang benar.',
    );
  }

  for (const layer of layers) {
    if (layer === 'performance') continue;
    const empty =
      (layer === 'web' && flows.length === 0) ||
      (layer === 'api' && requests.length === 0) ||
      (layer === 'db' && dbChecks.length === 0);
    if (empty) {
      warnings.push(
        `Layer "${layer}" diminta tetapi belum ada artefak ${layerLabel(layer)} di proyek "${project.name}"; ` +
          `generator tetap membuat kerangka pengujian ${layerLabel(layer)} agar proyek bisa dijalankan.`,
      );
    }
  }

  const unsupportedLayers = new Set<string>();
  for (const c of cases) {
    const mapped = toGeneratorLayer(c.test_case.layer);
    if (!mapped) unsupportedLayers.add(c.test_case.layer);
  }
  if (unsupportedLayers.size) {
    warnings.push(
      `Test case dengan layer ${[...unsupportedLayers].join(', ')} tidak punya padanan otomasi; ` +
        'langkah manualnya tetap ditulis sebagai komentar agar tidak hilang.',
    );
  }

  const workers = clampInt(request.workers, 1, 16);
  const parallel = request.parallel === true || workers > 1;

  const slug = slugify(`${project.key}-${project.name}`, 'qatools-project');

  const ctx: GenerateContext = {
    project: {
      id: project.id,
      key: textOf(project.key, 'PRJ'),
      name: labelOf(project.name, 'QATools Project'),
      target_url: normaliseUrl(project.target_url, '') || null,
    },
    framework: request.framework,
    slug,
    package_name: `com.qatools.${packageSegment(project.key, 'prj')}`,
    base_url: resolvedBase,
    request,
    layers,
    parallel,
    workers,
    cases,
    flows,
    requests,
    db_checks: dbChecks,
    warnings,
    ai_enriched: request.use_ai === true,
  };

  return ctx;
}

function layerLabel(layer: GeneratorLayer): string {
  switch (layer) {
    case 'web':
      return 'web flow';
    case 'api':
      return 'API request';
    case 'db':
      return 'DB check';
    default:
      return 'performance';
  }
}

/** Records the codegen run in the activity log; never throws. */
export function logCodegen(projectId: string, framework: string, fileCount: number): void {
  logActivity({
    project_id: projectId,
    action: 'generate',
    entity_kind: 'generated_project',
    entity_id: null,
    summary: `codegen ${framework}: ${fileCount} file`,
  });
}

/** Re-exported so generators can reuse the same coercion without importing util directly. */
export { dataRows, stringArray, stringRecord, textOf, numOf, joinUrl };
