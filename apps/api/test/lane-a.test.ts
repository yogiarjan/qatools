/**
 * Lane A tests — use case / scenario / test case builder + traceability matrix.
 *
 * Runs against a throwaway SQLite file via `QATOOLS_DB`, booting the real Fastify app
 * so the routes, validation and envelopes are all exercised.
 *
 *   node --test --import <repo>/apps/api/node_modules/tsx/dist/loader.mjs apps/api/test/lane-a.test.ts
 */

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

// The API reads QATOOLS_DB at import time, so the scratch DB must be in place first.
const scratch = mkdtempSync(resolve(tmpdir(), 'qatools-lane-a-'));
process.env.QATOOLS_DB = resolve(scratch, 'lane-a.db');

type App = Awaited<ReturnType<typeof buildApp>>;
const { buildApp } = await import('../src/server.js');
const { db } = await import('../src/db/index.js');
const { matrixService } = await import('../src/modules/matrix/service.js');

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
): Promise<{ status: number; json: Json; text: string }> {
  const res = await app.inject({
    method,
    url,
    ...(body === undefined ? {} : { payload: body as object }),
  });
  const text = res.body;
  let json: Json = {};
  try {
    json = JSON.parse(text) as Json;
  } catch {
    /* non-JSON (exports) */
  }
  return { status: res.statusCode, json, text };
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
 * Fixture: one fully traced project
 * ------------------------------------------------------------------ */

describe('lane A — projects', () => {
  let projectId = '';

  test('POST /projects creates the project and a default environment', async () => {
    const res = await call('POST', '/api/projects', {
      key: 'shop',
      name: 'Toko Online',
      target_url: 'https://example.test',
      quality_gate: 95,
    });
    assert.equal(res.status, 201);
    const project = res.json.data as Record<string, unknown>;
    projectId = String(project.id);
    assert.match(projectId, /^prj_/);
    assert.equal(project.key, 'SHOP');
    assert.equal(project.quality_gate, 95);

    const envs = db
      .prepare('SELECT * FROM environments WHERE project_id = ?')
      .all(projectId) as Array<Record<string, unknown>>;
    assert.equal(envs.length, 1, 'exactly one default environment is auto-created');
    assert.equal(Number(envs[0].is_default), 1);
    assert.equal(envs[0].base_url, 'https://example.test');
  });

  test('GET /projects returns the list envelope', async () => {
    const res = await call('GET', '/api/projects');
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.json.data));
    assert.equal(res.json.total, 1);
  });

  test('duplicate project key is rejected with 409', async () => {
    const res = await call('POST', '/api/projects', { key: 'SHOP', name: 'Duplikat' });
    assert.equal(res.status, 409);
    assert.equal(res.json.error?.code, 'conflict');
  });

  test('PATCH /projects/:id updates the quality gate', async () => {
    const res = await call('PATCH', `/api/projects/${projectId}`, { quality_gate: 88 });
    assert.equal(res.status, 200);
    assert.equal((res.json.data as Record<string, unknown>).quality_gate, 88);
  });
});

/* ------------------------------------------------------------------ *
 * Requirements → Use case → Scenario → Test case chain
 * ------------------------------------------------------------------ */

let projectId = '';
let requirementId = '';
let gapRequirementId = '';
let useCaseId = '';
let scenarioId = '';
let testCaseId = '';

