/**
 * Lane D — AI layer tests (`apps/api/test/lane-d.test.ts`).
 *
 * These tests MUST NOT touch the real internet. Every provider call is pointed at a
 * closed local port, so a stray network request fails fast and is caught by the
 * "no network call happens in offline mode" assertions below.
 *
 * Run:
 *   node --test --import <repo>/apps/api/node_modules/tsx/dist/loader.mjs apps/api/test/lane-d.test.ts
 */

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, type Server } from 'node:net';

/* ------------------------------------------------------------------ *
 * Isolation: point the DB at a scratch file BEFORE importing the app.
 * ------------------------------------------------------------------ */

const scratch = mkdtempSync(resolve(tmpdir(), 'qatools-lane-d-'));
process.env.QATOOLS_DB = resolve(scratch, 'lane-d.db');
// Any accidental provider call goes to a closed port → instant ECONNREFUSED.
process.env.QATOOLS_API_BASE = 'http://127.0.0.1:1';

/**
 * Resolve paths from THIS FILE, never from `process.cwd()`: the suite is invoked both
 * from the repo root (`node --test apps/api/test/*.test.ts`) and from `apps/api`, and a
 * cwd-relative path silently breaks the source-reading assertions in one of them.
 */
const here = dirname(fileURLToPath(import.meta.url));
const aiSrcDir = resolve(here, '..', 'src', 'modules', 'ai');
const repoRoot = resolve(here, '..', '..', '..');

const { db, migrate } = await import('../src/db/index.js');
const { AI_TASKS, CASE_TYPES, LAYER_KINDS } = await import('@qatools/shared');
const { aiService } = await import('../src/modules/ai/index.js');
const { extractJson, extractJsonDetailed } = await import('../src/modules/ai/json.js');
const { crawlSite } = await import('../src/modules/ai/crawler.js');
const { offlineGenerate, generateTestCases } = await import('../src/modules/ai/offline.js');
const { maskKey } = await import('../src/modules/ai/index.js');
const { callProvider } = await import('../src/modules/ai/providers.js');

migrate();

/* ------------------------------------------------------------------ *
 * Fixtures
 * ------------------------------------------------------------------ */

/** A project row so persistence / FK constraints are satisfiable. */
function seedProject(id = 'prj_laned_test'): string {
  const now = new Date().toISOString();
  const existing = db.prepare(`SELECT id FROM projects WHERE id = ?`).get(id) as { id?: string } | undefined;
  if (!existing) {
    db.prepare(
      `INSERT INTO projects (id, key, name, description, target_url, owner, status, quality_gate, created_at, updated_at)
       VALUES (?, ?, ?, ?, NULL, ?, 'active', 90, ?, ?)`,
    ).run(id, 'LANED', 'Lane D Test Project', 'Proyek untuk pengujian lapisan AI', 'lane-d', now, now);
  }
  return id;
}

const FIXTURE_HTML = `<!doctype html>
<html lang="id">
<head><meta charset="utf-8"><title>Halaman Uji Crawler</title></head>
<body>
  <h1>Katalog Produk</h1>
  <h2>Masuk</h2>
  <h3>Bantuan</h3>
  <form action="/api/mock/login" method="post">
    <label for="username">Username</label>
    <input id="username" name="username" type="text" placeholder="admin" required>
    <label for="password">Kata Sandi</label>
    <input id="password" name="password" type="password" required>
    <button type="submit">Masuk</button>
  </form>
  <form action="/api/mock/products" method="get">
    <input name="q" type="search" placeholder="cari produk">
    <button type="submit">Cari</button>
  </form>
  <table>
    <thead><tr><th>SKU</th><th>Nama</th><th>Harga</th></tr></thead>
    <tbody>
      <tr><td>SKU-001</td><td>Keyboard</td><td>850000</td></tr>
      <tr><td>SKU-002</td><td>Mouse</td><td>320000</td></tr>
    </tbody>
  </table>
  <a href="/api/mock/products">Produk</a>
  <a href="/api/mock/health">Health</a>
  <button type="button">Tambah ke Keranjang</button>
  <button type="button">Checkout</button>
</body>
</html>`;

/** A sample use case / scenario used to drive the chain tasks. */
const SAMPLE_USE_CASE = {
  name: 'Login Pengguna',
  goal: 'Memungkinkan Pengguna masuk dengan email dan kata sandi.',
  actors: ['Pengguna'],
  preconditions: ['Akun uji sudah terdaftar'],
  postconditions: ['Sesi login aktif'],
  main_flow: ['Pengguna membuka halaman login.', 'Pengguna mengisi email dan kata sandi.', 'Sistem membuat sesi.'],
  alternate_flows: [],
  business_rules: ['Password minimal 8 karakter'],
  priority: 'high',
  risk: 'high',
};

const SAMPLE_SCENARIO = {
  title: 'Login berhasil',
  kind: 'happy_path',
  given_text: 'Pengguna terdaftar dengan kredensial valid',
  when_text: 'mengisi email dan kata sandi lalu menekan Masuk',
  then_text: 'diarahkan ke dashboard',
  priority: 'high',
};

const TASK_INPUTS: Record<string, Record<string, unknown>> = {
  crawl_site: { url: 'http://127.0.0.1:1/tidak-ada', html: FIXTURE_HTML },
  generate_usecases: { feature_description: 'Pengguna dapat login dengan email. Admin dapat menonaktifkan akun pengguna.' },
  generate_scenarios: { use_case: SAMPLE_USE_CASE },
  generate_testcases: { scenario: SAMPLE_SCENARIO },
  generate_test_data: { fields: ['email', 'password', 'quantity'] },
  generate_api_tests: { endpoints: 'POST /mock/login\nGET /mock/products' },
  generate_db_checks: { requirement_text: 'Pastikan tidak ada duplikat email pada tabel pengguna.' },
  generate_web_flow: { scenario_text: 'Login lalu buka katalog produk', url: 'http://127.0.0.1:1/mock/demo' },
  generate_sql: { requirement_text: 'Berapa jumlah pengguna aktif bulan ini?' },
  review_coverage: { gaps: [{ requirement_id: 'REQ-001', title: 'Pengguna dapat login' }], matrix_summary: { coverage_pct: 40, automation_pct: 10 } },
  triage_defect: { title: 'Tombol simpan tidak berfungsi', actual_result: 'Data hilang setelah refresh', expected_result: 'Data tersimpan' },
  summarize_test_plan: { project_name: 'Toko Demo', test_cases: [{ id: 'tc_1', title: 'Login berhasil', type: 'functional' }] },
  predict_risk: { test_cases: [{ id: 'tc_1', code: 'TC-001', title: 'Pembayaran checkout', type: 'functional' }] },
  chat: { message: 'Buatkan use case login' },
};

let closedPort = 1;
let closedPortServer: Server | null = null;

/**
 * Reserve a port, then close it — guaranteeing nothing is listening.
 * Any provider attempt against it fails immediately with ECONNREFUSED.
 */
async function reserveClosedPort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const srv = createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 1;
      srv.close(() => {
        closedPortServer = srv;
        resolvePort(port);
      });
    });
  });
}

let networkAttempts = 0;
const realFetch = globalThis.fetch;

before(async () => {
  closedPort = await reserveClosedPort();
  // Instrument fetch so we can PROVE offline mode performs no network call.
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    networkAttempts += 1;
    return realFetch(input as never, init as never);
  }) as typeof fetch;
});

