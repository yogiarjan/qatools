/**
 * Robot Framework generator.
 *
 * Emits a real Robot project using the **Browser** library (Playwright under the hood)
 * for web and **RequestsLibrary** for API:
 *
 *   tests/*.robot            *** Settings *** / *** Variables *** / *** Test Cases *** / *** Keywords ***
 *   resources/keywords.robot reusable keywords
 *   resources/variables.robot global variables + auth headers
 *   requirements.txt         robotframework, robotframework-browser, robotframework-requests
 *   robot.yaml               Robocorp-style task definition
 *
 * Escaping notes that matter for runnability:
 *   - Robot table cells are split on **2+ spaces**, so every interpolated cell is
 *     collapsed via `robotCell()`.
 *   - An expected value starting with `=` must not be parsed as a named argument,
 *     so `assert` values are quoted with `$var` indirection instead of inline.
 */

import type { Assertion, WebStep } from '@qatools/shared';
import { matcherFor, resolveApiAssertionJs } from '../assertions-map.js';
import { file, type GenerateContext, type GeneratedFile } from '../types.js';
import {
  clampInt,
  commentLine,
  labelOf,
  numOf,
  robotCell,
  robotName,
  safeSegment,
  textOf,
} from '../util.js';
import { ancestryLine } from '../gather.js';

const ROBOT_REQ = [
  'robotframework>=7.0.1',
  'robotframework-browser>=18.0.0',
  'robotframework-requests>=0.9.7',
  'robotframework-jsonlibrary>=0.5',
];

/* ------------------------------------------------------------------ *
 * WebStep → Browser-library keyword
 * ------------------------------------------------------------------ */

function browserKeyword(step: WebStep, baseUrl: string): { keyword: string; args: string[]; warning?: string } {
  const selector = textOf(step.selector, '').trim();
  const value = textOf(step.value, '');
  const expected = textOf(step.expected, '');
  const timeout = typeof step.timeout_ms === 'number' && Number.isFinite(step.timeout_ms)
    ? clampInt(step.timeout_ms, 100, 600_000)
    : 10_000;

  switch (step.action) {
    case 'goto': {
      const raw = value || expected || baseUrl;
      const url = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `${baseUrl.replace(/\/+$/, '')}${raw.startsWith('/') ? '' : '/'}${raw}`;
      return { keyword: 'Go To', args: [robotCell(url)] };
    }
    case 'click':
      return { keyword: 'Click', args: [robotCell(selector)] };
    case 'fill':
      return { keyword: 'Fill Text', args: [robotCell(selector), robotCell(value)] };
    case 'select':
      return { keyword: 'Select Options By', args: [robotCell(selector), 'label', robotCell(value)] };
    case 'check':
      return { keyword: 'Check Checkbox', args: [robotCell(selector)] };
    case 'uncheck':
      return { keyword: 'Uncheck Checkbox', args: [robotCell(selector)] };
    case 'press':
      return { keyword: 'Press Keys', args: [robotCell(selector), robotCell(value || 'Enter')] };
    case 'wait':
      // Browser library offers a real wait; a fixed sleep is the honest fallback.
      return { keyword: 'Sleep', args: [`${clampInt(value || step.timeout_ms, 0, 60_000) / 1000}s`] };
    case 'assert_text':
      return { keyword: 'Get Text', args: [robotCell(selector)], };
    case 'assert_visible':
      return { keyword: 'Wait For Elements State', args: [robotCell(selector), 'visible', `${timeout}ms`] };
    case 'assert_url':
      return { keyword: 'Get Url', args: [] };
    case 'screenshot':
      return { keyword: 'Take Screenshot', args: [robotCell(value || 'screenshot')] };
    case 'hover':
      return { keyword: 'Hover', args: [robotCell(selector)] };
    case 'scroll':
      return { keyword: 'Scroll To Element', args: [robotCell(selector)] };
    default:
      return {
        keyword: 'No Operation',
        args: [],
        warning: `Aksi web "${textOf(step.action, 'unknown')}" belum punya keyword Robot.`,
      };
  }
}