describe('lane A — requirement → use case → scenario → test case chain', () => {
  before(async () => {
    const project = await call('POST', '/api/projects', { key: 'CART', name: 'Keranjang' });
    projectId = String((project.json.data as Record<string, unknown>).id);
  });

  test('requirements get sequential REQ-nnn codes', async () => {
    const first = await call('POST', `/api/projects/${projectId}/requirements`, {
      title: 'User dapat menambahkan barang ke keranjang',
      priority: 'high',
      acceptance_criteria: ['Barang muncul di keranjang', 'Jumlah bertambah'],
    });
    assert.equal(first.status, 201);
    requirementId = String((first.json.data as Record<string, unknown>).id);
    assert.equal((first.json.data as Record<string, unknown>).code, 'REQ-001');

    const second = await call('POST', `/api/projects/${projectId}/requirements`, {
      title: 'Kebutuhan yang belum diturunkan (gap)',
    });
    gapRequirementId = String((second.json.data as Record<string, unknown>).id);
    assert.equal((second.json.data as Record<string, unknown>).code, 'REQ-002');
  });

  test('bulk import creates requirements from pasted CSV', async () => {
    const res = await call('POST', `/api/projects/${projectId}/requirements/bulk`, {
      items: [
        { title: 'Checkout berhasil', priority: 'critical' },
        { title: 'Riwayat pesanan tampil' },
      ],
    });
    assert.equal(res.status, 201);
    assert.equal((res.json.data as unknown[]).length, 2);
  });

  test('POST /usecases links the requirement automatically', async () => {
    const res = await call('POST', `/api/projects/${projectId}/usecases`, {
      name: 'Tambah ke keranjang',
      goal: 'Pengguna menambahkan produk ke keranjang belanja',
      actors: ['Pembeli'],
      preconditions: ['Pengguna sudah login'],
      postconditions: ['Keranjang berisi produk'],
      main_flow: ['Buka detail produk', 'Klik tambah ke keranjang', 'Sistem menampilkan konfirmasi'],
      alternate_flows: [{ name: 'Stok habis', steps: ['Klik tambah', 'Sistem menolak'] }],
      business_rules: ['Maksimal 99 unit per produk'],
      requirement_ids: [requirementId],
      priority: 'high',
    });
    assert.equal(res.status, 201);
    const uc = res.json.data as Record<string, unknown>;
    useCaseId = String(uc.id);
    assert.match(useCaseId, /^uc_/);
    assert.equal(uc.code, 'UC-001');
    assert.deepEqual(uc.actors_list, ['Pembeli']);
    assert.deepEqual(uc.main_flow_list, ['Buka detail produk', 'Klik tambah ke keranjang', 'Sistem menampilkan konfirmasi']);

    const link = db
      .prepare(
        `SELECT * FROM matrix_links
          WHERE link_type = 'requirement_to_usecase' AND from_id = ? AND to_id = ?`,
      )
      .get(requirementId, useCaseId);
    assert.ok(link, 'requirement_to_usecase link was auto-derived on create');
  });

  test('POST /scenarios links the use case automatically', async () => {
    const res = await call('POST', `/api/projects/${projectId}/scenarios`, {
      use_case_id: useCaseId,
      title: 'Menambahkan produk yang tersedia',
      kind: 'happy_path',
      given_text: 'Pengguna berada di halaman detail produk',
      when_text: 'Pengguna menekan tombol Tambah ke Keranjang',
      then_text: 'Produk muncul di keranjang dengan jumlah 1',
      priority: 'high',
    });
    assert.equal(res.status, 201);
    const sc = res.json.data as Record<string, unknown>;
    scenarioId = String(sc.id);
    assert.equal(sc.code, 'SC-001');

    const link = db
      .prepare(
        `SELECT * FROM matrix_links
          WHERE link_type = 'usecase_to_scenario' AND from_id = ? AND to_id = ?`,
      )
      .get(useCaseId, scenarioId);
    assert.ok(link, 'usecase_to_scenario link was auto-derived on create');
  });

  test('POST /testcases links scenario, derives requirement edge + risk score', async () => {
    const res = await call('POST', `/api/projects/${projectId}/testcases`, {
      scenario_id: scenarioId,
      title: 'Tambah produk tersedia ke keranjang',
      objective: 'Memastikan produk valid dapat ditambahkan',
      type: 'functional',
      layer: 'web',
      priority: 'high',
      automation_status: 'automated',
      engine: 'web',
      expected_result: 'Keranjang berisi 1 produk',
      steps: [
        { action: 'Buka halaman detail produk', expected: 'Halaman tampil' },
        { action: 'Klik tombol Tambah ke Keranjang', expected: 'Toast sukses' },
      ],
      test_data: [{ field: 'sku', value: 'SKU-001' }],
    });
    assert.equal(res.status, 201);
    const tc = res.json.data as Record<string, unknown>;
    testCaseId = String(tc.id);
    assert.equal(tc.code, 'TC-001');
    assert.ok(Number(tc.risk_score) > 0, 'risk_score computed on create');
    assert.equal((tc.steps as unknown[]).length, 2);

    const scenarioLink = db
      .prepare(
        `SELECT * FROM matrix_links
          WHERE link_type = 'scenario_to_testcase' AND from_id = ? AND to_id = ?`,
      )
      .get(scenarioId, testCaseId);
    assert.ok(scenarioLink, 'scenario_to_testcase link was auto-derived');

    const reqLink = db
      .prepare(
        `SELECT * FROM matrix_links
          WHERE link_type = 'requirement_to_testcase' AND from_id = ? AND to_id = ?`,
      )
      .get(requirementId, testCaseId);
    assert.ok(reqLink, 'requirement_to_testcase link was derived transitively');
  });

  test('PUT /testcases/:id/steps replaces the whole ordered list', async () => {
    const res = await call('PUT', `/api/testcases/${testCaseId}/steps`, {
      steps: [
        { action: 'Login sebagai pembeli', expected: 'Masuk ke beranda' },
        { action: 'Buka detail produk', expected: 'Detail tampil' },
        { action: 'Klik tambah ke keranjang', expected: 'Toast sukses' },
      ],
    });
    assert.equal(res.status, 200);
    const steps = res.json.data as Array<Record<string, unknown>>;
    assert.equal(steps.length, 3);
    assert.deepEqual(
      steps.map((s) => s.order_index),
      [1, 2, 3],
    );
    assert.equal(steps[0].action, 'Login sebagai pembeli');
  });

  test('POST /testcases/:id/regression toggles the King flag', async () => {
    const on = await call('POST', `/api/testcases/${testCaseId}/regression`, {});
    assert.equal(on.status, 200);
    assert.equal((on.json.data as Record<string, unknown>).is_regression, 1);

    const off = await call('POST', `/api/testcases/${testCaseId}/regression`, {});
    assert.equal(off.status, 200);
    assert.equal((off.json.data as Record<string, unknown>).is_regression, 0);
  });
});

