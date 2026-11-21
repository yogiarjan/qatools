/**
 * Postman Collection v2.1 + environment generator.
 *
 * Emits a collection that imports into the Postman GUI **and** runs under Newman:
 *   collection.json    info / item[] / request / event[].script with pm.test()
 *   environment.json   Postman environment with baseUrl + auth variables
 *   README.md          the exact newman command
 *
 * The JSON is assembled with `JSON.stringify` over a real object graph (not string
 * concatenation), so the output is guaranteed parseable and every `pm.test()` body is
 * a properly escaped JavaScript string produced by the shared `tsStr()` helper.
 */

import type { Assertion } from '@qatools/shared';
import { matcherFor, resolveApiAssertionJs } from '../assertions-map.js';
import { file, type GenerateContext, type GeneratedFile } from '../types.js';
import { commentLine, labelOf, numOf, safeSegment, textOf, tsStr } from '../util.js';

interface PostmanUrl {
  raw: string;
  host: string[];
  path: string[];
  query?: Array<{ key: string; value: string }>;
  variable?: Array<{ key: string; value: string }>;
}

interface PostmanRequest {
  method: string;
  header: Array<{ key: string; value: string; type: string }>;
  url: PostmanUrl;
  body?: { mode: string; raw: string; options?: { raw: { language: string } } };
  description?: string;
}

interface PostmanItem {
  name: string;
  request: PostmanRequest;
  event?: Array<{ listen: string; script: { type: string; exec: string[] } }>;
  response?: unknown[];
}

interface PostmanFolder {
  name: string;
  description?: string;
  item: PostmanItem[];
}

interface PostmanCollection {
  info: {
    _postman_id: string;
    name: string;
    description: string;
    schema: string;
    version?: string;
  };
  item: Array<PostmanFolder | PostmanItem>;
  event?: Array<{ listen: string; script: { type: string; exec: string[] } }>;
  variable?: Array<{ key: string; value: string; type: string }>;
}

export const POSTMAN_SCHEMA = 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json';

/* ------------------------------------------------------------------ *
 * URL decomposition
 * ------------------------------------------------------------------ */

/** Splits a URL into the `host` / `path` arrays Postman's schema expects. */
export function splitUrl(raw: string, query: Record<string, string>): PostmanUrl {
  const queryList = Object.entries(query).map(([key, value]) => ({ key, value }));
  let parsed: URL | null = null;
  try {
    parsed = new URL(raw);
  } catch {
    parsed = null;
  }

  if (!parsed) {
    // Relative path: let Postman resolve it against the `baseUrl` variable.
    const pathOnly = raw.replace(/^\/+/, '');
    const url: PostmanUrl = {
      raw: `{{baseUrl}}/${pathOnly}`,
      host: ['{{baseUrl}}'],
      path: pathOnly.split('/').filter(Boolean),
    };
    if (queryList.length) url.query = queryList;
    return url;
  }

  const host = [parsed.protocol.replace(':', ''), '://', parsed.host];
  const segments = parsed.pathname.split('/').filter(Boolean);
  const rawWithQuery = queryList.length
    ? `${parsed.origin}${parsed.pathname}?${queryList.map((q) => `${q.key}=${q.value}`).join('&')}`
    : `${parsed.origin}${parsed.pathname}`;
  const url: PostmanUrl = { raw: rawWithQuery, host, path: segments };
  if (queryList.length) url.query = queryList;
  return url;
}

/** `:id` / `{id}` path params become Postman `{{id}}` variables. */
function templatisePath(url: PostmanUrl, variables: Record<string, string>): PostmanUrl {
  const out: PostmanUrl = { ...url };
  const found: Array<{ key: string; value: string }> = [];
  out.path = url.path.map((segment) => {
    const colon = /^:(.+)$/.exec(segment);
    const brace = /^\{(.+)\}$/.exec(segment);
    const key = colon?.[1] ?? brace?.[1];
    if (!key) return segment;
    const value = variables[key] ?? '';
    found.push({ key, value });
    return `{{${key}}}`;
  });
  if (found.length) out.variable = found;
  out.raw = out.raw.replace(/:([A-Za-z0-9_]+)/g, '{{$1}}').replace(/\{([A-Za-z0-9_]+)\}/g, '{{$1}}');
  return out;
}

