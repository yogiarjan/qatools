/**
 * k6 (performance) generator.
 *
 * Turns API test cases into a real load-test script:
 *   script.js          `export const options` (stages, thresholds) + `export default function`
 *   lib/checks.js      `check()` helpers translated from the Assertion DSL
 *   lib/data.js        parameterised test data extracted from the cases
 *   README.md          run instructions (k6 is a separate binary — user installs it)
 *
 * Thresholds come from `performanceFromExpectations()`: explicit `p95_ms` / `vus` /
 * `duration` in test data or tags win; otherwise conservative defaults are used and
 * the value is labelled a default in a comment rather than presented as a requirement.
 */

import type { Assertion } from '@qatools/shared';
import { matcherFor, performanceFromExpectations, resolveApiAssertionJs } from '../assertions-map.js';
import { file, type GenerateContext, type GeneratedFile } from '../types.js';
import {
  camelCase,
  clampInt,
  commentLine,
  labelOf,
  numOf,
  safeSegment,
  textOf,
  tsStr,
} from '../util.js';

/* ------------------------------------------------------------------ *
 * options
 * ------------------------------------------------------------------ */

function optionsBlock(ctx: GenerateContext): string {
  const profiles = ctx.cases.map((c) => {
    const profile = performanceFromExpectations({
      data: c.data,
      tags: c.tags,
      estimated_minutes: c.test_case.estimated_minutes,
    });
    return { code: c.test_case.code, title: c.test_case.title, profile };
  });

  // Aggregate: the strictest p95 wins (a load test cannot be looser than the SLA of
  // any case it represents) and the widest VU target wins.
  const hasProfile = profiles.length > 0;
  const peakVus = hasProfile ? Math.max(...profiles.map((p) => p.profile.vus)) : 10;
  const p95 = hasProfile ? Math.min(...profiles.map((p) => p.profile.p95_ms)) : 1500;
  const durationS = hasProfile ? Math.max(...profiles.map((p) => p.profile.duration_s)) : 30;
  const errorRate = hasProfile ? Math.min(...profiles.map((p) => p.profile.error_rate)) : 1;

  const ramp = Math.max(5, Math.round(durationS / 3));
  const hold = Math.max(5, durationS - ramp * 2);

  const stages = [
    { duration: `${ramp}s`, target: Math.max(1, Math.round(peakVus / 2)) },
    { duration: `${hold}s`, target: peakVus },
    { duration: `${ramp}s`, target: 0 },
  ];

  const lines: string[] = [];
  lines.push('/**');
  lines.push(` * Opsi eksekusi k6 untuk proyek "${commentLine(ctx.project.name)}".`);
  lines.push(' *');
  lines.push(' * Threshold diturunkan dari ekspektasi performa test case QATools:');
  for (const p of profiles.slice(0, 12)) {
    lines.push(` *   ${commentLine(p.code)} (p95 <= ${p.profile.p95_ms} ms, ${p.profile.vus} VU) — ${commentLine(p.title)}`);
  }
  if (profiles.length > 12) lines.push(` *   … dan ${profiles.length - 12} test case lain.`);
  if (!hasProfile) {
    lines.push(' * Tidak ada data ekspektasi performa; nilai di bawah adalah default yang wajar.');
  }
  lines.push(' */');
  lines.push('export const options = {');
  lines.push('  stages: [');
  for (const s of stages) lines.push(`    { duration: '${s.duration}', target: ${s.target} },`);
  lines.push('  ],');
  lines.push(`  // Puncak beban: ${peakVus} virtual user.`);
  lines.push('  thresholds: {');
  lines.push(`    http_req_duration: ['p(95)<${p95}'],`);
  lines.push(`    http_req_failed: ['rate<${Math.max(0.001, errorRate / 100)}'],`);
  lines.push("    checks: ['rate>0.95'],");
  lines.push('  },');
  lines.push('  // Ringkasan tambahan supaya hasil mudah dibaca di CI.');
  lines.push("  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],");
  lines.push('  discardResponseBodies: false,');
  lines.push('  // Sleep 1 detik antar iterasi supaya beban menyerupai perilaku user nyata.');
  lines.push('  noConnectionReuse: false,');
  lines.push('};');
  return lines.join('\n');
}