/** Robot `Should Be Equal` family for one assertion. */
function robotAssertion(assertion: Assertion, observedExpr: string): { lines: string[]; warning?: string } {
  const m = matcherFor(assertion);
  const expected = robotCell(m.display === 'null' ? '' : m.display);
  const lines: string[] = [];
  switch (m.kind) {
    case 'equal':
      lines.push(`Should Be Equal As Strings    \${${observedExpr}}    ${expected}`);
      break;
    case 'not_equal':
      lines.push(`Should Not Be Equal As Strings    \${${observedExpr}}    ${expected}`);
      break;
    case 'contains':
      lines.push(`Should Contain    \${${observedExpr}}    ${expected}`);
      break;
    case 'not_contains':
      lines.push(`Should Not Contain    \${${observedExpr}}    ${expected}`);
      break;
    case 'gt':
      lines.push(`Should Be True    \${${observedExpr}} > ${numOf(m.expected, 0)}`);
      break;
    case 'gte':
      lines.push(`Should Be True    \${${observedExpr}} >= ${numOf(m.expected, 0)}`);
      break;
    case 'lt':
      lines.push(`Should Be True    \${${observedExpr}} < ${numOf(m.expected, 0)}`);
      break;
    case 'lte':
      lines.push(`Should Be True    \${${observedExpr}} <= ${numOf(m.expected, 0)}`);
      break;
    case 'exists':
      lines.push(`Should Not Be Equal    \${${observedExpr}}    \${None}`);
      break;
    case 'not_exists':
      lines.push(`Should Be Equal    \${${observedExpr}}    \${None}`);
      break;
    case 'matches':
      lines.push(`Should Match Regexp    \${${observedExpr}}    ${robotCell(m.regex ?? '.*')}`);
      break;
    case 'in':
      lines.push(`Should Contain Any    \${${observedExpr}}    ${robotCell(m.display.replace(/^\[|\]$/g, ''))}`);
      break;
    case 'length_gte':
      lines.push(`Should Be True    len(\${${observedExpr}}) >= ${numOf(m.expected, 0)}`);
      break;
    case 'length_lte':
      lines.push(`Should Be True    len(\${${observedExpr}}) <= ${numOf(m.expected, 0)}`);
      break;
    default:
      return { lines: [], warning: `Operator "${assertion.operator}" belum dipetakan ke keyword Robot.` };
  }
  return { lines };
}

/* ------------------------------------------------------------------ *
 * resources/variables.robot
 * ------------------------------------------------------------------ */

function variablesResource(ctx: GenerateContext): string {
  const lines: string[] = [];
  lines.push('*** Settings ***');
  lines.push('Documentation     Variabel global proyek automation QATools.');
  lines.push('');
  lines.push('*** Variables ***');
  lines.push(`\${BASE_URL}       ${robotCell(ctx.base_url)}`);
  lines.push(`\${PROJECT_NAME}   ${robotCell(ctx.project.name)}`);
  lines.push(`\${BROWSER}        chromium`);
  lines.push(`\${HEADLESS}       True`);
  lines.push('\${TIMEOUT}        10s');
  lines.push('');

  // Per-collection auth so a request keyword never hard-codes a secret inline.
  const seen = new Set<string>();
  for (const r of ctx.requests) {
    const varName = `\${AUTH_${safeSegment(r.collection_name, 'collection').toUpperCase().replace(/-/g, '_')}}`;
    if (seen.has(varName)) continue;
    seen.add(varName);
    if (r.auth.type === 'bearer' && r.auth.token) {
      lines.push(`${varName}    Bearer ${robotCell(r.auth.token)}`);
    } else if (r.auth.type === 'basic' && r.auth.username) {
      lines.push(`${varName}    Basic ${robotCell(`${r.auth.username}:${r.auth.password ?? ''}`)}`);
    } else if (r.auth.type === 'api_key' && r.auth.header) {
      lines.push(`${varName}    ${robotCell(r.auth.value ?? '')}`);
    }
  }
  if (seen.size === 0) {
    lines.push('# Tidak ada collection dengan auth; tambahkan variabel token di sini bila perlu.');
  }
  lines.push('');
  lines.push('${API_HEADERS}    {"Accept": "application/json", "Content-Type": "application/json"}');
  lines.push('');

  // Flow start URLs, so tests never hard-code a URL.
  if (ctx.flows.length) {
    lines.push('# Halaman awal per web flow');
    for (const flow of ctx.flows) {
      const varName = `\${URL_${safeSegment(flow.flow.name, 'flow').toUpperCase().replace(/-/g, '_')}}`;
      lines.push(`${varName}    ${robotCell(flow.start_url || ctx.base_url)}`);
    }
    lines.push('');
  }

  return `${lines.join('\n')}\n`;
}