/* ------------------------------------------------------------------ *
 * The matrix document
 * ------------------------------------------------------------------ */

describe('lane A — matrix document', () => {
  test('GET /projects/:id/matrix reports 1 covered + 1 gap', async () => {
    const res = await call('GET', `/api/projects/${projectId}/matrix`);
    assert.equal(res.status, 200);
    const doc = res.json.data as {
      cells: Array<Record<string, unknown>>;
      summary: Record<string, number>;
    };

    assert.equal(doc.summary.requirements, 4, 'REQ-001, REQ-002 + 2 imported');

    const coveredCell = doc.cells.find((c) => c.requirement_id === requirementId);
    assert.ok(coveredCell, 'the traced requirement has a cell');
    assert.equal(coveredCell.coverage, 'covered');
    assert.equal(coveredCell.coverage_pct, 100);
    assert.deepEqual(coveredCell.use_case_ids, [useCaseId]);
    assert.deepEqual(coveredCell.scenario_ids, [scenarioId]);
    assert.deepEqual(coveredCell.test_case_ids, [testCaseId]);
    assert.equal(coveredCell.automation_pct, 100);

    const gapCell = doc.cells.find((c) => c.requirement_id === gapRequirementId);
    assert.ok(gapCell, 'the untraced requirement has a cell');
    assert.equal(gapCell.coverage, 'gap');
    assert.equal(gapCell.coverage_pct, 0);
    assert.deepEqual(gapCell.use_case_ids, []);
    assert.deepEqual(gapCell.test_case_ids, []);

    assert.equal(doc.summary.covered, 1);
    assert.equal(doc.summary.gaps, 3, 'REQ-002 + the two imported requirements');
  });

  test('matrixService.document() agrees with the HTTP route', async () => {
    const doc = await matrixService.document(projectId);
    assert.equal(doc.project_id, projectId);
    assert.equal(doc.cells.length, doc.summary.requirements + doc.summary.orphans);
  });

  test('a test case with no requirement shows up as an orphan, not a gap', async () => {
    // A use case that no requirement points at: everything below it is unreachable.
    const orphanUseCase = await call('POST', `/api/projects/${projectId}/usecases`, {
      name: 'Use case tanpa requirement',
    });
    const orphanUseCaseId = String((orphanUseCase.json.data as Record<string, unknown>).id);

    const orphan = await call('POST', `/api/projects/${projectId}/scenarios`, {
      title: 'Skenario tanpa requirement',
      use_case_id: orphanUseCaseId,
      kind: 'negative',
    });
    const orphanScenario = String((orphan.json.data as Record<string, unknown>).id);

    const tc = await call('POST', `/api/projects/${projectId}/testcases`, {
      scenario_id: orphanScenario,
      title: 'Test case tanpa jalur requirement',
    });
    const orphanTestCase = String((tc.json.data as Record<string, unknown>).id);

    const doc = await matrixService.document(projectId);
    const orphanCell = doc.cells.find((c) => c.requirement_id === `orphan:${orphanTestCase}`);
    assert.ok(orphanCell, 'orphan cell is emitted for an unreachable test case');
    assert.equal(orphanCell.coverage, 'orphan');
    assert.deepEqual(orphanCell.test_case_ids, [orphanTestCase]);
    assert.equal(doc.summary.orphans, 1);
  });
});