/* ------------------------------------------------------------------ *
 * checks helper
 * ------------------------------------------------------------------ */

function checksLib(ctx: GenerateContext): string {
  return `import { check } from 'k6';
import http from 'k6/http';

/**
 * Helper assertion untuk script k6 — digenerate QATools.
 * Setiap fungsi mengembalikan hasil \`check()\` sehingga bisa dihitung threshold.
 */

/** Ambil nilai dari dokumen JSON memakai JSONPath sederhana (\`$.data.id\`). */
export function dig(document, path) {
  if (!path) return document;
  const parts = String(path)
    .replace(/^\\$\\.?/, '')
    .split('.')
    .flatMap((segment) => segment.replace(/\\[(\\d+)\\]/g, '.$1').split('.'))
    .filter(Boolean);
  let current = document;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    current = Array.isArray(current) ? current[Number(part)] : current[part];
  }
  return current;
}

/** Parse body response tanpa melempar. */
export function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch (err) {
    return undefined;
  }
}

export const BASE_URL = __ENV.QA_BASE_URL || ${tsStr(ctx.base_url)};

/** Header default; token diambil dari -e QA_TOKEN=... */
export function authHeaders(token) {
  const headers = { Accept: 'application/json', 'Content-Type': 'application/json' };
  const value = token || __ENV.QA_TOKEN;
  if (value) headers.Authorization = \`Bearer \${value}\`;
  return headers;
}

/** GET dengan check otomatis pada status code. */
export function get(path, name, tags) {
  const response = http.get(\`\${BASE_URL}\${path}\`, { headers: authHeaders(), tags });
  check(response, { [\`\${name}: status < 400\`]: (r) => r.status < 400 });
  return response;
}

/** POST JSON dengan check otomatis pada status code. */
export function post(path, payload, name, tags) {
  const response = http.post(\`\${BASE_URL}\${path}\`, JSON.stringify(payload || {}), {
    headers: authHeaders(),
    tags,
  });
  check(response, { [\`\${name}: status < 400\`]: (r) => r.status < 400 });
  return response;
}
`;
}

/* ------------------------------------------------------------------ *
 * data lib
 * ------------------------------------------------------------------ */

function dataLib(ctx: GenerateContext): string {
  const datasets = ctx.cases
    .filter((c) => c.data.length > 0)
    .map((c) => {
      const key = camelCase(c.test_case.code, 'case');
      const obj = c.data.map((d) => `    ${tsStr(d.field)}: ${tsStr(d.value)},`).join('\n');
      return `  /** ${commentLine(`${c.test_case.code} — ${c.test_case.title}`)} */\n  ${safeIdentifier(key)}: {\n${obj}\n  },`;
    })
    .join('\n');

  return `/**
 * Data uji yang diekstrak dari test case QATools.
 * Nilai di sini adalah salinan saat generate; sinkronkan ulang bila data berubah.
 */
export const dataSets = {
${datasets || '  // Belum ada test data pada test case yang digenerate.'}
};

/** Ambil data berdasarkan kode test case (mis. "TC-001"). */
export function dataFor(code) {
  const key = String(code || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\\s+/)
    .map((part, index) => (index === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join('');
  return dataSets[key] || {};
}
`;
}

function safeIdentifier(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9_$]/g, '_');
  return /^[A-Za-z_$]/.test(cleaned) ? cleaned : `_${cleaned}`;
}

/* ------------------------------------------------------------------ *
 * assertion rendering
 * ------------------------------------------------------------------ */