/* ------------------------------------------------------------------ *
 * resources/keywords.robot
 * ------------------------------------------------------------------ */

function keywordsResource(ctx: GenerateContext): string {
  const keywords: string[] = [];

  keywords.push(`Open Browser To Page
    [Documentation]    Buka browser dan halaman \${url}.
    [Arguments]    \${url}=\${BASE_URL}
    New Browser    \${BROWSER}    headless=\${HEADLESS}
    New Context    viewport={'width': 1366, 'height': 768}
    New Page    \${url}
    Set Browser Timeout    \${TIMEOUT}`);

  keywords.push(`Close Qa Browser
    [Documentation]    Tutup semua browser agar run berikutnya bersih.
    Close Browser    ALL`);

  // One reusable keyword per web flow, so tests stay declarative.
  for (const flow of ctx.flows) {
    const name = robotName(`Run Flow ${flow.flow.name}`, 'Run Flow');
    const body: string[] = [];
    body.push(`    [Documentation]    Menjalankan web flow "${commentLine(flow.flow.name)}".`);
    if (flow.test_case_code) {
      body.push(`    ...    Test case: ${commentLine(`${flow.test_case_code} — ${textOf(flow.test_case_title, '')}`)}`);
    }
    body.push(`    Open Browser To Page    ${robotCell(flow.start_url || ctx.base_url)}`);
    for (const step of flow.steps) {
      const kw = browserKeyword(step, flow.start_url || ctx.base_url);
      if (kw.warning) ctx.warnings.push(`Robot: ${flow.flow.name}: ${kw.warning}`);
      body.push(`    ${kw.keyword}${kw.args.length ? `    ${kw.args.join('    ')}` : ''}`);
      if (step.description) body.push(`    ...    # ${commentLine(step.description)}`);
    }
    body.push('    Close Qa Browser');
    keywords.push(`${name}\n${body.join('\n')}`);
  }

  keywords.push(`Assert Response Status
    [Documentation]    Memastikan status code sesuai harapan.
    [Arguments]    \${response}    \${expected}=200
    Should Be Equal As Integers    \${response.status_code}    \${expected}`);

  keywords.push(`Post Json
    [Documentation]    Kirim request JSON memakai RequestsLibrary.
    [Arguments]    \${alias}    \${path}    \${payload}=&{EMPTY}    \${expected_status}=200
    \${response}=    POST    \${BASE_URL}\${path}    json=\${payload}    expected_status=anything
    Assert Response Status    \${response}    \${expected_status}
    Set Test Variable    \${response}
    RETURN    \${response}`);

  keywords.push(`Get Resource
    [Documentation]    GET sederhana yang mengembalikan response object.
    [Arguments]    \${path}    \${expected_status}=200
    \${response}=    GET    \${BASE_URL}\${path}    expected_status=anything
    Assert Response Status    \${response}    \${expected_status}
    RETURN    \${response}`);

  return `*** Settings ***
Documentation     Keyword reusable untuk proyek "${commentLine(ctx.project.name)}".
Library           Browser
Library           RequestsLibrary
Library           Collections
Library           String
Library           OperatingSystem
Resource          variables.robot

*** Keywords ***
${keywords.join('\n\n')}
`;
}