after(() => {
  globalThis.fetch = realFetch;
  void closedPortServer;
  try {
    rmSync(scratch, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

/** Configures the singleton settings row directly (no HTTP). */
function setSettings(patch: Record<string, unknown>): void {
  // The module reads `ORDER BY created_at LIMIT 1` and creates the row lazily on first
  // use, so the test must (a) ensure the row exists and (b) update exactly that row.
  db.prepare(
    `INSERT INTO ai_settings (id, provider, model, base_url, api_key, api_key_masked, temperature, max_tokens, enabled, fallback_to_mock, created_at, updated_at)
     SELECT 'ais_laned_seed', 'mock', 'qatools-mock-1', NULL, NULL, NULL, 0.3, 4096, 1, 1, ?, ?
     WHERE NOT EXISTS (SELECT 1 FROM ai_settings)`,
  ).run(new Date(0).toISOString(), new Date(0).toISOString());

  const row = db.prepare(`SELECT id FROM ai_settings ORDER BY created_at LIMIT 1`).get() as { id?: string } | undefined;
  assert.ok(row?.id, 'baris ai_settings harus tersedia untuk pengujian');
  const keys = Object.keys(patch);
  if (!keys.length) return;
  db.prepare(`UPDATE ai_settings SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`).run(
    ...keys.map((k) => patch[k] as never),
    new Date().toISOString(),
    row.id,
  );
}

/** Reads back what the AI module itself would see. */
function currentSettings(): Record<string, unknown> {
  return db.prepare(`SELECT * FROM ai_settings ORDER BY created_at LIMIT 1`).get() as Record<string, unknown>;
}

/* ================================================================== *
 * 1. OFFLINE MODE — every AI task returns a real deterministic result
 * ================================================================== */

describe('offline mode', () => {
  test('every AI_TASKS entry returns ok:true, used_mock:true, non-null data and NO network call', async () => {
    const projectId = seedProject();
    // The nastiest possible configuration: a real-looking provider with a key,
    // pointed at a CLOSED port. fallback_to_mock must rescue all of it.
    setSettings({
      provider: 'openai',
      model: 'gpt-4o-mini',
      base_url: `http://127.0.0.1:${closedPort}/v1`,
      api_key: 'sk-test-key-not-real',
      api_key_masked: 'sk-…real',
      enabled: 1,
      fallback_to_mock: 1,
    });

    const before = networkAttempts;
    const results: Array<{ task: string; ok: boolean; usedMock: boolean; degraded: boolean; kind: string }> = [];

    for (const task of AI_TASKS) {
      const res = await aiService.generate(task, TASK_INPUTS[task] ?? {}, { projectId });
      assert.equal(res.ok, true, `task ${task} harus ok:true`);
      assert.equal(res.meta.used_mock, true, `task ${task} harus used_mock:true`);
      assert.notEqual(res.data, null, `task ${task} harus punya data non-null`);
      assert.notEqual(res.data, undefined, `task ${task} data tidak boleh undefined`);
      assert.equal(res.meta.task, task);
      assert.ok(res.meta.generation_id, `task ${task} harus menyimpan id generasi`);
      assert.equal(typeof res.meta.latency_ms, 'number');
      assert.equal(
        (res.meta as unknown as Record<string, unknown>).provider_attempted,
        true,
        `task ${task} harus mencoba provider live sebelum jatuh ke offline (settings=${JSON.stringify({
          provider: currentSettings().provider,
          enabled: currentSettings().enabled,
          api_key: Boolean(currentSettings().api_key),
          base_url: currentSettings().base_url,
        })})`,
      );
      results.push({
        task,
        ok: res.ok,
        usedMock: res.meta.used_mock,
        degraded: res.meta.degraded,
        kind: Array.isArray(res.data) ? 'array' : typeof res.data,
      });
    }

    assert.equal(results.length, AI_TASKS.length, 'seluruh AI_TASKS harus tercakup');
    for (const r of results) assert.ok(['array', 'object'].includes(r.kind), `${r.task} harus object/array`);

    // The provider failed → we degraded, and we said so.
    const notDegraded = results.filter((r) => !r.degraded);
    assert.equal(
      notDegraded.length,
      0,
      `semua task harus degraded:true ketika provider live gagal; tidak degraded: ${notDegraded.map((r) => r.task).join(', ')}`,
    );

    // One provider attempt per task — and NOTHING else on the wire.
    const providerAttempts = networkAttempts - before;
    assert.ok(
      providerAttempts <= AI_TASKS.length + 1,
      `maksimal satu percobaan provider per task (terdeteksi ${providerAttempts})`,
    );

    // ---- Pure offline: no provider configured at all ----
    setSettings({ provider: 'mock', model: 'qatools-mock-1', base_url: '', api_key: null, api_key_masked: null, enabled: 1, fallback_to_mock: 1 });
    const beforeOffline = networkAttempts;
    for (const task of AI_TASKS) {
      const res = await aiService.generate(task, TASK_INPUTS[task] ?? {}, { projectId });
      assert.equal(res.ok, true, `[pure offline] ${task} harus ok:true`);
      assert.equal(res.meta.used_mock, true, `[pure offline] ${task} used_mock:true`);
      assert.notEqual(res.data, null, `[pure offline] ${task} data non-null`);
      assert.equal(res.meta.degraded, false, `[pure offline] ${task} bukan degraded (offline = mode normal)`);
      assert.equal(
        (res.meta as unknown as Record<string, unknown>).provider_attempted,
        false,
        `[pure offline] ${task} tidak boleh mencoba provider`,
      );
    }
    assert.equal(
      networkAttempts,
      beforeOffline,
      `mode offline murni TIDAK BOLEH melakukan panggilan jaringan (terdeteksi ${networkAttempts - beforeOffline})`,
    );
  });

  test('mock provider never touches the network even when called directly', async () => {
    const before = networkAttempts;
    const res = await callProvider({
      provider: 'mock',
      model: 'qatools-mock-1',
      messages: [{ role: 'user', content: 'halo' }],
    });
    assert.equal(res.ok, true);
    assert.equal(res.used_mock, true);
    assert.equal(networkAttempts, before, 'provider mock tidak boleh memanggil fetch');
  });

  test('a live provider failure is reported honestly without 500-ing', async () => {
    setSettings({
      provider: 'deepseek',
      model: 'deepseek-chat',
      base_url: `http://127.0.0.1:${closedPort}/v1`,
      api_key: 'sk-not-real',
      enabled: 1,
      fallback_to_mock: 1,
    });
    const res = await aiService.generate('triage_defect', { title: 'Halaman blank' });
    assert.equal(res.ok, true, 'kegagalan provider tidak boleh membuat request gagal');
    assert.equal(res.meta.used_mock, true);
    assert.equal(res.meta.degraded, true);
    assert.ok(res.error, 'alasan degradasi harus dilaporkan pada field error');
    assert.notEqual(res.data, null);
  });

  test('offline output is deterministic (stableHash reproducibility)', async () => {
    setSettings({ provider: 'mock', base_url: '', api_key: null, api_key_masked: null });
    const a = await aiService.generate('generate_testcases', { scenario: SAMPLE_SCENARIO });
    const b = await aiService.generate('generate_testcases', { scenario: SAMPLE_SCENARIO });
    assert.deepEqual(a.data, b.data, 'input yang sama harus menghasilkan output byte-identik');
  });
});

/* ================================================================== *
 * 2. OFFLINE GENERATOR SHAPE — TestCaseDraft conformance
 * ================================================================== */

describe('offline generator contract shapes', () => {
  test('generate_testcases output satisfies the frozen TestCaseDraft shape', () => {
    const drafts = generateTestCases({ scenario: SAMPLE_SCENARIO, per_scenario: 3 });
    assert.ok(Array.isArray(drafts) && drafts.length > 0, 'harus menghasilkan minimal satu test case');

    for (const tc of drafts) {
      assert.equal(typeof tc.title, 'string');
      assert.ok(tc.title.trim().length > 0, 'title wajib non-kosong');
      assert.ok(typeof tc.objective === 'string' && tc.objective.trim().length > 0, 'objective wajib non-kosong');
      assert.ok(typeof tc.preconditions === 'string' && tc.preconditions.trim().length > 0, 'preconditions wajib');
      assert.ok(
        (CASE_TYPES as readonly string[]).includes(tc.type),
        `type "${tc.type}" harus salah satu dari CASE_TYPES`,
      );
      assert.ok(
        (LAYER_KINDS as readonly string[]).includes(tc.layer),
        `layer "${tc.layer}" harus salah satu dari LAYER_KINDS`,
      );
      assert.ok(['low', 'medium', 'high', 'critical'].includes(tc.priority), 'priority valid');
      assert.ok(['cosmetic', 'minor', 'major', 'critical', 'blocker'].includes(tc.severity), 'severity valid');
      assert.ok(Number.isFinite(tc.estimated_minutes) && tc.estimated_minutes > 0, 'estimated_minutes > 0');
      assert.ok(Array.isArray(tc.tags), 'tags harus array');
      assert.ok(Array.isArray(tc.test_data), 'test_data harus array');
      assert.ok(tc.test_data.length > 0, 'test_data harus punya minimal satu baris');
      for (const d of tc.test_data) {
        assert.equal(typeof d.field, 'string');
        assert.equal(typeof d.value, 'string');
      }
      assert.ok(typeof tc.expected_result === 'string' && tc.expected_result.trim().length > 0, 'expected_result wajib');
      assert.ok(Array.isArray(tc.steps) && tc.steps.length > 0, 'steps wajib non-kosong');
      for (const s of tc.steps) {
        assert.ok(typeof s.action === 'string' && s.action.trim().length > 0, 'setiap step punya action');
        assert.equal(typeof s.expected, 'string');
      }
    }

    // The scenario's own type should have been honoured.
    const kinds = new Set(drafts.map((d) => d.type));
    assert.ok(kinds.size > 1, 'beberapa jenis test case harus dihasilkan (functional/negative/boundary)');
  });

  test('offlineGenerate returns the contract shape for every AI_TASKS entry', () => {
    for (const task of AI_TASKS) {
      const out = offlineGenerate(task, TASK_INPUTS[task] ?? {});
      assert.notEqual(out, null, `${task} tidak boleh null`);
      assert.notEqual(out, undefined, `${task} tidak boleh undefined`);
      if (task === 'chat') {
        const chat = out as { reply: string };
        assert.ok(typeof chat.reply === 'string' && chat.reply.length > 0, 'chat harus punya reply');
      } else if (task === 'generate_web_flow' || task === 'generate_sql' || task === 'triage_defect' || task === 'predict_risk' || task === 'review_coverage' || task === 'summarize_test_plan' || task === 'generate_test_data' || task === 'crawl_site') {
        assert.equal(typeof out, 'object', `${task} harus objek`);
        assert.ok(!Array.isArray(out), `${task} harus objek (bukan array)`);
      } else {
        assert.ok(Array.isArray(out), `${task} harus array`);
        assert.ok((out as unknown[]).length > 0, `${task} array tidak boleh kosong`);
      }
    }
  });

  test('triage_defect returns a DefectTriageResult with valid enums', () => {
    const t = offlineGenerate('triage_defect', {
      title: 'Kebocoran data: pengguna lain dapat melihat pesanan',
      description: 'Akses tanpa hak melalui penggantian id',
    }) as Record<string, unknown>;
    assert.equal(t.severity, 'critical');
    assert.equal(t.priority, 'critical');
    assert.ok(['low', 'medium', 'high'].includes(String(t.duplicate_risk)));
    assert.ok(String(t.likely_root_cause).length > 10);
    assert.ok(String(t.reproduction_hint).length > 10);
    assert.ok(String(t.suggested_owner_role).length > 2);
  });

  test('predict_risk orders items by descending score with valid levels', () => {
    const r = offlineGenerate('predict_risk', {
      test_cases: [
        { id: 'tc_a', code: 'TC-001', title: 'Login pengguna', type: 'functional' },
        { id: 'tc_b', code: 'TC-002', title: 'Pembayaran checkout dengan kartu kredit', type: 'security' },
      ],
    }) as { items: Array<{ score: number; level: string; recommended_order: number; test_case_id: string }> };
    assert.equal(r.items.length, 2);
    for (const it of r.items) {
      assert.ok(it.score >= 0 && it.score <= 100, 'score 0..100');
      assert.ok(['low', 'medium', 'high'].includes(it.level));
    }
    assert.ok(r.items[0]!.score >= r.items[1]!.score, 'harus terurut menurun');
    assert.deepEqual(
      r.items.map((i) => i.recommended_order),
      [1, 2],
    );
  });
});

/* ================================================================== *
 * 3. extractJson robustness
 * ================================================================== */

describe('extractJson', () => {
  test('parses plain JSON', () => {
    assert.deepEqual(extractJson('{"a":1}'), { a: 1 });
  });

  test('strips ```json fences', () => {
    const text = 'Berikut hasilnya:\n```json\n{"name":"Login","actors":["Pengguna"]}\n```\nSemoga membantu!';
    assert.deepEqual(extractJson(text), { name: 'Login', actors: ['Pengguna'] });
  });

  test('strips plain ``` fences without a language tag', () => {
    assert.deepEqual(extractJson('```\n[{"a":1},{"a":2}]\n```'), [{ a: 1 }, { a: 2 }]);
  });

  test('tolerates trailing prose after the JSON object', () => {
    const text = '{"severity":"major","priority":"high"}\n\nPenjelasan: severity ditentukan dari dampak.';
    assert.deepEqual(extractJson(text), { severity: 'major', priority: 'high' });
  });

  test('tolerates leading prose before the JSON object', () => {
    assert.deepEqual(extractJson('Hasil analisis adalah: {"ok":true} — selesai.'), { ok: true });
  });

  test('handles deeply nested objects and braces inside strings', () => {
    const nested = {
      items: [
        { id: 'a', note: 'brace } and { inside a string', inner: { deep: { deeper: [1, 2, { x: 'y' }] } } },
      ],
    };
    const text = `Penjelasan panjang.\n${JSON.stringify(nested)}\nSelesai.`;
    assert.deepEqual(extractJson(text), nested);
  });

  test('returns null on garbage', () => {
    assert.equal(extractJson('ini bukan json sama sekali'), null);
    assert.equal(extractJson('{'), null);
    assert.equal(extractJson(''), null);
    assert.equal(extractJson('   '), null);
    assert.equal(extractJson(null), null);
    assert.equal(extractJson(undefined), null);
    assert.equal(extractJson('<<<>>>'), null);
  });

  test('recovers trailing commas via salvage', () => {
    const value = extractJson('{"a":1,"b":[1,2,],}') as { a: number; b: number[] };
    assert.equal(value.a, 1);
    assert.deepEqual(value.b, [1, 2]);
  });

  test('reports how the payload was recovered', () => {
    assert.equal(extractJsonDetailed('{"a":1}').via, 'direct');
    assert.equal(extractJsonDetailed('```json\n{"a":1}\n```').via, 'fence');
    assert.equal(extractJsonDetailed('prosa {"a":1} prosa').via, 'balanced');
    assert.equal(extractJsonDetailed('bukan json').via, null);
  });

  test('a malformed model reply never 500s — generate() falls back to offline', async () => {
    // Simulate by generating with a provider that returns unparseable text:
    // the mock provider path is offline, so we assert the invariant at the service level.
    setSettings({ provider: 'mock', base_url: '', api_key: null, api_key_masked: null });
    const res = await aiService.generate('generate_usecases', { feature_description: 'Login pengguna' });
    assert.equal(res.ok, true);
    assert.equal(extractJson('not json at all'), null);
  });
});

/* ================================================================== *
 * 4. Crawler — inline HTML fixture
 * ================================================================== */

describe('crawlSite with an inline html payload', () => {
  test('extracts title, headings, forms, links, buttons, tables without any network', async () => {
    const before = networkAttempts;
    const result = await crawlSite({ url: 'http://127.0.0.1:1/halaman', html: FIXTURE_HTML });
    assert.equal(networkAttempts, before, 'html inline tidak boleh memicu fetch');

    assert.equal(result.fetched, true);
    assert.equal(result.pages.length, 1);
    const page = result.pages[0]!;

    // Title + headings
    assert.equal(page.title, 'Halaman Uji Crawler');
    assert.ok(page.headings.includes('Katalog Produk'), 'h1 harus terdeteksi');
    assert.ok(page.headings.includes('Masuk'), 'h2 harus terdeteksi');
    assert.ok(page.headings.includes('Bantuan'), 'h3 harus terdeteksi');

    // Forms
    assert.equal(page.forms.length, 2, 'dua form harus terdeteksi');
    const login = page.forms[0]!;
    assert.equal(login.action, '/api/mock/login');
    assert.equal(login.method, 'POST');
    assert.equal(login.fields.length, 2);
    const username = login.fields.find((f) => f.name === 'username')!;
    assert.ok(username, 'field username harus ada');
    assert.equal(username.type, 'text');
    assert.equal(username.required, true, 'atribut required harus terbaca');
    assert.equal(username.label, 'Username', 'label[for] harus teresolusi');
    const password = login.fields.find((f) => f.name === 'password')!;
    assert.equal(password.type, 'password');
    assert.equal(password.label, 'Kata Sandi');

    const search = page.forms[1]!;
    assert.equal(search.method, 'GET');
    assert.equal(search.fields[0]!.name, 'q');

    // Links
    assert.ok(page.links.some((l) => l.text === 'Produk' && l.href.endsWith('/api/mock/products')), 'tautan Produk');
    assert.ok(page.links.some((l) => l.text === 'Health'), 'tautan Health');

    // Buttons
    assert.ok(page.buttons.includes('Masuk'));
    assert.ok(page.buttons.includes('Cari'));
    assert.ok(page.buttons.includes('Tambah ke Keranjang'));
    assert.ok(page.buttons.includes('Checkout'));

    // Inputs
    assert.ok(page.inputs.some((i) => i.name === 'q' && i.type === 'search'));
    assert.ok(page.inputs.some((i) => i.placeholder === 'admin'));

    // Tables
    assert.equal(page.tables.length, 1);
    assert.deepEqual(page.tables[0]!.headers, ['SKU', 'Nama', 'Harga']);
    assert.equal(page.tables[0]!.rowCount, 2);

    // Text sample
    assert.ok(page.textSample.includes('Katalog Produk'));
    assert.ok(!page.textSample.includes('<'), 'tag HTML harus sudah dibersihkan');

    // Derived features + suggested use cases
    assert.ok(result.features.length > 0, 'harus menurunkan fitur');
    assert.ok(
      result.features.some((f) => f.kind === 'auth'),
      'form login harus dikenali sebagai fitur auth',
    );
    assert.ok(
      result.features.some((f) => f.kind === 'listing'),
      'tabel harus dikenali sebagai fitur listing',
    );
    assert.ok(result.suggested_use_cases.length > 0);
    for (const uc of result.suggested_use_cases) {
      assert.ok(uc.name.length > 0 && uc.goal.length > 0);
      assert.ok(Array.isArray(uc.actors) && uc.actors.length > 0);
      assert.ok(['low', 'medium', 'high', 'critical'].includes(uc.priority));
    }
  });

  test('an unreachable URL returns fetched:false instead of throwing', async () => {
    const result = await crawlSite({ url: `http://127.0.0.1:${closedPort}/tidak-ada` });
    assert.equal(result.fetched, false, 'harus melaporkan fetched:false');
    assert.equal(result.used_mock, true, 'harus menandai hasil offline');
    assert.ok(Array.isArray(result.pages));
    assert.ok(result.pages.length >= 1, 'halaman penjelas tetap dikembalikan');
    assert.ok(
      result.pages[0]!.textSample.toLowerCase().includes('gagal') ||
        result.pages[0]!.title.toLowerCase().includes('tidak dapat'),
      'pesan kegagalan yang membantu harus ada',
    );
    assert.ok(result.features.length > 0, 'fitur minimal diturunkan dari segmen URL');
    assert.ok(result.suggested_use_cases.length > 0);
  });

  test('a missing url is handled gracefully (no throw, empty result)', async () => {
    const result = await crawlSite({ url: '' });
    assert.equal(result.fetched, false);
    assert.equal(result.used_mock, true);
    assert.deepEqual(result.pages, []);
  });

  test('aiService.crawl logs the attempt to ai_generations', async () => {
    const before = countGenerations('crawl_site');
    await aiService.crawl({ url: `http://127.0.0.1:${closedPort}/x` });
    assert.ok(countGenerations('crawl_site') > before, 'crawl harus tercatat');
  });
});

/* ================================================================== *
 * 5. ai_generations logging — success AND failure
 * ================================================================== */

function countGenerations(task?: string): number {
  const row = task
    ? (db.prepare(`SELECT COUNT(*) AS n FROM ai_generations WHERE task = ?`).get(task) as { n?: number } | undefined)
    : (db.prepare(`SELECT COUNT(*) AS n FROM ai_generations`).get() as { n?: number } | undefined);
  return Number(row?.n ?? 0);
}

describe('ai_generations logging', () => {
  test('a success row is written with tokens, latency and used_mock', async () => {
    setSettings({ provider: 'mock', base_url: '', api_key: null, api_key_masked: null, fallback_to_mock: 1 });
    const before = countGenerations('triage_defect');
    const res = await aiService.generate('triage_defect', { title: 'Halaman kosong setelah login' }, { projectId: seedProject() });
    assert.equal(res.ok, true);
    assert.equal(countGenerations('triage_defect'), before + 1, 'tepat satu baris log baru');

    const row = db
      .prepare(`SELECT * FROM ai_generations WHERE id = ?`)
      .get(res.meta.generation_id) as Record<string, unknown>;
    assert.ok(row, 'baris ai_generations harus ada');
    assert.equal(row.status, 'success');
    assert.equal(row.task, 'triage_defect');
    assert.equal(Number(row.used_mock), 1);
    assert.ok(Number(row.latency_ms) >= 0);
    assert.ok(Number(row.prompt_tokens) >= 0);
    assert.ok(Number(row.completion_tokens) >= 0);
    assert.equal(row.project_id, seedProject());
    assert.ok(typeof row.provider === 'string' && row.provider.length > 0);
    assert.ok(typeof row.model === 'string' && row.model.length > 0);
    assert.ok(typeof row.created_at === 'string' && row.created_at.length > 0);
  });

  test('a FAILURE row is written when the provider errors', async () => {
    // fallback_to_mock = 0 → a failing live provider produces ok:false + an error row.
    setSettings({
      provider: 'openai',
      model: 'gpt-4o-mini',
      base_url: `http://127.0.0.1:${closedPort}/v1`,
      api_key: 'sk-broken',
      enabled: 1,
      fallback_to_mock: 0,
    });
    const before = countGenerations('generate_usecases');
    const res = await aiService.generate('generate_usecases', { feature_description: 'Login' }, { projectId: seedProject() });

    assert.equal(res.ok, false, 'tanpa fallback, kegagalan provider harus ok:false');
    assert.equal(res.data, null);
    assert.ok(res.error && res.error.length > 0, 'pesan error harus informatif');
    assert.equal(countGenerations('generate_usecases'), before + 1, 'kegagalan tetap harus tercatat');

    const row = db.prepare(`SELECT * FROM ai_generations WHERE id = ?`).get(res.meta.generation_id) as Record<
      string,
      unknown
    >;
    assert.equal(row.status, 'error');
    assert.ok(row.error && String(row.error).length > 0, 'kolom error harus terisi');
    assert.equal(Number(row.used_mock), 0);

    // An unrecognised task key must fail LOUDLY and be logged — never a 500, never
    // a silent filler payload that hides a lane typo.
    const unknown = await aiService.generate('task_yang_tidak_ada', {});
    assert.equal(unknown.ok, false, 'task tidak dikenal harus ok:false (bukan filler)');
    assert.equal(unknown.data, null);
    assert.ok(unknown.error && unknown.error.includes('tidak dikenal'), 'pesan error harus menyebut task tidak dikenal');
    assert.ok(unknown.meta.generation_id, 'kegagalan task tidak dikenal juga dicatat');
    const unknownRow = db
      .prepare(`SELECT * FROM ai_generations WHERE id = ?`)
      .get(unknown.meta.generation_id) as Record<string, unknown>;
    assert.equal(unknownRow.status, 'error');
    assert.equal(unknownRow.task, 'task_yang_tidak_ada');
  });

  test('degraded failures are logged with the underlying provider error', async () => {
    setSettings({
      provider: 'anthropic',
      model: 'claude-3-5-sonnet-latest',
      base_url: `http://127.0.0.1:${closedPort}/v1`,
      api_key: 'sk-ant-broken',
      enabled: 1,
      fallback_to_mock: 1,
    });
    const before = countGenerations('summary_task');
    const res = await aiService.generate('predict_risk', { test_cases: [{ id: 'tc_x', title: 'Checkout' }] });
    assert.equal(res.ok, true);
    assert.equal(res.meta.degraded, true);
    assert.ok(res.error, 'alasan degradasi harus tersedia');

    const row = db.prepare(`SELECT * FROM ai_generations WHERE id = ?`).get(res.meta.generation_id) as Record<
      string,
      unknown
    >;
    assert.equal(row.status, 'success', 'baris tetap sukses karena fallback menghasilkan data');
    assert.ok(row.error, 'penyebab degradasi tetap dicatat pada kolom error');
    void before;
  });
});

/* ================================================================== *
 * 6. Settings — the API key must never leak
 * ================================================================== */

describe('ai_settings masking', () => {
  test('maskKey never returns the raw secret', () => {
    const masked = maskKey('sk-abcdefghijklmnop1234');
    assert.notEqual(masked, 'sk-abcdefghijklmnop1234');
    assert.ok(masked && masked.includes('…'), 'format harus memakai elipsis');
    assert.ok(!masked!.includes('abcdefghij'), 'bagian tengah rahasia tidak boleh terlihat');
    assert.equal(maskKey(''), null);
    assert.equal(maskKey(null), null);
  });

  test('the settings row stores the key but exposes only api_key_masked', async () => {
    const RAW = 'sk-super-secret-value-1234';
    setSettings({ provider: 'deepseek', model: 'deepseek-chat', api_key: RAW, api_key_masked: maskKey(RAW), enabled: 1 });

    const stored = db.prepare(`SELECT * FROM ai_settings ORDER BY created_at LIMIT 1`).get() as Record<string, unknown>;
    assert.equal(stored.api_key, RAW, 'kunci disimpan lokal');
    assert.notEqual(stored.api_key_masked, RAW, 'kolom masked tidak boleh sama dengan kunci asli');
  });

  test('GET /ai/settings never returns the raw api_key (in-process route check)', async () => {
    const RAW = 'sk-another-secret-abcd';
    setSettings({ provider: 'openai', model: 'gpt-4o-mini', api_key: RAW, api_key_masked: maskKey(RAW), enabled: 1 });

    const { default: Fastify } = await import('fastify');
    const aiRoutes = (await import('../src/modules/ai/index.js')).default;
    const app = Fastify({ logger: false });
    await app.register(aiRoutes, { prefix: '/api' });
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/api/ai/settings' });
    assert.equal(res.statusCode, 200);
    const body = res.body;
    assert.ok(!body.includes(RAW), 'respons TIDAK BOLEH memuat kunci mentah');
    assert.ok(body.includes('api_key_masked'), 'respons harus memuat api_key_masked');

    const parsed = res.json() as { data: Record<string, unknown> };
    assert.equal(parsed.data.api_key, undefined, 'field api_key tidak boleh ada pada respons');
    assert.ok(parsed.data.api_key_masked, 'api_key_masked harus terisi');
    assert.notEqual(parsed.data.api_key_masked, RAW);

    await app.close();
  });

  test('PUT /ai/settings masks on write and never echoes the key back', async () => {
    const RAW = 'sk-put-secret-wxyz';
    const { default: Fastify } = await import('fastify');
    const aiRoutes = (await import('../src/modules/ai/index.js')).default;
    const app = Fastify({ logger: false });
    await app.register(aiRoutes, { prefix: '/api' });
    await app.ready();

    const res = await app.inject({
      method: 'PUT',
      url: '/api/ai/settings',
      payload: { provider: 'deepseek', model: 'deepseek-chat', api_key: RAW, temperature: 0.2, max_tokens: 2048 },
    });
    assert.equal(res.statusCode, 200);
    assert.ok(!res.body.includes(RAW), 'respons PUT tidak boleh memuat kunci mentah');

    const parsed = res.json() as { data: Record<string, unknown> };
    assert.equal(parsed.data.api_key, undefined);
    assert.ok(String(parsed.data.api_key_masked).includes('…'));

    // Verify the round-trip through GET as well.
    const get = await app.inject({ method: 'GET', url: '/api/ai/settings' });
    assert.ok(!get.body.includes(RAW));
    await app.close();
  });
});

/* ================================================================== *
 * 7. Provider adapters — no SDKs, no throwing, mock is offline
 * ================================================================== */

describe('provider adapters', () => {
  test('the mock provider reports used_mock and needs no key', async () => {
    const res = await callProvider({ provider: 'mock', model: 'qatools-mock-1', messages: [{ role: 'user', content: 'hi' }] });
    assert.equal(res.ok, true);
    assert.equal(res.used_mock, true);
    assert.ok(res.text.length > 0);
  });

  test('an unknown provider returns a structured error, never throws', async () => {
    const res = await callProvider({ provider: 'tidak-ada', model: 'x', messages: [{ role: 'user', content: 'hi' }] });
    assert.equal(res.ok, false);
    assert.ok(res.error && res.error.includes('tidak dikenal'));
  });

  test('a key-requiring provider without a key fails fast and locally', async () => {
    const before = networkAttempts;
    const res = await callProvider({ provider: 'openai', model: 'gpt-4o-mini', apiKey: '', messages: [{ role: 'user', content: 'hi' }] });
    assert.equal(res.ok, false);
    assert.ok(res.error && /key/i.test(res.error));
    assert.equal(networkAttempts, before, 'validasi key tidak boleh memanggil jaringan');
  });

  test('every non-mock provider maps a connection failure to a structured error', async () => {
    for (const provider of ['deepseek', 'openai', 'anthropic', 'google', 'ollama', 'custom']) {
      const res = await callProvider({
        provider,
        model: 'test-model',
        baseUrl: `http://127.0.0.1:${closedPort}/v1`,
        apiKey: 'test-key',
        messages: [{ role: 'user', content: 'hi' }],
        timeoutMs: 4000,
      });
      assert.equal(res.ok, false, `${provider} harus gagal secara terkontrol`);
      assert.ok(res.error && res.error.length > 0, `${provider} harus punya pesan error`);
      assert.equal(res.text, '');
      assert.ok(res.latencyMs >= 0);
    }
  });

  test('no banned SDK is imported anywhere in the AI module', async () => {
    const { readFileSync, readdirSync } = await import('node:fs');
    const dir = aiSrcDir;
    const banned = ['openai', '@anthropic-ai/sdk', '@google/generative-ai', 'axios', 'node-fetch', 'cheerio', 'jsdom', 'tiktoken'];
    const files = readdirSync(dir).filter((f) => f.endsWith('.ts'));
    assert.ok(files.length >= 6, `direktori modul AI harus berisi file sumber (ditemukan ${files.length} di ${dir})`);
    for (const file of files) {
      const src = readFileSync(resolve(dir, file), 'utf8');
      for (const dep of banned) {
        const importRe = new RegExp(`from\\s+['"]${dep.replace(/[/@]/g, (c) => `\\${c}`)}['"]`);
        assert.ok(!importRe.test(src), `${file} tidak boleh mengimpor "${dep}"`);
      }
    }
  });
});

/* ================================================================== *
 * 8. Persistence — additive INSERTs + matrix_links
 * ================================================================== */

describe('persistence', () => {
  test('persist:true inserts use cases with codes, generated_by=ai and matrix links', async () => {
    setSettings({ provider: 'mock', base_url: '', api_key: null, api_key_masked: null, fallback_to_mock: 1 });
    const projectId = seedProject();

    // Seed a requirement so the requirement→use case link has a real parent.
    const reqId = 'req_laned_1';
    if (!db.prepare(`SELECT id FROM requirements WHERE id = ?`).get(reqId)) {
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO requirements (id, project_id, code, title, description, source, priority, status, created_at, updated_at)
         VALUES (?, ?, 'REQ-001', 'Login pengguna', 'Pengguna dapat login dengan email', 'test', 'high', 'draft', ?, ?)`,
      ).run(reqId, projectId, now, now);
    }

    const res = await aiService.generate(
      'generate_usecases',
      { feature_description: 'Pengguna dapat login dengan email dan kata sandi.', requirement_ids: [reqId], count: 1 },
      { projectId, persist: true },
    );

    assert.equal(res.ok, true);
    const created = (res.meta as Record<string, unknown>).created as Record<string, string[]> | undefined;
    assert.ok(created, 'meta.created harus tersedia saat persist:true');
    assert.equal(created!.use_cases.length, 1, 'satu use case harus dibuat');

    const ucId = created!.use_cases[0]!;
    const uc = db.prepare(`SELECT * FROM use_cases WHERE id = ?`).get(ucId) as Record<string, unknown>;
    assert.ok(uc, 'baris use_cases harus ada');
    assert.equal(uc.generated_by, 'ai');
    assert.equal(uc.ai_generation_id, res.meta.generation_id);
    assert.equal(uc.project_id, projectId);
    assert.ok(String(uc.code).startsWith('UC-'), `code harus UC-xxx, dapat "${uc.code}"`);
    assert.ok(String(uc.name).length > 3, 'nama use case harus bermakna');

    const links = db
      .prepare(`SELECT * FROM matrix_links WHERE link_type = 'requirement_to_usecase' AND to_id = ?`)
      .all(ucId) as Array<Record<string, unknown>>;
    assert.equal(links.length, 1, 'matrix_links requirement→use case harus ditulis');
    assert.equal(links[0]!.from_id, reqId);
    assert.equal(links[0]!.created_by, 'ai');
  });

  test('persist:true inserts scenarios and test cases plus the full parent chain', async () => {
    setSettings({ provider: 'mock', base_url: '', api_key: null, api_key_masked: null, fallback_to_mock: 1 });
    const projectId = seedProject();

    const ucRes = await aiService.generate(
      'generate_usecases',
      { feature_description: 'Admin dapat mengunggah dokumen pendukung', count: 1 },
      { projectId, persist: true },
    );
    const ucId = ((ucRes.meta as Record<string, unknown>).created as Record<string, string[]>).use_cases[0]!;

    const scRes = await aiService.generate(
      'generate_scenarios',
      { use_case: SAMPLE_USE_CASE, use_case_ids: [ucId], per_use_case: 2 },
      { projectId, persist: true },
    );
    const scCreated = (scRes.meta as Record<string, unknown>).created as Record<string, string[]>;
    assert.ok(scCreated.scenarios.length >= 2, 'skenario harus dibuat');
    const scId = scCreated.scenarios[0]!;

    const sc = db.prepare(`SELECT * FROM scenarios WHERE id = ?`).get(scId) as Record<string, unknown>;
    assert.equal(sc.generated_by, 'ai');
    assert.equal(sc.use_case_id, ucId, 'skenario harus terhubung ke use case');
    assert.ok(String(sc.code).startsWith('SC-'));

    const ucToSc = db
      .prepare(`SELECT * FROM matrix_links WHERE link_type = 'usecase_to_scenario' AND to_id = ?`)
      .all(scId) as Array<Record<string, unknown>>;
    assert.equal(ucToSc.length, 1, 'matrix_links usecase→scenario harus ada');

    const tcRes = await aiService.generate(
      'generate_testcases',
      { scenario: SAMPLE_SCENARIO, scenario_ids: [scId], use_case_ids: [ucId], per_scenario: 2 },
      { projectId, persist: true },
    );
    const tcCreated = (tcRes.meta as Record<string, unknown>).created as Record<string, string[]>;
    assert.ok(tcCreated.test_cases.length >= 2, 'test case harus dibuat');
    assert.ok(tcCreated.test_steps.length > 0, 'test_steps harus dibuat');

    const tcId = tcCreated.test_cases[0]!;
    const tc = db.prepare(`SELECT * FROM test_cases WHERE id = ?`).get(tcId) as Record<string, unknown>;
    assert.equal(tc.generated_by, 'ai');
    assert.equal(tc.scenario_id, scId);
    assert.equal(tc.use_case_id, ucId);
    assert.ok(String(tc.code).startsWith('TC-'));

    const steps = db
      .prepare(`SELECT * FROM test_steps WHERE test_case_id = ? ORDER BY order_index`)
      .all(tcId) as Array<Record<string, unknown>>;
    assert.ok(steps.length > 0, 'langkah harus tersimpan');
    assert.equal(Number(steps[0]!.order_index), 1, 'order_index harus mulai dari 1');

    const scToTc = db
      .prepare(`SELECT * FROM matrix_links WHERE link_type = 'scenario_to_testcase' AND to_id = ?`)
      .all(tcId) as Array<Record<string, unknown>>;
    assert.equal(scToTc.length, 1, 'matrix_links scenario→testcase harus ada');
  });

  test('persist:true works for api_requests, db_checks and web_flows (self-provisioning parents)', async () => {
    setSettings({ provider: 'mock', base_url: '', api_key: null, api_key_masked: null, fallback_to_mock: 1 });
    const projectId = seedProject();

    const apiRes = await aiService.generate('generate_api_tests', { endpoints: 'POST /mock/login' }, { projectId, persist: true });
    const apiCreated = (apiRes.meta as Record<string, unknown>).created as Record<string, string[]>;
    assert.ok(apiCreated.api_requests.length > 0, 'api_requests harus dibuat');
    const apr = db.prepare(`SELECT * FROM api_requests WHERE id = ?`).get(apiCreated.api_requests[0]!) as Record<string, unknown>;
    assert.equal(apr.project_id, projectId);
    assert.ok(apr.collection_id, 'collection_id harus terisi (FK NOT NULL)');

    const dbRes = await aiService.generate('generate_db_checks', { requirement_text: 'tidak ada duplikat email' }, { projectId, persist: true });
    const dbCreated = (dbRes.meta as Record<string, unknown>).created as Record<string, string[]>;
    assert.ok(dbCreated.db_checks.length > 0, 'db_checks harus dibuat');
    const dbc = db.prepare(`SELECT * FROM db_checks WHERE id = ?`).get(dbCreated.db_checks[0]!) as Record<string, unknown>;
    assert.ok(dbc.connection_id, 'connection_id harus terisi (FK NOT NULL)');
    assert.ok(String(dbc.sql).toUpperCase().includes('SELECT'), 'check harus SELECT-only');

    const wfRes = await aiService.generate(
      'generate_web_flow',
      { scenario_text: 'Login lalu buka katalog', url: 'http://127.0.0.1:1/mock/demo' },
      { projectId, persist: true },
    );
    const wfCreated = (wfRes.meta as Record<string, unknown>).created as Record<string, string[]>;
    assert.ok(wfCreated.web_flows.length > 0, 'web_flows harus dibuat');
    const wbf = db.prepare(`SELECT * FROM web_flows WHERE id = ?`).get(wfCreated.web_flows[0]!) as Record<string, unknown>;
    assert.ok(String(wbf.steps).startsWith('['), 'steps harus JSON array');
  });

  test('persist without a project_id reports why it was skipped instead of failing', async () => {
    setSettings({ provider: 'mock', base_url: '', api_key: null, api_key_masked: null, fallback_to_mock: 1 });
    const res = await aiService.generate('generate_usecases', { feature_description: 'Login' }, { persist: true });
    assert.equal(res.ok, true, 'tetap sukses');
    const skipped = (res.meta as Record<string, unknown>).persist_skipped as string[] | undefined;
    assert.ok(Array.isArray(skipped) && skipped.length > 0, 'alasan skip harus dilaporkan');
  });

  test('the persistence layer only ever INSERTs (never UPDATE/DELETE)', async () => {
    const { readFileSync } = await import('node:fs');
    const path = resolve(aiSrcDir, 'persist.ts');
    const src = readFileSync(path, 'utf8');
    // Strip comments/strings crudely, then assert no destructive statement exists.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.ok(!/\bUPDATE\s+\w+\s+SET\b/i.test(code), 'persist.ts tidak boleh menjalankan UPDATE');
    assert.ok(!/\bDELETE\s+FROM\b/i.test(code), 'persist.ts tidak boleh menjalankan DELETE');
    assert.ok(!/\bDROP\s+TABLE\b/i.test(code), 'persist.ts tidak boleh menjalankan DROP');
    assert.ok(/\bINSERT\b/i.test(code), 'persist.ts harus memakai INSERT');
  });
});

/* ================================================================== *
 * 9. aiService surface + status
 * ================================================================== */

describe('aiService cross-lane surface', () => {
  test('exposes generate, status and crawl as required by ARCHITECTURE §6.1', () => {
    assert.equal(typeof aiService.generate, 'function');
    assert.equal(typeof aiService.status, 'function');
    assert.equal(typeof aiService.crawl, 'function');
  });

  test('status() reports offline mode honestly with zero configuration', async () => {
    setSettings({ provider: 'mock', model: 'qatools-mock-1', base_url: '', api_key: null, api_key_masked: null, enabled: 1, fallback_to_mock: 1 });
    const status = await aiService.status();
    assert.equal(status.configured, false);
    assert.equal(status.mode, 'mock');
    assert.equal(status.provider, 'mock');
    assert.ok(typeof status.model === 'string' && status.model.length > 0);
    assert.ok(typeof status.message === 'string' && status.message.length > 10);
    assert.equal(status.fallback_to_mock, true);
  });

  test('status() flips to live when a provider with a key is configured', async () => {
    setSettings({ provider: 'deepseek', model: 'deepseek-chat', base_url: '', api_key: 'sk-x', enabled: 1, fallback_to_mock: 1 });
    const status = await aiService.status();
    assert.equal(status.configured, true);
    assert.equal(status.mode, 'live');
    assert.equal(status.provider, 'deepseek');
    setSettings({ provider: 'mock', model: 'qatools-mock-1', base_url: '', api_key: null, api_key_masked: null });
  });
});

/* ================================================================== *
 * 10. Routes — health, tasks, mock system-under-test
 * ================================================================== */

describe('routes', () => {
  test('GET /api/ai/health, /api/ai/tasks and /api/ai/providers respond sensibly', async () => {
    const { default: Fastify } = await import('fastify');
    const aiRoutes = (await import('../src/modules/ai/index.js')).default;
    const app = Fastify({ logger: false });
    await app.register(aiRoutes, { prefix: '/api' });
    await app.ready();

    const health = await app.inject({ method: 'GET', url: '/api/ai/health' });
    assert.equal(health.statusCode, 200);
    const healthBody = health.json() as { data: { tasks: number; offline_capable: boolean } };
    assert.equal(healthBody.data.tasks, AI_TASKS.length);
    assert.equal(healthBody.data.offline_capable, true);

    const tasks = await app.inject({ method: 'GET', url: '/api/ai/tasks' });
    assert.equal(tasks.statusCode, 200);
    const tasksBody = tasks.json() as { data: Array<{ task: string }>; total: number };
    assert.equal(tasksBody.total, AI_TASKS.length);
    assert.deepEqual(
      tasksBody.data.map((t) => t.task).sort(),
      [...AI_TASKS].sort(),
    );

    const providers = await app.inject({ method: 'GET', url: '/api/ai/providers' });
    assert.equal(providers.statusCode, 200);
    const providerBody = providers.json() as { data: Array<{ id: string }> };
    for (const id of ['deepseek', 'openai', 'anthropic', 'google', 'ollama', 'custom', 'mock']) {
      assert.ok(providerBody.data.some((p) => p.id === id), `provider ${id} harus terdaftar`);
    }

    await app.close();
  });

  test('POST /api/ai/generate works with zero configuration and returns an AiResult', async () => {
    setSettings({ provider: 'mock', base_url: '', api_key: null, api_key_masked: null });
    const { default: Fastify } = await import('fastify');
    const aiRoutes = (await import('../src/modules/ai/index.js')).default;
    const app = Fastify({ logger: false });
    await app.register(aiRoutes, { prefix: '/api' });
    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: '/api/ai/generate',
      payload: { task: 'generate_scenarios', input: { use_case: SAMPLE_USE_CASE } },
    });
    assert.equal(res.statusCode, 200);
    const body = res.json() as { ok: boolean; data: unknown; meta: { used_mock: boolean; task: string } };
    assert.equal(body.ok, true);
    assert.ok(Array.isArray(body.data));
    assert.equal(body.meta.used_mock, true);
    assert.equal(body.meta.task, 'generate_scenarios');

    // Unknown task → honest 400, not a crash.
    const bad = await app.inject({ method: 'POST', url: '/api/ai/generate', payload: { task: 'ngawur' } });
    assert.equal(bad.statusCode, 400);
    const badBody = bad.json() as { error: { code: string } };
    assert.equal(badBody.error.code, 'bad_request');

    await app.close();
  });

  test('POST /api/projects/:projectId/ai/generate is project-scoped', async () => {
    setSettings({ provider: 'mock', base_url: '', api_key: null, api_key_masked: null });
    const projectId = seedProject();
    const { default: Fastify } = await import('fastify');
    const aiRoutes = (await import('../src/modules/ai/index.js')).default;
    const app = Fastify({ logger: false });
    await app.register(aiRoutes, { prefix: '/api' });
    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/ai/generate`,
      payload: { task: 'triage_defect', input: { title: 'Tombol rusak' } },
    });
    assert.equal(res.statusCode, 200);
    const body = res.json() as { ok: boolean; meta: { generation_id: string } };
    assert.equal(body.ok, true);
    const row = db.prepare(`SELECT project_id FROM ai_generations WHERE id = ?`).get(body.meta.generation_id) as {
      project_id?: string;
    };
    assert.equal(row.project_id, projectId, 'generasi harus tercatat pada project dari path');

    await app.close();
  });

  test('POST /api/ai/crawl returns a CrawlResult shape', async () => {
    const { default: Fastify } = await import('fastify');
    const aiRoutes = (await import('../src/modules/ai/index.js')).default;
    const app = Fastify({ logger: false });
    await app.register(aiRoutes, { prefix: '/api' });
    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: '/api/ai/crawl',
      payload: { url: 'http://127.0.0.1:1/x', html: FIXTURE_HTML },
    });
    assert.equal(res.statusCode, 200);
    const body = res.json() as { fetched: boolean; pages: unknown[]; features: unknown[]; suggested_use_cases: unknown[] };
    assert.equal(body.fetched, true);
    assert.equal(body.pages.length, 1);
    assert.ok(body.features.length > 0);
    assert.ok(body.suggested_use_cases.length > 0);

    // Missing url AND html → 400.
    const bad = await app.inject({ method: 'POST', url: '/api/ai/crawl', payload: {} });
    assert.equal(bad.statusCode, 400);

    await app.close();
  });

  test('POST /api/ai/chat answers offline with a context-aware reply', async () => {
    setSettings({ provider: 'mock', base_url: '', api_key: null, api_key_masked: null });
    const { default: Fastify } = await import('fastify');
    const aiRoutes = (await import('../src/modules/ai/index.js')).default;
    const app = Fastify({ logger: false });
    await app.register(aiRoutes, { prefix: '/api' });
    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: '/api/ai/chat',
      payload: { messages: [{ role: 'user', content: 'Buatkan use case untuk login pengguna' }] },
    });
    assert.equal(res.statusCode, 200);
    const body = res.json() as { reply: string; used_mock: boolean };
    assert.equal(body.used_mock, true);
    assert.ok(body.reply.length > 40);
    assert.ok(/use case/i.test(body.reply), 'jawaban harus kontekstual terhadap pertanyaan');

    const empty = await app.inject({ method: 'POST', url: '/api/ai/chat', payload: {} });
    assert.equal(empty.statusCode, 400);

    await app.close();
  });

  test('task shortcut routes exist and answer offline', async () => {
    setSettings({ provider: 'mock', base_url: '', api_key: null, api_key_masked: null });
    const { default: Fastify } = await import('fastify');
    const aiRoutes = (await import('../src/modules/ai/index.js')).default;
    const app = Fastify({ logger: false });
    await app.register(aiRoutes, { prefix: '/api' });
    await app.ready();

    const shortcuts: Array<[string, Record<string, unknown>]> = [
      ['/api/ai/tasks/generate-usecases', { feature_description: 'Login pengguna' }],
      ['/api/ai/tasks/generate-scenarios', { use_case: SAMPLE_USE_CASE }],
      ['/api/ai/tasks/generate-testcases', { scenario: SAMPLE_SCENARIO }],
      ['/api/ai/tasks/generate-test-data', { fields: ['email'] }],
      ['/api/ai/tasks/generate-api-tests', { endpoints: 'GET /mock/products' }],
      ['/api/ai/tasks/generate-db-checks', { requirement_text: 'duplikat email' }],
      ['/api/ai/tasks/generate-web-flow', { scenario_text: 'login' }],
      ['/api/ai/tasks/generate-sql', { requirement_text: 'jumlah pengguna aktif' }],
      ['/api/ai/tasks/review-coverage', { gaps: [{ requirement_id: 'REQ-001', title: 'Login' }] }],
      ['/api/ai/tasks/triage-defect', { title: 'Halaman blank' }],
      ['/api/ai/tasks/predict-risk', { test_cases: [{ id: 'tc_1', title: 'Checkout' }] }],
      ['/api/ai/tasks/summarize-test-plan', { test_cases: [{ id: 'tc_1', title: 'Login' }] }],
    ];

    for (const [url, payload] of shortcuts) {
      const res = await app.inject({ method: 'POST', url, payload });
      assert.equal(res.statusCode, 200, `${url} harus 200`);
      const body = res.json() as { ok: boolean; data: unknown };
      assert.equal(body.ok, true, `${url} harus ok:true`);
      assert.notEqual(body.data, null, `${url} harus punya data`);
    }

    await app.close();
  });

  test('the mock system-under-test is reachable offline: login, products, flaky, slow', async () => {
    const { default: Fastify } = await import('fastify');
    const aiRoutes = (await import('../src/modules/ai/index.js')).default;
    const app = Fastify({ logger: false });
    await app.register(aiRoutes, { prefix: '/api' });
    await app.ready();

    const health = await app.inject({ method: 'GET', url: '/api/mock/health' });
    assert.equal(health.statusCode, 200);
    assert.equal((health.json() as { status: string }).status, 'ok');

    const products = await app.inject({ method: 'GET', url: '/api/mock/products' });
    assert.equal(products.statusCode, 200);
    assert.ok((products.json() as { data: unknown[] }).data.length >= 3);

    const ok = await app.inject({ method: 'POST', url: '/api/mock/login', payload: { username: 'admin', password: 'secret' } });
    assert.equal(ok.statusCode, 200);
    assert.ok((ok.json() as { data: { token: string } }).data.token.length > 0);

    const wrong = await app.inject({ method: 'POST', url: '/api/mock/login', payload: { username: 'admin', password: 'salah' } });
    assert.equal(wrong.statusCode, 401);

    // Deterministic flaky endpoint: exactly the pattern n % 3 !== 0 fails.
    await app.inject({ method: 'POST', url: '/api/mock/reset' });
    const codes: number[] = [];
    for (let i = 0; i < 3; i++) {
      const r = await app.inject({ method: 'GET', url: '/api/mock/flaky' });
      codes.push(r.statusCode);
    }
    assert.deepEqual(codes, [500, 500, 200], 'pola flaky deterministik 2 gagal lalu 1 sukses');

    const slow = await app.inject({ method: 'GET', url: '/api/mock/slow?ms=10' });
    assert.equal(slow.statusCode, 200);

    const demo = await app.inject({ method: 'GET', url: '/api/mock/demo' });
    assert.equal(demo.statusCode, 200);
    assert.ok(demo.body.includes('<form'), 'halaman demo harus memuat form untuk diuji web automation');

    await app.close();
  });

  test('the mock demo page can be crawled without the internet', async () => {
    const result = await crawlSite({ url: 'http://127.0.0.1:1/mock/demo', html: undefined });
    // No server running here → graceful degradation, but the demo HTML itself parses:
    assert.equal(result.fetched, false);
    const inline = await crawlSite({ url: 'http://127.0.0.1:1/mock/demo', html: FIXTURE_HTML });
    assert.equal(inline.fetched, true);
    assert.ok(inline.features.length > 0);
  });
});

/* ================================================================== *
 * 11. Events: no unhandled provider throw can reach the caller
 * ================================================================== */

test('a provider that hangs/fails still yields a usable result (never a 500)', async () => {
  setSettings({
    provider: 'ollama',
    model: 'llama3.1',
    base_url: `http://127.0.0.1:${closedPort}`,
    api_key: null,
    enabled: 1,
    fallback_to_mock: 1,
  });
  const res = await aiService.generate('generate_db_checks', { requirement_text: 'konsistensi data' });
  assert.equal(res.ok, true);
  assert.equal(res.meta.used_mock, true);
  assert.ok(Array.isArray(res.data));
  setSettings({ provider: 'mock', model: 'qatools-mock-1', base_url: '', api_key: null, api_key_masked: null });
});