function k6CheckLines(assertion: Assertion, responseVar: string, name: string, indent: string): { lines: string[]; warning?: string } {
  const resolved = resolveApiAssertionJs(assertion, {
    response: responseVar,
    status: `${responseVar}.status`,
    duration: `${responseVar}.timings.duration`,
    header: (headerName) => `${responseVar}.headers[${tsStr(headerName)}] ?? ${responseVar}.headers[${tsStr(headerName.toLowerCase())}]`,
    json: (path) => `dig(payload, ${tsStr(path)})`,
    text: `${responseVar}.body`,
  });
  if (!resolved) {
    return { lines: [], warning: `assertion source "${assertion.source}" tidak dipetakan ke k6.` };
  }

  const m = matcherFor(assertion);
  const observed = resolved.subject;
  const label = `${name}: ${resolved.label} ${assertion.operator}`;
  const num = (v: unknown) => (Number.isFinite(numOf(v, NaN)) ? String(numOf(v, 0)) : '0');

  let predicate: string;
  switch (m.kind) {
    case 'equal':
      predicate = `(value) => String(value) === ${tsStr(m.display)}`;
      break;
    case 'not_equal':
      predicate = `(value) => String(value) !== ${tsStr(m.display)}`;
      break;
    case 'contains':
      predicate = `(value) => String(value).includes(${tsStr(m.display)})`;
      break;
    case 'not_contains':
      predicate = `(value) => !String(value).includes(${tsStr(m.display)})`;
      break;
    case 'gt':
      predicate = `(value) => Number(value) > ${num(m.expected)}`;
      break;
    case 'gte':
      predicate = `(value) => Number(value) >= ${num(m.expected)}`;
      break;
    case 'lt':
      predicate = `(value) => Number(value) < ${num(m.expected)}`;
      break;
    case 'lte':
      predicate = `(value) => Number(value) <= ${num(m.expected)}`;
      break;
    case 'exists':
      predicate = `(value) => value !== undefined && value !== null`;
      break;
    case 'not_exists':
      predicate = `(value) => value === undefined || value === null`;
      break;
    case 'matches':
      predicate = `(value) => new RegExp(${tsStr(m.regex ?? '')}).test(String(value))`;
      break;
    case 'in': {
      const list = Array.isArray(m.expected)
        ? m.expected
        : String(m.expected ?? '')
            .replace(/^\[|\]$/g, '')
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);
      predicate = `(value) => [${list.map((v) => tsStr(String(v))).join(', ')}].includes(String(value))`;
      break;
    }
    case 'length_gte':
      predicate = `(value) => (Array.isArray(value) ? value.length : String(value).length) >= ${num(m.expected)}`;
      break;
    case 'length_lte':
      predicate = `(value) => (Array.isArray(value) ? value.length : String(value).length) <= ${num(m.expected)}`;
      break;
    default:
      return { lines: [], warning: `operator "${assertion.operator}" belum dipetakan ke k6.` };
  }

  const lines: string[] = [];
  lines.push(`${indent}const ${safeIdentifier(name)}Value = ${observed};`);
  lines.push(
    `${indent}check(${responseVar}, { ${tsStr(label)}: () => (${predicate})(${safeIdentifier(name)}Value) });`,
  );
  return { lines };
}

/* ------------------------------------------------------------------ *
 * script.js
 * ------------------------------------------------------------------ */