/* ------------------------------------------------------------------ *
 * Impact analysis
 * ------------------------------------------------------------------ */

describe('lane A — impactOf blast radius', () => {
  test('impactOf(requirement) reaches the whole downstream chain', async () => {
    const report = await matrixService.impactOf(requirementId);
    assert.equal(report.artifact_kind, 'requirement');
    assert.equal(report.artifact_code, 'REQ-001');

    assert.deepEqual(
      report.affected_use_cases.map((u) => u.id),
      [useCaseId],
    );
    assert.ok(report.affected_scenarios.some((s) => s.id === scenarioId));
    assert.ok(report.affected_test_cases.some((t) => t.id === testCaseId));
    assert.ok(report.blast_radius >= 3, 'blast radius counts the whole chain');
  });

  test('impactOf(testcase) walks back up to its requirement', async () => {
    const report = await matrixService.impactOf(testCaseId);
    assert.equal(report.artifact_kind, 'testcase');
    assert.ok(
      report.affected_requirements.some((r) => r.id === requirementId),
      'backward walk finds the originating requirement',
    );
  });

  test('GET /projects/:id/matrix/impact/:artifactId matches the service', async () => {
    const res = await call('GET', `/api/projects/${projectId}/matrix/impact/${requirementId}`);
    assert.equal(res.status, 200);
    const report = res.json.data as { blast_radius: number; artifact_code: string | null };
    assert.equal(report.artifact_code, 'REQ-001');
    assert.ok(report.blast_radius >= 3);
  });

  test('unknown artifact id returns 404', async () => {
    const res = await call('GET', `/api/projects/${projectId}/matrix/impact/req_does_not_exist`);
    assert.equal(res.status, 404);
  });
});

/* ------------------------------------------------------------------ *
 * Manual links + sync
 * ------------------------------------------------------------------ */

