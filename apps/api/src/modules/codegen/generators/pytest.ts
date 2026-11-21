/**
 * pytest generator (Python + requests + sqlite3).
 *
 * Emits a runnable pytest project:
 *   tests/test_<collection>.py   API tests via `requests`
 *   tests/test_db_<check>.py     DB tests via sqlite3 / SQLAlchemy
 *   conftest.py                  fixtures + `--base-url` / `--api-token` options
 *   pytest.ini                   -v, junitxml, markers
 *   requirements.txt             pytest, requests, pytest-html, pytest-xdist, SQLAlchemy
 *
 * Every literal passes through `pyStr()`, so an expected value containing `'`, `\`
 * or a newline cannot break out of the generated Python source.
 */

import type { Assertion } from '@qatools/shared';
import { matcherFor, resolveApiAssertionJs, resolveDbAssertion } from '../assertions-map.js';
import { file, type GenerateContext, type GeneratedFile } from '../types.js';
import {
  commentLine,
  labelOf,
  numOf,
  pyStr,
  safeSegment,
  snakeCase,
  textOf,
} from '../util.js';
import { ancestryLine } from '../gather.js';

const REQUIREMENTS = [
  'pytest>=8.3.3',
  'requests>=2.32.3',
  'pytest-html>=4.1.1',
  'pytest-xdist>=3.6.1',
  'SQLAlchemy>=2.0.36',
  'python-dotenv>=1.0.1',
];

/* ------------------------------------------------------------------ *
 * assertion → python
 * ------------------------------------------------------------------ */

function pyLiteral(value: unknown): string {
  if (value === null || value === undefined) return 'None';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'None';
  if (typeof value === 'boolean') return value ? 'True' : 'False';
  if (Array.isArray(value)) return `[${value.map(pyLiteral).join(', ')}]`;
  if (typeof value === 'string') return pyStr(value);
  try {
    const json = JSON.stringify(value) ?? 'None';
    return json === 'null' ? 'None' : json.replace(/\btrue\b/g, 'True').replace(/\bfalse\b/g, 'False');
  } catch {
    return 'None';
  }
}

/**
 * One assertion → Python statements.
 * Returns `warning` instead of code when the DSL cannot be honoured here — an
 * assertion that silently passes is worse than an explicit gap.
 */
export function pytestAssertionLines(
  assertion: Assertion,
  subject: string,
  indent = '    ',
): { lines: string[]; warning?: string } {
  const m = matcherFor(assertion);
  const lines: string[] = [];
  const note = assertion.message ? `  # ${commentLine(assertion.message)}` : '';

  switch (m.kind) {
    case 'equal':
      lines.push(`${indent}assert ${subject} == ${pyLiteral(m.expected)}${note}`);
      break;
    case 'not_equal':
      lines.push(`${indent}assert ${subject} != ${pyLiteral(m.expected)}${note}`);
      break;
    case 'contains':
      lines.push(`${indent}assert ${pyStr(m.display)} in str(${subject})${note}`);
      break;
    case 'not_contains':
      lines.push(`${indent}assert ${pyStr(m.display)} not in str(${subject})${note}`);
      break;
    case 'gt':
      lines.push(`${indent}assert float(${subject}) > ${numOf(m.expected, 0)}${note}`);
      break;
    case 'gte':
      lines.push(`${indent}assert float(${subject}) >= ${numOf(m.expected, 0)}${note}`);
      break;
    case 'lt':
      lines.push(`${indent}assert float(${subject}) < ${numOf(m.expected, 0)}${note}`);
      break;
    case 'lte':
      lines.push(`${indent}assert float(${subject}) <= ${numOf(m.expected, 0)}${note}`);
      break;
    case 'exists':
      lines.push(`${indent}assert ${subject} is not None${note}`);
      break;
    case 'not_exists':
      lines.push(`${indent}assert ${subject} is None${note}`);
      break;
    case 'matches':
      lines.push(`${indent}assert re.search(${pyStr(m.regex ?? '')}, str(${subject}))${note}`);
      break;
    case 'in':
      lines.push(`${indent}assert ${subject} in ${pyLiteral(listFrom(m.expected))}${note}`);
      break;
    case 'length_gte':
      lines.push(`${indent}assert len(${subject}) >= ${numOf(m.expected, 0)}${note}`);
      break;
    case 'length_lte':
      lines.push(`${indent}assert len(${subject}) <= ${numOf(m.expected, 0)}${note}`);
      break;
    default:
      return { lines: [], warning: `Operator "${assertion.operator}" belum dipetakan ke pytest.` };
  }
  return { lines };
}