function scriptJs(ctx: GenerateContext): { content: string; warnings: string[] } {
  const warnings: string[] = [];

  if (!ctx.requests.length) {
    return {
      content: `import { sleep } from 'k6';
import { get, BASE_URL } from './lib/checks.js';

${optionsBlock(ctx)}

/**
 * Placeholder: proyek ini belum punya API request di QATools.
 * Script tetap valid dan bisa dijalankan dengan \`k6 run script.js\`.
 */
export default function () {
  get('/', 'health');
  sleep(1);
}

export { BASE_URL };
`,
      warnings,
    };
  }

  const scenarios: string[] = [];
  const usedNames = new Set<string>();

  for (const r of ctx.requests) {
    const baseName = r.test_case_code
      ? camelCase(r.test_case_code, 'request')
      : camelCase(`${textOf(r.request.method, 'get')} ${textOf(r.request.path, 'root')} ${textOf(r.request.name, '')}`, 'request');
    let fnName = `${baseName}Scenario`;
    let n = 2;
    while (usedNames.has(fnName)) fnName = `${baseName}${n++}Scenario`;
    usedNames.add(fnName);

    const path = textOf(r.request.path, '/');
    const relative = /^[a-z][a-z0-9+.-]*:\/\//i.test(path) ? path : path.startsWith('/') ? path : `/${path}`;
    const method = textOf(r.request.method, 'GET').toUpperCase();
    const name = labelOf(r.request.name, `${method} ${relative}`);
    const tags = `{ name: ${tsStr(name)}, case: ${tsStr(textOf(r.test_case_code, ''))}, method: ${tsStr(method)} }`;

    const bodyText = textOf(r.request.body, '');
    let payloadLiteral = 'undefined';
    if (bodyText && r.request.body_type === 'json') {
      try {
        payloadLiteral = JSON.stringify(JSON.parse(bodyText));
      } catch {
        payloadLiteral = tsStr(bodyText);
        warnings.push(`k6: body request "${name}" bukan JSON valid; dikirim sebagai string.`);
      }
    } else if (bodyText) {
      payloadLiteral = tsStr(bodyText);
    }

    const queryLine =
      r.query && Object.keys(r.query).length
        ? `  const query = ${JSON.stringify(r.query)};\n  const queryString = Object.entries(query).map(([k, v]) => \`\${encodeURIComponent(k)}=\${encodeURIComponent(v)}\`).join('&');\n`
        : '';

    const body: string[] = [];
    body.push(`/**`);
    body.push(` * ${commentLine(`${method} ${relative} — ${name}`)}`);
    if (r.test_case_code) body.push(` * Test case: ${commentLine(`${r.test_case_code} — ${textOf(r.test_case_title, '')}`)}`);
    body.push(` * Collection: ${commentLine(r.collection_name)}`);
    body.push(` */`);
    body.push(`export function ${fnName}() {`);
    if (queryLine) body.push(queryLine.trimEnd());
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS' || method === 'DELETE') {
      body.push(
        `  const response = http.${method.toLowerCase()}(\`\${BASE_URL}${relative}\${queryString ? \`?\${queryString}\` : ''}\`, { headers: authHeaders(), tags: ${tags} });`,
      );
    } else {
      body.push(
        `  const response = http.${method.toLowerCase()}(\`\${BASE_URL}${relative}\${queryString ? \`?\${queryString}\` : ''}\`, ${payloadLiteral === 'undefined' ? 'null' : payloadLiteral}, { headers: authHeaders(), tags: ${tags} });`,
      );
    }
    body.push('  const payload = parseJson(response.body);');
    body.push(`  check(response, { ${tsStr(`${name}: status < 400`)}: (res) => res.status < 400 });`);

    let emitted = 0;
    for (let i = 0; i < r.assertions.length; i++) {
      const a = r.assertions[i] as Assertion;
      const rendered = k6CheckLines(a, 'response', `${baseName}${i + 1}`, '  ');
      if (rendered.warning) {
        warnings.push(`k6: request "${name}": ${rendered.warning}`);
        continue;
      }
      body.push(`  // ${commentLine(`${a.source} ${a.operator}`)}`);
      body.push(...rendered.lines);
      emitted += 1;
    }
    if (!emitted) {
      body.push('  // Tidak ada assertion eksplisit pada request ini.');
    }
    body.push('  sleep(Math.random() * 1 + 0.5);');
    body.push('}');
    scenarios.push(body.join('\n'));
  }

  // One round-robin entry point: each iteration walks a different request so a short
  // run still exercises every endpoint, which is what a QA smoke load test needs.
  const names = [...usedNames];
  const defaultFn: string[] = [];
  defaultFn.push('/**');
  defaultFn.push(' * Iterasi default: menyebar ke semua request secara merata.');
  defaultFn.push(' * Ganti isi fungsi ini bila ingin skenario beban yang berbeda.');
  defaultFn.push(' */');
  defaultFn.push('export default function () {');
  if (names.length === 1) {
    defaultFn.push(`  ${names[0]}();`);
  } else {
    defaultFn.push('  const steps = [');
    for (const n of names) defaultFn.push(`    ${n},`);
    defaultFn.push('  ];');
    defaultFn.push('  for (const step of steps) {');
    defaultFn.push('    step();');
    defaultFn.push('  }');
  }
  defaultFn.push('}');

  const content = `import http from 'k6/http';
import { check, sleep } from 'k6';

import { BASE_URL, authHeaders, dig, parseJson } from './lib/checks.js';

${optionsBlock(ctx)}

${scenarios.join('\n\n')}

${defaultFn.join('\n')}

export { BASE_URL };
`;
  return { content, warnings };
}