describe('lane A — manual links and sync', () => {
  test('POST /matrix/links creates a manual link and DELETE removes it', async () => {
    const created = await call('POST', '/api/matrix/links', {
      link_type: 'requirement_to_usecase',
      from_id: gapRequirementId,
      to_id: useCaseId,
      project_id: projectId,
      note: 'Dipakai juga oleh use case ini',
    });
    assert.equal(created.status, 201);
    const linkId = String((created.json.data as Record<string, unknown>).id);

    const doc = await matrixService.document(projectId);
    const cell = doc.cells.find((c) => c.requirement_id === gapRequirementId);
    assert.equal(cell?.coverage, 'covered', 'the manual link closes the gap');

    const removed = await call('DELETE', `/api/matrix/links/${linkId}`);
    assert.equal(removed.status, 200);

    const after = await matrixService.document(projectId);
    assert.equal(
      after.cells.find((c) => c.requirement_id === gapRequirementId)?.coverage,
      'gap',
      'removing the manual link reopens the gap',
    );
  });

  test('POST /matrix/sync rebuilds derived links and is idempotent', async () => {
    // Simulate a lost derived edge.
    db.prepare(
      `DELETE FROM matrix_links WHERE link_type = 'scenario_to_testcase' AND to_id = ?`,
    ).run(testCaseId);

    const res = await call('POST', `/api/projects/${projectId}/matrix/sync`);
    assert.equal(res.status, 200);
    const counts = (res.json.data as { counts: Record<string, number> }).counts;
    assert.equal(counts.scenario_to_testcase, 1, 'the lost edge is rebuilt');

    const again = await call('POST', `/api/projects/${projectId}/matrix/sync`);
    const counts2 = (again.json.data as { counts: Record<string, number> }).counts;
    assert.equal(counts2.scenario_to_testcase, 0, 'second sync creates nothing new');
    assert.equal(counts2.total, counts.total, 'link total is stable');
  });
});

/* ------------------------------------------------------------------ *
 * Exports
 * ------------------------------------------------------------------ */

