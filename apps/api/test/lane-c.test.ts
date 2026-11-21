/**
 * Lane C — automation engines test suite (node:test).
 *
 * Everything here executes for REAL against a loopback node:http server and a
 * scratch node:sqlite database. No network access, no external services.
 *
 * Run from the repo root:
 *   node --test --import <repo>/apps/api/node_modules/tsx/dist/loader.mjs apps/api/test/lane-c.test.ts
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/* ------------------------------------------------------------------ *
 * Isolated scratch database — MUST be set before importing the db module.
 * ------------------------------------------------------------------ */

const scratch = mkdtempSync(join(tmpdir(), 'qatools-lane-c-'));
process.env.QATOOLS_DB = resolve(scratch, 'lane-c.db');

const here = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = resolve(here, '..', '..', '..');

/* ------------------------------------------------------------------ *
 * Imports under test
 * ------------------------------------------------------------------ */

const { migrate, db } = await import('../src/db/index.js');
const { evaluateAssertions, evaluateAssertion } = await import('../src/modules/execute/assertions.js');
const { resolvePath } = await import('../src/modules/execute/jsonpath.js');
const { analyzeSql, violatesReadonlyGuard, assertReadonlySafe } = await import('../src/modules/dbtester/guard.js');
const { executeDbCheck, testConnection, explainCheck, dialectCapability, requireDialect } = await import(
  '../src/modules/dbtester/engine.js'
);
const { executeApiRequest } = await import('../src/modules/apitester/engine.js');
const { parseOpenApi } = await import('../src/modules/apitester/openapi.js');
const { runScript, interpolate, applyAuth, normalizeAssertions } = await import(
  '../src/modules/execute/scripting.js'
);
const { parseHtml, querySelectorAll, analyzeDocument, selectorCandidates } = await import(
  '../src/modules/webtester/html.js'
);
const { executeWebFlow, recordHint, webModeCapabilities } = await import('../src/modules/webtester/engine.js');
const { executeService } = await import('../src/modules/execute/index.js');

migrate();

/* ------------------------------------------------------------------ *
 * REAL loopback HTTP target
 * ------------------------------------------------------------------ */

interface EchoRequest {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: string;
}

let server: http.Server;
let baseUrl = '';
const seen: EchoRequest[] = [];

const PRODUCTS = [
  { id: 1, name: 'Kopi Arabika', price: 45000, tags: ['minuman', 'panas'] },
  { id: 2, name: 'Teh Hijau', price: 22000, tags: ['minuman'] },
  { id: 3, name: 'Roti Gandum', price: 31000, tags: ['makanan'] },
];

const LOGIN_HTML = `<!doctype html>
<html>
  <head><title>QATools Demo Shop</title></head>
  <body>
    <header id="main-header" class="top">
      <h1>Demo Shop</h1>
      <a href="/products" data-testid="nav-products">Produk</a>
    </header>
    <form id="login-form" action="/login" method="post">
      <input type="text" name="username" placeholder="Username" aria-label="Nama pengguna" />
      <input type="password" name="password" placeholder="Password" />
      <button type="submit" data-testid="btn-login">Masuk</button>
    </form>
    <table id="product-table">
      <thead><tr><th>Nama</th><th>Harga</th></tr></thead>
      <tbody>
        <tr><td>Kopi Arabika</td><td>45000</td></tr>
        <tr><td>Teh Hijau</td><td>22000</td></tr>
      </tbody>
    </table>
    <p id="footer-note">Halaman demo tanpa dependensi jaringan.</p>
  </body>
</html>`;

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((done) => {
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => done(data));
  });
}

function send(res: http.ServerResponse, status: number, payload: unknown, contentType = 'application/json'): void {
  const body = contentType === 'application/json' ? JSON.stringify(payload) : String(payload);
  res.writeHead(status, { 'Content-Type': contentType, 'X-QATools-Test': 'lane-c' });
  res.end(body);
}

test.before(async () => {
  server = http.createServer(async (req, res) => {
    const body = await readBody(req);
    seen.push({ method: req.method ?? 'GET', url: req.url ?? '/', headers: req.headers, body });

    const url = new URL(req.url ?? '/', 'http://127.0.0.1');

    switch (url.pathname) {
      case '/echo':
        return send(res, 200, {
          ok: true,
          method: req.method,
          received: body ? JSON.parse(body) : null,
          token: 'tok_abc123',
          data: { id: 42, items: [{ sku: 'A-1', qty: 3 }], nested: { deep: { value: 'halo' } } },
        });

      case '/products':
        return send(res, 200, { total: PRODUCTS.length, data: PRODUCTS });

      case '/login':
        return send(res, 200, { token: 'jwt.token.value', user: { name: 'tester' } });

      case '/orders':
        return send(res, 201, { created: true, order_id: 'ord_777' });

      case '/slow':
        await new Promise((r) => setTimeout(r, 120));
        return send(res, 200, { slow: true });

      case '/fail':
        return send(res, 500, { error: { code: 'boom', message: 'Server sengaja gagal' } });

      case '/page':
        return send(res, 200, LOGIN_HTML, 'text/html');

      case '/redirect':
        res.writeHead(302, { Location: '/page' });
        return res.end();

      case '/echo-auth':
        return send(res, 200, { authorization: req.headers.authorization ?? null, headers: req.headers });

      default:
        return send(res, 404, { error: { code: 'not_found', message: `Tidak ada rute ${url.pathname}` } });
    }
  });

  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
});