function listFrom(expected: unknown): unknown[] {
  if (Array.isArray(expected)) return expected;
  if (typeof expected === 'string') {
    return expected
      .replace(/^\[|\]$/g, '')
      .split(',')
      .map((s) => s.trim().replace(/^["']|["']$/g, ''))
      .filter(Boolean);
  }
  return expected === null || expected === undefined ? [] : [expected];
}

/* ------------------------------------------------------------------ *
 * conftest.py
 * ------------------------------------------------------------------ */

function dbFixture(ctx: GenerateContext): string {
  if (ctx.db_checks.length === 0) return '';
  return `

@pytest.fixture
def db_connection():
    """
    Koneksi database untuk DB check.

    Dialect yang didukung: sqlite (langsung via sqlite3), postgres/mysql (via
    SQLAlchemy). Isi QA_DB_URL sebelum menjalankan, mis.:
        sqlite:///./qatools-test.db
    """
    url = os.getenv("QA_DB_URL", ${pyStr(dbHint(ctx))})
    if not url:
        pytest.skip("QA_DB_URL belum diisi; DB test dilewati.")
    if url.startswith("sqlite"):
        import sqlite3

        path = url.split("///", 1)[-1] or ":memory:"
        connection = sqlite3.connect(path)
        try:
            yield connection
        finally:
            connection.close()
        return
    from sqlalchemy import create_engine

    engine = create_engine(url)
    connection = engine.connect()
    try:
        yield connection
    finally:
        connection.close()
        engine.dispose()
`;
}

function conftest(ctx: GenerateContext): string {
  const projectName = pyStr(ctx.project.name);
  return `"""
Fixture dan konfigurasi bersama — digenerate QATools untuk proyek ${projectName}.

Menjalankan:
    pytest -v
    pytest -v --base-url=https://staging.example.com
    pytest -v -n auto --html=report.html
"""

from __future__ import annotations

import json
import os
from typing import Any, Dict, Iterator, Optional

import pytest
import requests

DEFAULT_BASE_URL = os.getenv("QA_BASE_URL", ${pyStr(ctx.base_url)})
DEFAULT_TIMEOUT = float(os.getenv("QA_HTTP_TIMEOUT", "30"))
${ctx.db_checks.length > 0 ? 'DEFAULT_DB_URL = os.getenv("QA_DB_URL", "")\n' : ''}

def pytest_addoption(parser: pytest.Parser) -> None:
    """Opsi CLI supaya base URL tidak perlu diubah di dalam kode."""
    parser.addoption(
        "--base-url",
        action="store",
        default=DEFAULT_BASE_URL,
        help="Base URL target pengujian (default: %(default)s)",
    )
    parser.addoption(
        "--api-token",
        action="store",
        default=os.getenv("QA_API_TOKEN", ""),
        help="Bearer token untuk endpoint yang butuh autentikasi.",
    )
    parser.addoption(
        "--timeout",
        action="store",
        type=float,
        default=DEFAULT_TIMEOUT,
        help="Timeout HTTP dalam detik (default: %(default)s)",
    )


@pytest.fixture(scope="session")
def base_url(request: pytest.FixtureRequest) -> str:
    return str(request.config.getoption("--base-url")).rstrip("/")


@pytest.fixture(scope="session")
def api_token(request: pytest.FixtureRequest) -> str:
    return str(request.config.getoption("--api-token"))


@pytest.fixture(scope="session")
def http_timeout(request: pytest.FixtureRequest) -> float:
    return float(request.config.getoption("--timeout"))


@pytest.fixture(scope="session")
def api_session(api_token: str) -> Iterator[requests.Session]:
    """Sesi requests dengan header JSON; otomatis ditutup setelah suite selesai."""
    session = requests.Session()
    session.headers.update({
        "Accept": "application/json",
        "Content-Type": "application/json",
    })
    if api_token:
        session.headers["Authorization"] = f"Bearer {api_token}"
    yield session
    session.close()


@pytest.fixture
def api(
    api_session: requests.Session,
    base_url: str,
    http_timeout: float,
):
    """Pemanggil HTTP dengan base URL otomatis dan timeout aman."""

    def _call(
        method: str,
        path: str,
        *,
        params: Optional[Dict[str, Any]] = None,
        json_body: Any = None,
        data: Any = None,
        headers: Optional[Dict[str, str]] = None,
        expected_status: Optional[int] = None,
    ) -> requests.Response:
        url = path if path.startswith("http") else f"{base_url}/{path.lstrip('/')}"
        response = api_session.request(
            method.upper(),
            url,
            params=params,
            json=json_body,
            data=data,
            headers=headers,
            timeout=http_timeout,
        )
        if expected_status is not None:
            assert response.status_code == expected_status, (
                f"{method.upper()} {url} -> {response.status_code} "
                f"(diharapkan {expected_status}): {response.text[:400]}"
            )
        return response

    return _call


def parse_json(text: str) -> Any:
    """JSON.parse yang tidak melempar — assertion tetap memberi pesan jelas."""
    try:
        return json.loads(text)
    except (ValueError, TypeError):
        return None


def dig(document: Any, path: str) -> Any:
    """Ambil nilai dengan JSONPath sederhana: $.data.items[0].id"""
    if not path:
        return document
    cleaned = path.lstrip("$").lstrip(".")
    current = document
    for raw_part in cleaned.replace("[", ".").replace("]", "").split("."):
        part = raw_part.strip()
        if part == "":
            continue
        if isinstance(current, list):
            if not part.isdigit():
                return None
            index = int(part)
            if index >= len(current):
                return None
            current = current[index]
            continue
        if not isinstance(current, dict):
            return None
        current = current.get(part)
    return current
${dbFixture(ctx)}`;
}

function dbHint(ctx: GenerateContext): string {
  const first = ctx.db_checks[0];
  if (!first) return '';
  if (first.dialect === 'sqlite') return 'sqlite:///./qatools-test.db';
  if (first.dialect === 'postgres') return 'postgresql+psycopg://qa:qa@localhost:5432/qa';
  return 'mysql+pymysql://qa:qa@localhost:3306/qa';
}

/* ------------------------------------------------------------------ *
 * API test files
 * ------------------------------------------------------------------ */

function apiTestModule(ctx: GenerateContext, collectionName: string, requestsOfCollection: typeof ctx.requests): string {
  const moduleName = snakeCase(collectionName, 'collection');
  const lines: string[] = [];

  lines.push(`"""`);
  lines.push(`Test API untuk collection "${commentLine(collectionName)}" — digenerate QATools.`);
  lines.push('');
  lines.push('Menjalankan: pytest -v tests/' + `test_${safeSegment(moduleName)}.py`);
  lines.push(`"""`);
  lines.push('');
  lines.push('from __future__ import annotations');
  lines.push('');
  lines.push('import re');
  lines.push('');
  lines.push('import pytest');
  lines.push('');
  lines.push('from conftest import dig, parse_json');
  lines.push('');

  const usedNames = new Set<string>();
  for (const r of requestsOfCollection) {
    const base = r.test_case_code
      ? snakeCase(`${r.test_case_code} ${textOf(r.test_case_title, r.request.name)}`, 'test_api')
      : snakeCase(`${textOf(r.request.method, 'get')} ${textOf(r.request.path, 'root')} ${textOf(r.request.name, '')}`, 'test_api');
    let fn = base.startsWith('test_') ? base : `test_${base}`;
    let n = 2;
    while (usedNames.has(fn)) fn = `${base}_${n++}`;
    usedNames.add(fn);

    const title = r.test_case_code
      ? `${r.test_case_code} — ${labelOf(r.test_case_title, r.request.name)}`
      : `${r.request.method} ${textOf(r.request.path, '/')} — ${labelOf(r.request.name)}`;

    lines.push('');
    lines.push('');
    lines.push(`def ${fn}(api) -> None:`);
    lines.push(`    """${commentLine(title)}"""`);
    if (r.test_case_title) lines.push(`    # Collection: ${commentLine(r.collection_name)}`);

    const headers = { ...r.headers };
    const useToken = r.auth.type === 'bearer' && Boolean(r.auth.token);
    const useApiKey = r.auth.type === 'api_key' && Boolean(r.auth.header);
    const useBasic = r.auth.type === 'basic' && Boolean(r.auth.username);
    if (useApiKey && r.auth.header) headers[r.auth.header] = textOf(r.auth.value, '');
    if (useBasic && r.auth.username) {
      headers.Authorization = `Basic ${Buffer.from(`${r.auth.username}:${r.auth.password ?? ''}`).toString('base64')}`;
    }
    if (useToken) headers.Authorization = 'Bearer ${api_token}';

    if (Object.keys(headers).length) {
      lines.push(`    headers = ${pyDict(headers)}`);
      if (useToken) lines.push('    # Ganti placeholder token dengan --api-token=<token> bila diperlukan.');
    } else {
      lines.push('    headers = None');
    }

    const bodyLines: string[] = [];
    const method = textOf(r.request.method, 'GET').toUpperCase();
    const path = textOf(r.request.path, '/');
    if (r.query && Object.keys(r.query).length) {
      bodyLines.push(`        params=${pyDict(r.query)},`);
    }
    const bodyText = textOf(r.request.body, '');
    if (bodyText) {
      if (r.request.body_type === 'json') {
        try {
          const parsed = JSON.parse(bodyText) as unknown;
          bodyLines.push(`        json_body=${pyLiteral(parsed)},`);
        } catch {
          bodyLines.push(`        data=${pyStr(bodyText)},`);
          ctx.warnings.push(
            `pytest: body request "${labelOf(r.request.name)}" diberi tipe JSON tetapi bukan JSON valid; dikirim sebagai string.`,
          );
        }
      } else if (r.request.body_type === 'form') {
        bodyLines.push(`        data=${pyDict(parseFormBody(bodyText))},`);
      } else {
        bodyLines.push(`        data=${pyStr(bodyText)},`);
      }
    }

    const expectedStatus = detectStatus(r.assertions);
    lines.push(`    response = api(`);
    lines.push(`        ${pyStr(method)},`);
    lines.push(`        ${pyStr(path)},`);
    if (Object.keys(headers).length) lines.push('        headers=headers,');
    for (const l of bodyLines) lines.push(l);
    lines.push(`        expected_status=${expectedStatus === null ? 'None' : expectedStatus},`);
    lines.push('    )');
    lines.push('');
    lines.push('    payload = parse_json(response.text)');
    lines.push('');

    let emitted = 0;
    for (const a of r.assertions) {
      const resolved = resolveApiAssertionJs(a, {
        response: 'response',
        status: 'response.status_code',
        duration: 'response.elapsed.total_seconds() * 1000',
        header: (name) => `response.headers.get(${pyStr(name)}, "")`,
        json: (p) => `dig(payload, ${pyStr(p)})`,
        text: 'response.text',
      });
      if (!resolved) {
        ctx.warnings.push(
          `pytest: assertion source "${a.source}" pada request "${labelOf(r.request.name)}" tidak didukung (hanya API source).`,
        );
        continue;
      }
      const rendered = pytestAssertionLines(a, resolved.subject);
      if (rendered.warning) {
        ctx.warnings.push(`pytest: ${rendered.warning}`);
        continue;
      }
      lines.push(`    # ${commentLine(`${resolved.label} ${a.operator}`)}`);
      lines.push(...rendered.lines);
      emitted += 1;
    }

    if (!emitted) {
      lines.push(`    # Tidak ada assertion eksplisit; minimal pastikan endpoint menjawab 2xx.`);
      lines.push('    assert response.status_code < 400, response.text[:400]');
    }
    void moduleName;
  }

  if (!requestsOfCollection.length) {
    lines.push('');
    lines.push('');
    lines.push('def test_placeholder() -> None:');
    lines.push('    """Collection ini belum memiliki request di QATools."""');
    lines.push('    pytest.skip("Belum ada API request pada collection ini.")');
  }

  void ancestryLine;
  return `${lines.join('\n')}\n`;
}

function pyDict(record: Record<string, string>): string {
  const entries = Object.entries(record);
  if (!entries.length) return '{}';
  return `{\n${entries.map(([k, v]) => `        ${pyStr(k)}: ${pyStr(v)},`).join('\n')}\n    }`;
}

function parseFormBody(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of body.split('&')) {
    const [k, v = ''] = pair.split('=');
    if (!k) continue;
    out[decodeURIComponent(k.trim())] = decodeURIComponent(v.trim());
  }
  return out;
}

function detectStatus(assertions: Assertion[]): number | null {
  for (const a of assertions) {
    if (a.source !== 'status') continue;
    if (a.operator === 'equals') {
      const n = numOf(a.expected, NaN);
      if (Number.isFinite(n)) return Math.trunc(n);
    }
    if (a.operator === 'in') {
      const list = listFrom(a.expected);
      const n = numOf(list[0], NaN);
      if (Number.isFinite(n)) return Math.trunc(n);
    }
    if (a.operator === 'lt' || a.operator === 'lte') return null; // 2xx-range check stays explicit
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * DB test files
 * ------------------------------------------------------------------ */

function dbTestModule(ctx: GenerateContext, check: (typeof ctx.db_checks)[number]): string {
  const fnBase = snakeCase(`check ${check.check.name}`, 'check');
  const fn = fnBase.startsWith('test_') ? fnBase : `test_${fnBase}`;
  const lines: string[] = [];

  lines.push('"""');
  lines.push(`DB check "${commentLine(check.check.name)}" — digenerate QATools.`);
  lines.push(`Koneksi: ${commentLine(check.connection_name)} (dialect: ${check.dialect}).`);
  lines.push('');
  lines.push('Isi variabel lingkungan QA_DB_URL sebelum menjalankan, mis.:');
  lines.push('    $env:QA_DB_URL = "sqlite:///./qatools-test.db"');
  lines.push('"""');
  lines.push('');
  lines.push('from __future__ import annotations');
  lines.push('');
  lines.push('import re');
  lines.push('');
  lines.push('import pytest');
  lines.push('');
  lines.push('');
  lines.push(`def ${fn}(db_connection) -> None:`);
  lines.push(`    """${commentLine(labelOf(check.test_case_title, check.check.name))}"""`);
  if (check.test_case_code) lines.push(`    # Test case: ${commentLine(check.test_case_code)}`);

  const sql = textOf(check.check.sql, 'SELECT 1;');
  const setupSql = textOf(check.check.setup_sql, '');
  const teardownSql = textOf(check.check.teardown_sql, '');

  if (setupSql) {
    lines.push('    # Setup SQL dari QATools — jalankan sebelum query utama.');
    lines.push(`    db_connection.exec_driver_sql(${pySql(setupSql)})`);
  }

  lines.push(`    sql = ${pySql(sql)}`);
  lines.push('    result = db_connection.exec_driver_sql(sql)');
  lines.push('    rows = result.fetchall()');
  lines.push('    columns = [c[0] for c in (result.cursor.description if result.cursor and result.cursor.description else [])]');
  lines.push('    row = dict(zip(columns, rows[0])) if rows else {}');
  lines.push('');

  let emitted = 0;
  for (const a of check.assertions) {
    const resolved = resolveDbAssertion(a, {
      rows: 'rows',
      rowCount: 'len(rows)',
      row: 'row',
    });
    if (!resolved) {
      ctx.warnings.push(
        `pytest: assertion "${a.source}" pada DB check "${labelOf(check.check.name)}" tidak bisa dipetakan (hanya row_count/column/jsonpath).`,
      );
      continue;
    }
    const rendered = pytestAssertionLines(a, resolved.subject);
    if (rendered.warning) {
      ctx.warnings.push(`pytest: ${rendered.warning}`);
      continue;
    }
    lines.push(`    # ${commentLine(`${resolved.label} ${a.operator}`)}`);
    lines.push(...rendered.lines);
    emitted += 1;
  }

  if (!emitted) {
    lines.push('    # Tidak ada assertion eksplisit pada DB check ini.');
    lines.push('    assert isinstance(rows, list), "Query harus mengembalikan result set."');
  }

  if (teardownSql) {
    lines.push('');
    lines.push('    # Teardown SQL dari QATools.');
    lines.push(`    db_connection.exec_driver_sql(${pySql(teardownSql)})`);
  }

  void ctx;
  return `${lines.join('\n')}\n`;
}

/** SQL as a Python triple-quoted string; `"""` inside SQL cannot terminate it. */
function pySql(sql: string): string {
  const cleaned = textOf(sql, 'SELECT 1;').replace(/\\/g, '\\\\').replace(/"""/g, '\\"\\"\\"');
  return `"""${cleaned}"""`;
}

/* ------------------------------------------------------------------ *
 * manifests
 * ------------------------------------------------------------------ */

function pytestIni(ctx: GenerateContext): string {
  return `[pytest]
testpaths = tests
python_files = test_*.py
python_functions = test_*
addopts = -ra -q --strict-markers --junitxml=reports/junit.xml
markers =
    api: test API
    db: test database
    smoke: jalur kritis
    regression: suite regresi
    qatools: digenerate oleh QATools (proyek ${ctx.project.key})
filterwarnings =
    ignore::DeprecationWarning
`;
}

/* ------------------------------------------------------------------ *
 * Entry point
 * ------------------------------------------------------------------ */

export function generate(ctx: GenerateContext): GeneratedFile[] {
  const files: GeneratedFile[] = [];

  files.push(
    file('conftest.py', 'python', 'Fixture bersama: sesi HTTP, opsi --base-url/--api-token, koneksi DB, helper dig().', conftest(ctx)),
  );
  files.push(
    file('pytest.ini', 'yaml', 'Konfigurasi pytest: testpaths, marker, dan laporan JUnit XML.', pytestIni(ctx)),
  );
  files.push(
    file('requirements.txt', 'yaml', 'Dependensi Python: pytest, requests, pytest-html, pytest-xdist, SQLAlchemy.', `${REQUIREMENTS.join('\n')}\n`),
  );

  // Group API requests by collection so file names shadow the QATools UI structure.
  if (ctx.layers.includes('api')) {
    const byCollection = new Map<string, typeof ctx.requests>();
    for (const r of ctx.requests) {
      const list = byCollection.get(r.collection_name) ?? [];
      list.push(r);
      byCollection.set(r.collection_name, list);
    }
    if (!byCollection.size) byCollection.set('api', []);

    for (const [collectionName, list] of byCollection) {
      const moduleName = safeSegment(snakeCase(collectionName, 'api'));
      files.push(
        file(
          `tests/test_${moduleName}.py`,
          'python',
          `Test API untuk collection "${collectionName}" (${list.length} request).`,
          apiTestModule(ctx, collectionName, list),
        ),
      );
    }
  }

  if (ctx.layers.includes('db')) {
    if (ctx.db_checks.length) {
      for (const check of ctx.db_checks) {
        const moduleName = safeSegment(snakeCase(check.check.name, 'check'));
        files.push(
          file(
            `tests/test_db_${moduleName}.py`,
            'python',
            `DB check "${check.check.name}" pada koneksi ${check.connection_name}.`,
            dbTestModule(ctx, check),
          ),
        );
      }
    } else {
      files.push(
        file(
          'tests/test_db_placeholder.py',
          'python',
          'Placeholder DB: proyek belum punya DB check.',
          `"""Placeholder DB — proyek ini belum punya DB check di QATools."""

from __future__ import annotations

import pytest

from conftest import dig, parse_json  # noqa: F401  (dipakai begitu check ditambahkan)


def test_db_placeholder() -> None:
    pytest.skip("Belum ada DB check di QATools; tambahkan di menu Database Testing.")
`,
        ),
      );
    }
  }

  if (!files.some((f) => f.path.startsWith('tests/test_'))) {
    files.push(
      file(
        'tests/test_smoke.py',
        'python',
        'Smoke test minimal agar pytest selalu punya sesuatu untuk dijalankan.',
        `"""Smoke test placeholder — digenerate QATools."""

from __future__ import annotations


def test_project_metadata() -> None:
    """Memastikan proyek automation bisa dijalankan sebelum test asli ditambahkan."""
    assert ${ctx.project.key ? pyStr(ctx.project.key) : "'PRJ'"}.strip() != ""
`,
      ),
    );
  }

  return files;
}