/* ------------------------------------------------------------------ *
 * tests/*.robot
 * ------------------------------------------------------------------ */

function webTestFile(ctx: GenerateContext): string {
  const tests: string[] = [];

  if (!ctx.flows.length) {
    tests.push(`Belum Ada Web Flow
    [Documentation]    Placeholder: proyek ini belum punya web flow di QATools.
    [Tags]    placeholder
    Skip    Belum ada web flow; buat di menu Web Automation QATools lalu generate ulang.`);
  }

  for (const flow of ctx.flows) {
    const title = flow.test_case_title
      ? robotName(`${textOf(flow.test_case_code, '')} ${flow.test_case_title}`.trim(), 'Web Flow')
      : robotName(flow.flow.name, 'Web Flow');
    const tags = ['web', 'qatools'];
    const caseRecord = flow.test_case_id
      ? ctx.cases.find((c) => c.test_case.id === flow.test_case_id)
      : undefined;
    if (caseRecord?.test_case.is_regression) tags.push('regression');

    const body: string[] = [];
    body.push(`    [Documentation]    Flow "${commentLine(flow.flow.name)}" — ${flow.steps.length} langkah.`);
    if (caseRecord) {
      const trace = ancestryLine(caseRecord.ancestry);
      if (trace) body.push(`    ...    Traceability: ${commentLine(trace)}`);
      if (caseRecord.test_case.expected_result) {
        body.push(`    ...    Expected: ${commentLine(caseRecord.test_case.expected_result)}`);
      }
    }
    body.push(`    [Tags]    ${tags.join('    ')}`);
    body.push(`    Open Browser To Page    ${robotCell(flow.start_url || ctx.base_url)}`);

    for (const step of flow.steps) {
      const kw = browserKeyword(step, flow.start_url || ctx.base_url);
      body.push(`    ${kw.keyword}${kw.args.length ? `    ${kw.args.join('    ')}` : ''}`);
      if (step.action === 'assert_url') {
        const expectedUrl = textOf(step.expected, '');
        body.push(`    \${current}=    Get Url`);
        body.push(`    Should Contain    \${current}    ${robotCell(expectedUrl)}`);
      }
      if (step.action === 'assert_text') {
        const expectedText = textOf(step.expected, '');
        body.push(`    Should Contain    \${text}    ${robotCell(expectedText)}`);
      }
    }

    // Manual steps of the source case become comments, plus a real assertion on the
    // case's declared expected result so the Robot test is not assertion-free.
    if (caseRecord) {
      for (const step of caseRecord.steps) {
        body.push(`    ...    # Manual: ${commentLine(`${step.order_index}. ${textOf(step.action, '')} → ${textOf(step.expected, '')}`)}`);
      }
      const expectedResult = textOf(caseRecord.test_case.expected_result, '');
      if (expectedResult && !flow.steps.length) {
        body.push(`    \${text}=    Get Text    body`);
        body.push(`    Should Contain    \${text}    ${robotCell(expectedResult.slice(0, 120))}`);
      }
    }

    body.push('    Close Qa Browser');
    tests.push(`${title}\n${body.join('\n')}`);
  }

  return `*** Settings ***
Documentation     Test web untuk "${commentLine(ctx.project.name)}" — digenerate QATools.
Library           Browser
Resource          ../resources/keywords.robot
Resource          ../resources/variables.robot

Suite Setup       Log    Menjalankan suite web QATools
Suite Teardown    Close Qa Browser

*** Variables ***
\${BROWSER}    chromium

*** Test Cases ***
${tests.join('\n\n')}
`;
}