test.after(() => {
  server?.close();
  try {
    rmSync(scratch, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});

/* ------------------------------------------------------------------ *
 * Fixture helpers — write the frozen schema directly.
 * ------------------------------------------------------------------ */

function seedProject(): string {
  const id = 'prj_lanec0001';
  const ts = new Date().toISOString();
  db.prepare(
    `INSERT OR REPLACE INTO projects (id, key, name, description, target_url, repo_url, owner, status, quality_gate, metadata, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'active', 90, NULL, ?, ?)`,
  ).run(id, 'LANEC', 'Lane C Test Project', 'Scratch project', baseUrl, null, 'lane-auto', ts, ts);
  return id;
}

function seedTestCase(projectId: string, engine: string, code: string): string {
  const id = `tc_${code.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
  const ts = new Date().toISOString();
  db.prepare(
    `INSERT OR REPLACE INTO test_cases
       (id, project_id, scenario_id, use_case_id, code, title, objective, preconditions, type, layer, priority,
        severity, automation_status, engine, risk_score, estimated_minutes, tags, test_data, expected_result,
        is_regression, status, generated_by, ai_generation_id, created_at, updated_at)
     VALUES (?, ?, NULL, NULL, ?, ?, NULL, NULL, 'functional', 'api', 'high', 'major', 'automated', ?, 55, 5,
             NULL, NULL, NULL, 1, 'ready', 'manual', NULL, ?, ?)`,
  ).run(id, projectId, code, `Test case ${code}`, engine, ts, ts);
  return id;
}

function seedCollection(projectId: string, base = baseUrl): string {
  const id = 'col_lanec0001';
  const ts = new Date().toISOString();
  db.prepare(
    `INSERT OR REPLACE INTO api_collections (id, project_id, name, description, base_url, auth_type, auth_config, variables, created_at, updated_at)
     VALUES (?, ?, 'Demo Collection', 'Koleksi uji lane C', ?, 'none', NULL, ?, ?, ?)`,
  ).run(id, projectId, base, JSON.stringify({ sku: 'A-1' }), ts, ts);
  return id;
}

function seedRequest(input: {
  collectionId: string;
  projectId: string;
  testCaseId?: string | null;
  name: string;
  method: string;
  path: string;
  assertions?: unknown;
  body?: string | null;
  bodyType?: string;
  headers?: Record<string, string>;
  preScript?: string | null;
  postScript?: string | null;
}): string {
  const id = `apr_${input.name.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
  const ts = new Date().toISOString();
  db.prepare(
    `INSERT OR REPLACE INTO api_requests
       (id, collection_id, project_id, test_case_id, name, method, path, headers, query, body, body_type,
        assertions, pre_script, post_script, generated_by, last_status, last_duration_ms, last_run_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, 'manual', NULL, NULL, NULL, ?, ?)`,
  ).run(
    id,
    input.collectionId,
    input.projectId,
    input.testCaseId ?? null,
    input.name,
    input.method,
    input.path,
    input.headers ? JSON.stringify(input.headers) : null,
    input.body ?? null,
    input.bodyType ?? 'json',
    input.assertions ? JSON.stringify(input.assertions) : null,
    input.preScript ?? null,
    input.postScript ?? null,
    ts,
    ts,
  );
  return id;
}

function seedDbConnection(projectId: string, dsn: string, guard = 1): string {
  const id = guard ? 'dbcn_guarded' : 'dbcn_open';
  const ts = new Date().toISOString();
  db.prepare(
    `INSERT OR REPLACE INTO db_connections (id, project_id, name, dialect, dsn_masked, dsn, readonly_guard, created_by, created_at, updated_at)
     VALUES (?, ?, ?, 'sqlite', ?, ?, ?, 'lane-auto', ?, ?)`,
  ).run(id, projectId, guard ? 'Guarded SQLite' : 'Open SQLite', dsn, dsn, guard, ts, ts);
  return id;
}

function seedDbCheck(input: {
  id: string;
  projectId: string;
  connectionId: string;
  testCaseId?: string | null;
  name: string;
  sql: string;
  assertions?: unknown;
  setupSql?: string | null;
  teardownSql?: string | null;
}): string {
  const ts = new Date().toISOString();
  db.prepare(
    `INSERT OR REPLACE INTO db_checks
       (id, project_id, connection_id, test_case_id, name, sql, assertions, setup_sql, teardown_sql,
        generated_by, last_status, last_rows, last_run_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', NULL, NULL, NULL, ?, ?)`,
  ).run(
    input.id,
    input.projectId,
    input.connectionId,
    input.testCaseId ?? null,
    input.name,
    input.sql,
    input.assertions ? JSON.stringify(input.assertions) : null,
    input.setupSql ?? null,
    input.teardownSql ?? null,
    ts,
    ts,
  );
  return input.id;
}

function seedWebFlow(input: {
  id: string;
  projectId: string;
  testCaseId?: string | null;
  name: string;
  startUrl: string;
  steps: unknown[];
}): string {
  const ts = new Date().toISOString();
  db.prepare(
    `INSERT OR REPLACE INTO web_flows
       (id, project_id, test_case_id, name, start_url, steps, viewport, generated_by, last_status, last_run_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL, 'manual', NULL, NULL, ?, ?)`,
  ).run(
    input.id,
    input.projectId,
    input.testCaseId ?? null,
    input.name,
    input.startUrl,
    JSON.stringify(input.steps),
    ts,
    ts,
  );
  return input.id;
}

/** Creates a scratch sqlite file with a small `orders` table. */
function makeScratchSqlite(): string {
  const dir = mkdtempSync(join(tmpdir(), 'qatools-db-'));
  const file = join(dir, 'shop.db');
  const { DatabaseSync } = require$sqlite();
  const handle = new DatabaseSync(file);
  handle.exec(`
    CREATE TABLE orders (
      id INTEGER PRIMARY KEY,
      customer TEXT NOT NULL,
      total REAL NOT NULL,
      status TEXT NOT NULL
    );
    INSERT INTO orders (id, customer, total, status) VALUES
      (1, 'Andi',  150000, 'paid'),
      (2, 'Budi',   89000, 'paid'),
      (3, 'Citra',  42000, 'pending'),
      (4, 'Dewi',  310000, 'paid');
  `);
  handle.close();
  return file;
}

/** Small indirection so the test file does not need a second import form. */
function require$sqlite(): { DatabaseSync: new (path: string) => { exec: (sql: string) => void; close: () => void } } {
  return sqliteModule as unknown as {
    DatabaseSync: new (path: string) => { exec: (sql: string) => void; close: () => void };
  };
}

const sqliteModule = await import('node:sqlite');

/* ================================================================== *
 * 1. Assertion evaluator — the shared DSL
 * ================================================================== */

test('assertions: jsonpath resolves nested objects and array indexes', () => {
  const doc = { data: { items: [{ sku: 'A-1', qty: 3 }], nested: { deep: { value: 'halo' } } } };

  assert.equal(resolvePath(doc, '$.data.nested.deep.value').value, 'halo');
  assert.equal(resolvePath(doc, '$.data.items[0].sku').value, 'A-1');
  assert.equal(resolvePath(doc, '$.data.items[0].qty').value, 3);
  assert.equal(resolvePath(doc, '$["data"].nested.deep.value').value, 'halo');
  assert.equal(resolvePath(doc, 'data.nested.deep.value').value, 'halo');
  assert.equal(resolvePath(doc, '$').value, doc);

  // missing paths report found:false rather than throwing
  assert.equal(resolvePath(doc, '$.data.nope.deeper').found, false);
  assert.equal(resolvePath(doc, '$.data.items[9].sku').found, false);
});

test('assertions: jsonpath wildcard and .length', () => {
  const doc = { items: [{ id: 1 }, { id: 2 }, { id: 3 }] };
  const ids = resolvePath(doc, '$.items[*].id').value;
  assert.deepEqual(ids, [1, 2, 3]);
  assert.equal(resolvePath(doc, '$.items.length').value, 3);
  assert.equal(resolvePath(doc, '$.items[0].id.length').found, false);
});

test('assertions: equals / not_equals / gt / lt / gte / lte', () => {
  const ctx = { status: 200, duration_ms: 150, json: { body: { count: 12 } } };

  assert.equal(
    evaluateAssertion({ source: 'status', operator: 'equals', expected: 200 }, ctx).passed,
    true,
  );
  assert.equal(
    evaluateAssertion({ source: 'status', operator: 'not_equals', expected: 500 }, ctx).passed,
    true,
  );
  assert.equal(evaluateAssertion({ source: 'status', operator: 'lt', expected: 400 }, ctx).passed, true);
  assert.equal(evaluateAssertion({ source: 'status', operator: 'lte', expected: 200 }, ctx).passed, true);
  assert.equal(evaluateAssertion({ source: 'status', operator: 'gt', expected: 200 }, ctx).passed, false);
  assert.equal(evaluateAssertion({ source: 'status', operator: 'gte', expected: 200 }, ctx).passed, true);
  assert.equal(evaluateAssertion({ source: 'duration', operator: 'lt', expected: 500 }, ctx).passed, true);
  assert.equal(evaluateAssertion({ source: 'duration', operator: 'gt', expected: 5000 }, ctx).passed, false);
  assert.equal(
    evaluateAssertion({ source: 'jsonpath', path: '$.body.count', operator: 'gt', expected: 10 }, ctx).passed,
    true,
  );
  // numeric equality across string/number representations
  assert.equal(evaluateAssertion({ source: 'status', operator: 'equals', expected: '200' }, ctx).passed, true);
});

test('assertions: contains / not_contains / matches', () => {
  const ctx = { text: 'Selamat datang di QATools Demo Shop', body: '{"msg":"hello world"}' };

  assert.equal(
    evaluateAssertion({ source: 'text', operator: 'contains', expected: 'QATools' }, ctx).passed,
    true,
  );
  assert.equal(
    evaluateAssertion({ source: 'text', operator: 'not_contains', expected: 'Error' }, ctx).passed,
    true,
  );
  assert.equal(
    evaluateAssertion({ source: 'text', operator: 'contains', expected: 'Tidak Ada' }, ctx).passed,
    false,
  );
  assert.equal(
    evaluateAssertion({ source: 'text', operator: 'matches', expected: 'Demo\\s+Shop' }, ctx).passed,
    true,
  );
  assert.equal(
    evaluateAssertion({ source: 'text', operator: 'matches', expected: '/^Selamat/' }, ctx).passed,
    true,
  );
  assert.equal(
    evaluateAssertion({ source: 'text', operator: 'matches', expected: '^Nope$' }, ctx).passed,
    false,
  );
});

test('assertions: exists / not_exists', () => {
  const ctx = { json: { a: { b: 0 }, empty: null } };

  assert.equal(evaluateAssertion({ source: 'jsonpath', path: '$.a.b', operator: 'exists' }, ctx).passed, true);
  assert.equal(evaluateAssertion({ source: 'jsonpath', path: '$.a.missing', operator: 'exists' }, ctx).passed, false);
  assert.equal(
    evaluateAssertion({ source: 'jsonpath', path: '$.a.missing', operator: 'not_exists' }, ctx).passed,
    true,
  );
  assert.equal(evaluateAssertion({ source: 'jsonpath', path: '$.a.b', operator: 'not_exists' }, ctx).passed, false);
});

test('assertions: length_gte / length_lte on arrays, strings and objects', () => {
  const ctx = {
    json: { items: [1, 2, 3, 4], word: 'qatools', obj: { a: 1, b: 2 } },
    rows: [{ id: 1 }],
    row_count: 4,
    columns: ['id'],
  };

  assert.equal(
    evaluateAssertion({ source: 'jsonpath', path: '$.items', operator: 'length_gte', expected: 3 }, ctx).passed,
    true,
  );
  assert.equal(
    evaluateAssertion({ source: 'jsonpath', path: '$.items', operator: 'length_lte', expected: 4 }, ctx).passed,
    true,
  );
  assert.equal(
    evaluateAssertion({ source: 'jsonpath', path: '$.items', operator: 'length_gte', expected: 9 }, ctx).passed,
    false,
  );
  assert.equal(
    evaluateAssertion({ source: 'jsonpath', path: '$.word', operator: 'length_gte', expected: 7 }, ctx).passed,
    true,
  );
  assert.equal(
    evaluateAssertion({ source: 'jsonpath', path: '$.obj', operator: 'length_gte', expected: 2 }, ctx).passed,
    true,
  );
  assert.equal(evaluateAssertion({ source: 'row_count', operator: 'gte', expected: 4 }, ctx).passed, true);
});

test('assertions: in operator', () => {
  const ctx = { status: 201, json: { state: 'paid' } };
  assert.equal(
    evaluateAssertion({ source: 'status', operator: 'in', expected: [200, 201, 202] }, ctx).passed,
    true,
  );
  assert.equal(
    evaluateAssertion({ source: 'status', operator: 'in', expected: [400, 500] }, ctx).passed,
    false,
  );
  assert.equal(
    evaluateAssertion({ source: 'jsonpath', path: '$.state', operator: 'in', expected: ['paid', 'shipped'] }, ctx)
      .passed,
    true,
  );
  assert.equal(
    evaluateAssertion({ source: 'jsonpath', path: '$.state', operator: 'in', expected: 'paid,shipped' }, ctx).passed,
    true,
  );
});

test('assertions: header and column sources', () => {
  const ctx = {
    headers: { 'x-qatools-test': 'lane-c', 'Content-Type': 'application/json' },
    rows: [{ customer: 'Andi', total: 150000 }],
    first_row: { customer: 'Andi', total: 150000 },
  };
  assert.equal(
    evaluateAssertion({ source: 'header', path: 'x-qatools-test', operator: 'equals', expected: 'lane-c' }, ctx).passed,
    true,
  );
  // header lookup is case-insensitive
  assert.equal(
    evaluateAssertion({ source: 'header', path: 'X-QATools-Test', operator: 'equals', expected: 'lane-c' }, ctx).passed,
    true,
  );
  assert.equal(
    evaluateAssertion({ source: 'column', path: 'customer', operator: 'equals', expected: 'Andi' }, ctx).passed,
    true,
  );
  assert.equal(
    evaluateAssertion({ source: 'column', path: 'total', operator: 'gte', expected: 100000 }, ctx).passed,
    true,
  );
  assert.equal(
    evaluateAssertion({ source: 'column', path: 'missing', operator: 'exists' }, ctx).passed,
    false,
  );
});

test('assertions: evaluateAssertions aggregates and never throws', () => {
  const report = evaluateAssertions(
    [
      { source: 'status', operator: 'equals', expected: 200 },
      { source: 'status', operator: 'gt', expected: 100 },
      { source: 'status', operator: 'equals', expected: 500 },
    ],
    { status: 200 },
  );

  assert.equal(report.results.length, 3);
  assert.equal(report.passed_count, 2);
  assert.equal(report.failed_count, 1);
  assert.equal(report.passed, false);

  // an empty list passes nothing — explicit "no checks" policy
  assert.equal(evaluateAssertions([], { status: 200 }).passed, false);

  // a malformed assertion degrades to a failed outcome, never an exception
  const bad = evaluateAssertions([{ source: 'status', operator: 'not_a_real_op' as never, expected: 1 }], {
    status: 200,
  });
  assert.equal(bad.passed, false);
  assert.match(bad.results[0]!.message, /tidak dikenal/i);

  // no context at all
  assert.doesNotThrow(() => evaluateAssertions([{ source: 'jsonpath', path: '$.x', operator: 'exists' }], {}));
});

/* ================================================================== *
 * 2. API engine — REAL loopback HTTP execution
 * ================================================================== */

test('api engine: real HTTP call against the loopback server with passing assertions', async () => {
  const projectId = seedProject();
  const collectionId = seedCollection(projectId);

  const requestId = seedRequest({
    collectionId,
    projectId,
    name: 'EchoOK',
    method: 'POST',
    path: '/echo',
    body: JSON.stringify({ hello: 'dunia' }),
    assertions: [
      { source: 'status', operator: 'equals', expected: 200, message: 'HTTP 200' },
      { source: 'jsonpath', path: '$.ok', operator: 'equals', expected: true },
      { source: 'jsonpath', path: '$.token', operator: 'equals', expected: 'tok_abc123' },
      { source: 'jsonpath', path: '$.data.items[0].sku', operator: 'equals', expected: 'A-1' },
      { source: 'jsonpath', path: '$.data.nested.deep.value', operator: 'equals', expected: 'halo' },
      { source: 'jsonpath', path: '$.data.items', operator: 'length_gte', expected: 1 },
      { source: 'header', path: 'x-qatools-test', operator: 'equals', expected: 'lane-c' },
      { source: 'duration', operator: 'lt', expected: 10000 },
    ],
  });

  const request = db.prepare('SELECT * FROM api_requests WHERE id = ?').get(requestId) as Record<string, unknown>;
  const collection = db.prepare('SELECT * FROM api_collections WHERE id = ?').get(collectionId) as Record<string, unknown>;

  const result = await executeApiRequest({
    request: request as never,
    collection: collection as never,
    vars: {},
  });

  assert.equal(result.status, 'passed', `expected passed, got ${result.status}: ${result.error ?? ''}`);
  assert.equal(result.engine, 'api');
  assert.equal(result.http_status, 200);
  assert.equal(result.assertions.length, 8);
  assert.equal(result.assertions.every((a) => a.passed), true);
  assert.equal(result.error, null);

  // the loopback server really received the call
  const hit = seen.find((s) => s.url === '/echo' && s.method === 'POST');
  assert.ok(hit, 'server should have received POST /echo');
  assert.equal(JSON.parse(hit.body).hello, 'dunia');
  assert.match(String(hit.headers['content-type']), /application\/json/);

  // evidence captures the real response body
  assert.equal((result.evidence as { status: number }).status, 200);
  assert.match(String((result.evidence as { response_body: string }).response_body), /tok_abc123/);

  // last-run metadata is persisted on the request row
  const after = db.prepare('SELECT last_status, last_duration_ms, last_run_at FROM api_requests WHERE id = ?').get(
    requestId,
  ) as { last_status: number; last_duration_ms: number; last_run_at: string };
  assert.equal(after.last_status, 200);
  assert.ok(after.last_duration_ms >= 0);
  assert.ok(after.last_run_at);
});

test('api engine: a deliberately WRONG assertion fails the run', async () => {
  const projectId = seedProject();
  const collectionId = seedCollection(projectId);

  const requestId = seedRequest({
    collectionId,
    projectId,
    name: 'EchoWrong',
    method: 'GET',
    path: '/echo',
    assertions: [
      { source: 'status', operator: 'equals', expected: 200 },
      { source: 'jsonpath', path: '$.token', operator: 'equals', expected: 'TOKEN-YANG-SALAH' },
    ],
  });

  const request = db.prepare('SELECT * FROM api_requests WHERE id = ?').get(requestId) as Record<string, unknown>;
  const collection = db.prepare('SELECT * FROM api_collections WHERE id = ?').get(collectionId) as Record<string, unknown>;

  const result = await executeApiRequest({ request: request as never, collection: collection as never, vars: {} });

  assert.equal(result.status, 'failed');
  assert.equal(result.assertions.length, 2);
  assert.equal(result.assertions[0]!.passed, true);
  assert.equal(result.assertions[1]!.passed, false);
  assert.ok(result.error, 'a failing run must carry an error message');
  assert.match(result.error as string, /TOKEN-YANG-SALAH/);
  assert.equal(result.http_status, 200, 'the HTTP call itself still succeeded');
});

test('api engine: a wrong status expectation fails', async () => {
  const projectId = seedProject();
  const collectionId = seedCollection(projectId);
  const requestId = seedRequest({
    collectionId,
    projectId,
    name: 'FailStatus',
    method: 'GET',
    path: '/fail',
    assertions: [{ source: 'status', operator: 'equals', expected: 200 }],
  });

  const result = await executeApiRequest({
    request: db.prepare('SELECT * FROM api_requests WHERE id = ?').get(requestId) as never,
    collection: db.prepare('SELECT * FROM api_collections WHERE id = ?').get(collectionId) as never,
    vars: {},
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.http_status, 500);
  assert.equal(result.assertions[0]!.observed, 500);
});

test('api engine: variable interpolation from collection variables', async () => {
  const projectId = seedProject();
  const collectionId = seedCollection(projectId);
  const requestId = seedRequest({
    collectionId,
    projectId,
    name: 'Interp',
    method: 'GET',
    path: '/products',
    headers: { 'X-Sku': '{{sku}}' },
    assertions: [
      { source: 'status', operator: 'equals', expected: 200 },
      { source: 'jsonpath', path: '$.total', operator: 'gte', expected: 3 },
      { source: 'jsonpath', path: '$.data[*].name', operator: 'contains', expected: 'Kopi Arabika' },
    ],
  });

  const result = await executeApiRequest({
    request: db.prepare('SELECT * FROM api_requests WHERE id = ?').get(requestId) as never,
    collection: db.prepare('SELECT * FROM api_collections WHERE id = ?').get(collectionId) as never,
    vars: {},
  });

  assert.equal(result.status, 'passed', result.error ?? '');
  const hit = seen.filter((s) => s.url === '/products').pop();
  assert.ok(hit);
  assert.equal(hit.headers['x-sku'], 'A-1', 'collection variable must be interpolated into the header');
});

test('api engine: unreachable target is blocked, not failed', async () => {
  const projectId = seedProject();
  // Port 1 is reserved and refuses connections immediately.
  const collectionId = seedCollection(projectId, 'http://127.0.0.1:1');
  const requestId = seedRequest({
    collectionId,
    projectId,
    name: 'Unreachable',
    method: 'GET',
    path: '/nothing',
    assertions: [{ source: 'status', operator: 'equals', expected: 200 }],
  });

  const result = await executeApiRequest({
    request: db.prepare('SELECT * FROM api_requests WHERE id = ?').get(requestId) as never,
    collection: db.prepare('SELECT * FROM api_collections WHERE id = ?').get(collectionId) as never,
    vars: {},
  });

  assert.equal(result.status, 'blocked');
  assert.match(result.error as string, /Tidak dapat menghubungi/);
});

test('api engine: dry-run validates without hitting the target', async () => {
  const projectId = seedProject();
  const collectionId = seedCollection(projectId);
  const requestId = seedRequest({
    collectionId,
    projectId,
    name: 'DryRun',
    method: 'GET',
    path: '/never-called-dry-run',
    assertions: [{ source: 'status', operator: 'equals', expected: 200 }],
  });

  const before = seen.length;
  const result = await executeApiRequest({
    request: db.prepare('SELECT * FROM api_requests WHERE id = ?').get(requestId) as never,
    collection: db.prepare('SELECT * FROM api_collections WHERE id = ?').get(collectionId) as never,
    vars: {},
    dryRun: true,
  });

  assert.equal(result.status, 'skipped');
  assert.equal(seen.length, before, 'dry-run must not send any request');
  assert.equal((result.evidence as { mode: string }).mode, 'dry-run');
});

/* ================================================================== *
 * 3. Safe scripting + auth (no arbitrary JS)
 * ================================================================== */

test('scripting: set()/jsonpath() extraction works, arbitrary JS is rejected', () => {
  const ctx = {
    json: { data: { token: 'jwt.abc', items: [{ id: 'ord_1' }] } },
    status: 201,
    body: '{"data":{"token":"jwt.abc"}}',
    headers: { 'x-trace': 'trace-1' },
    vars: { existing: 'nilai' },
  };

  const effect = runScript(
    'set("token", jsonpath("$.data.token"));\nset("order", jsonpath("$.data.items[0].id"));\nset("code", status);',
    ctx,
  );
  assert.equal(effect.sets.token, 'jwt.abc');
  assert.equal(effect.sets.order, 'ord_1');
  assert.equal(effect.sets.code, 201);
  assert.equal(effect.logs.length, 3);

  const headerEffect = runScript('header("X-Trace-Id", jsonpath("$.data.token"))', ctx);
  assert.equal(headerEffect.headers['X-Trace-Id'], 'jwt.abc');

  // Free-form JavaScript must be rejected with a clear message.
  assert.throws(() => runScript('console.log("hi")', ctx), /tidak diizinkan/i);
  assert.throws(() => runScript('process.exit(1)', ctx), /tidak diizinkan/i);
  assert.throws(() => runScript('const a = 1;', ctx), /tidak diizinkan/i);
  assert.throws(() => runScript('require("fs").unlinkSync("/tmp/x")', ctx), /tidak diizinkan/i);
  assert.throws(() => runScript('set("x", eval("1+1"))', ctx), /tidak dikenal|tidak didukung/i);

  // jsonpath that finds nothing reports a precise error
  assert.throws(() => runScript('set("x", jsonpath("$.nope"))', ctx), /tidak menemukan nilai/i);

  // empty scripts are a no-op
  const empty = runScript('', ctx);
  assert.deepEqual(empty.sets, {});
});

test('scripting: interpolate and applyAuth cover all four auth types', () => {
  const vars = { base: baseUrl, token: 'secret-token', user: 'admin', pass: 'p@ss' };

  const interp = interpolate('{{base}}/api/users/{{user}}', vars);
  assert.equal(interp.text, `${baseUrl}/api/users/admin`);
  assert.deepEqual(interp.missing, []);

  const unknown = interpolate('{{nope}}/x', vars);
  assert.deepEqual(unknown.missing, ['nope']);
  assert.match(unknown.text, /\{\{nope\}\}/);

  const bearer = applyAuth('bearer', { token: '{{token}}' }, vars);
  assert.equal(bearer.headers.Authorization, 'Bearer secret-token');

  const basic = applyAuth('basic', { username: '{{user}}', password: '{{pass}}' }, vars);
  assert.equal(basic.headers.Authorization, `Basic ${Buffer.from('admin:p@ss').toString('base64')}`);

  const apiKeyHeader = applyAuth('api_key', { key: 'X-API-Key', value: 'k-123', in: 'header' }, vars);
  assert.equal(apiKeyHeader.headers['X-API-Key'], 'k-123');

  const apiKeyQuery = applyAuth('api_key', { key: 'api_key', value: 'k-456', in: 'query' }, vars);
  assert.equal(apiKeyQuery.query.api_key, 'k-456');
  assert.equal(Object.keys(apiKeyQuery.headers).length, 0);

  const none = applyAuth('none', null, vars);
  assert.deepEqual(none.headers, {});
});

test('api engine: bearer auth reaches the loopback server', async () => {
  const projectId = seedProject();
  const collectionId = seedCollection(projectId);
  db.prepare("UPDATE api_collections SET auth_type = 'bearer', auth_config = ? WHERE id = ?").run(
    JSON.stringify({ token: '{{apiToken}}' }),
    collectionId,
  );
  const requestId = seedRequest({
    collectionId,
    projectId,
    name: 'AuthEcho',
    method: 'GET',
    path: '/echo-auth',
    assertions: [
      { source: 'status', operator: 'equals', expected: 200 },
      { source: 'jsonpath', path: '$.authorization', operator: 'equals', expected: 'Bearer super-secret' },
    ],
  });

  const result = await executeApiRequest({
    request: db.prepare('SELECT * FROM api_requests WHERE id = ?').get(requestId) as never,
    collection: db.prepare('SELECT * FROM api_collections WHERE id = ?').get(collectionId) as never,
    vars: { apiToken: 'super-secret' },
  });

  assert.equal(result.status, 'passed', result.error ?? '');
  // secrets must be redacted in stored evidence
  const evidence = result.evidence as { request_headers: Record<string, string> };
  assert.equal(evidence.request_headers.Authorization, '***');
});

/* ================================================================== *
 * 4. DB engine — REAL node:sqlite execution + readonly guard
 * ================================================================== */

test('db engine: runs a real sqlite check with row_count and column assertions', async () => {
  const projectId = seedProject();
  const dbFile = makeScratchSqlite();
  const connectionId = seedDbConnection(projectId, dbFile, 1);

  const checkId = seedDbCheck({
    id: 'dbc_rowcount',
    projectId,
    connectionId,
    name: 'Order berstatus paid',
    sql: "SELECT id, customer, total, status FROM orders WHERE status = 'paid' ORDER BY id",
    assertions: [
      { source: 'row_count', operator: 'equals', expected: 3, message: 'Tiga order paid' },
      { source: 'row_count', operator: 'gte', expected: 1 },
      { source: 'column', path: 'customer', operator: 'equals', expected: 'Andi' },
      { source: 'column', path: 'total', operator: 'gt', expected: 100000 },
      { source: 'column', path: 'status', operator: 'in', expected: ['paid'] },
      { source: 'column', path: 'id', operator: 'exists' },
    ],
  });

  const check = db.prepare('SELECT * FROM db_checks WHERE id = ?').get(checkId) as Record<string, unknown>;
  const connection = db.prepare('SELECT * FROM db_connections WHERE id = ?').get(connectionId) as Record<string, unknown>;

  const result = await executeDbCheck(check as never, connection as never, {});

  assert.equal(result.status, 'passed', result.error ?? '');
  assert.equal(result.engine, 'db');
  assert.equal(result.row_count, 3);
  assert.deepEqual(result.columns, ['id', 'customer', 'total', 'status']);
  assert.equal(result.rows.length, 3);
  assert.equal(result.rows[0]!.customer, 'Andi');
  assert.equal(result.assertions.length, 6);
  assert.equal(result.assertions.every((a) => a.passed), true);

  // last-run metadata persisted on the check row
  try {
    db.prepare('UPDATE db_checks SET last_status = ?, last_rows = ? WHERE id = ?').run(result.status, result.row_count, checkId);
  } catch {
    /* mirror of the route behaviour */
  }
});

test('db engine: a wrong row_count assertion fails the check', async () => {
  const projectId = seedProject();
  const dbFile = makeScratchSqlite();
  const connectionId = seedDbConnection(projectId, dbFile, 1);

  const checkId = seedDbCheck({
    id: 'dbc_wrongcount',
    projectId,
    connectionId,
    name: 'Jumlah order salah',
    sql: 'SELECT * FROM orders',
    assertions: [
      { source: 'row_count', operator: 'equals', expected: 99 },
      { source: 'column', path: 'customer', operator: 'equals', expected: 'Tidak Ada' },
    ],
  });

  const result = await executeDbCheck(
    db.prepare('SELECT * FROM db_checks WHERE id = ?').get(checkId) as never,
    db.prepare('SELECT * FROM db_connections WHERE id = ?').get(connectionId) as never,
    {},
  );

  assert.equal(result.status, 'failed');
  assert.equal(result.assertions.filter((a) => !a.passed).length, 2);
  assert.equal(result.assertions[0]!.observed, 4);
  assert.ok(result.error);
});

test('db engine: setup_sql inserts and teardown_sql removes — real side effects', async () => {
  const projectId = seedProject();
  const dbFile = makeScratchSqlite();
  const connectionId = seedDbConnection(projectId, dbFile, 0); // guard off: setup writes

  const checkId = seedDbCheck({
    id: 'dbc_setup',
    projectId,
    connectionId,
    name: 'Check dengan setup/teardown',
    sql: "SELECT COUNT(*) AS n FROM orders WHERE customer = 'Zoe'",
    setupSql: "INSERT INTO orders (id, customer, total, status) VALUES (99, 'Zoe', 1000, 'paid');",
    teardownSql: "DELETE FROM orders WHERE id = 99;",
    assertions: [
      { source: 'jsonpath', path: '$.n', operator: 'equals', expected: 1 },
      { source: 'row_count', operator: 'equals', expected: 1 },
    ],
  });

  const result = await executeDbCheck(
    db.prepare('SELECT * FROM db_checks WHERE id = ?').get(checkId) as never,
    db.prepare('SELECT * FROM db_connections WHERE id = ?').get(connectionId) as never,
    {},
  );

  assert.equal(result.status, 'passed', result.error ?? '');
  assert.equal(result.row_count, 1);
  const actions = result.logs.map((l) => l.action);
  assert.ok(actions.includes('setup'));
  assert.ok(actions.includes('query'));
  assert.ok(actions.includes('teardown'));

  // teardown really ran: row 99 is gone
  const verify = new (sqliteModule as unknown as { DatabaseSync: new (p: string) => { prepare: (s: string) => { get: () => unknown }; close: () => void } }).DatabaseSync(dbFile);
  const row = verify.prepare('SELECT COUNT(*) AS n FROM orders WHERE id = 99').get() as { n: number };
  verify.close();
  assert.equal(row.n, 0, 'teardown_sql must have deleted the setup row');
});

test('db engine: READONLY GUARD rejects UPDATE / DROP / DELETE / INSERT', async () => {
  const projectId = seedProject();
  const dbFile = makeScratchSqlite();
  const connectionId = seedDbConnection(projectId, dbFile, 1);

  const guarded = db.prepare('SELECT * FROM db_connections WHERE id = ?').get(connectionId) as Record<string, unknown>;

  const cases: Array<{ name: string; sql: string; verb: string }> = [
    { name: 'UPDATE', sql: "UPDATE orders SET status = 'refunded' WHERE id = 1", verb: 'UPDATE' },
    { name: 'DROP', sql: 'DROP TABLE orders', verb: 'DROP' },
    { name: 'DELETE', sql: 'DELETE FROM orders', verb: 'DELETE' },
    { name: 'INSERT', sql: "INSERT INTO orders (id, customer, total, status) VALUES (5, 'Eka', 1, 'x')", verb: 'INSERT' },
    { name: 'multiple statements', sql: 'SELECT 1; DROP TABLE orders', verb: 'SELECT' },
  ];

  for (const c of cases) {
    const checkId = seedDbCheck({
      id: `dbc_guard_${c.verb.toLowerCase()}`,
      projectId,
      connectionId,
      name: `Guard ${c.name}`,
      sql: c.sql,
      assertions: [{ source: 'row_count', operator: 'gte', expected: 0 }],
    });

    const check = db.prepare('SELECT * FROM db_checks WHERE id = ?').get(checkId) as Record<string, unknown>;

    // The engine must THROW (→ the route renders 400 readonly_guard_violation).
    await assert.rejects(
      () => executeDbCheck(check as never, guarded as never, {}),
      (err: Error & { code?: string; status?: number }) => {
        assert.equal(err.name, 'EngineError');
        assert.equal(err.code, 'readonly_guard_violation');
        assert.equal(err.status, 400);
        assert.match(err.message, /readonly guard/i);
        return true;
      },
      `guard must reject ${c.name}`,
    );
  }

  // The database is untouched after every rejected attempt.
  const verify = new (sqliteModule as unknown as {
    DatabaseSync: new (p: string) => { prepare: (s: string) => { all: () => unknown[] }; close: () => void };
  }).DatabaseSync(dbFile);
  const rows = verify.prepare('SELECT * FROM orders').all() as Array<{ status: string; id: number }>;
  verify.close();
  assert.equal(rows.length, 4, 'DROP/DELETE/INSERT must never have executed');
  assert.equal(rows.find((r) => r.id === 1)?.status, 'paid', 'UPDATE must never have executed');
});

test('db engine: READONLY GUARD allows SELECT and WITH ... SELECT', async () => {
  const projectId = seedProject();
  const dbFile = makeScratchSqlite();
  const connectionId = seedDbConnection(projectId, dbFile, 1);

  // A literal containing the word DROP must NOT trip the guard.
  const selectId = seedDbCheck({
    id: 'dbc_guard_select',
    projectId,
    connectionId,
    name: 'Select aman',
    sql: "SELECT 'DROP TABLE orders' AS pesan, COUNT(*) AS n FROM orders",
    assertions: [
      { source: 'column', path: 'pesan', operator: 'equals', expected: 'DROP TABLE orders' },
      { source: 'jsonpath', path: '$.n', operator: 'equals', expected: 4 },
    ],
  });

  const selectResult = await executeDbCheck(
    db.prepare('SELECT * FROM db_checks WHERE id = ?').get(selectId) as never,
    db.prepare('SELECT * FROM db_connections WHERE id = ?').get(connectionId) as never,
    {},
  );
  assert.equal(selectResult.status, 'passed', selectResult.error ?? '');

  const cteId = seedDbCheck({
    id: 'dbc_guard_cte',
    projectId,
    connectionId,
    name: 'CTE aman',
    sql: "WITH paid AS (SELECT * FROM orders WHERE status = 'paid') SELECT COUNT(*) AS n FROM paid",
    assertions: [{ source: 'jsonpath', path: '$.n', operator: 'equals', expected: 3 }],
  });

  const cteResult = await executeDbCheck(
    db.prepare('SELECT * FROM db_checks WHERE id = ?').get(cteId) as never,
    db.prepare('SELECT * FROM db_connections WHERE id = ?').get(connectionId) as never,
    {},
  );
  assert.equal(cteResult.status, 'passed', cteResult.error ?? '');
});

test('db engine: guard is per-connection — an unguarded connection may write', async () => {
  const projectId = seedProject();
  const dbFile = makeScratchSqlite();
  const connectionId = seedDbConnection(projectId, dbFile, 0);

  const checkId = seedDbCheck({
    id: 'dbcn_open_write',
    projectId,
    connectionId,
    name: 'Tulis pada koneksi tanpa guard',
    sql: "UPDATE orders SET status = 'refunded' WHERE id = 1",
    assertions: [{ source: 'row_count', operator: 'equals', expected: 0 }],
  });

  const result = await executeDbCheck(
    db.prepare('SELECT * FROM db_checks WHERE id = ?').get(checkId) as never,
    db.prepare('SELECT * FROM db_connections WHERE id = ?').get(connectionId) as never,
    {},
  );

  assert.equal(result.status, 'passed', result.error ?? '');

  const verify = new (sqliteModule as unknown as {
    DatabaseSync: new (p: string) => { prepare: (s: string) => { get: () => unknown }; close: () => void };
  }).DatabaseSync(dbFile);
  const row = verify.prepare('SELECT status FROM orders WHERE id = 1').get() as { status: string };
  verify.close();
  assert.equal(row.status, 'refunded', 'an unguarded connection must be allowed to write');
});

test('db guard: analyzeSql classifies statements correctly', () => {
  assert.equal(violatesReadonlyGuard('SELECT * FROM orders'), false);
  assert.equal(violatesReadonlyGuard('  select 1  '), false);
  assert.equal(violatesReadonlyGuard('WITH x AS (SELECT 1) SELECT * FROM x'), false);
  assert.equal(violatesReadonlyGuard('-- komentar\nSELECT 1'), false);
  assert.equal(violatesReadonlyGuard('/* blok */ SELECT 1'), false);
  assert.equal(violatesReadonlyGuard("SELECT 'UPDATE orders'"), false);
  assert.equal(violatesReadonlyGuard("SELECT 1; SELECT 2"), true);
  assert.equal(violatesReadonlyGuard('UPDATE orders SET a = 1'), true);
  assert.equal(violatesReadonlyGuard('DROP TABLE orders'), true);
  assert.equal(violatesReadonlyGuard('TRUNCATE TABLE orders'), true);
  assert.equal(violatesReadonlyGuard('PRAGMA journal_mode = WAL'), true);
  assert.equal(violatesReadonlyGuard('PRAGMA table_info(orders)'), false);
  assert.equal(violatesReadonlyGuard('ATTACH DATABASE "x.db" AS x'), true);
  assert.equal(violatesReadonlyGuard(''), true);

  const analysis = analyzeSql('SELECT 1; DROP TABLE x');
  assert.equal(analysis.statements.length, 2);
  assert.deepEqual(analysis.verbs, ['SELECT', 'DROP']);
  assert.equal(analysis.readonly_safe, false);

  // assertReadonlySafe is a no-op when the guard is disabled
  assert.doesNotThrow(() => assertReadonlySafe('DROP TABLE x', false));
  assert.throws(() => assertReadonlySafe('DROP TABLE x', true), /readonly guard/i);
});

test('db engine: postgres/mysql return an honest 501 driver_not_installed', async () => {
  const projectId = seedProject();
  const ts = new Date().toISOString();
  db.prepare(
    `INSERT OR REPLACE INTO db_connections (id, project_id, name, dialect, dsn_masked, dsn, readonly_guard, created_by, created_at, updated_at)
     VALUES ('dbcn_pg', ?, 'Postgres', 'postgres', 'postgres://u:***@h/db', 'postgres://u:p@h/db', 1, 'lane-auto', ?, ?)`,
  ).run(projectId, ts, ts);

  const checkId = seedDbCheck({
    id: 'dbcn_pg',
    projectId,
    connectionId: 'dbcn_pg',
    name: 'Check postgres',
    sql: 'SELECT 1',
    assertions: [{ source: 'row_count', operator: 'gte', expected: 0 }],
  });

  await assert.rejects(
    () =>
      executeDbCheck(
        db.prepare('SELECT * FROM db_checks WHERE id = ?').get(checkId) as never,
        db.prepare("SELECT * FROM db_connections WHERE id = 'dbcn_pg'").get() as never,
        {},
      ),
    (err: Error & { code?: string; status?: number; details?: unknown }) => {
      assert.equal(err.status, 501);
      assert.equal(err.code, 'driver_not_installed');
      assert.match(err.message, /pg/);
      assert.ok(err.details, 'the 501 must explain how to install the driver');
      return true;
    },
  );

  // getters report the honest matrix
  const sqlite = dialectCapability('sqlite');
  const postgres = dialectCapability('postgres');
  const mysql = dialectCapability('mysql');
  assert.equal(sqlite.available, true);
  assert.equal(postgres.available, false);
  assert.equal(mysql.available, false);
  assert.match(postgres.reason, /pg/);
  assert.match(mysql.reason, /mysql2/);
  assert.throws(() => requireDialect('postgres'), /pg/);
  assert.doesNotThrow(() => requireDialect('sqlite'));
});

test('db engine: connectivity test and EXPLAIN work on a real sqlite file', async () => {
  const projectId = seedProject();
  const dbFile = makeScratchSqlite();
  const connectionId = seedDbConnection(projectId, dbFile, 1);
  const connection = db.prepare('SELECT * FROM db_connections WHERE id = ?').get(connectionId) as Record<string, unknown>;

  const probe = await testConnection(connection as never);
  assert.equal(probe.ok, true, probe.message);
  assert.equal(probe.tables, 1);
  assert.match(probe.version ?? '', /sqlite/i);

  const checkId = seedDbCheck({
    id: 'dbc_explain',
    projectId,
    connectionId,
    name: 'Explain',
    sql: "SELECT * FROM orders WHERE status = 'paid'",
    assertions: [],
  });

  const plan = await explainCheck(
    db.prepare('SELECT * FROM db_checks WHERE id = ?').get(checkId) as never,
    connection as never,
  );
  assert.equal(plan.available, true, plan.message);

  // EXPLAIN on a write statement is refused
  const writeCheckId = seedDbCheck({
    id: 'dbc_explain_write',
    projectId,
    connectionId,
    name: 'Explain write',
    sql: 'DELETE FROM orders',
    assertions: [],
  });
  await assert.rejects(
    () =>
      explainCheck(
        db.prepare('SELECT * FROM db_checks WHERE id = ?').get(writeCheckId) as never,
        connection as never,
      ),
    /hanya tersedia untuk statement baca/i,
  );
});

/* ================================================================== *
 * 5. Web engine — REAL HTTP fetch + hand-written HTML parsing
 * ================================================================== */

test('web html: hand-written parser extracts structure without any DOM library', () => {
  const doc = analyzeDocument(LOGIN_HTML, baseUrl);

  assert.equal(doc.title, 'QATools Demo Shop');
  assert.match(doc.text, /Demo Shop/);
  assert.match(doc.text, /Halaman demo/);

  assert.equal(doc.forms.length, 1);
  assert.equal(doc.forms[0]!.action, `${baseUrl}/login`);
  assert.equal(doc.forms[0]!.method, 'POST');

  assert.equal(doc.inputs.length, 2);
  assert.equal(doc.inputs[0]!.name, 'username');
  assert.equal(doc.inputs[1]!.type, 'password');

  assert.ok(doc.buttons.includes('Masuk'), `buttons were ${JSON.stringify(doc.buttons)}`);

  assert.equal(doc.tables.length, 1);
  assert.deepEqual(doc.tables[0]!.headers, ['Nama', 'Harga']);
  assert.equal(doc.tables[0]!.rowCount, 2);

  assert.ok(doc.links.some((l) => l.href === `${baseUrl}/products`));
});

test('web html: selector matching supports id / testid / attribute / class / text', () => {
  const root = parseHtml(LOGIN_HTML);

  assert.equal(querySelectorAll(root, '#login-form').length, 1);
  assert.equal(querySelectorAll(root, '[data-testid="btn-login"]').length, 1);
  assert.equal(querySelectorAll(root, 'input[name="username"]').length, 1);
  assert.equal(querySelectorAll(root, '[aria-label="Nama pengguna"]').length, 1);
  assert.equal(querySelectorAll(root, '#product-table tr').length, 3, 'header + 2 body rows');
  assert.equal(querySelectorAll(root, 'form#login-form input').length, 2);
  assert.equal(querySelectorAll(root, '.top').length, 1);
  assert.equal(querySelectorAll(root, 'button >> text=Masuk').length, 1);
  assert.equal(querySelectorAll(root, '#does-not-exist').length, 0);

  const button = querySelectorAll(root, '[data-testid="btn-login"]')[0]!;
  assert.equal(button.node.tag, 'button');
  assert.equal(button.text, 'Masuk');

  // selector candidates follow the documented priority order
  const candidates = selectorCandidates(button.node);
  assert.equal(candidates[0], '[data-testid="btn-login"]');
});

test('web engine: HTTP mode runs a real flow against the loopback server', async () => {
  const projectId = seedProject();
  const flowId = seedWebFlow({
    id: 'wbf_http_flow',
    projectId,
    name: 'Alur login demo',
    startUrl: `${baseUrl}/page`,
    steps: [
      { action: 'goto', value: `${baseUrl}/page` },
      { action: 'assert_visible', selector: '#login-form' },
      { action: 'assert_visible', selector: '[data-testid="btn-login"]' },
      { action: 'assert_text', selector: '#product-table', expected: 'Kopi Arabika' },
      { action: 'assert_text', expected: 'Halaman demo' },
      { action: 'fill', selector: 'input[name="username"]', value: 'tester' },
      { action: 'fill', selector: 'input[name="password"]', value: 'rahasia' },
      { action: 'assert_url', expected: '/page' },
      { action: 'screenshot' },
    ],
  });

  const flow = db.prepare('SELECT * FROM web_flows WHERE id = ?').get(flowId) as Record<string, unknown>;
  const result = await executeWebFlow(flow as never, {});

  assert.equal(result.engine, 'web');
  // screenshot is skipped in HTTP mode, everything else passes
  assert.equal(result.status, 'passed', `expected passed: ${JSON.stringify(result.logs.filter((l) => l.status === 'fail'))}`);

  const evidence = result.evidence as {
    mode: string;
    mode_label: string;
    page_title: string;
    steps_total: number;
    steps_failed: number;
    status_code: number;
  };

  // HONESTY: the mode must be reported truthfully.
  assert.equal(evidence.mode, 'http');
  assert.match(evidence.mode_label, /BUKAN browser/i);
  assert.equal(result.mode, 'http');
  assert.equal(evidence.page_title, 'QATools Demo Shop');
  assert.equal(evidence.status_code, 200);
  assert.equal(evidence.steps_total, 9);
  assert.equal(evidence.steps_failed, 0);

  // the loopback server really was fetched
  assert.ok(seen.some((s) => s.url === '/page'));

  // screenshot step is honestly skipped, not faked as success
  const screenshotLog = result.logs.find((l) => l.action === 'screenshot');
  assert.ok(screenshotLog);
  assert.equal(screenshotLog.status, 'skip');
  assert.match(screenshotLog.message, /Playwright/i);
});

test('web engine: a failing step fails the flow and reports which one', async () => {
  const projectId = seedProject();
  const flowId = seedWebFlow({
    id: 'wbf_failing_flow',
    projectId,
    name: 'Alur gagal',
    startUrl: `${baseUrl}/page`,
    steps: [
      { action: 'goto', value: `${baseUrl}/page` },
      { action: 'assert_visible', selector: '#tidak-ada-elemen-ini' },
      { action: 'assert_text', expected: 'Teks yang tidak pernah ada di halaman' },
    ],
  });

  const result = await executeWebFlow(
    db.prepare('SELECT * FROM web_flows WHERE id = ?').get(flowId) as never,
    {},
  );

  assert.equal(result.status, 'failed');
  assert.equal((result.evidence as { steps_failed: number }).steps_failed, 2);
  const failures = result.logs.filter((l) => l.status === 'fail');
  assert.equal(failures.length, 2);
  assert.match(failures[0]!.message, /tidak ada di HTML|tidak ditemukan/i);
  assert.ok(result.error);
});

test('web engine: unreachable page is blocked, never falsely passed', async () => {
  const projectId = seedProject();
  const flowId = seedWebFlow({
    id: 'wbf_unreachable',
    projectId,
    name: 'Alur target mati',
    startUrl: 'http://127.0.0.1:1/tidak-ada',
    steps: [{ action: 'goto', value: 'http://127.0.0.1:1/tidak-ada' }],
  });

  const result = await executeWebFlow(
    db.prepare('SELECT * FROM web_flows WHERE id = ?').get(flowId) as never,
    {},
  );

  assert.equal(result.status, 'blocked');
  assert.match(result.error ?? result.logs.map((l) => l.message).join(' '), /Tidak dapat memuat/i);
});

test('web engine: dry-run validates the flow without fetching', async () => {
  const projectId = seedProject();
  const flowId = seedWebFlow({
    id: 'wbf_dryrun',
    projectId,
    name: 'Alur dry-run',
    startUrl: `${baseUrl}/page`,
    steps: [
      { action: 'goto', value: `${baseUrl}/page` },
      { action: 'click' }, // deliberately missing a selector
    ],
  });

  const before = seen.length;
  const result = await executeWebFlow(
    db.prepare('SELECT * FROM web_flows WHERE id = ?').get(flowId) as never,
    { dry_run: true },
  );

  assert.equal(seen.length, before, 'dry-run must not fetch the target');
  assert.equal(result.status, 'failed');
  assert.match(result.error ?? '', /tanpa selector/i);
});

test('web engine: record-hint returns SUGGESTED steps with robust selector candidates', async () => {
  const hint = await recordHint(`${baseUrl}/page`);

  assert.equal(hint.fetched, true, hint.message);
  assert.equal(hint.status, 200);
  assert.equal(hint.title, 'QATools Demo Shop');
  assert.match(hint.message, /SARAN/i);

  // starts with goto then assertions
  assert.equal(hint.suggested_steps[0]!.action, 'goto');
  assert.ok(hint.suggested_steps.length > 3);

  // selector candidates are ordered id > testid > name > aria-label > text
  const loginBtn = hint.elements.find((e) => e.attributes['data-testid'] === 'btn-login');
  assert.ok(loginBtn, 'the login button should be discovered');
  assert.equal(loginBtn.candidates[0], '[data-testid="btn-login"]');

  const username = hint.elements.find((e) => e.attributes.name === 'username');
  assert.ok(username);
  assert.ok(username.candidates.some((c) => c.includes('name="username"')), JSON.stringify(username.candidates));

  assert.equal(hint.forms.length, 1);
  assert.ok(hint.tables.length >= 1);
});

test('web engine: reports playwright honestly when it is not installed', async () => {
  const modes = await webModeCapabilities(true);

  const http = modes.find((m) => m.mode === 'http');
  const playwright = modes.find((m) => m.mode === 'playwright');

  assert.ok(http);
  assert.equal(http.available, true, 'HTTP mode is always available');
  assert.match(http.reason, /AKTIF/);

  assert.ok(playwright);
  // On this machine playwright is NOT installed, so it must be reported unavailable
  // with an install hint — never silently claimed as working.
  assert.equal(playwright.available, false);
  assert.match(playwright.reason, /tidak terpasang/i);
  assert.match(playwright.reason, /playwright/);
});

/* ================================================================== *
 * 6. executeService — the cross-lane surface (Lane B depends on this)
 * ================================================================== */

test('executeService.capabilities(): honest engine matrix', async () => {
  const caps = await executeService.capabilities();

  assert.ok(Array.isArray(caps.engines));
  const byEngine = Object.fromEntries(caps.engines.map((e) => [e.engine, e]));
  assert.deepEqual(Object.keys(byEngine).sort(), ['ai', 'api', 'db', 'manual', 'web']);

  // every engine carries a reason string
  for (const entry of caps.engines) {
    assert.equal(typeof entry.reason, 'string');
    assert.ok(entry.reason.length > 0, `${entry.engine} must explain itself`);
  }

  assert.equal(byEngine.manual!.available, true);
  assert.equal(byEngine.api!.available, true);
  assert.equal(byEngine.db!.available, true);
  assert.match(byEngine.db!.reason, /sqlite/i);
  assert.match(byEngine.db!.reason, /501|driver_not_installed/i);

  // web is available via HTTP mode, and says so honestly
  assert.equal(byEngine.web!.available, true);
  assert.equal(byEngine.web!.mode, 'http');
  assert.match(byEngine.web!.reason, /HTTP/i);

  // playwright is reported as absent in the web modes section
  const pw = caps.web_modes.find((m) => m.mode === 'playwright');
  assert.ok(pw);
  assert.equal(pw.available, false);

  // dialects are honest too
  const sqlite = caps.dialects.find((d) => d.dialect === 'sqlite');
  const postgres = caps.dialects.find((d) => d.dialect === 'postgres');
  const mysql = caps.dialects.find((d) => d.dialect === 'mysql');
  assert.equal(sqlite!.available, true);
  assert.equal(postgres!.available, false);
  assert.equal(mysql!.available, false);
  assert.ok(caps.generated_at);
});

test('executeService.runCase(): dispatches api engine to a REAL loopback call', async () => {
  const projectId = seedProject();
  const collectionId = seedCollection(projectId);
  const testCaseId = seedTestCase(projectId, 'api', 'TC-API-001');

  seedRequest({
    collectionId,
    projectId,
    testCaseId,
    name: 'CaseApiPass',
    method: 'POST',
    path: '/echo',
    body: JSON.stringify({ from: 'runCase' }),
    assertions: [
      { source: 'status', operator: 'equals', expected: 200 },
      { source: 'jsonpath', path: '$.data.id', operator: 'equals', expected: 42 },
      { source: 'jsonpath', path: '$.ok', operator: 'equals', expected: true },
    ],
  });

  const result = await executeService.runCase(testCaseId, {});
  assert.equal(result.engine, 'api');
  assert.equal(result.status, 'passed', result.error ?? '');
  assert.equal(result.assertions.length, 3);
  assert.equal(result.assertions.every((a) => a.passed), true);
});

test('executeService.runCase(): a failing case reports failed', async () => {
  const projectId = seedProject();
  const collectionId = seedCollection(projectId);
  const testCaseId = seedTestCase(projectId, 'api', 'TC-API-002');

  seedRequest({
    collectionId,
    projectId,
    testCaseId,
    name: 'CaseApiFail',
    method: 'GET',
    path: '/echo',
    assertions: [{ source: 'jsonpath', path: '$.token', operator: 'equals', expected: 'salah' }],
  });

  const result = await executeService.runCase(testCaseId, {});
  assert.equal(result.status, 'failed');
  assert.ok(result.error);
});

test('executeService.runCase(): manual engine returns not_run with an explanation', async () => {
  const projectId = seedProject();
  const testCaseId = seedTestCase(projectId, 'manual', 'TC-MAN-001');

  const result = await executeService.runCase(testCaseId, {});
  assert.equal(result.status, 'not_run');
  assert.equal(result.engine, 'manual');
  assert.equal(result.error, null);
  assert.match(result.logs.map((l) => l.message).join(' '), /manual/i);
  assert.ok((result.evidence as { instruction: string }).instruction);
});

test('executeService.runCase(): an api case with no linked request is reported, not crashed', async () => {
  const projectId = seedProject();
  const testCaseId = seedTestCase(projectId, 'api', 'TC-API-NOLINK');

  await assert.rejects(
    () => executeService.runCase(testCaseId, {}),
    (err: Error & { code?: string }) => {
      assert.equal(err.code, 'no_api_request');
      assert.match(err.message, /belum punya API request/i);
      return true;
    },
  );
});

test('executeService.runCase(): a db case runs a REAL sqlite check', async () => {
  const projectId = seedProject();
  const dbFile = makeScratchSqlite();
  const connectionId = seedDbConnection(projectId, dbFile, 1);
  const testCaseId = seedTestCase(projectId, 'db', 'TC-DB-001');

  seedDbCheck({
    id: 'dbc_case',
    projectId,
    connectionId,
    testCaseId,
    name: 'Case DB',
    sql: "SELECT * FROM orders WHERE status = 'paid'",
    assertions: [
      { source: 'row_count', operator: 'equals', expected: 3 },
      { source: 'column', path: 'customer', operator: 'equals', expected: 'Andi' },
    ],
  });

  const result = await executeService.runCase(testCaseId, {});
  assert.equal(result.engine, 'db');
  assert.equal(result.status, 'passed', result.error ?? '');
  assert.equal(result.assertions.length, 2);
});

test('executeService.runSuite(): creates a run, writes run_results and rolls up counters', async () => {
  const projectId = seedProject();
  const collectionId = seedCollection(projectId);
  const dbFile = makeScratchSqlite();
  const connectionId = seedDbConnection(projectId, dbFile, 1);

  // a passing API case
  const passCase = seedTestCase(projectId, 'api', 'TC-SUITE-PASS');
  seedRequest({
    collectionId,
    projectId,
    testCaseId: passCase,
    name: 'SuitePass',
    method: 'GET',
    path: '/echo',
    assertions: [{ source: 'status', operator: 'equals', expected: 200 }],
  });

  // a failing API case
  const failCase = seedTestCase(projectId, 'api', 'TC-SUITE-FAIL');
  seedRequest({
    collectionId,
    projectId,
    testCaseId: failCase,
    name: 'SuiteFail',
    method: 'GET',
    path: '/echo',
    assertions: [{ source: 'status', operator: 'equals', expected: 999 }],
  });

  // a passing DB case
  const dbCase = seedTestCase(projectId, 'db', 'TC-SUITE-DB');
  seedDbCheck({
    id: 'dbc_suite',
    projectId,
    connectionId,
    testCaseId: dbCase,
    name: 'Suite DB',
    sql: 'SELECT * FROM orders',
    assertions: [{ source: 'row_count', operator: 'equals', expected: 4 }],
  });

  // a manual case
  const manualCase = seedTestCase(projectId, 'manual', 'TC-SUITE-MAN');

  const suite = await executeService.runSuite([passCase, failCase, dbCase, manualCase], {
    executed_by: 'lane-c-test',
  });

  // --- SuiteResult shape exactly as frozen in contracts.ts ---
  assert.equal(typeof suite.run_id, 'string');
  assert.ok(suite.run_id.startsWith('run_'));
  assert.equal(suite.total, 4);
  assert.equal(suite.passed, 2, 'api pass + db pass');
  assert.equal(suite.failed, 1, 'the 999 status case');
  assert.equal(suite.skipped, 0);
  assert.equal(suite.blocked, 0);
  assert.equal(typeof suite.duration_ms, 'number');
  assert.ok(suite.duration_ms >= 0);
  assert.equal(suite.results.length, 4);

  for (const r of suite.results) {
    assert.equal(typeof r.test_case_id, 'string');
    assert.equal(typeof r.code, 'string');
    assert.equal(typeof r.title, 'string');
    assert.ok(['passed', 'failed', 'blocked', 'skipped', 'not_run'].includes(r.status));
    assert.equal(typeof r.duration_ms, 'number');
  }

  const byCode = Object.fromEntries(suite.results.map((r) => [r.code, r]));
  assert.equal(byCode['TC-SUITE-PASS']!.status, 'passed');
  assert.equal(byCode['TC-SUITE-FAIL']!.status, 'failed');
  assert.equal(byCode['TC-SUITE-DB']!.status, 'passed');
  assert.equal(byCode['TC-SUITE-MAN']!.status, 'not_run');
  assert.ok(byCode['TC-SUITE-FAIL']!.error);

  // --- test_runs row really persisted ---
  const run = db.prepare('SELECT * FROM test_runs WHERE id = ?').get(suite.run_id) as Record<string, unknown>;
  assert.ok(run, 'a test_runs row must exist for the suite');
  assert.equal(run.status, 'completed');
  assert.equal(run.total, 4);
  assert.equal(run.passed, 2);
  assert.equal(run.failed, 1);
  assert.ok(run.finished_at);
  assert.equal(run.project_id, projectId);

  // --- run_results rows really persisted, one per case ---
  const rows = db
    .prepare('SELECT * FROM run_results WHERE run_id = ? ORDER BY created_at ASC')
    .all(suite.run_id) as Array<Record<string, unknown>>;
  assert.equal(rows.length, 4);
  assert.ok(rows.every((r) => String(r.id).startsWith('res_')));
  assert.equal(rows.filter((r) => r.status === 'passed').length, 2);

  // evidence JSON is stored and parseable, including per-step logs
  const failRow = rows.find((r) => r.status === 'failed') as Record<string, unknown>;
  const evidence = JSON.parse(String(failRow.evidence)) as { logs?: unknown[]; assertions?: unknown[] };
  assert.ok(Array.isArray(evidence.logs));
  assert.ok(Array.isArray(evidence.assertions));
  assert.ok(failRow.actual_result);
  assert.ok(failRow.error_message);

  // executed_by is recorded
  assert.equal(rows[0]!.executed_by, 'lane-c-test');
  assert.ok(rows[0]!.executed_at);
});

test('executeService.runSuite(): opts.run_id appends into an existing run', async () => {
  const projectId = seedProject();
  const collectionId = seedCollection(projectId);

  const firstCase = seedTestCase(projectId, 'api', 'TC-APPEND-1');
  seedRequest({
    collectionId,
    projectId,
    testCaseId: firstCase,
    name: 'Append1',
    method: 'GET',
    path: '/echo',
    assertions: [{ source: 'status', operator: 'equals', expected: 200 }],
  });

  const secondCase = seedTestCase(projectId, 'api', 'TC-APPEND-2');
  seedRequest({
    collectionId,
    projectId,
    testCaseId: secondCase,
    name: 'Append2',
    method: 'GET',
    path: '/echo',
    assertions: [{ source: 'status', operator: 'equals', expected: 200 }],
  });

  const first = await executeService.runSuite([firstCase], {});
  assert.equal(first.total, 1);

  const second = await executeService.runSuite([secondCase], { run_id: first.run_id });
  assert.equal(second.run_id, first.run_id, 'the same run must be reused');

  // counters are recomputed across BOTH cases
  const run = db.prepare('SELECT * FROM test_runs WHERE id = ?').get(first.run_id) as Record<string, unknown>;
  assert.equal(run.total, 2);
  assert.equal(run.passed, 2);

  const rows = db.prepare('SELECT * FROM run_results WHERE run_id = ?').all(first.run_id);
  assert.equal(rows.length, 2);
});

test('executeService.runSuite(): dry-run validates without executing anything', async () => {
  const projectId = seedProject();
  const testCaseId = seedTestCase(projectId, 'api', 'TC-DRYRUN');
  const before = seen.length;

  const suite = await executeService.runSuite([testCaseId], { dry_run: true });

  assert.equal(seen.length, before, 'dry-run suite must not hit the target');
  assert.equal(suite.total, 1);
  assert.equal(suite.results.length, 1);
  // no run_results rows are written for a dry run
  const rows = db.prepare('SELECT * FROM run_results WHERE run_id = ?').all(suite.run_id);
  assert.equal(rows.length, 0);
});

test('executeService.runSuite(): rejects an empty list and unknown ids', async () => {
  await assert.rejects(() => executeService.runSuite([], {}), /kosong|minimal satu/i);
  await assert.rejects(
    () => executeService.runSuite(['tc_tidak_ada'], {}),
    (err: Error & { status?: number }) => {
      assert.equal(err.status, 404);
      return true;
    },
  );
});

test('executeService.impactRegression(): splits runnable from blocked cases', async () => {
  const projectId = seedProject();
  const collectionId = seedCollection(projectId);

  const linked = seedTestCase(projectId, 'api', 'TC-IMPACT-LINKED');
  seedRequest({
    collectionId,
    projectId,
    testCaseId: linked,
    name: 'ImpactLinked',
    method: 'GET',
    path: '/echo',
    assertions: [],
  });

  const unlinked = seedTestCase(projectId, 'api', 'TC-IMPACT-UNLINKED');
  const manual = seedTestCase(projectId, 'manual', 'TC-IMPACT-MANUAL');

  const report = await executeService.impactRegression([linked, unlinked, manual, 'tc_missing']);

  assert.equal(report.runnable.length, 2, JSON.stringify(report));
  assert.equal(report.blocked.length, 2);
  assert.ok(report.runnable.some((r) => r.code === 'TC-IMPACT-LINKED'));
  assert.ok(report.runnable.some((r) => r.code === 'TC-IMPACT-MANUAL'));
  assert.ok(report.blocked.some((b) => b.code === 'TC-IMPACT-UNLINKED'));
  assert.match(report.blocked.find((b) => b.code === 'TC-IMPACT-UNLINKED')!.reason, /tertaut/i);
});

/* ================================================================== *
 * 7. OpenAPI import
 * ================================================================== */

/* ================================================================== *
 * 7. ID prefixes (ARCHITECTURE.md §5.3, amended v1.1)
 * ================================================================== */

test('id prefixes: db_connections use dbcn_ and db_checks use dbc_', async () => {
  const projectId = seedProject();

  const { createConnection, createCheck } = await import('../src/modules/dbtester/repo.js');

  const connection = createConnection({
    project_id: projectId,
    name: 'Prefix Check Connection',
    dialect: 'sqlite',
    dsn: makeScratchSqlite(),
  });
  assert.ok(connection.id.startsWith('dbcn_'), `db_connections id must use dbcn_, got ${connection.id}`);

  const check = createCheck({
    project_id: projectId,
    connection_id: connection.id,
    name: 'Prefix Check',
    sql: 'SELECT 1 AS n',
    assertions: [],
  });
  assert.ok(check.id.startsWith('dbc_'), `db_checks id must use dbc_, got ${check.id}`);
  assert.equal(check.id.startsWith('dbcn_'), false);

  // api artifacts keep their documented prefixes too
  const { createCollection, createRequest } = await import('../src/modules/apitester/repo.js');
  const coll = createCollection({ project_id: projectId, name: 'Prefix Collection', base_url: baseUrl });
  const request = createRequest({
    collection_id: coll.id,
    project_id: projectId,
    name: 'Prefix Request',
    method: 'GET',
    path: '/echo',
  });
  assert.ok(request.id.startsWith('apr_'), `api_requests id must use apr_, got ${request.id}`);
});

test('openapi: parses an OpenAPI 3 document into operations with starter assertions', () => {  const doc = {
    openapi: '3.0.3',
    info: { title: 'Demo Shop API', version: '1.2.0' },
    servers: [{ url: baseUrl }],
    paths: {
      '/products': {
        get: {
          summary: 'Daftar produk',
          parameters: [
            { name: 'limit', in: 'query', schema: { type: 'integer', example: 10 } },
            { name: 'X-Tenant', in: 'header', schema: { type: 'string', example: 'demo' } },
          ],
          responses: { '200': { description: 'ok' } },
        },
        post: {
          operationId: 'createProduct',
          requestBody: {
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { name: { type: 'string' }, price: { type: 'number' } },
                },
              },
            },
          },
          responses: { '201': { description: 'created' } },
        },
      },
      '/orders/{id}': {
        get: { summary: 'Detail order', responses: { '200': { description: 'ok' } } },
      },
    },
  };

  const parsed = parseOpenApi(JSON.stringify(doc), null);

  assert.equal(parsed.title, 'Demo Shop API');
  assert.match(parsed.version, /openapi 3/);
  assert.equal(parsed.base_url, baseUrl);
  assert.equal(parsed.operations.length, 3);

  const list = parsed.operations.find((o) => o.method === 'GET' && o.path === '/products')!;
  assert.equal(list.name, 'Daftar produk');
  assert.equal(list.query.limit, '10');
  assert.equal(list.headers['X-Tenant'], 'demo');
  assert.equal(list.body_type, 'none');
  assert.equal(list.assertions.length, 2);
  assert.deepEqual(list.assertions[0], {
    source: 'status',
    operator: 'equals',
    expected: 200,
    message: 'HTTP 200 diharapkan',
  });

  const create = parsed.operations.find((o) => o.method === 'POST')!;
  assert.equal(create.name, 'createProduct');
  assert.equal(create.body_type, 'json');
  assert.equal(create.assertions[0]!.expected, 201);
  const body = JSON.parse(create.body as string) as Record<string, unknown>;
  assert.ok('name' in body && 'price' in body);
});

test('openapi: parses Swagger 2 and rejects garbage with a clear message', () => {
  const swagger = {
    swagger: '2.0',
    info: { title: 'Legacy API' },
    host: 'api.example.test',
    basePath: '/v1',
    schemes: ['https'],
    paths: {
      '/users': {
        post: {
          parameters: [
            { name: 'body', in: 'body', schema: { type: 'object', properties: { email: { type: 'string' } } } },
          ],
          responses: { '200': { description: 'ok' } },
        },
      },
    },
  };

  const parsed = parseOpenApi(JSON.stringify(swagger), null);
  assert.match(parsed.version, /swagger 2\.0/);
  assert.equal(parsed.base_url, 'https://api.example.test/v1');
  assert.equal(parsed.operations.length, 1);
  assert.equal(parsed.operations[0]!.body_type, 'json');

  assert.throws(() => parseOpenApi('bukan json sama sekali', null), /bukan JSON yang valid|JSON/i);
  assert.throws(() => parseOpenApi(JSON.stringify({ info: {} }), null), /paths|Tidak ada operasi/i);
  assert.throws(() => parseOpenApi(JSON.stringify({ paths: {} }), null), /Tidak ada operasi/i);
});

test('scripting: normalizeAssertions tolerates bad input', () => {
  assert.deepEqual(normalizeAssertions(null), []);
  assert.deepEqual(normalizeAssertions('bukan json'), []);
  assert.deepEqual(normalizeAssertions({ a: 1 }), []);
  assert.equal(normalizeAssertions([{ source: 'status', operator: 'equals', expected: 200 }]).length, 1);
  assert.equal(normalizeAssertions(JSON.stringify([{ source: 'status', operator: 'equals' }])).length, 1);
  // entries without source/operator are dropped
  assert.equal(normalizeAssertions([{ nope: true }, { source: 'status', operator: 'equals' }]).length, 1);
});

/* ================================================================== *
 * 8. End-to-end: the wired Fastify app (modules registered by the Lead)
 * ================================================================== */

test('e2e: GET /api/execute/capabilities over real HTTP reports all four engines registered', async () => {
  const { buildApp } = await import('../src/server.js');
  const app = await buildApp({ logger: false });
  await app.ready();

  const health = await app.inject({ method: 'GET', url: '/api/health' });
  assert.equal(health.statusCode, 200);
  const healthBody = health.json() as { modules: Array<{ name: string; ok: boolean; error?: string }> };

  for (const name of ['apitester', 'dbtester', 'webtester', 'execute']) {
    const mod = healthBody.modules.find((m) => m.name === name);
    assert.ok(mod, `module ${name} must be listed by /api/health`);
    assert.equal(mod.ok, true, `module ${name} failed to register: ${mod.error ?? ''}`);
  }

  const caps = await app.inject({ method: 'GET', url: '/api/execute/capabilities' });
  assert.equal(caps.statusCode, 200);
  const body = caps.json() as {
    data: {
      engines: Array<{ engine: string; available: boolean; mode: string; reason: string }>;
      dialects: Array<{ dialect: string; available: boolean }>;
      web_modes: Array<{ mode: string; available: boolean }>;
    };
  };

  assert.equal(body.data.engines.length, 5);
  const api = body.data.engines.find((e) => e.engine === 'api')!;
  assert.equal(api.available, true);
  assert.match(api.reason, /fetch/i);

  const web = body.data.engines.find((e) => e.engine === 'web')!;
  assert.equal(web.available, true);
  assert.equal(web.mode, 'http', 'playwright is not installed here, so the honest mode is http');

  // the capability payload must never claim playwright is live on this machine
  const pw = body.data.web_modes.find((m) => m.mode === 'playwright')!;
  assert.equal(pw.available, false);

  const sqlite = body.data.dialects.find((d) => d.dialect === 'sqlite')!;
  assert.equal(sqlite.available, true);
  const pg = body.data.dialects.find((d) => d.dialect === 'postgres')!;
  assert.equal(pg.available, false);

  await app.close();
});

test('e2e: POST /api/execute/suite runs a real suite over HTTP and returns SuiteResult', async () => {
  const projectId = seedProject();
  const collectionId = seedCollection(projectId);
  const passCase = seedTestCase(projectId, 'api', 'TC-E2E-PASS');
  seedRequest({
    collectionId,
    projectId,
    testCaseId: passCase,
    name: 'E2EPass',
    method: 'POST',
    path: '/login',
    body: JSON.stringify({ username: 'tester', password: 'x' }),
    assertions: [
      { source: 'status', operator: 'equals', expected: 200 },
      { source: 'jsonpath', path: '$.token', operator: 'equals', expected: 'jwt.token.value' },
    ],
  });

  const { buildApp } = await import('../src/server.js');
  const app = await buildApp({ logger: false });
  await app.ready();

  const res = await app.inject({
    method: 'POST',
    url: '/api/execute/suite',
    payload: { test_case_ids: [passCase], executed_by: 'e2e' },
  });

  assert.equal(res.statusCode, 200);
  const body = res.json() as { data: { run_id: string; total: number; passed: number; results: unknown[] } };
  assert.ok(body.data.run_id.startsWith('run_'));
  assert.equal(body.data.total, 1);
  assert.equal(body.data.passed, 1);
  assert.equal(body.data.results.length, 1);

  // invalid payloads are rejected with the frozen error envelope
  const bad = await app.inject({ method: 'POST', url: '/api/execute/suite', payload: { test_case_ids: [] } });
  assert.equal(bad.statusCode, 400);
  const badBody = bad.json() as { error: { code: string; message: string } };
  assert.equal(badBody.error.code, 'bad_request');

  // unknown test case -> 404 envelope
  const missing = await app.inject({
    method: 'POST',
    url: '/api/execute/suite',
    payload: { test_case_ids: ['tc_tidak_ada'] },
  });
  assert.equal(missing.statusCode, 404);
  assert.equal((missing.json() as { error: { code: string } }).error.code, 'not_found');

  await app.close();
});

test('e2e: readonly guard surfaces as HTTP 400 readonly_guard_violation', async () => {
  const projectId = seedProject();
  const dbFile = makeScratchSqlite();
  const connectionId = seedDbConnection(projectId, dbFile, 1);
  const checkId = seedDbCheck({
    id: 'dbc_http_guard',
    projectId,
    connectionId,
    name: 'Guard lewat HTTP',
    sql: 'DROP TABLE orders',
    assertions: [],
  });

  const { buildApp } = await import('../src/server.js');
  const app = await buildApp({ logger: false });
  await app.ready();

  const res = await app.inject({ method: 'POST', url: `/api/db-checks/${checkId}/run` });
  assert.equal(res.statusCode, 400);
  const body = res.json() as { error: { code: string; message: string; details?: unknown } };
  assert.equal(body.error.code, 'readonly_guard_violation');
  assert.match(body.error.message, /readonly guard/i);
  assert.ok(body.error.details);

  // the table must still exist
  const verify = new (sqliteModule as unknown as {
    DatabaseSync: new (p: string) => { prepare: (s: string) => { get: () => unknown }; close: () => void };
  }).DatabaseSync(dbFile);
  const row = verify.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'orders'").get() as { n: number };
  verify.close();
  assert.equal(row.n, 1);

  await app.close();
});

test('e2e: db-connections list never leaks the raw dsn', async () => {
  const projectId = seedProject();
  const dbFile = makeScratchSqlite();
  seedDbConnection(projectId, dbFile, 1);

  const { buildApp } = await import('../src/server.js');
  const app = await buildApp({ logger: false });
  await app.ready();

  const res = await app.inject({ method: 'GET', url: `/api/projects/${projectId}/db-connections` });
  assert.equal(res.statusCode, 200);
  const text = res.body;
  assert.equal(text.includes(dbFile), false, 'the raw dsn path must never appear in a list response');
  assert.equal(text.includes('"dsn"'), false, 'the "dsn" field must be absent from list responses');

  const body = res.json() as { data: Array<{ dsn_masked: string; id: string }>; total: number };
  assert.ok(body.total >= 1);
  assert.ok(body.data.some((c) => c.dsn_masked && c.dsn_masked.length > 0));

  await app.close();
});