/* ------------------------------------------------------------------ *
 * pm.test() generation
 * ------------------------------------------------------------------ */

/**
 * Renders one assertion as a `pm.test(...)` with a `pm.expect(...)` chain.
 * The JSONPath-ish `$.a.b` is converted to Postman's `jsonData.a.b` access, which is
 * what actually works inside the PM sandbox.
 */
export function pmTestLines(assertion: Assertion, index: number): { lines: string[]; warning?: string } {
  const m = matcherFor(assertion);
  const label = `${assertion.source}${assertion.path ? ` ${assertion.path}` : ''} ${assertion.operator}${
    m.display !== 'null' ? ` ${m.display}` : ''
  }`;
  const title = assertion.message?.trim() || label;
  const lines: string[] = [];

  let subject: string;
  switch (assertion.source) {
    case 'status':
      subject = 'pm.response.code';
      break;
    case 'duration':
      subject = 'pm.response.responseTime';
      break;
    case 'header':
      subject = `pm.response.headers.get(${tsStr(textOf(assertion.path, 'content-type').toLowerCase())})`;
      break;
    case 'row_count':
      subject = 'jsonData.length';
      break;
    case 'column':
    case 'jsonpath':
    case 'body':
    case 'element': {
      const path = textOf(assertion.path, '');
      subject = path ? `dig(${tsStr(path)})` : 'pm.response.text()';
      break;
    }
    case 'text':
      subject = 'pm.response.text()';
      break;
    default:
      return { lines: [], warning: `assertion source "${assertion.source}" tidak dipetakan ke Postman.` };
  }

  const expectedLiteral = (v: unknown): string => {
    if (v === null || v === undefined) return 'null';
    if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'null';
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    if (Array.isArray(v)) return `[${v.map(expectedLiteral).join(', ')}]`;
    if (typeof v === 'string') return tsStr(v);
    return JSON.stringify(v) ?? 'null';
  };

  let chain: string;
  switch (m.kind) {
    case 'equal':
      chain = `expect(${subject}).to.eql(${expectedLiteral(m.expected)})`;
      break;
    case 'not_equal':
      chain = `expect(${subject}).to.not.eql(${expectedLiteral(m.expected)})`;
      break;
    case 'contains':
      chain = `expect(String(${subject})).to.include(${tsStr(m.display)})`;
      break;
    case 'not_contains':
      chain = `expect(String(${subject})).to.not.include(${tsStr(m.display)})`;
      break;
    case 'gt':
      chain = `expect(Number(${subject})).to.be.above(${numOf(m.expected, 0)})`;
      break;
    case 'gte':
      chain = `expect(Number(${subject})).to.be.at.least(${numOf(m.expected, 0)})`;
      break;
    case 'lt':
      chain = `expect(Number(${subject})).to.be.below(${numOf(m.expected, 0)})`;
      break;
    case 'lte':
      chain = `expect(Number(${subject})).to.be.at.most(${numOf(m.expected, 0)})`;
      break;
    case 'exists':
      chain = `expect(${subject}).to.not.be.undefined`;
      break;
    case 'not_exists':
      chain = `expect(${subject}).to.be.undefined`;
      break;
    case 'matches':
      chain = `expect(String(${subject})).to.match(new RegExp(${tsStr(m.regex ?? '')}))`;
      break;
    case 'in': {
      const list = Array.isArray(m.expected)
        ? m.expected
        : String(m.expected ?? '')
            .replace(/^\[|\]$/g, '')
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);
      chain = `expect([${list.map(expectedLiteral).join(', ')}]).to.include(${subject})`;
      break;
    }
    case 'length_gte':
      chain = `expect(${subject}).to.have.lengthOf.at.least(${numOf(m.expected, 0)})`;
      break;
    case 'length_lte':
      chain = `expect(${subject}).to.have.lengthOf.at.most(${numOf(m.expected, 0)})`;
      break;
    default:
      return { lines: [], warning: `operator "${assertion.operator}" belum dipetakan ke Postman.` };
  }

  lines.push(`// ${commentLine(title)}`);
  lines.push(`pm.test(${tsStr(title)}, function () {`);
  lines.push(`    ${chain};`);
  lines.push('});');
  void index;
  void resolveApiAssertionJs;
  return { lines };
}