/* ------------------------------------------------------------------ *
 * README
 * ------------------------------------------------------------------ */

function k6Readme(ctx: GenerateContext): string {
  return `# k6 load test — ${ctx.project.name}

Digenerate QATools dari ${ctx.cases.length} test case, ${ctx.requests.length} API request.

## 1. Instal k6 (langkah Anda, bukan langkah QATools)

\`\`\`powershell
winget install k6 --source winget
# atau
choco install k6
# atau via Docker
docker run --rm -i grafana/k6 run - < script.js
\`\`\`

## 2. Jalankan

\`\`\`bash
k6 run script.js
\`\`\`

Override target dan token tanpa mengubah file:

\`\`\`bash
k6 run -e QA_BASE_URL=https://staging.example.com -e QA_TOKEN=xxx script.js
\`\`\`

Simpan ringkasan JSON untuk CI:

\`\`\`bash
k6 run --summary-export=summary.json script.js
\`\`\`

## 3. Struktur

| File | Isi |
|---|---|
| \`script.js\` | \`options\` (stages + thresholds) dan satu fungsi per request |
| \`lib/checks.js\` | helper \`check()\` hasil terjemahan Assertion DSL QATools |
| \`lib/data.js\` | data uji yang diekstrak dari test case |

## 4. Catatan jujur

- Ambang \`p95\` diturunkan dari data/tag test case. Bila tidak ada, nilainya default
  yang wajar — bukan SLA yang disepakati. Sesuaikan sebelum dipakai sebagai gate rilis.
- k6 **tidak** terpasang oleh QATools; menginstal k6 adalah langkah Anda.
`;
}

/* ------------------------------------------------------------------ *
 * Entry point
 * ------------------------------------------------------------------ */

export function generate(ctx: GenerateContext): GeneratedFile[] {
  const files: GeneratedFile[] = [];
  const script = scriptJs(ctx);
  ctx.warnings.push(...script.warnings);

  files.push(file('script.js', 'javascript', 'Skenario k6: options (stages + thresholds) dan fungsi per API request.', script.content));
  files.push(
    file('lib/checks.js', 'javascript', 'Helper check()/dig() hasil terjemahan Assertion DSL QATools.', checksLib(ctx)),
  );
  files.push(file('lib/data.js', 'javascript', 'Data uji yang diekstrak dari test case QATools.', dataLib(ctx)));
  files.push(
    file(
      'README.md',
      'yaml',
      'Cara memasang k6, menjalankan script, dan membaca threshold-nya.',
      k6Readme(ctx),
    ),
  );

  if (!ctx.cases.length) {
    ctx.warnings.push('k6: tidak ada test case yang digenerate, ambang batas memakai nilai default.');
  }
  if (ctx.parallel) {
    ctx.warnings.push(
      `k6: pengaturan "workers: ${clampInt(ctx.workers, 1, 16)}" tidak berlaku — k6 mengatur beban lewat \`stages\`, bukan jumlah worker.`,
    );
  }
  void safeSegment;
  return files;
}