describe('lane A — exports', () => {
  test('export matrix CSV has the right header and attachment headers', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/projects/${projectId}/export/matrix?format=csv` });
    assert.equal(res.statusCode, 200);
    assert.match(String(res.headers['content-type']), /text\/csv/);
    assert.match(String(res.headers['content-disposition']), /attachment; filename="matrix-CART-/);

    const lines = res.body.replace(/^\uFEFF/, '').split('\r\n').filter(Boolean);
    assert.equal(
      lines[0],
      'requirement_code,requirement_title,priority,status,use_case_count,scenario_count,test_case_count,defect_count,coverage_pct,automation_pct,coverage_status,use_case_codes,scenario_codes,test_case_codes',
    );
    assert.ok(lines.length >= 5, 'one row per requirement plus the header');
    assert.ok(res.body.includes('REQ-001'), 'the traced requirement appears');
    assert.ok(res.body.includes('Tercakup'), 'coverage label is rendered in Indonesian');
  });

  test('export matrix JSON and Markdown use their own content types', async () => {
    const json = await app.inject({ method: 'GET', url: `/api/projects/${projectId}/export/matrix?format=json` });
    assert.equal(json.statusCode, 200);
    assert.match(String(json.headers['content-type']), /application\/json/);
    const parsed = JSON.parse(json.body) as { project_id: string };
    assert.equal(parsed.project_id, projectId);

    const md = await app.inject({ method: 'GET', url: `/api/projects/${projectId}/export/matrix?format=md` });
    assert.equal(md.statusCode, 200);
    assert.match(String(md.headers['content-type']), /text\/markdown/);
    assert.ok(md.body.startsWith('# Digital Traceability Matrix'));
    assert.ok(md.body.includes('## Ringkasan'));
  });

  test('export testcases CSV carries the catalogue header', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/projects/${projectId}/export/testcases?format=csv`,
    });
    assert.equal(res.statusCode, 200);
    assert.match(String(res.headers['content-type']), /text\/csv/);
    assert.match(String(res.headers['content-disposition']), /attachment; filename="testcases-CART-/);

    const lines = res.body.replace(/^\uFEFF/, '').split('\r\n').filter(Boolean);
    assert.equal(
      lines[0],
      'code,title,type,layer,priority,severity,engine,automation_status,risk_score,is_regression,status,use_case_code,scenario_code,objective,preconditions,steps,test_data,expected_result,estimated_minutes,tags',
    );
    assert.ok(res.body.includes('TC-001'));
  });

  test('export pack bundles every artifact', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/projects/${projectId}/export/pack` });
    assert.equal(res.statusCode, 200);
    assert.match(String(res.headers['content-type']), /application\/json/);
    const pack = JSON.parse(res.body) as {
      summary: Record<string, number>;
      test_cases: Array<Record<string, unknown>>;
      matrix: { cells: unknown[] };
    };
    assert.equal(pack.summary.requirements, 4);
    assert.ok(pack.summary.use_cases >= 1);
    assert.ok(Array.isArray(pack.test_cases[0].steps));
    assert.ok(Array.isArray(pack.matrix.cells));
  });

  test('unknown export format is rejected', async () => {
    const res = await call('GET', `/api/projects/${projectId}/export/matrix?format=xlsx`);
    assert.equal(res.status, 400);
  });
});

/* ------------------------------------------------------------------ *
 * Duplication + validation
 * ------------------------------------------------------------------ */

describe('lane A — validation and duplication', () => {
  test('POST /usecases/:id/duplicate copies the flows and keeps the requirement links', async () => {
    const source = await call('GET', `/api/usecases/${useCaseId}`);
    const sourceData = source.json.data as Record<string, unknown>;

    const res = await call('POST', `/api/usecases/${useCaseId}/duplicate`, {});
    assert.equal(res.status, 201);
    const copy = res.json.data as Record<string, unknown>;
    assert.match(String(copy.code), /^UC-\d{3}$/, 'the copy gets a fresh sequential code');
    assert.notEqual(copy.code, sourceData.code);
    assert.notEqual(copy.id, useCaseId);
    assert.deepEqual(copy.actors_list, sourceData.actors_list);
    assert.deepEqual(copy.main_flow_list, sourceData.main_flow_list);
    assert.deepEqual(copy.alternate_flows_list, sourceData.alternate_flows_list);
    assert.deepEqual(copy.business_rules_list, sourceData.business_rules_list);

    const links = db
      .prepare(
        `SELECT * FROM matrix_links
          WHERE link_type = 'requirement_to_usecase' AND from_id = ? AND to_id = ?`,
      )
      .get(requirementId, copy.id);
    assert.ok(links, 'the duplicate inherits the requirement link');
  });

  test('creating a use case without a name is a 400 with the error envelope', async () => {
    const res = await call('POST', `/api/projects/${projectId}/usecases`, { goal: 'tanpa nama' });
    assert.equal(res.status, 400);
    assert.equal(res.json.error?.code, 'bad_request');
    assert.match(String(res.json.error?.message), /nama use case/i);
  });

  test('unknown project scoping returns 404', async () => {
    const res = await call('GET', '/api/projects/prj_missing/requirements');
    assert.equal(res.status, 404);
  });

  test('deleting a requirement removes its links but keeps the use case', async () => {
    const created = await call('POST', `/api/projects/${projectId}/requirements`, {
      title: 'Kebutuhan sementara',
    });
    const tempId = String((created.json.data as Record<string, unknown>).id);

    const linked = await call('POST', '/api/matrix/links', {
      link_type: 'requirement_to_usecase',
      from_id: tempId,
      to_id: useCaseId,
      project_id: projectId,
    });
    assert.equal(linked.status, 201);

    const del = await call('DELETE', `/api/requirements/${tempId}`);
    assert.equal(del.status, 200);

    const dangling = db
      .prepare('SELECT * FROM matrix_links WHERE from_id = ? OR to_id = ?')
      .all(tempId, tempId);
    assert.equal(dangling.length, 0, 'no dangling links remain');
    assert.ok(
      db.prepare('SELECT id FROM use_cases WHERE id = ?').get(useCaseId),
      'the use case survives',
    );
  });

  test('DELETE /projects/:id refuses to drop a project that still has artifacts', async () => {
    const res = await call('DELETE', `/api/projects/${projectId}`);
    assert.equal(res.status, 409, 'conflict without ?force=true');
  });
});