/** Pre-request script: exposes `dig()` and the shared headers to pm.test. */
function preRequestScript(collectionName: string): string[] {
  return [
    `// Pre-request — digenerate QATools (collection: ${commentLine(collectionName)})`,
    'pm.variables.set("requestStart", Date.now());',
  ];
}

/* ------------------------------------------------------------------ *
 * test script (event)
 * ------------------------------------------------------------------ */

function testScriptFor(
  ctx: GenerateContext,
  name: string,
  assertions: Assertion[],
): { exec: string[]; warnings: string[] } {
  const warnings: string[] = [];
  const exec: string[] = [];

  exec.push('// Digenerate QATools dari Assertion DSL.');
  exec.push('// Helper dig(): ambil nilai JSON dengan path $.a.b[0].c');
  exec.push('function dig(path) {');
  exec.push('    if (!path) return pm.response.json();');
  exec.push('    var current;');
  exec.push('    try {');
  exec.push('        current = pm.response.json();');
  exec.push('    } catch (e) {');
  exec.push('        current = undefined;');
  exec.push('    }');
  exec.push('    var parts = String(path).replace(/^\\$\\.?/, "").split(".");');
  exec.push('    for (var i = 0; i < parts.length; i++) {');
  exec.push('        var segment = parts[i];');
  exec.push('        var match = /^(.+?)\\[(\\d+)\\]$/.exec(segment);');
  exec.push('        if (match) {');
  exec.push('            current = current === undefined || current === null ? undefined : current[match[1]];');
  exec.push('            segment = match[2];');
  exec.push('        }');
  exec.push('        if (current === undefined || current === null) return undefined;');
  exec.push('        current = Array.isArray(current) ? current[Number(segment)] : current[segment];');
  exec.push('    }');
  exec.push('    return current;');
  exec.push('}');
  exec.push('');

  if (!assertions.length) {
    exec.push('// Tidak ada assertion eksplisit pada request ini.');
    exec.push(`pm.test(${tsStr(`${name} — status < 400`)}, function () {`);
    exec.push('    pm.expect(pm.response.code).to.be.below(400);');
    exec.push('});');
    return { exec, warnings };
  }

  assertions.forEach((a, i) => {
    const rendered = pmTestLines(a, i + 1);
    if (rendered.warning) {
      warnings.push(`Postman: request "${name}": ${rendered.warning}`);
      return;
    }
    exec.push(...rendered.lines);
    exec.push('');
  });

  return { exec, warnings };
}

/* ------------------------------------------------------------------ *
 * collection assembly
 * ------------------------------------------------------------------ */

