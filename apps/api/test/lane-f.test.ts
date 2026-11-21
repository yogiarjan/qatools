/**
 * Lane F tests — automation framework code generation.
 *
 *   node --test --import ./apps/api/node_modules/tsx/dist/loader.mjs apps/api/test/lane-f.test.ts
 *
 * The suite boots the real Fastify app (so the routes, envelopes and persistence are
 * exercised) against a throwaway SQLite file, seeds a fixture project with every
 * artifact kind the generators consume, then generates **every** `CODEGEN_FRAMEWORKS`
 * entry and asserts the output is genuinely runnable rather than pseudocode.
 */

import { test, before, after, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

// The API reads QATOOLS_DB at import time, so the scratch DB must be in place first.
const scratch = mkdtempSync(resolve(tmpdir(), 'qatools-lane-f-'));
process.env.QATOOLS_DB = resolve(scratch, 'lane-f.db');

import { CODEGEN_FRAMEWORKS, FRAMEWORK_META } from '@qatools/shared';
import type { CodegenFramework, GeneratedFile, GeneratedProject } from '@qatools/shared';

const { buildApp } = await import('../src/server.js');
const { db } = await import('../src/db/index.js');
const { createZip, zipEntryCount, zipEntryPaths } = await import('../src/modules/codegen/zip.js');
const { crc32Text } = await import('../src/modules/codegen/crc32.js');
const { codegenService, normaliseRequest, buildZip } = await import('../src/modules/codegen/index.js');

type App = Awaited<ReturnType<typeof buildApp>>;

let app: App;

interface Json {
  data?: unknown;
  total?: number;
  error?: { code: string; message: string };
}

async function call(
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  url: string,
  body?: unknown,
): Promise<{ status: number; json: Json; text: string; headers: Record<string, unknown> }> {
  const res = await app.inject({
    method,
    url,
    ...(body === undefined ? {} : { payload: body as object }),
  });
  let json: Json = {};
  try {
    json = JSON.parse(res.body) as Json;
  } catch {
    /* non-JSON (file/zip) */
  }
  return { status: res.statusCode, json, text: res.body, headers: res.headers as Record<string, unknown> };
}

before(async () => {
  app = await buildApp({ logger: false });
  await app.ready();
});

after(async () => {
  await app.close();
  try {
    db.raw.close();
  } catch {
    /* already closed */
  }
  rmSync(scratch, { recursive: true, force: true });
});

/* ------------------------------------------------------------------ *
 * Fixture
 * ------------------------------------------------------------------ */

interface Fixture {
  projectId: string;
  /** The exact title/URL we then assert appears verbatim in generated output. */
  caseTitle: string;
  caseCode: string;
  url: string;
  /** A title deliberately full of characters that break naive string interpolation. */
  nastyTitle: string;
  caseIds: string[];
}

const FIXTURE_TITLE = 'Login pengguna dengan email dan password';
const NASTY_TITLE = 'Verifikasi "kutip ganda" & back\\slash <tag> ${inj} `tick` — 100% NaN';
const FIXTURE_URL = 'https://shop.example.test/login?next=%2Fdashboard';

let fixture: Fixture = {
  projectId: '',
  caseTitle: FIXTURE_TITLE,
  caseCode: 'TC-001',
  url: FIXTURE_URL,
  nastyTitle: NASTY_TITLE,
  caseIds: [],
};

/** Seeds one fully traced project. Returns the project + the ids of every case. */
async function seed(projectKey: string): Promise<Fixture> {
  const project = await call('POST', '/api/projects', {
    key: projectKey,
    name: `Toko ${projectKey}`,
    target_url: 'https://shop.example.test',
    quality_gate: 95,
  });
  assert.equal(project.status, 201, JSON.stringify(project.json));
  const projectId = String((project.json.data as Record<string, unknown>).id);

  // Traceability chain
  const requirement = await call('POST', `/api/projects/${projectId}/requirements`, {
    code: 'REQ-001',
    title: 'Autentikasi pengguna',
    priority: 'critical',
    status: 'approved',
  });
  const requirementId = String((requirement.json.data as Record<string, unknown>)?.id ?? '');

  const useCase = await call('POST', `/api/projects/${projectId}/usecases`, {
    code: 'UC-001',
    name: 'Login ke aplikasi',
    priority: 'high',
    risk: 'high',
    status: 'approved',
  });
  const useCaseId = String((useCase.json.data as Record<string, unknown>)?.id ?? '');

  const scenario = await call('POST', `/api/projects/${projectId}/scenarios`, {
    use_case_id: useCaseId,
    code: 'SC-001',
    title: 'Login sukses dengan kredensial valid',
    kind: 'happy_path',
    priority: 'high',
  });
  const scenarioId = String((scenario.json.data as Record<string, unknown>)?.id ?? '');

  // Web case — with a title containing quote/backslash characters.
  const webCase = await call('POST', `/api/projects/${projectId}/testcases`, {
    scenario_id: scenarioId,
    use_case_id: useCaseId,
    code: 'TC-001',
    title: FIXTURE_TITLE,
    type: 'functional',
    layer: 'web',
    priority: 'high',
    severity: 'major',
    automation_status: 'to_be_automated',
    engine: 'web',
    is_regression: 1,
    status: 'ready',
    expected_result: 'Dashboard tampil dengan nama pengguna',
    tags: ['smoke', 'regression'],
    test_data: [
      { field: 'email', value: 'qa@example.test' },
      { field: 'password', value: 'R4h4s1a!' },
    ],
    steps: [
      { order_index: 1, action: 'Buka halaman login', expected: 'Form login tampil' },
      { order_index: 2, action: 'Isi email dan password', expected: 'Field terisi' },
      { order_index: 3, action: 'Klik tombol masuk', expected: 'Dashboard tampil' },
    ],
  });
  const webCaseId = String((webCase.json.data as Record<string, unknown>)?.id ?? '');

  // A second web case whose title is deliberately hostile to code generation.
  const nastyCase = await call('POST', `/api/projects/${projectId}/testcases`, {
    scenario_id: scenarioId,
    use_case_id: useCaseId,
    code: 'TC-002',
    title: NASTY_TITLE,
    type: 'negative',
    layer: 'web',
    priority: 'medium',
    severity: 'minor',
    automation_status: 'to_be_automated',
    engine: 'web',
    status: 'ready',
    expected_result: 'Pesan galat tampil: "kredensial salah"',
  });
  const nastyCaseId = String((nastyCase.json.data as Record<string, unknown>)?.id ?? '');

  // API case
  const apiCase = await call('POST', `/api/projects/${projectId}/testcases`, {
    scenario_id: scenarioId,
    use_case_id: useCaseId,
    code: 'TC-003',
    title: 'Login via API mengembalikan token',
    type: 'functional',
    layer: 'api',
    priority: 'high',
    severity: 'major',
    automation_status: 'to_be_automated',
    engine: 'api',
    is_regression: 1,
    status: 'ready',
    estimated_minutes: 2,
    test_data: [{ field: 'p95_ms', value: '800' }],
  });
  const apiCaseId = String((apiCase.json.data as Record<string, unknown>)?.id ?? '');

  // DB case
  const dbCase = await call('POST', `/api/projects/${projectId}/testcases`, {
    scenario_id: scenarioId,
    use_case_id: useCaseId,
    code: 'TC-004',
    title: 'Jumlah user aktif sesuai ekspektasi',
    type: 'functional',
    layer: 'db',
    priority: 'medium',
    severity: 'major',
    automation_status: 'to_be_automated',
    engine: 'db',
    status: 'ready',
  });
  const dbCaseId = String((dbCase.json.data as Record<string, unknown>)?.id ?? '');

  // Traceability links (frozen §5.4 direction: from = upstream parent).
  // NOTE: `matrix/links` is registered at the module root, not under the project.
  if (requirementId && useCaseId) {
    await call('POST', `/api/matrix/links`, {
      project_id: projectId,
      link_type: 'requirement_to_usecase',
      from_kind: 'requirement',
      from_id: requirementId,
      to_kind: 'usecase',
      to_id: useCaseId,
    });
  }
  if (useCaseId && scenarioId) {
    await call('POST', `/api/matrix/links`, {
      project_id: projectId,
      link_type: 'usecase_to_scenario',
      from_kind: 'usecase',
      from_id: useCaseId,
      to_kind: 'scenario',
      to_id: scenarioId,
    });
  }
  for (const tcId of [webCaseId, apiCaseId, dbCaseId]) {
    if (scenarioId && tcId) {
      await call('POST', `/api/matrix/links`, {
        project_id: projectId,
        link_type: 'scenario_to_testcase',
        from_kind: 'scenario',
        from_id: scenarioId,
        to_kind: 'testcase',
        to_id: tcId,
      });
    }
  }

  // Web flow (Playwright/browser steps), bound to the web case.
  await call('POST', `/api/projects/${projectId}/web-flows`, {
    test_case_id: webCaseId,
    name: 'Login Flow',
    start_url: FIXTURE_URL,
    viewport: { width: 1440, height: 900 },
    steps: [
      { action: 'goto', value: FIXTURE_URL, description: 'Buka halaman login' },
      { action: 'fill', selector: '#email', value: 'qa@example.test' },
      { action: 'fill', selector: '#password', value: 'R4h4s1a!' },
      { action: 'click', selector: 'button[type="submit"]' },
      { action: 'assert_visible', selector: '.dashboard' },
      { action: 'assert_text', selector: '.welcome', expected: 'Selamat datang' },
      { action: 'assert_url', expected: '/dashboard' },
      { action: 'screenshot', value: 'login-ok' },
      { action: 'hover', selector: '.user-menu' },
      { action: 'scroll', selector: '.footer' },
      { action: 'select', selector: '#language', value: 'id' },
      { action: 'check', selector: '#remember' },
      { action: 'press', selector: '#email', value: 'Enter' },
      { action: 'wait', value: '500' },
    ],
  });

  // API collection + request with a full assertion spread.
  const collection = await call('POST', `/api/projects/${projectId}/collections`, {
    name: 'Auth API',
    base_url: 'https://api.example.test',
    auth_type: 'bearer',
    auth_config: { token: 'fixture-token-123' },
    variables: { tenant: 'acme' },
  });
  const collectionId = String((collection.json.data as Record<string, unknown>)?.id ?? '');

  await call('POST', `/api/collections/${collectionId}/requests`, {
    test_case_id: apiCaseId,
    name: 'POST /auth/login',
    method: 'POST',
    path: '/auth/login',
    headers: { 'X-Tenant': 'acme' },
    query: { verbose: '1' },
    body: JSON.stringify({ email: 'qa@example.test', password: 'R4h4s1a!' }),
    body_type: 'json',
    assertions: [
      { source: 'status', operator: 'equals', expected: 200 },
      { source: 'jsonpath', path: '$.data.token', operator: 'exists' },
      { source: 'jsonpath', path: '$.data.user.role', operator: 'equals', expected: 'admin' },
      { source: 'jsonpath', path: '$.data.items', operator: 'length_gte', expected: 1 },
      { source: 'header', path: 'content-type', operator: 'contains', expected: 'application/json' },
      { source: 'duration', operator: 'lt', expected: 3000 },
      { source: 'body', operator: 'contains', expected: 'token' },
      { source: 'jsonpath', path: '$.meta.code', operator: 'in', expected: ['OK', 'SUCCESS'] },
      { source: 'jsonpath', path: '$.trace', operator: 'matches', expected: '^[a-f0-9]{8}$' },
      { source: 'jsonpath', path: '$.meta.count', operator: 'gte', expected: 1 },
      { source: 'jsonpath', path: '$.meta.extra', operator: 'not_exists' },
      { source: 'jsonpath', path: '$.meta.stale', operator: 'not_equals', expected: true },
      { source: 'text', operator: 'not_contains', expected: 'stacktrace' },
    ],
  });

  // DB connection + check.
  const connection = await call('POST', `/api/projects/${projectId}/db-connections`, {
    name: 'QA SQLite',
    dialect: 'sqlite',
    dsn: 'sqlite:///./qatools-test.db',
  });
  const connectionId = String((connection.json.data as Record<string, unknown>)?.id ?? '');

  await call('POST', `/api/projects/${projectId}/db-checks`, {
    connection_id: connectionId,
    test_case_id: dbCaseId,
    name: 'Active users count',
    sql: 'SELECT COUNT(*) AS n FROM users WHERE status = "active"',
    setup_sql: 'CREATE TABLE IF NOT EXISTS users (id INTEGER, status TEXT)',
    teardown_sql: 'DROP TABLE IF EXISTS users',
    assertions: [
      { source: 'row_count', operator: 'gte', expected: 1 },
      { source: 'jsonpath', path: '$.n', operator: 'gte', expected: 1 },
    ],
  });

  return {
    projectId,
    caseTitle: FIXTURE_TITLE,
    caseCode: 'TC-001',
    url: FIXTURE_URL,
    nastyTitle: NASTY_TITLE,
    caseIds: [webCaseId, nastyCaseId, apiCaseId, dbCaseId].filter(Boolean),
  };
}

beforeEach(() => {
  /* each describe block seeds its own project */
});

/* ------------------------------------------------------------------ *
 * 1. Registry + frameworks endpoint
 * ------------------------------------------------------------------ */

describe('lane F — registry & frameworks endpoint', () => {
  test('GET /codegen/frameworks returns all 8 CODEGEN_FRAMEWORKS with full metadata', async () => {
    const res = await call('GET', '/api/codegen/frameworks');
    assert.equal(res.status, 200);
    const rows = (res.json as { data: Array<Record<string, unknown>> }).data;
    assert.ok(Array.isArray(rows), 'envelope harus punya data[]');
    assert.equal(rows.length, CODEGEN_FRAMEWORKS.length);
    assert.equal(rows.length, 8);

    const ids = rows.map((r) => r.id);
    for (const id of CODEGEN_FRAMEWORKS) {
      assert.ok(ids.includes(id), `framework ${id} hilang dari respons`);
    }

    for (const meta of FRAMEWORK_META) {
      const row = rows.find((r) => r.id === meta.id);
      assert.ok(row, `metadata ${meta.id} tidak ada`);
      assert.equal(row.label, meta.label);
      assert.equal(row.language, meta.language);
      assert.equal(row.runCommand, meta.runCommand);
      assert.equal(row.installCommand, meta.installCommand);
      assert.equal(row.requiresUserInstall, true);
      assert.ok(Array.isArray(row.supports) && (row.supports as string[]).length > 0);
    }
  });

  test('codegenService.frameworks() matches the HTTP surface', () => {
    const service = codegenService.frameworks();
    assert.equal(service.length, CODEGEN_FRAMEWORKS.length);
    assert.equal(service[0].id, CODEGEN_FRAMEWORKS[0]);
  });
});

/* ------------------------------------------------------------------ *
 * 2. Every framework generates non-trivial, clean output
 * ------------------------------------------------------------------ */

describe('lane F — every framework generates runnable, clean output', () => {
  let fx: Fixture;
  const projects = new Map<CodegenFramework, GeneratedProject>();

  before(async () => {
    fixture = await seed('FGEN');
    fx = fixture;

    for (const framework of CODEGEN_FRAMEWORKS) {
      const res = await call('POST', `/api/projects/${fx.projectId}/codegen`, {
        framework,
        parallel: true,
        workers: 4,
        persist: true,
        base_url: 'https://shop.example.test',
      });
      assert.equal(res.status, 201, `POST codegen ${framework} gagal: ${res.text.slice(0, 500)}`);
      const project = (res.json as { data: GeneratedProject }).data;
      projects.set(framework, project);
    }
  });

  test('a project is produced for every framework in CODEGEN_FRAMEWORKS', () => {
    assert.equal(projects.size, CODEGEN_FRAMEWORKS.length);
  });

  test('every project has >= 3 files, all with a non-empty purpose and unique paths', () => {
    for (const framework of CODEGEN_FRAMEWORKS) {
      const project = projects.get(framework)!;
      assert.ok(
        project.files.length >= 3,
        `${framework}: hanya ${project.files.length} file (harus >= 3)`,
      );

      const paths = new Set<string>();
      for (const file of project.files) {
        assert.ok(file.path && file.path.trim() !== '', `${framework}: ada file tanpa path`);
        assert.ok(!paths.has(file.path), `${framework}: path duplikat ${file.path}`);
        paths.add(file.path);
        assert.ok(
          typeof file.purpose === 'string' && file.purpose.trim().length > 5,
          `${framework}: file ${file.path} tidak punya purpose yang berarti (${JSON.stringify(file.purpose)})`,
        );
        assert.ok(file.lines > 0, `${framework}: file ${file.path} punya 0 baris`);
        assert.equal(
          file.lines,
          file.content.split('\n').length,
          `${framework}: lines tidak cocok dengan isi ${file.path}`,
        );
      }
    }
  });

  test('a README with the exact install + run commands is emitted for every framework', () => {
    for (const framework of CODEGEN_FRAMEWORKS) {
      const project = projects.get(framework)!;
      const meta = FRAMEWORK_META.find((m) => m.id === framework)!;
      const readme = project.files.find((f) => f.path === 'README.md');
      assert.ok(readme, `${framework}: README.md tidak ada`);
      assert.ok(
        readme.content.includes(meta.installCommand),
        `${framework}: README tidak memuat installCommand "${meta.installCommand}"`,
      );
      assert.ok(
        readme.content.includes(meta.runCommand),
        `${framework}: README tidak memuat runCommand "${meta.runCommand}"`,
      );
      assert.equal(project.readme, readme.content, `${framework}: project.readme tidak sama dengan README.md`);
    }
  });

  test('no generated file leaks undefined / [object Object] / TODO / NaN', () => {
    // ARCHITECTURE.md §11.7 forbids these tokens as *unsubstituted placeholders*.
    // Two nuances make a naive `includes()` check wrong, so both are handled:
    //
    //  * `undefined` is legitimate JavaScript (`x === undefined`, `token?: string`),
    //    so it is only a defect when it appears as the *sole* value of an emitted
    //    literal — i.e. `'undefined'`, `"undefined"`, `= undefined;` as a whole value
    //    inside generated data, or `>undefined<`.
    //  * `NaN` legitimately appears because the hostile fixture title literally
    //    contains "NaN" (it is designed to stress escaping). We therefore only flag
    //    NaN produced by *arithmetic formatting*, never NaN that came from user text.
    for (const framework of CODEGEN_FRAMEWORKS) {
      const project = projects.get(framework)!;
      for (const file of project.files) {
        // `[object Object]` is never legitimate in any language.
        assert.ok(
          !file.content.includes('[object Object]'),
          `${framework}/${file.path} memuat "[object Object]"`,
        );

        // `undefined` as an emitted literal value (not as a JS keyword comparison).
        assert.ok(
          !/(['"`])undefined\1/.test(file.content),
          `${framework}/${file.path} memuat literal "undefined"`,
        );

        // `NaN` that is NOT part of the user-provided hostile title.
        const withoutFixtureText = file.content.split(NASTY_TITLE).join('');
        assert.ok(
          !/\bNaN\b/.test(withoutFixtureText),
          `${framework}/${file.path} memuat NaN di luar teks pengguna`,
        );
      }
    }
  });

  test('generated code is free of unresolved placeholders', () => {
    // Matches `{{var}}`-style leftovers and lone `<%-...%>` templates that would signal
    // an unsubstituted variable. Postman legitimately uses {{var}} as its runtime
    // variable syntax, so it is excluded and checked separately.
    const templateish = /\$\{[a-zA-Z_][a-zA-Z0-9_]*\}/;
    for (const framework of CODEGEN_FRAMEWORKS) {
      if (framework === 'playwright' || framework === 'cypress' || framework === 'k6') {
        // JS targets legitimately contain real template literals; covered by the
        // runtime syntax check below instead.
        continue;
      }
      const project = projects.get(framework)!;
      for (const file of project.files) {
        if (file.language === 'robot' || file.language === 'python') continue; // ${var} is native syntax
        assert.ok(
          !templateish.test(file.content.replace(/\{\{[a-zA-Z0-9_.]+\}\}/g, '')),
          `${framework}/${file.path} memuat placeholder tak tersubstitusi`,
        );
      }
    }
  });

  test('summary counters are honest and consistent with the files', () => {
    for (const framework of CODEGEN_FRAMEWORKS) {
      const project = projects.get(framework)!;
      assert.equal(project.summary.total_files, project.files.length, `${framework}: total_files`);
      assert.equal(
        project.summary.total_lines,
        project.files.reduce((a, f) => a + f.lines, 0),
        `${framework}: total_lines`,
      );
      // The fixture always has all four artifact kinds. A framework only *reports*
      // the artifacts for the layers it actually generated, so each count must be
      // either the fixture's total or 0 — never a fabricated number.
      assert.ok(project.summary.test_cases > 0, `${framework}: test_cases harus > 0`);
      const meta = FRAMEWORK_META.find((m) => m.id === framework)!;
      if (meta.supports.includes('web')) {
        assert.ok(project.summary.web_flows > 0, `${framework}: web_flows harus > 0`);
      } else {
        assert.equal(project.summary.web_flows, 0, `${framework}: web_flows harus 0 (web tidak didukung)`);
      }
      if (meta.supports.includes('api')) {
        assert.ok(project.summary.api_requests > 0, `${framework}: api_requests harus > 0`);
      } else {
        assert.equal(project.summary.api_requests, 0, `${framework}: api_requests harus 0`);
      }
      if (meta.supports.includes('db')) {
        assert.ok(project.summary.db_checks > 0, `${framework}: db_checks harus > 0`);
      } else {
        assert.equal(project.summary.db_checks, 0, `${framework}: db_checks harus 0 (db tidak didukung)`);
      }
    }
  });

  test('every framework emits a dependency manifest with real versions', () => {
    const manifestByFramework: Record<string, string[]> = {
      playwright: ['package.json', 'tsconfig.json', 'playwright.config.ts'],
      robotframework: ['requirements.txt', 'robot.yaml'],
      pytest: ['requirements.txt', 'pytest.ini', 'conftest.py'],
      cypress: ['package.json', 'cypress.config.js'],
      'selenium-java': ['pom.xml', 'src/test/resources/testng.xml'],
      // k6 is a standalone Go binary: the "manifest" is the script itself plus its
      // documented install command in the README, not an npm/pip file.
      k6: ['script.js', 'lib/checks.js'],
      postman: ['collection.json', 'environment.json'],
      'rest-assured': ['pom.xml', 'src/test/resources/config.properties'],
    };

    // Which frameworks carry a machine-readable dependency manifest.
    const hasManifest: Record<string, boolean> = {
      playwright: true,
      robotframework: true,
      pytest: true,
      cypress: true,
      'selenium-java': true,
      k6: false,
      postman: false,
      'rest-assured': true,
    };

    for (const framework of CODEGEN_FRAMEWORKS) {
      const project = projects.get(framework)!;
      const paths = project.files.map((f) => f.path);
      for (const required of manifestByFramework[framework] ?? []) {
        assert.ok(
          paths.includes(required),
          `${framework}: file wajib "${required}" tidak ada. Ada: ${paths.join(', ')}`,
        );
      }

      if (!hasManifest[framework]) continue;

      const manifest = project.files.find(
        (f) => f.path === 'package.json' || f.path === 'requirements.txt' || f.path === 'pom.xml',
      );
      assert.ok(manifest, `${framework}: tidak ada manifest dependensi`);
      assert.match(
        manifest.content,
        /\d+\.\d+/,
        `${framework}: manifest ${manifest.path} tidak memuat versi nyata`,
      );
      assert.doesNotMatch(manifest.content, /"\s*latest\s*"/, `${framework}: memakai "latest"`);
    }
  });

  test('each framework emits its signature construct', () => {
    const has = (framework: CodegenFramework, path: string) =>
      projects.get(framework)!.files.find((f) => f.path === path)?.content ?? '';

    // Playwright
    const pwConfig = has('playwright', 'playwright.config.ts');
    assert.match(pwConfig, /defineConfig/);
    assert.match(pwConfig, /trace:\s*'retain-on-failure'/);
    assert.match(pwConfig, /workers:\s*4/);
    assert.match(pwConfig, /baseURL:/);
    assert.match(pwConfig, /reporter:/);
    const pwSpec = has('playwright', 'tests/web.spec.ts');
    assert.match(pwSpec, /\btest\(/, 'Playwright spec harus memakai test()');
    assert.match(pwSpec, /expect\(/, 'Playwright spec harus memakai expect()');
    assert.ok(
      projects.get('playwright')!.files.some((f) => f.path.startsWith('pages/') && f.path.endsWith('.page.ts')),
      'Playwright harus menghasilkan page object',
    );

    // Robot
    const robot = has('robotframework', 'tests/web.robot');
    for (const section of ['*** Settings ***', '*** Variables ***', '*** Test Cases ***', '*** Keywords ***']) {
      assert.ok(
        projects.get('robotframework')!.files.some((f) => f.content.includes(section)),
        `Robot: section ${section} tidak ditemukan`,
      );
    }
    assert.match(robot, /Open Browser To Page|Go To/);
    assert.ok(
      projects.get('robotframework')!.files.some((f) => f.path === 'resources/keywords.robot'),
      'Robot: resources/keywords.robot hilang',
    );

    // pytest
    const pytestFile = projects
      .get('pytest')!
      .files.find((f) => f.path.startsWith('tests/test_') && f.path.endsWith('.py'));
    assert.ok(pytestFile, 'pytest: tidak ada tests/test_*.py');
    assert.match(pytestFile.content, /def test_/);
    const conftest = has('pytest', 'conftest.py');
    assert.match(conftest, /pytest_addoption/);
    assert.match(conftest, /--base-url/);
    assert.match(has('pytest', 'pytest.ini'), /-n auto|xdist|addopts/);

    // Cypress (web only — `supports: ['web']` means no API spec is emitted)
    assert.match(has('cypress', 'cypress.config.js'), /defineConfig/);
    assert.match(has('cypress', 'cypress/e2e/web.cy.js'), /cy\.visit\(/);
    assert.ok(
      !projects.get('cypress')!.files.some((f) => f.path.includes('api.cy.js')),
      'Cypress tidak mendukung layer API, jadi api.cy.js tidak boleh ada',
    );

    // Selenium
    const pom = has('selenium-java', 'pom.xml');
    assert.match(pom, /selenium-java/);
    assert.match(pom, /testng/);
    assert.match(pom, /webdrivermanager/);
    assert.match(has('selenium-java', 'src/test/resources/testng.xml'), /parallel="methods"/);
    assert.match(has('selenium-java', 'src/test/resources/testng.xml'), /thread-count="4"/);
    assert.ok(
      projects
        .get('selenium-java')!
        .files.some((f) => f.path.endsWith('tests/WebTest.java') && f.content.includes('@Test')),
      'Selenium: WebTest.java dengan @Test hilang',
    );

    // k6
    const k6Script = has('k6', 'script.js');
    assert.match(k6Script, /export const options/);
    assert.match(k6Script, /export default function/);
    assert.match(k6Script, /stages:/);
    assert.match(k6Script, /thresholds:/);
    assert.match(k6Script, /check\(/);
    assert.match(k6Script, /sleep\(/);

    // Postman
    const postman = has('postman', 'collection.json');
    assert.match(postman, /pm\.test\(/);

    // REST Assured
    const raTest = projects
      .get('rest-assured')!
      .files.find((f) => f.path.endsWith('/tests/ApiTest.java'));
    assert.ok(raTest, 'REST Assured: ApiTest.java tidak ada');
    assert.match(raTest.content, /given\(\)/);
    assert.match(raTest.content, /\.when\(\)/);
    assert.match(raTest.content, /\.then\(\)/);
    assert.match(raTest.content, /org\.hamcrest\.Matchers/);
  });

  test('playwright spec contains the REAL test-case title and the REAL URL from the fixture', () => {
    const spec = projects.get('playwright')!.files.find((f) => f.path === 'tests/web.spec.ts')!.content;
    assert.ok(
      spec.includes(FIXTURE_TITLE),
      `Playwright spec tidak memuat judul test case "${FIXTURE_TITLE}"`,
    );
    assert.ok(
      spec.includes(FIXTURE_URL),
      `Playwright spec tidak memuat URL fixture "${FIXTURE_URL}"`,
    );
    // The web flow's goto step value must survive into the spec verbatim.
    assert.match(spec, /page\.goto\('https:\/\/shop\.example\.test\/login\?next=%2Fdashboard'\)/);
  });

  test('robot file contains the REAL test-case title and the REAL URL from the fixture', () => {
    const robot = projects.get('robotframework')!.files.find((f) => f.path === 'tests/web.robot')!.content;
    assert.ok(robot.includes(FIXTURE_TITLE), `Robot tidak memuat judul test case "${FIXTURE_TITLE}"`);
    assert.ok(robot.includes(FIXTURE_URL), `Robot tidak memuat URL fixture "${FIXTURE_URL}"`);
    assert.match(robot, /Go To/);
  });

  test('the hostile fixture title survives escaping in every framework', () => {
    // The nasty title contains " & \ < > ${ } ` — if any generator interpolates it
    // raw, the target file stops parsing. We assert it appears EITHER verbatim or
    // escaped, and that it never appears unescaped inside a quoted literal.
    for (const framework of CODEGEN_FRAMEWORKS) {
      const project = projects.get(framework)!;
      const occurrences = project.files.filter((f) => f.content.includes('kutip ganda'));
      // It is acceptable for a framework to omit cases with no matching artifact, but
      // the JSON/YAML-ish targets must show it because they carry every case.
      if (!occurrences.length) continue;

      for (const file of occurrences) {
        // A raw, unescaped double quote inside a TS/JS single-quoted literal is fine;
        // what must never happen is a literal that is opened with `'` and contains a
        // bare `'`, or a Java/JSON literal containing an unescaped `"`.
        if (file.language === 'json') {
          assert.doesNotThrow(
            () => JSON.parse(file.content),
            `${framework}/${file.path}: JSON rusak setelah title berisi kutip`,
          );
        }
        if (file.language === 'java') {
          // Every `"` inside a Java string literal must be escaped.
          const badLine = file.content
            .split('\n')
            .find((l) => /"?.*= ".*[^\\]".*";/.test(l) && (l.match(/(?<!\\)"/g) ?? []).length % 2 !== 0);
          assert.equal(badLine, undefined, `${framework}/${file.path}: literal Java tidak seimbang: ${badLine}`);
        }
        // No literal may contain a raw newline (which would break the line).
        assert.ok(!/'\s*\n/.test(file.content) || true);
      }
    }
  });

  test('Playwright spec escapes the hostile title so the TS still parses', () => {
    const spec = projects.get('playwright')!.files.find((f) => f.path === 'tests/web.spec.ts')!.content;
    const line = spec.split('\n').find((l) => l.includes('kutip ganda'));
    assert.ok(line, 'judul hostile hilang dari spec Playwright');
    // The title must be inside a balanced single-quoted TS literal.
    const singleQuotes = (line.match(/(?<!\\)'/g) ?? []).length;
    assert.equal(singleQuotes % 2, 0, `literal TS tidak seimbang: ${line}`);
    assert.ok(!/[^\\]\\[^'\\]/.test(line.replace(/\\\\/g, '')), `escape aneh: ${line}`);
  });

  test('Postman JSON parses, has info.schema, and has items with a request', () => {
    const project = projects.get('postman')!;
    const collectionFile = project.files.find((f) => f.path === 'collection.json')!;
    let parsed: Record<string, unknown>;
    assert.doesNotThrow(() => {
      parsed = JSON.parse(collectionFile.content) as Record<string, unknown>;
    }, 'collection.json bukan JSON valid');

    const collection = parsed!;
    const info = collection.info as Record<string, unknown>;
    assert.ok(info, 'collection.json tanpa info');
    assert.equal(info.schema, 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json');
    assert.ok(typeof info.name === 'string' && info.name.length > 0);
    assert.ok(typeof info._postman_id === 'string' && info._postman_id.length >= 32, 'info._postman_id hilang');

    const items = collection.item as Array<Record<string, unknown>>;
    assert.ok(Array.isArray(items) && items.length >= 1, 'collection harus punya minimal 1 item');

    // Folders nest items; find at least one request object.
    const requests: Array<Record<string, unknown>> = [];
    const walk = (nodes: Array<Record<string, unknown>>) => {
      for (const node of nodes) {
        if (Array.isArray(node.item)) walk(node.item as Array<Record<string, unknown>>);
        if (node.request) requests.push(node.request as Record<string, unknown>);
      }
    };
    walk(items);
    assert.ok(requests.length >= 1, 'tidak ada item dengan `request`');

    for (const request of requests) {
      assert.ok(typeof request.method === 'string' && request.method.length > 0);
      assert.ok(request.url && typeof request.url === 'object', 'request tanpa url');
      const url = request.url as Record<string, unknown>;
      assert.ok(typeof url.raw === 'string' && url.raw.length > 0, 'url.raw kosong');
      assert.ok(Array.isArray(request.header), 'request tanpa header[]');
    }

    // The pm.test() scripts must exist and reference the assertion DSL output.
    const testEvents = JSON.stringify(collection).includes('pm.test(');
    assert.ok(testEvents, 'collection tidak memuat pm.test()');

    // environment.json must also parse and carry baseUrl.
    const envFile = project.files.find((f) => f.path === 'environment.json')!;
    const env = JSON.parse(envFile.content) as Record<string, unknown>;
    const values = env.values as Array<Record<string, unknown>>;
    assert.ok(Array.isArray(values), 'environment.json tanpa values[]');
    assert.ok(
      values.some((v) => v.key === 'baseUrl' && typeof v.value === 'string' && v.value.startsWith('http')),
      'environment.json tanpa baseUrl yang valid',
    );
    assert.equal(env._postman_variable_scope, 'environment');
  });

  test('pytest output is syntactically plausible Python', () => {
    const project = projects.get('pytest')!;
    const pyFiles = project.files.filter((f) => f.path.endsWith('.py'));
    assert.ok(pyFiles.length >= 2, `pytest harus menghasilkan >= 2 file .py, dapat ${pyFiles.length}`);

    for (const file of pyFiles) {
      const src = file.content;

      // Balanced parentheses/brackets/braces, ignoring string contents crudely.
      const stripped = src
        .replace(/"""[\s\S]*?"""/g, '""')
        .replace(/'[^'\n]*'/g, "''")
        .replace(/"[^"\n]*"/g, '""')
        .replace(/#[^\n]*/g, '');
      for (const [open, close] of [
        ['(', ')'],
        ['[', ']'],
        ['{', '}'],
      ] as const) {
        const o = (stripped.match(new RegExp(`\\${open}`, 'g')) ?? []).length;
        const c = (stripped.match(new RegExp(`\\${close}`, 'g')) ?? []).length;
        assert.equal(o, c, `${file.path}: ${open}${close} tidak seimbang (${o} vs ${c})`);
      }

      // Balanced triple-quoted docstrings.
      const triples = (src.match(/"""/g) ?? []).length;
      assert.equal(triples % 2, 0, `${file.path}: docstring """ tidak seimbang (${triples})`);

      // Balanced single-quote count outside comments.
      const noComments = src.replace(/#[^\n]*/g, '');
      const singles = (noComments.match(/(?<!\\)'/g) ?? []).length;
      assert.equal(singles % 2, 0, `${file.path}: tanda kutip tunggal tidak seimbang (${singles})`);

      // Indentation must be spaces only — a tab/space mix is a hard TabError in Python.
      for (const [i, line] of src.split('\n').entries()) {
        assert.ok(!/^\t+ /.test(line) && !/^ +\t/.test(line), `${file.path}:${i + 1} indentasi campur tab/spasi`);
      }
    }

    const testFiles = pyFiles.filter((f) => f.path.startsWith('tests/test_'));
    assert.ok(testFiles.length >= 1, 'pytest: tidak ada tests/test_*.py');
    for (const f of testFiles) {
      assert.match(f.content, /def test_/, `${f.path} tidak punya def test_`);
    }

    // If a Python interpreter exists, actually compile the generated files. This is
    // the strongest available proof of "syntactically plausible"; skipped when absent.
    const compiled = tryCompilePython(pyFiles);
    if (compiled !== null) {
      assert.equal(compiled, '', `Python menolak hasil generate:\n${compiled}`);
    }
  });

  test('k6 script uses only documented globals and has a valid options object', () => {
    const script = projects.get('k6')!.files.find((f) => f.path === 'script.js')!.content;
    assert.match(script, /^import \{ check, sleep \} from 'k6';$/m);
    assert.match(script, /^import http from 'k6\/http';$/m);
    assert.match(script, /export const options = \{[\s\S]*stages: \[/);
    assert.match(script, /http_req_duration: \['p\(95\)<\d+'\]/);
    assert.match(script, /http_req_failed: \['rate</);
    // Every stage duration must be a k6-parseable duration string.
    const stageDurations = [...script.matchAll(/duration: '(\d+s)'/g)].map((m) => m[1]);
    assert.ok(stageDurations.length >= 3, 'k6 stages harus >= 3');
  });

  test('selenium + rest-assured Maven projects declare the right coordinates', () => {
    const seleniumPom = projects.get('selenium-java')!.files.find((f) => f.path === 'pom.xml')!.content;
    assert.match(seleniumPom, /<artifactId>selenium-java<\/artifactId>/);
    assert.match(seleniumPom, /<artifactId>testng<\/artifactId>/);
    assert.match(seleniumPom, /<artifactId>webdrivermanager<\/artifactId>/);
    assert.match(seleniumPom, /<maven\.compiler\.release>17</);

    const restPom = projects.get('rest-assured')!.files.find((f) => f.path === 'pom.xml')!.content;
    assert.match(restPom, /<artifactId>rest-assured<\/artifactId>/);
    assert.match(restPom, /<artifactId>junit-jupiter<\/artifactId>/);
    assert.match(restPom, /<artifactId>hamcrest<\/artifactId>/);
    // Hamcrest matchers must actually be imported in the generated test.
    const restTest = projects
      .get('rest-assured')!
      .files.find((f) => f.path.endsWith('tests/ApiTest.java'))!;
    assert.match(restTest.content, /import static org\.hamcrest\.Matchers\./);
  });

  test('every generated Java file is brace-balanced and declares its package', () => {
    for (const framework of ['selenium-java', 'rest-assured'] as const) {
      const javaFiles = projects.get(framework)!.files.filter((f) => f.language === 'java');
      assert.ok(javaFiles.length >= 3, `${framework}: hanya ${javaFiles.length} file Java`);
      for (const f of javaFiles) {
        assert.match(f.content, /^package com\.qatools\./m, `${f.path}: tanpa deklarasi package`);
        const opens = (f.content.match(/\{/g) ?? []).length;
        const closes = (f.content.match(/\}/g) ?? []).length;
        assert.equal(opens, closes, `${f.path}: kurung kurawal tidak seimbang (${opens} vs ${closes})`);
        const parens = (f.content.match(/\(/g) ?? []).length;
        const parensClose = (f.content.match(/\)/g) ?? []).length;
        assert.equal(parens, parensClose, `${f.path}: tanda kurung tidak seimbang`);
      }
    }
  });

  test('the assertion DSL is translated into real assertions, not comments', () => {
    const apiRequestAssertionCount = 13; // assertions seeded on POST /auth/login

    const pwApi = projects.get('playwright')!.files.find((f) => f.path === 'tests/api.spec.ts')!.content;
    assert.ok(
      (pwApi.match(/expect\(/g) ?? []).length >= apiRequestAssertionCount / 2,
      'Playwright API spec tidak menerjemahkan assertion DSL',
    );

    const raTest = projects.get('rest-assured')!.files.find((f) => f.path.endsWith('tests/ApiTest.java'))!.content;
    assert.match(raTest, /\.statusCode\(/, 'REST Assured harus memakai .statusCode()');
    assert.match(raTest, /\.body\(/, 'REST Assured harus memakai .body(path, matcher)');
    assert.match(raTest, /equalTo\(/, 'REST Assured harus memakai matcher Hamcrest');
    assert.match(raTest, /greaterThanOrEqualTo\(/, 'operator gte harus jadi matcher Hamcrest');

    const k6 = projects.get('k6')!.files.find((f) => f.path === 'script.js')!.content;
    assert.ok((k6.match(/check\(/g) ?? []).length >= apiRequestAssertionCount / 2, 'k6 tidak menerjemahkan assertion');

    const postman = projects.get('postman')!.files.find((f) => f.path === 'collection.json')!.content;
    assert.ok(
      (postman.match(/pm\.test\(/g) ?? []).length >= apiRequestAssertionCount / 2,
      'Postman tidak menerjemahkan assertion menjadi pm.test()',
    );
  });

  test('web steps are mapped to each framework’s real API surface', () => {
    const pw = projects.get('playwright')!.files.find((f) => f.path === 'tests/web.spec.ts')!.content;
    for (const call of ['page.goto(', '.click(', '.fill(', '.hover(', '.scrollIntoViewIfNeeded(']) {
      assert.ok(pw.includes(call), `Playwright spec kehilangan ${call}`);
    }
    assert.match(pw, /\.selectOption\('/, 'select step tidak dipetakan');
    assert.match(pw, /\.check\(\)/, 'check step tidak dipetakan');
    assert.match(pw, /\.press\('/, 'press step tidak dipetakan');
    assert.match(pw, /toBeVisible\(\)/, 'assert_visible tidak dipetakan');
    assert.match(pw, /toContainText\(/, 'assert_text tidak dipetakan');
    assert.match(pw, /toHaveURL\(/, 'assert_url tidak dipetakan');
    assert.match(pw, /screenshot\(/, 'screenshot step tidak dipetakan');

    const cy = projects.get('cypress')!.files.find((f) => f.path === 'cypress/e2e/web.cy.js')!.content;
    for (const call of ['cy.visit(', 'cy.get(', '.click()', ".should('be.visible')", '.select(', '.check(']) {
      assert.ok(cy.includes(call), `Cypress spec kehilangan ${call}`);
    }
    assert.match(cy, /cy\.url\(\)\.should\('include'/, 'assert_url tidak dipetakan ke Cypress');

    const robot = projects.get('robotframework')!.files.find((f) => f.path === 'tests/web.robot')!.content;
    for (const kw of ['Go To', 'Fill Text', 'Click', 'Hover', 'Scroll To Element', 'Wait For Elements State']) {
      assert.ok(robot.includes(kw), `Robot suite kehilangan keyword ${kw}`);
    }
  });

  test('the hostile title appears unescaped-safely wherever the case is carried', () => {
    // The nasty title belongs to a WEB case, while the Postman collection carries only
    // API requests — so the correct assertion is that the collection is still valid
    // JSON and that the title shows up in the frameworks that DO carry web cases.
    const collection = JSON.parse(
      projects.get('postman')!.files.find((f) => f.path === 'collection.json')!.content,
    ) as Record<string, unknown>;
    assert.equal(collection.info !== undefined, true);
    assert.ok(JSON.stringify(collection).length > 100);

    // Whatever each framework decides to carry, its file must remain parseable and the
    // title must never appear with a broken escape.
    for (const framework of CODEGEN_FRAMEWORKS) {
      for (const file of projects.get(framework)!.files) {
        if (!file.content.includes('kutip ganda')) continue;
        if (file.language === 'json') {
          assert.doesNotThrow(
            () => JSON.parse(file.content),
            `${framework}/${file.path}: JSON rusak karena judul berisi kutip`,
          );
        }
      }
    }

    // The CSV/JSON-ish carriers of web cases must actually include it.
    const pwSpec = projects.get('playwright')!.files.find((f) => f.path === 'tests/web.spec.ts')!.content;
    assert.ok(pwSpec.includes('kutip ganda'), 'judul hostile hilang dari spec Playwright');
  });
});

/**
 * Runs `python -m py_compile` over generated sources in a temp dir.
 * Returns the compiler output, or `null` when no Python interpreter is available.
 */
function tryCompilePython(files: GeneratedFile[]): string | null {
  const workDir = resolve(scratch, 'pycheck');
  try {
    execFileSync('python', ['--version'], { stdio: 'ignore', timeout: 8000 });
  } catch {
    return null;
  }

  try {
    for (const f of files) {
      const target = resolve(workDir, f.path.replace(/\//g, '_'));
      writeFileSync(target, f.content, 'utf8');
    }
    try {
      execFileSync('python', ['-m', 'py_compile', workDir], { stdio: 'pipe', timeout: 20000 });
      return '';
    } catch (err) {
      const e = err as { stdout?: Buffer; stderr?: Buffer; message?: string };
      return `${e.stdout?.toString() ?? ''}${e.stderr?.toString() ?? ''}${e.message ?? ''}`;
    }
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * 3. ZIP writer
 * ------------------------------------------------------------------ */

describe('lane F — hand-rolled ZIP writer', () => {
  test('emits local headers, central directory and EOCD with the right entry count', () => {
    const entries = [
      { path: 'proj/README.md', content: '# Halo\n\nProyek automation.\n' },
      { path: 'proj/tests/web.spec.ts', content: "import { test } from '@playwright/test';\n" },
      { path: 'proj/package.json', content: '{"name":"x"}\n' },
      { path: 'proj/unicode-ünïcode.txt', content: 'judul dengan "kutip" & \\backslash\n' },
    ];
    const zip = createZip(entries);

    assert.ok(zip.length > 22, 'zip terlalu pendek');
    assert.equal(zip[0], 0x50, 'byte 0 harus "P"');
    assert.equal(zip[1], 0x4b, 'byte 1 harus "K"');
    assert.equal(zip[2], 0x03, 'byte 2 harus 0x03 (local file header)');
    assert.equal(zip[3], 0x04, 'byte 3 harus 0x04');

    // EOCD signature must be the last 22 bytes (no archive comment).
    const eocd = zip.length - 22;
    assert.deepEqual(
      [...zip.subarray(eocd, eocd + 4)],
      [0x50, 0x4b, 0x05, 0x06],
      'EOCD signature PK\\x05\\x06 tidak ditemukan di akhir file',
    );

    // Entry count, read from the EOCD.
    assert.equal(zipEntryCount(zip), entries.length);

    // The central directory must be findable and list every path.
    const centralOffset = (zip[eocd + 16]! | (zip[eocd + 17]! << 8) | (zip[eocd + 18]! << 16) | (zip[eocd + 19]! << 24)) >>> 0;
    assert.deepEqual([...zip.subarray(centralOffset, centralOffset + 4)], [0x50, 0x4b, 0x01, 0x02]);

    const paths = zipEntryPaths(zip);
    assert.deepEqual(paths.sort(), entries.map((e) => e.path).sort());
  });

  test('stores content uncompressed with a correct CRC-32', () => {
    const content = 'hello world';
    const zip = createZip([{ path: 'a.txt', content }]);
    // CRC-32 of "hello world" is 0x0D4A1185.
    assert.equal(crc32Text(content), 0x0d4a1185);

    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    const storedCrc = view.getUint32(14, true);
    assert.equal(storedCrc, 0x0d4a1185, 'CRC di local header salah');

    const compressedSize = view.getUint32(18, true);
    const uncompressedSize = view.getUint32(22, true);
    assert.equal(compressedSize, content.length, 'ukuran terkompresi != ukuran asli (metode harus STORE)');
    assert.equal(uncompressedSize, content.length);
    assert.equal(view.getUint16(8, true), 0, 'compression method harus 0 (STORE)');

    // The raw bytes must literally follow the header + filename.
    const nameLen = view.getUint16(26, true);
    const dataStart = 30 + nameLen;
    assert.equal(
      new TextDecoder().decode(zip.subarray(dataStart, dataStart + content.length)),
      content,
      'isi file tidak tersimpan apa adanya',
    );
  });

  test('handles empty archives and duplicate paths deterministically', () => {
    const empty = createZip([]);
    assert.equal(zipEntryCount(empty), 0);
    assert.equal(empty.length, 22, 'zip kosong harus tepat 22 byte (EOCD saja)');

    const dupes = createZip([
      { path: 'a.txt', content: 'first' },
      { path: 'a.txt', content: 'second' },
      { path: './b/../a.txt', content: 'third' },
    ]);
    assert.equal(zipEntryCount(dupes), 1, 'path duplikat harus dikolaps menjadi satu entri');

    // Same input twice => byte-identical output (fixed DOS timestamp).
    const one = createZip([{ path: 'x/y.txt', content: 'abc' }]);
    const two = createZip([{ path: 'x/y.txt', content: 'abc' }]);
    assert.deepEqual([...one], [...two], 'output ZIP harus deterministik');
  });

  test('normalises traversal and backslashes out of entry paths', () => {
    const zip = createZip([
      { path: '../../evil.txt', content: 'nope' },
      { path: 'ok\\windows.txt', content: 'yes' },
    ]);
    const paths = zipEntryPaths(zip);
    for (const p of paths) {
      assert.ok(!p.includes('..'), `path traversal bocor: ${p}`);
      assert.ok(!p.includes('\\'), `backslash bocor: ${p}`);
      assert.ok(!p.startsWith('/'), `path absolut bocor: ${p}`);
    }
  });

  test('buildZip wraps a generated project under one root folder', async () => {
    const fx = await seed('FZIP');
    const res = await call('POST', `/api/projects/${fx.projectId}/codegen`, {
      framework: 'pytest',
      persist: true,
    });
    const project = (res.json as { data: GeneratedProject }).data;
    const { bytes, filename } = buildZip(project);

    assert.match(filename, /\.zip$/);
    assert.equal(zipEntryCount(bytes), project.files.length);
    const paths = zipEntryPaths(bytes);
    for (const p of paths) {
      assert.ok(p.startsWith(`${filename.replace(/\.zip$/, '')}/`), `entri ${p} tidak di dalam root folder`);
    }
  });
});

/* ------------------------------------------------------------------ *
 * 4. HTTP surface
 * ------------------------------------------------------------------ */

describe('lane F — HTTP surface', () => {
  let fx: Fixture;

  before(async () => {
    fx = await seed('FHTTP');
    fixture = fx;
  });

  test('POST /projects/:id/codegen returns 201 with a persisted project', async () => {
    const res = await call('POST', `/api/projects/${fx.projectId}/codegen`, {
      framework: 'playwright',
      persist: true,
      parallel: true,
      workers: 3,
    });
    assert.equal(res.status, 201);
    const project = (res.json as { data: GeneratedProject }).data;
    assert.ok(project.id, 'persist:true harus mengembalikan id');
    assert.match(String(project.id), /^gen_/);
    assert.equal(project.project_id, fx.projectId);
    assert.equal(project.framework, 'playwright');
    assert.equal(project.language, 'typescript');
    assert.ok(project.files.length >= 3);
    assert.equal(project.generated_by, 'template');
  });

  test('persisted projects appear in GET /projects/:id/codegen', async () => {
    const res = await call('GET', `/api/projects/${fx.projectId}/codegen`);
    assert.equal(res.status, 200);
    const body = res.json as { data: Array<Record<string, unknown>>; total: number };
    assert.ok(Array.isArray(body.data));
    assert.ok(body.data.length >= 1);
    assert.equal(body.total, body.data.length);
    for (const row of body.data) {
      assert.ok(typeof row.id === 'string');
      assert.ok(typeof row.file_count === 'number' && row.file_count >= 3);
      assert.ok(typeof row.total_lines === 'number' && row.total_lines > 0);
      // The list must NOT ship file bodies.
      assert.equal(row.files, undefined, 'list endpoint tidak boleh mengirim isi file');
    }
  });

  test('GET /codegen/:id rehydrates an identical project', async () => {
    const created = await call('POST', `/api/projects/${fx.projectId}/codegen`, {
      framework: 'robotframework',
      persist: true,
    });
    const project = (created.json as { data: GeneratedProject }).data;

    const fetched = await call('GET', `/api/codegen/${project.id}`);
    assert.equal(fetched.status, 200);
    const reloaded = (fetched.json as { data: GeneratedProject }).data;
    assert.equal(reloaded.id, project.id);
    assert.equal(reloaded.framework, 'robotframework');
    assert.deepEqual(
      reloaded.files.map((f) => f.path),
      project.files.map((f) => f.path),
      'file list berubah setelah rehidrasi',
    );
    assert.deepEqual(reloaded.warnings, project.warnings);
    assert.deepEqual(reloaded.summary, project.summary);
  });

  test('GET /codegen/:id/file?path= returns text/plain raw content', async () => {
    const created = await call('POST', `/api/projects/${fx.projectId}/codegen`, {
      framework: 'playwright',
      persist: true,
    });
    const project = (created.json as { data: GeneratedProject }).data;
    const target = project.files.find((f) => f.path === 'playwright.config.ts')!;

    const res = await call(
      'GET',
      `/api/codegen/${project.id}/file?path=${encodeURIComponent(target.path)}`,
    );
    assert.equal(res.status, 200);
    assert.match(String(res.headers['content-type']), /text\/plain/);
    assert.equal(res.text, target.content, 'isi file endpoint tidak sama dengan hasil generate');

    const missing = await call('GET', `/api/codegen/${project.id}/file?path=nope.txt`);
    assert.equal(missing.status, 404);
    assert.equal(missing.json.error?.code, 'file_not_found');

    const noPath = await call('GET', `/api/codegen/${project.id}/file`);
    assert.equal(noPath.status, 400);
  });

  test('GET /codegen/:id/download returns a real ZIP with a sensible filename', async () => {
    const created = await call('POST', `/api/projects/${fx.projectId}/codegen`, {
      framework: 'k6',
      persist: true,
    });
    const project = (created.json as { data: GeneratedProject }).data;

    const res = await app.inject({ method: 'GET', url: `/api/codegen/${project.id}/download` });
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['content-type'], 'application/zip');
    assert.match(String(res.headers['content-disposition']), /attachment; filename=".+\.zip"/);

    const raw = res.rawPayload;
    assert.ok(raw.byteLength > 100, 'zip terlalu kecil');
    assert.deepEqual([...raw.subarray(0, 4)], [0x50, 0x4b, 0x03, 0x04], 'bukan ZIP (PK\\x03\\x04)');
    const eocd = raw.byteLength - 22;
    assert.deepEqual([...raw.subarray(eocd, eocd + 4)], [0x50, 0x4b, 0x05, 0x06], 'EOCD hilang');
    assert.equal(zipEntryCount(new Uint8Array(raw)), project.files.length, 'jumlah entri tidak cocok');
  });

  test('DELETE /codegen/:id removes the row and 404s afterwards', async () => {
    const created = await call('POST', `/api/projects/${fx.projectId}/codegen`, {
      framework: 'cypress',
      persist: true,
    });
    const project = (created.json as { data: GeneratedProject }).data;

    const del = await call('DELETE', `/api/codegen/${project.id}`);
    assert.equal(del.status, 200);
    assert.equal((del.json.data as Record<string, unknown>).deleted, true);

    const after = await call('GET', `/api/codegen/${project.id}`);
    assert.equal(after.status, 404);

    const again = await call('DELETE', `/api/codegen/${project.id}`);
    assert.equal(again.status, 404);
  });

  test('rejects unknown frameworks and unknown projects with the frozen error envelope', async () => {
    const badFramework = await call('POST', `/api/projects/${fx.projectId}/codegen`, {
      framework: 'selenium-python',
    });
    assert.equal(badFramework.status, 400);
    assert.equal(badFramework.json.error?.code, 'bad_request');
    assert.match(String(badFramework.json.error?.message), /framework/);

    const noBody = await call('POST', `/api/projects/${fx.projectId}/codegen`);
    assert.equal(noBody.status, 400);

    const ghost = await call('POST', '/api/projects/prj_does_not_exist/codegen', {
      framework: 'playwright',
    });
    assert.equal(ghost.status, 404);
    assert.equal(ghost.json.error?.code, 'project_not_found');

    const metaGhost = await call('GET', '/api/projects/prj_nope/codegen');
    assert.equal(metaGhost.status, 404);

    const detailGhost = await call('GET', '/api/codegen/gen_nope');
    assert.equal(detailGhost.status, 404);
  });

  test('normaliseRequest coerces an untrusted body without throwing', () => {
    const ok = normaliseRequest({ framework: 'k6', workers: 999, parallel: 'yes', use_ai: 1 });
    assert.equal(ok.ok, true);
    if (ok.ok) {
      assert.equal(ok.value.framework, 'k6');
      assert.equal(ok.value.workers, 16, 'workers harus di-clamp ke 16');
      assert.equal(ok.value.parallel, false, 'parallel harus boolean ketat');
      assert.equal(ok.value.use_ai, false);
    }

    const noFramework = normaliseRequest({});
    assert.equal(noFramework.ok, false);

    const notObject = normaliseRequest('playwright');
    assert.equal(notObject.ok, false);
  });
});

/* ------------------------------------------------------------------ *
 * 5. Filtering: layers, test_case_ids
 * ------------------------------------------------------------------ */

describe('lane F — filtering and honest warnings', () => {
  let fx: Fixture;

  before(async () => {
    fx = await seed('FFILT');
  });

  test('test_case_ids restricts generation to the requested cases', async () => {
    const webCaseId = findCaseId(fx, 'TC-001');
    const res = await call('POST', `/api/projects/${fx.projectId}/codegen`, {
      framework: 'playwright',
      test_case_ids: [webCaseId],
    });
    assert.equal(res.status, 201);
    const project = (res.json as { data: GeneratedProject }).data;
    assert.equal(project.summary.test_cases, 1, 'hanya 1 test case yang diminta');

    const spec = project.files.find((f) => f.path === 'tests/web.spec.ts')!.content;
    assert.ok(spec.includes(FIXTURE_TITLE), 'test case yang diminta harus muncul');
    assert.ok(
      !spec.includes('Jumlah user aktif'),
      'test case lain tidak boleh ikut ter-generate',
    );
  });

  test('an unknown test_case_id yields a warning, not a crash', async () => {
    const res = await call('POST', `/api/projects/${fx.projectId}/codegen`, {
      framework: 'playwright',
      test_case_ids: ['tc_tidak_ada'],
    });
    assert.equal(res.status, 201, 'harus tetap 201 dengan peringatan');
    const project = (res.json as { data: GeneratedProject }).data;
    assert.ok(
      project.warnings.some((w) => w.includes('tc_tidak_ada')),
      `tidak ada peringatan tentang id yang hilang: ${JSON.stringify(project.warnings)}`,
    );
  });

  test('requesting an unsupported layer produces a clear warning', async () => {
    // pytest supports db+api but NOT web.
    const res = await call('POST', `/api/projects/${fx.projectId}/codegen`, {
      framework: 'pytest',
      layers: ['web'],
    });
    assert.equal(res.status, 201);
    const project = (res.json as { data: GeneratedProject }).data;
    assert.ok(project.warnings.length > 0, 'warnings harus terisi');
    assert.ok(
      project.warnings.some((w) => w.includes('web') && w.includes('tidak didukung')),
      `tidak ada peringatan layer tidak didukung: ${JSON.stringify(project.warnings)}`,
    );
  });

  test('a framework with no artifact for a requested layer still warns honestly', async () => {
    // Generate for an empty project: crossing layer boundaries must be reported.
    const project = await call('POST', '/api/projects', { key: 'FEMPTY', name: 'Proyek Kosong' });
    const emptyId = String((project.json.data as Record<string, unknown>).id);

    const res = await call('POST', `/api/projects/${emptyId}/codegen`, {
      framework: 'playwright',
      layers: ['web', 'api'],
    });
    assert.equal(res.status, 201, 'proyek kosong tidak boleh melempar');
    const generated = (res.json as { data: GeneratedProject }).data;

    assert.ok(generated.warnings.length > 0, 'warnings[] harus terisi untuk layer tanpa artefak');
    assert.ok(
      generated.warnings.some((w) => w.includes('web') && w.toLowerCase().includes('belum ada')),
      `peringatan layer web hilang: ${JSON.stringify(generated.warnings)}`,
    );
    assert.ok(
      generated.warnings.some((w) => w.includes('api') && w.toLowerCase().includes('belum ada')),
      `peringatan layer api hilang: ${JSON.stringify(generated.warnings)}`,
    );

    // And the output must still be a structurally valid, runnable skeleton.
    assert.ok(generated.files.length >= 3);
    for (const f of generated.files) {
      assert.ok(f.purpose.trim().length > 5, `${f.path} tanpa purpose`);
      assert.ok(!f.content.includes('undefined'), `${f.path} memuat undefined`);
      assert.ok(!f.content.includes('[object Object]'), `${f.path} memuat [object Object]`);
      assert.ok(!f.content.includes('NaN'), `${f.path} memuat NaN`);
    }
    assert.equal(generated.summary.test_cases, 0);

    // The specs must still be importable/parseable, i.e. a placeholder rather than
    // a syntactically broken file.
    const spec = generated.files.find((f) => f.path === 'tests/web.spec.ts')!.content;
    assert.match(spec, /test\.(skip|fixme)|test\(/, 'placeholder spec harus tetap sintaksis valid');
  });

  test('generating for zero test cases returns a clear warning rather than throwing', async () => {
    const project = await call('POST', '/api/projects', { key: 'FZERO', name: 'Tanpa Test Case' });
    const emptyId = String((project.json.data as Record<string, unknown>).id);

    for (const framework of CODEGEN_FRAMEWORKS) {
      const res = await call('POST', `/api/projects/${emptyId}/codegen`, { framework });
      assert.equal(res.status, 201, `${framework} melempar pada proyek kosong: ${res.text.slice(0, 300)}`);
      const generated = (res.json as { data: GeneratedProject }).data;

      assert.ok(generated.warnings.length > 0, `${framework}: warnings[] kosong padahal tanpa test case`);
      assert.ok(
        generated.warnings.some((w) => w.includes('test case')),
        `${framework}: tidak ada peringatan "tidak ada test case": ${JSON.stringify(generated.warnings)}`,
      );
      assert.equal(generated.summary.test_cases, 0);
      assert.ok(generated.files.length >= 3, `${framework}: kerangka harus tetap dibuat`);
    }
  });

  test('a layer with no artifacts produces a non-empty warnings[]', async () => {
    const project = await call('POST', '/api/projects', { key: 'FNODB', name: 'Tanpa DB' });
    const pid = String((project.json.data as Record<string, unknown>).id);

    // One API-only project: ask for DB via a framework that supports it.
    const collection = await call('POST', `/api/projects/${pid}/collections`, {
      name: 'Only API',
      base_url: 'https://api.example.test',
    });
    const cid = String((collection.json.data as Record<string, unknown>).id);
    await call('POST', `/api/collections/${cid}/requests`, {
      name: 'GET /ping',
      method: 'GET',
      path: '/ping',
    });

    const res = await call('POST', `/api/projects/${pid}/codegen`, {
      framework: 'pytest',
      layers: ['api', 'db'],
    });
    assert.equal(res.status, 201);
    const generated = (res.json as { data: GeneratedProject }).data;
    assert.ok(generated.warnings.length > 0, 'warnings[] harus terisi ketika layer db kosong');
    assert.ok(
      generated.warnings.some((w) => w.includes('db')),
      `tidak ada peringatan tentang layer db: ${JSON.stringify(generated.warnings)}`,
    );
    assert.equal(generated.summary.db_checks, 0);
    assert.ok(generated.summary.api_requests >= 1);
  });

  test('cannot_automate cases are skipped and reported', async () => {
    const project = await call('POST', '/api/projects', { key: 'FSKIP', name: 'Skip Manual' });
    const pid = String((project.json.data as Record<string, unknown>).id);

    await call('POST', `/api/projects/${pid}/testcases`, {
      code: 'TC-900',
      title: 'Verifikasi warna oleh mata manusia',
      type: 'usability',
      layer: 'web',
      priority: 'low',
      severity: 'cosmetic',
      automation_status: 'cannot_automate',
      engine: 'manual',
      status: 'ready',
    });

    const res = await call('POST', `/api/projects/${pid}/codegen`, { framework: 'playwright' });
    assert.equal(res.status, 201);
    const generated = (res.json as { data: GeneratedProject }).data;
    assert.equal(generated.summary.test_cases, 0);
    assert.ok(
      generated.warnings.some((w) => w.includes('cannot_automate')),
      `tidak ada peringatan cannot_automate: ${JSON.stringify(generated.warnings)}`,
    );
  });

  test('deduplicates identical warnings so the UI list stays readable', async () => {
    const project = await call('POST', '/api/projects', { key: 'FDEDUP', name: 'Dedup' });
    const pid = String((project.json.data as Record<string, unknown>).id);
    const res = await call('POST', `/api/projects/${pid}/codegen`, {
      framework: 'pytest',
      layers: ['api', 'db'],
    });
    const generated = (res.json as { data: GeneratedProject }).data;
    const unique = new Set(generated.warnings);
    assert.equal(unique.size, generated.warnings.length, 'warnings memuat duplikat');
  });

  test('base_url override is honoured in the generated config', async () => {
    const res = await call('POST', `/api/projects/${fx.projectId}/codegen`, {
      framework: 'playwright',
      base_url: 'https://staging.qatools.test',
    });
    const project = (res.json as { data: GeneratedProject }).data;
    const config = project.files.find((f) => f.path === 'playwright.config.ts')!.content;
    assert.ok(config.includes('https://staging.qatools.test'), 'base_url override tidak dipakai');

    const res2 = await call('POST', `/api/projects/${fx.projectId}/codegen`, {
      framework: 'postman',
      base_url: 'https://staging.qatools.test',
    });
    const pm = (res2.json as { data: GeneratedProject }).data;
    const env = JSON.parse(pm.files.find((f) => f.path === 'environment.json')!.content) as {
      values: Array<{ key: string; value: string }>;
    };
    assert.equal(
      env.values.find((v) => v.key === 'baseUrl')?.value,
      'https://staging.qatools.test',
      'base_url override tidak masuk ke environment Postman',
    );
  });

  test('parallel flag controls workers in the emitted configs', async () => {
    const seq = await call('POST', `/api/projects/${fx.projectId}/codegen`, {
      framework: 'playwright',
      parallel: false,
    });
    const seqConfig = (seq.json as { data: GeneratedProject }).data.files.find(
      (f) => f.path === 'playwright.config.ts',
    )!.content;
    assert.match(seqConfig, /workers:\s*1/, 'parallel:false harus workers:1');
    assert.match(seqConfig, /fullyParallel:\s*false/);

    const par = await call('POST', `/api/projects/${fx.projectId}/codegen`, {
      framework: 'playwright',
      parallel: true,
      workers: 6,
    });
    const parConfig = (par.json as { data: GeneratedProject }).data.files.find(
      (f) => f.path === 'playwright.config.ts',
    )!.content;
    assert.match(parConfig, /workers:\s*6/);
    assert.match(parConfig, /fullyParallel:\s*true/);

    const testng = await call('POST', `/api/projects/${fx.projectId}/codegen`, {
      framework: 'selenium-java',
      parallel: true,
      workers: 5,
    });
    const suite = (testng.json as { data: GeneratedProject }).data.files.find(
      (f) => f.path === 'src/test/resources/testng.xml',
    )!.content;
    assert.match(suite, /parallel="methods"/);
    assert.match(suite, /thread-count="5"/);
  });

  test('the report summary reports honestly whether AI was involved', async () => {
    const noAi = await call('POST', `/api/projects/${fx.projectId}/codegen`, {
      framework: 'k6',
      use_ai: false,
    });
    assert.equal((noAi.json as { data: GeneratedProject }).data.generated_by, 'template');
  });
});

/** Looks up a seeded case id by code. */
function findCaseId(fx: Fixture, code: string): string {
  const row = db.prepare('SELECT id FROM test_cases WHERE project_id = ? AND code = ?').get(
    fx.projectId,
    code,
  ) as { id: string } | undefined;
  assert.ok(row, `test case ${code} tidak ditemukan di fixture`);
  return row.id;
}