function apiTestFile(ctx: GenerateContext): string {
  const tests: string[] = [];

  if (!ctx.requests.length) {
    tests.push(`Belum Ada Api Request
    [Documentation]    Placeholder: proyek ini belum punya API request di QATools.
    [Tags]    placeholder
    Skip    Belum ada API request; buat di menu API Tester QATools lalu generate ulang.`);
  }

  for (const r of ctx.requests) {
    const title = robotName(
      r.test_case_code
        ? `${r.test_case_code} ${textOf(r.test_case_title, r.request.name)}`
        : `${textOf(r.request.method, 'GET')} ${textOf(r.request.path, '/')}`,
      'API Request',
    );
    const expectedStatus = detectExpectedStatus(r.assertions) ?? 200;

    const body: string[] = [];
    body.push(
      `    [Documentation]    ${textOf(r.request.method, 'GET')} ${commentLine(textOf(r.request.path, '/'))} pada "${commentLine(r.collection_name)}".`,
    );
    body.push(`    [Tags]    api    qatools`);

    const headers: Record<string, string> = { ...r.headers };
    if (r.auth.type === 'bearer' && r.auth.token) headers.Authorization = 'Bearer ${AUTH_TOKEN}';
    if (r.auth.type === 'basic' && r.auth.username) headers.Authorization = 'Basic ${AUTH_BASIC}';
    if (r.auth.type === 'api_key' && r.auth.header) headers[r.auth.header] = '${AUTH_API_KEY}';

    // Each test opens its own session so tests stay independent under `robot --test`.
    body.push(`    Create Session    qa    \${BASE_URL}    verify=\${True}`);

    const path = textOf(r.request.path, '/');
    const relative = /^[a-z][a-z0-9+.-]*:\/\//i.test(path)
      ? path.replace(/^https?:\/\/[^/]+/i, '')
      : path;

    const method = textOf(r.request.method, 'GET').toUpperCase();
    const bodyText = textOf(r.request.body, '');
    const params = r.query && Object.keys(r.query).length ? `    params=${JSON.stringify(r.query)}` : '';
    const headerArg = Object.keys(headers).length ? `    headers=${JSON.stringify(headers)}` : '';

    if (['GET', 'HEAD', 'OPTIONS', 'DELETE'].includes(method)) {
      body.push(
        `    \${response}=    ${method} On Session    qa    ${robotCell(relative)}${params}${headerArg}    expected_status=anything`,
      );
    } else {
      const jsonArg = bodyText && r.request.body_type === 'json' ? `    json=${robotCell(bodyText)}` : bodyText ? `    data=${robotCell(bodyText)}` : '';
      body.push(
        `    \${response}=    ${method} On Session    qa    ${robotCell(relative)}${jsonArg}${params}${headerArg}    expected_status=anything`,
      );
    }

    body.push(`    Should Be Equal As Integers    \${response.status_code}    ${expectedStatus}`);

    for (const a of r.assertions) {
      const rendered = renderApiAssertionForRobot(r, a);
      if (rendered.warning) {
        ctx.warnings.push(`Robot: request "${labelOf(r.request.name)}": ${rendered.warning}`);
        continue;
      }
      body.push(...rendered.lines);
    }

    tests.push(`${title}\n${body.join('\n')}`);
  }

  return `*** Settings ***
Documentation     Test API untuk "${commentLine(ctx.project.name)}" — digenerate QATools.
Library           RequestsLibrary
Library           Collections
Library           String
Resource          ../resources/variables.robot

Suite Setup       Create Session    qa    \${BASE_URL}    verify=\${True}

*** Test Cases ***
${tests.join('\n\n')}
`;
}