function buildCollection(ctx: GenerateContext): { collection: PostmanCollection; warnings: string[] } {
  const warnings: string[] = [];
  const folders = new Map<string, PostmanFolder>();

  for (const r of ctx.requests) {
    const folderName = labelOf(r.collection_name, 'Collection');
    let folder = folders.get(folderName);
    if (!folder) {
      folder = {
        name: folderName,
        description: `Digenerate QATools dari collection "${commentLine(folderName)}".`,
        item: [],
      };
      folders.set(folderName, folder);
    }

    const headers: Array<{ key: string; value: string; type: string }> = Object.entries(r.headers).map(
      ([key, value]) => ({ key, value, type: 'text' }),
    );
    headers.push({ key: 'Accept', value: 'application/json', type: 'text' });

    if (r.auth.type === 'bearer') {
      headers.push({ key: 'Authorization', value: 'Bearer {{authToken}}', type: 'text' });
    } else if (r.auth.type === 'basic') {
      headers.push({ key: 'Authorization', value: 'Basic {{authBasic}}', type: 'text' });
    } else if (r.auth.type === 'api_key' && r.auth.header) {
      headers.push({ key: r.auth.header, value: '{{authApiKey}}', type: 'text' });
    }

    const rawPath = textOf(r.request.path, '/');
    const isAbsolute = /^[a-z][a-z0-9+.-]*:\/\//i.test(rawPath);
    const absolute = isAbsolute
      ? rawPath
      : `${r.base_url.replace(/\/+$/, '')}${rawPath.startsWith('/') ? '' : '/'}${rawPath}`;
    // Prefer the {{baseUrl}} variable so the environment file stays authoritative.
    const url = templatisePath(
      splitUrl(isAbsolute ? absolute : `{{baseUrl}}${rawPath.startsWith('/') ? '' : '/'}${rawPath}`, r.query),
      r.collection_variables,
    );

    const method = textOf(r.request.method, 'GET').toUpperCase();
    const bodyText = textOf(r.request.body, '');
    const request: PostmanRequest = {
      method,
      header: headers,
      url,
      description: r.test_case_code
        ? `${r.test_case_code} — ${commentLine(textOf(r.test_case_title, r.request.name))}`
        : undefined,
    };

    if (bodyText && method !== 'GET' && method !== 'HEAD') {
      if (r.request.body_type === 'json') {
        let raw = bodyText;
        try {
          raw = JSON.stringify(JSON.parse(bodyText), null, 2);
        } catch {
          warnings.push(
            `Postman: body request "${labelOf(r.request.name)}" diberi tipe JSON tetapi bukan JSON valid; dikirim apa adanya.`,
          );
        }
        request.body = { mode: 'raw', raw, options: { raw: { language: 'json' } } };
      } else if (r.request.body_type === 'form') {
        request.body = { mode: 'urlencoded', raw: bodyText } as unknown as PostmanRequest['body'];
      } else {
        request.body = { mode: 'raw', raw: bodyText };
      }
    }

    const itemName = r.test_case_code
      ? `${r.test_case_code} — ${labelOf(r.test_case_title, r.request.name)}`
      : labelOf(r.request.name, `${method} ${rawPath}`);
    const script = testScriptFor(ctx, itemName, r.assertions);
    warnings.push(...script.warnings);

    const item: PostmanItem = {
      name: itemName,
      request,
      event: [
        { listen: 'prerequest', script: { type: 'text/javascript', exec: preRequestScript(folderName) } },
        { listen: 'test', script: { type: 'text/javascript', exec: script.exec } },
      ],
      response: [],
    };
    folder.item.push(item);
  }

  if (!folders.size) {
    folders.set('Belum ada API request', {
      name: 'Belum ada API request',
      description: 'Proyek ini belum punya API request di QATools.',
      item: [
        {
          name: 'Placeholder — belum ada API request',
          request: {
            method: 'GET',
            header: [{ key: 'Accept', value: 'application/json', type: 'text' }],
            url: { raw: '{{baseUrl}}/', host: ['{{baseUrl}}'], path: [] },
          },
          event: [
            {
              listen: 'test',
              script: {
                type: 'text/javascript',
                exec: [
                  '// Placeholder: buat API request di QATools (menu API Tester) lalu generate ulang.',
                  `pm.test(${tsStr('placeholder dijalankan')}, function () {`,
                  '    pm.expect(true).to.be.true;',
                  '});',
                ],
              },
            },
          ],
          response: [],
        },
      ],
    });
  }

  const collection: PostmanCollection = {
    info: {
      _postman_id: deterministicUuid(`${ctx.project.id}-${ctx.framework}`),
      name: `${ctx.project.name} — QATools Automation`,
      description: `Koleksi Postman yang digenerate QATools untuk proyek "${ctx.project.name}" (${ctx.project.key}).\n\nMenjalankan dengan Newman:\n  newman run collection.json -e environment.json`,
      schema: POSTMAN_SCHEMA,
      version: '1.0.0',
    },
    item: [...folders.values()],
    event: [
      {
        listen: 'prerequest',
        script: {
          type: 'text/javascript',
          exec: [
            '// Script level koleksi — dijalankan sebelum setiap request.',
            '// Simpan waktu mulai agar durasi bisa dihitung bila diperlukan.',
            'pm.collectionVariables.set("collectionStart", Date.now());',
          ],
        },
      },
    ],
    variable: [
      { key: 'baseUrl', value: ctx.base_url, type: 'string' },
      { key: 'authToken', value: '', type: 'string' },
      { key: 'authBasic', value: '', type: 'string' },
      { key: 'authApiKey', value: '', type: 'string' },
    ],
  };

  return { collection, warnings };
}

/** A stable UUID-ish id so regenerating the same project does not churn the file. */
function deterministicUuid(seed: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < seed.length; i++) {
    h1 = Math.imul(h1 ^ seed.charCodeAt(i), 16777619) >>> 0;
    h2 = Math.imul(h2 + seed.charCodeAt(i) + i, 2246822519) >>> 0;
  }
  const hex = (n: number, width: number) => (n >>> 0).toString(16).padStart(width, '0').slice(-width);
  return [
    hex(h1, 8),
    hex(h2, 4),
    `4${hex(h1 ^ h2, 3)}`,
    `a${hex(h2 ^ 0x1234, 3)}`,
    hex(h1, 8) + hex(h2, 4).slice(0, 4),
  ].join('-');
}

/* ------------------------------------------------------------------ *
 * environment + README
 * ------------------------------------------------------------------ */

function environmentFile(ctx: GenerateContext): string {
  return `${JSON.stringify(
    {
      id: deterministicUuid(`${ctx.project.id}-env`),
      name: `${ctx.project.name} — QATools`,
      values: [
        { key: 'baseUrl', value: ctx.base_url, type: 'default', enabled: true },
        { key: 'authToken', value: '', type: 'secret', enabled: true },
        { key: 'authBasic', value: '', type: 'secret', enabled: true },
        { key: 'authApiKey', value: '', type: 'secret', enabled: true },
      ],
      _postman_variable_scope: 'environment',
    },
    null,
    2,
  )}\n`;
}

function postmanReadme(ctx: GenerateContext): string {
  return `# Postman Collection — ${ctx.project.name}

Digenerate QATools dari ${ctx.requests.length} API request.

## 1. Instal Newman (langkah Anda)

\`\`\`bash
npm install -g newman
npm install -g newman-reporter-htmlextra   # opsional
\`\`\`

## 2. Jalankan

\`\`\`bash
newman run collection.json -e environment.json
\`\`\`

Dengan laporan HTML dan kegagalan yang menghentikan CI:

\`\`\`bash
newman run collection.json -e environment.json --reporters cli,htmlextra --reporter-htmlextra-export report.html --bail
\`\`\`

Override base URL tanpa menyentuh file:

\`\`\`bash
newman run collection.json -e environment.json --env-var baseUrl=https://staging.example.com --env-var authToken=XXX
\`\`\`

## 3. Impor ke Postman GUI

1. Buka Postman → **Import**.
2. Pilih \`collection.json\`, lalu \`environment.json\`.
3. Pilih environment **${ctx.project.name} — QATools** di kanan atas.
4. Isi \`authToken\` / \`authBasic\` / \`authApiKey\` (ditandai *secret*) sebelum menjalankan.

## 4. Struktur

| File | Isi |
|---|---|
| \`collection.json\` | Postman Collection v2.1: folder per collection QATools, \`pm.test()\` hasil terjemahan Assertion DSL |
| \`environment.json\` | Environment Postman (baseUrl + variabel auth) |

## 5. Catatan jujur

- Token autentikasi **tidak** ditanam di koleksi; nilainya kosong dan wajib Anda isi.
  Yang digenerate hanya nilai dari konfigurasi auth collection, bila ada.
- Asersi \`row_count\` / \`column\` berasal dari layer database dan tidak dapat dijalankan
  oleh Postman; gunakan generator pytest untuk check seperti itu.
`;
}

/* ------------------------------------------------------------------ *
 * Entry point
 * ------------------------------------------------------------------ */

export function generate(ctx: GenerateContext): GeneratedFile[] {
  const files: GeneratedFile[] = [];
  const { collection, warnings } = buildCollection(ctx);
  ctx.warnings.push(...warnings);

  const folderCount = collection.item.length;
  files.push(
    file(
      'collection.json',
      'json',
      `Postman Collection v2.1: ${folderCount} folder, ${ctx.requests.length} request dengan skrip pm.test().`,
      `${JSON.stringify(collection, null, 2)}\n`,
    ),
  );
  files.push(
    file(
      'environment.json',
      'json',
      'Postman environment: baseUrl proyek dan variabel auth (kosong, wajib diisi pengguna).',
      environmentFile(ctx),
    ),
  );
  files.push(
    file(
      'README.md',
      'yaml',
      'Perintah newman, cara impor ke Postman GUI, dan catatan batasan.',
      postmanReadme(ctx),
    ),
  );

  if (ctx.layers.includes('db')) {
    ctx.warnings.push(
      'Postman tidak dapat menjalankan assertion layer database; gunakan generator pytest untuk DB check.',
    );
  }
  void safeSegment;
  return files;
}