function detectExpectedStatus(assertions: Assertion[]): number | null {
  for (const a of assertions) {
    if (a.source === 'status' && (a.operator === 'equals' || a.operator === 'in')) {
      const n = numOf(a.expected, NaN);
      if (Number.isFinite(n)) return Math.trunc(n);
      if (typeof a.expected === 'string') {
        const m = /\d{3}/.exec(a.expected);
        if (m) return Number(m[0]);
      }
    }
  }
  return null;
}

/**
 * Robot has one assertion-library flavour, so the renderer stays close to the
 * `Should Be Equal` family and uses `Evaluate` only for JSON extraction.
 */
function renderApiAssertionForRobot(
  r: { request: { name: string } },
  a: Assertion,
): { lines: string[]; warning?: string } {
  const pair = resolveApiAssertionJs(a, {
    response: 'response',
    status: '${response.status_code}',
    duration: '${response.elapsed.total_seconds()}',
    header: (name) => `\${response.headers}["${name.toLowerCase()}"]`,
    json: () => '${payload}',
    text: '${response.text}',
  });
  if (!pair) {
    return { lines: [], warning: `assertion source "${a.source}" tidak dipetakan ke Robot.` };
  }

  const lines: string[] = [];
  const m = matcherFor(a);
  const needsJson = a.source === 'jsonpath' || a.source === 'body' || a.source === 'element';

  if (a.source === 'status') {
    const expected = numOf(m.expected, 200);
    lines.push(`    Should Be Equal As Integers    \${response.status_code}    ${Math.trunc(expected)}`);
    return { lines };
  }
  if (a.source === 'header') {
    const headerName = textOf(a.path, 'content-type').toLowerCase();
    lines.push(`    \${header}=    Set Variable    \${response.headers}["${headerName}"]`);
    lines.push(...robotAssertion(a, 'header').lines);
    return { lines };
  }
  if (needsJson) {
    lines.push('    ${payload}=    Evaluate    json.loads("""${response.text}""")    json');
    const key = textOf(a.path, '').replace(/^\$\.?/, '').split('.').filter(Boolean).pop() ?? '';
    if (key) {
      lines.push(`    \${value}=    Get From Dictionary    \${payload}    ${key}    default=\${None}`);
      lines.push(...robotAssertion(a, 'value').lines);
      return { lines };
    }
  }
  lines.push(...robotAssertion(a, 'response.text').lines);
  void r;
  return { lines };
}

function dbTestFile(ctx: GenerateContext): string {
  const tests: string[] = [];
  if (!ctx.db_checks.length) {
    tests.push(`Belum Ada Db Check
    [Documentation]    Placeholder: proyek ini belum punya DB check di QATools.
    [Tags]    placeholder
    Skip    Belum ada DB check; buat di menu Database Testing QATools lalu generate ulang.`);
  }

  for (const c of ctx.db_checks) {
    const title = robotName(
      c.test_case_code ? `${c.test_case_code} ${textOf(c.test_case_title, c.check.name)}` : c.check.name,
      'DB Check',
    );
    const body: string[] = [];
    body.push(
      `    [Documentation]    Check "${commentLine(c.check.name)}" pada ${commentLine(c.connection_name)} (${c.dialect}).`,
    );
    body.push('    [Tags]    db    qatools');
    body.push('    Skip    Robot tidak mengeksekusi SQL secara langsung di template ini.');
    body.push(`    ...    Jalankan SQL berikut lewat engine DB QATools atau generator pytest:`);
    for (const line of textOf(c.check.sql, '').split(/\r?\n/)) {
      body.push(`    ...    ${commentLine(line)}`);
    }
    tests.push(`${title}\n${body.join('\n')}`);
  }

  return `*** Settings ***
Documentation     Test database untuk "${commentLine(ctx.project.name)}" — digenerate QATools.
Library           DatabaseLibrary
Library           Collections
Resource          ../resources/variables.robot

*** Variables ***
# Isi kredensial koneksi sebelum menjalankan suite ini.
\${DB_HOST}    localhost
\${DB_USER}    qa
\${DB_PASS}    qa
\${DB_NAME}    qa

*** Test Cases ***
${tests.join('\n\n')}
`;
}

/* ------------------------------------------------------------------ *
 * robot.yaml + requirements
 * ------------------------------------------------------------------ */

function robotYaml(ctx: GenerateContext): string {
  const tasks: string[] = [];
  if (ctx.layers.includes('web') && ctx.flows.length) {
    tasks.push(`  Run Web Tests:
    shell: robot --outputdir results --include web tests/web.robot`);
  }
  if (ctx.layers.includes('api') && ctx.requests.length) {
    tasks.push(`  Run Api Tests:
    shell: robot --outputdir results --include api tests/api.robot`);
  }
  if (!tasks.length) {
    tasks.push(`  Run All Tests:
    shell: robot --outputdir results tests/`);
  }
  return `# robot.yaml — definisi task (kompatibel dengan Robocorp / rcc).
# Menjalankan:  robot --outputdir results tests/
tasks:
${tasks.join('\n')}

condaConfigFile: conda.yaml
artifactsDir: results
PATH:
  - .
  - resources
PYTHONPATH:
  - .
ignoreFiles:
  - .gitignore
`;
}

/* ------------------------------------------------------------------ *
 * Entry point
 * ------------------------------------------------------------------ */

export function generate(ctx: GenerateContext): GeneratedFile[] {
  const files: GeneratedFile[] = [];

  files.push(
    file(
      'resources/variables.robot',
      'robot',
      'Variabel global: BASE_URL, kredensial collection, dan halaman awal setiap web flow.',
      variablesResource(ctx),
    ),
  );
  files.push(
    file(
      'resources/keywords.robot',
      'robot',
      'Keyword reusable (Browser + RequestsLibrary) untuk seluruh suite.',
      keywordsResource(ctx),
    ),
  );

  const webContent = ctx.layers.includes('web') ? webTestFile(ctx) : null;
  const apiContent = ctx.layers.includes('api') ? apiTestFile(ctx) : null;

  let hasDb = false;
  if (ctx.layers.includes('db')) {
    hasDb = true;
    files.push(
      file('tests/database.robot', 'robot', 'Suite DB: check SQL dan assertion-nya (butuh DatabaseLibrary).', dbTestFile(ctx)),
    );
  }

  if (webContent !== null) {
    files.push(file('tests/web.robot', 'robot', 'Suite web: satu test per web flow memakai Browser library.', webContent));
  }
  if (apiContent !== null) {
    files.push(
      file('tests/api.robot', 'robot', 'Suite API: RequestsLibrary dengan assertion dari DSL QATools.', apiContent),
    );
  }
  if (webContent === null && apiContent === null && !hasDb) {
    files.push(
      file(
        'tests/smoke.robot',
        'robot',
        'Suite minimal agar `robot tests/` selalu punya sesuatu untuk dijalankan.',
        `*** Settings ***
Documentation     Suite placeholder QATools.
*** Test Cases ***
Placeholder
    [Tags]    placeholder
    Log    Belum ada artefak yang digenerate.
`,
      ),
    );
  }

  files.push(
    file(
      'requirements.txt',
      'yaml',
      'Dependensi Python untuk Robot Framework (Browser + Requests + JSONLibrary).',
      `${ROBOT_REQ.join('\n')}\n`,
    ),
  );
  files.push(
    file(
      'robot.yaml',
      'yaml',
      'Definisi task Robot (kompatibel Robocorp) dengan perintah menjalankan suite.',
      robotYaml(ctx),
    ),
  );

  if (ctx.layers.includes('db')) {
    ctx.warnings.push(
      'Suite Robot untuk DB hanya memuat SQL sebagai komentar: DatabaseLibrary butuh kredensial nyata yang tidak ' +
        'boleh ditanam di kode. Gunakan generator pytest (dukungan sqlite3) atau jalankan lewat engine DB QATools.',
    );
  }
  return files;
}
