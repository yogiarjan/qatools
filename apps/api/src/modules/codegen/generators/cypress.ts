/**
 * Cypress generator.
 *
 * Emits:
 *   cypress.config.js            baseUrl, retries, screenshots/videos, JUnit reporter
 *   cypress/e2e/web.cy.js        real cy.visit / cy.get / cy.contains / cy.request
 *   cypress/e2e/api.cy.js        cy.request-based API specs
 *   cypress/support/e2e.js       custom commands (assertion DSL helper)
 *   cypress/support/commands.js
 *   package.json
 *
 * Cypress runs inside the browser, so the DSL is translated to `cy.get(...).should(...)`
 * for UI assertions and plain Node assertions inside `.then()` for API payloads —
 * that split is what makes the generated specs actually pass or fail meaningfully.
 */

import type { Assertion, WebStep } from '@qatools/shared';
import { matcherFor, resolveApiAssertionJs } from '../assertions-map.js';
import { file, type GenerateContext, type GeneratedFile } from '../types.js';
import {
  clampInt,
  commentLine,
  labelOf,
  numOf,
  textOf,
  tsStr,
} from '../util.js';
import { ancestryLine } from '../gather.js';

const CYPRESS_VERSION = '^13.16.0';

/* ------------------------------------------------------------------ *
 * WebStep → Cypress command
 * ------------------------------------------------------------------ */

function cypressCommand(step: WebStep, baseUrl: string, index: number): { code: string[]; warning?: string } {
  const selector = textOf(step.selector, '').trim();
  const value = textOf(step.value, '');
  const expected = textOf(step.expected, '');
  const target = selector || 'body';
  const lines: string[] = [];

  const timeoutArg = (): string => {
    const t = typeof step.timeout_ms === 'number' && Number.isFinite(step.timeout_ms) ? clampInt(step.timeout_ms, 0, 300_000) : 0;
    return t > 0 ? `{ timeout: ${t} }` : '';
  };

  switch (step.action) {
    case 'goto': {
      const raw = value || expected || baseUrl;
      const url = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : raw || '/';
      lines.push(`cy.visit(${tsStr(url)});`);
      break;
    }
    case 'click':
      // Emit the bare call when no timeout was declared — `click({})` is valid but
      // reads like a leftover placeholder.
      lines.push(timeoutArg() ? `cy.get(${tsStr(target)}).click(${timeoutArg()});` : `cy.get(${tsStr(target)}).click();`);
      break;
    case 'fill':
      lines.push(`cy.get(${tsStr(target)}).clear().type(${tsStr(value)}, { force: false });`);
      break;
    case 'select':
      lines.push(`cy.get(${tsStr(target)}).select(${tsStr(value)});`);
      break;
    case 'check':
      lines.push(`cy.get(${tsStr(target)}).check();`);
      break;
    case 'uncheck':
      lines.push(`cy.get(${tsStr(target)}).uncheck();`);
      break;
    case 'press':
      lines.push(`cy.get(${tsStr(target)}).type(${tsStr(`{${value || 'enter'}}`)});`);
      break;
    case 'wait': {
      const ms = clampInt(value || step.timeout_ms, 0, 60_000);
      lines.push(`// QATools "wait" step — pertimbangkan mengganti dengan cy.intercept/cy.contains.`);
      lines.push(`cy.wait(${ms});`);
      break;
    }
    case 'assert_text':
      lines.push(`cy.get(${tsStr(target)}).should('contain.text', ${tsStr(expected)});`);
      break;
    case 'assert_visible':
      lines.push(`cy.get(${tsStr(target)}).should('be.visible');`);
      break;
    case 'assert_url':
      lines.push(`cy.url().should('include', ${tsStr(expected)});`);
      break;
    case 'screenshot':
      lines.push(`cy.screenshot(${tsStr(`${String(index + 1).padStart(2, '0')}-${value || 'step'}`)});`);
      break;
    case 'hover':
      // Cypress has no native hover; trigger is the honest, documented approximation.
      lines.push(`cy.get(${tsStr(target)}).trigger('mouseover');`);
      break;
    case 'scroll':
      lines.push(`cy.get(${tsStr(target)}).scrollIntoView();`);
      break;
    default:
      return {
        code: [`// Aksi "${textOf(step.action, 'unknown')}" belum dipetakan ke Cypress.`],
        warning: `Aksi web "${textOf(step.action, 'unknown')}" belum punya padanan Cypress.`,
      };
  }
  return { code: lines };
}

/* ------------------------------------------------------------------ *
 * config + package
 * ------------------------------------------------------------------ */

function cypressConfig(ctx: GenerateContext): string {
  return `const { defineConfig } = require('cypress');

/**
 * Konfigurasi Cypress — digenerate QATools untuk proyek "${ctx.project.name}".
 *
 * Menjalankan:
 *   npx cypress run            # headless, semua spec
 *   npx cypress open           # mode interaktif
 *   npx cypress run --spec cypress/e2e/${ctx.flows.length ? 'web' : 'api'}.cy.js
 */
module.exports = defineConfig({
  e2e: {
    baseUrl: process.env.CYPRESS_BASE_URL || ${tsStr(ctx.base_url)},
    specPattern: 'cypress/e2e/**/*.cy.js',
    supportFile: 'cypress/support/e2e.js',
    fixturesFolder: 'cypress/fixtures',
    screenshotsFolder: 'cypress/screenshots',
    videosFolder: 'cypress/videos',
    video: false,
    screenshotOnRunFailure: true,
    defaultCommandTimeout: 10000,
    requestTimeout: 30000,
    responseTimeout: 30000,
    retries: { runMode: process.env.CI ? 2 : 0, openMode: 0 },
    chromeWebSecurity: false,
    reporter: 'junit',
    reporterOptions: {
      mochaFile: 'reports/junit-[hash].xml',
      toConsole: false,
    },
  },
});
`;
}

function cypressPackageJson(ctx: GenerateContext): string {
  return `${JSON.stringify(
    {
      name: ctx.slug,
      version: '1.0.0',
      private: true,
      description: `Automation project Cypress untuk "${ctx.project.name}" — digenerate QATools.`,
      scripts: {
        test: 'cypress run',
        open: 'cypress open',
        'test:headed': 'cypress run --headed --browser chrome',
      },
      devDependencies: {
        cypress: CYPRESS_VERSION,
        'cypress-junit-reporter': '^2.1.1',
      },
    },
    null,
    2,
  )}\n`;
}

/* ------------------------------------------------------------------ *
 * support files
 * ------------------------------------------------------------------ */

function supportE2e(): string {
  return `// cypress/support/e2e.js — dimuat sebelum setiap spec.
require('./commands');

// Cypress gagal pada error aplikasi yang tidak tertangani; untuk aplikasi yang
// punya noise di console, baris berikut membuat run tidak berhenti karena hal
// yang bukan bagian dari skenario.
Cypress.on('uncaught:exception', (err) => {
  // eslint-disable-next-line no-console
  console.warn('Uncaught exception diabaikan:', err.message);
  return false;
});
`;
}

function supportCommands(): string {
  return `// cypress/support/commands.js — custom command untuk proyek QATools.

/**
 * Ambil nilai dari dokumen JSON memakai JSONPath sederhana: $.data.items[0].id
 * Dipakai spec API agar assertion tetap terbaca.
 */
Cypress.Commands.add('dig', (document, path) => {
  if (!path) return cy.wrap(document);
  const parts = String(path)
    .replace(/^\\$\\.?/, '')
    .split('.')
    .flatMap((segment) => segment.replace(/\\[(\\d+)\\]/g, '.$1').split('.'))
    .filter(Boolean);
  let current = document;
  for (const part of parts) {
    if (current === null || current === undefined) {
      current = undefined;
      break;
    }
    current = Array.isArray(current) ? current[Number(part)] : current[part];
  }
  return cy.wrap(current);
});

/** Login helper yang membaca kredensial dari environment Cypress. */
Cypress.Commands.add('loginByApi', (path = '/login', username, password) => {
  const user = username || Cypress.env('QA_USER');
  const pass = password || Cypress.env('QA_PASSWORD');
  if (!user || !pass) {
    throw new Error('QA_USER / QA_PASSWORD belum diisi (cypress.env.json atau -e).');
  }
  return cy
    .request({ method: 'POST', url: path, body: { username: user, password: pass } })
    .its('body')
    .then((body) => {
      if (body && body.token) window.localStorage.setItem('qa.token', body.token);
    });
});
`;
}

/* ------------------------------------------------------------------ *
 * specs
 * ------------------------------------------------------------------ */

function webSpec(ctx: GenerateContext): { content: string; warnings: string[] } {
  const warnings: string[] = [];
  const blocks: string[] = [];

  if (!ctx.flows.length) {
    blocks.push(`describe('Belum ada web flow', () => {
  it.skip('Placeholder — belum ada web flow di proyek ini', () => {
    cy.visit('/');
  });
});`);
    return { content: specHeader() + blocks.join('\n\n') + '\n', warnings };
  }

  for (const flow of ctx.flows) {
    const title = flow.test_case_title
      ? `${flow.test_case_code ? `${flow.test_case_code} — ` : ''}${flow.test_case_title}`
      : `Web flow: ${flow.flow.name}`;
    const caseRecord = flow.test_case_id ? ctx.cases.find((c) => c.test_case.id === flow.test_case_id) : undefined;
    const trace = caseRecord ? ancestryLine(caseRecord.ancestry) : '';

    const commands: string[] = [];
    // Skip the implicit visit when the flow navigates itself first, to avoid a
    // redundant double `cy.visit` in the generated spec.
    if (flow.steps[0]?.action !== 'goto') {
      commands.push(`    cy.visit(${tsStr(flow.start_url || ctx.base_url)});`);
    }
    for (let i = 0; i < flow.steps.length; i++) {
      const step = flow.steps[i] as WebStep;
      const emission = cypressCommand(step, flow.start_url || ctx.base_url, i);
      if (emission.warning) warnings.push(`${flow.flow.name}: ${emission.warning}`);
      for (const line of emission.code) {
        if (line.startsWith('// Aksi ')) continue;
        commands.push(`    ${line}`);
      }
      if (step.description) commands.push(`    // ${commentLine(step.description)}`);
    }

    // Manual steps of the source case are recorded as comments so the spec is a
    // faithful trace of the QATools case, not a lossy rewrite.
    const manual: string[] = [];
    if (caseRecord) {
      for (const step of caseRecord.steps) {
        manual.push(`    // Manual: ${commentLine(`${step.order_index}. ${textOf(step.action, '')} → ${textOf(step.expected, '')}`)}`);
      }
      const expectedResult = textOf(caseRecord.test_case.expected_result, '');
      if (expectedResult) {
        commands.push(`    cy.get('body').should('contain.text', ${tsStr(expectedResult.slice(0, 120))});`);
      }
    }

    blocks.push(`describe(${tsStr(title)}, () => {
${trace ? `  // Traceability: ${commentLine(trace)}\n` : ''}  it(${tsStr(labelOf(flow.test_case_title ?? flow.flow.name, 'Web flow'))}, () => {
${commands.join('\n')}
  });
${manual.length ? `\n  // Langkah manual pada test case sumber:\n${manual.join('\n')}\n` : ''}});`);
  }

  const uncovered = ctx.cases.filter(
    (c) => c.test_case.layer === 'web' && !ctx.flows.some((f) => f.test_case_id === c.test_case.id),
  );
  for (const c of uncovered) {
    const manual = c.steps
      .map((s) => `    // ${commentLine(`${s.order_index}. ${textOf(s.action, '')} → ${textOf(s.expected, '')}`)}`)
      .join('\n');
    blocks.push(`describe(${tsStr(`${c.test_case.code} — ${c.test_case.title}`)}, () => {
  it.skip(${tsStr('Belum ada web flow otomatis untuk test case ini')}, () => {
    // Test case ber-layer web tanpa web flow di QATools; langkah manualnya dicatat.
${manual || '    // Belum ada langkah.'}
    cy.visit('/');
  });
});`);
  }
  if (uncovered.length) {
    warnings.push(
      `${uncovered.length} test case ber-layer web belum punya web flow; dibuat sebagai spec it.skip berisi langkah manual.`,
    );
  }

  return { content: specHeader() + blocks.join('\n\n') + '\n', warnings };
}

function specHeader(): string {
  return `// Digenerate oleh QATools — jangan mengubah struktur tanpa memperbarui artefak sumber.
/* eslint-disable no-unused-expressions */

`;
}

/** Assertion DSL → a Node assertion inside `.then()`. */
function cypressAssertion(assertion: Assertion, subjectExpr: string): { lines: string[]; warning?: string } {
  const m = matcherFor(assertion);
  const lines: string[] = [];
  const expectedLiteral = (v: unknown): string => {
    if (v === null || v === undefined) return 'null';
    if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'null';
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    if (Array.isArray(v)) return `[${v.map(expectedLiteral).join(', ')}]`;
    if (typeof v === 'string') return tsStr(v);
    return JSON.stringify(v) ?? 'null';
  };

  switch (m.kind) {
    case 'equal':
      lines.push(`      expect(${subjectExpr}, ${tsStr(m.display)}).to.deep.equal(${expectedLiteral(m.expected)});`);
      break;
    case 'not_equal':
      lines.push(`      expect(${subjectExpr}).to.not.deep.equal(${expectedLiteral(m.expected)});`);
      break;
    case 'contains':
      lines.push(`      expect(String(${subjectExpr})).to.contain(${tsStr(m.display)});`);
      break;
    case 'not_contains':
      lines.push(`      expect(String(${subjectExpr})).to.not.contain(${tsStr(m.display)});`);
      break;
    case 'gt':
      lines.push(`      expect(Number(${subjectExpr})).to.be.greaterThan(${numOf(m.expected, 0)});`);
      break;
    case 'gte':
      lines.push(`      expect(Number(${subjectExpr})).to.be.at.least(${numOf(m.expected, 0)});`);
      break;
    case 'lt':
      lines.push(`      expect(Number(${subjectExpr})).to.be.lessThan(${numOf(m.expected, 0)});`);
      break;
    case 'lte':
      lines.push(`      expect(Number(${subjectExpr})).to.be.at.most(${numOf(m.expected, 0)});`);
      break;
    case 'exists':
      lines.push(`      expect(${subjectExpr}).to.not.be.undefined;`);
      break;
    case 'not_exists':
      lines.push(`      expect(${subjectExpr}).to.be.undefined;`);
      break;
    case 'matches':
      lines.push(`      expect(String(${subjectExpr})).to.match(new RegExp(${tsStr(m.regex ?? '')}));`);
      break;
    case 'in':
      lines.push(`      expect(${expectedLiteral(listFrom(m.expected))}).to.deep.include(${subjectExpr});`);
      break;
    case 'length_gte':
      lines.push(`      expect(${subjectExpr}).to.have.length.of.at.least(${numOf(m.expected, 0)});`);
      break;
    case 'length_lte':
      lines.push(`      expect(${subjectExpr}).to.have.length.of.at.most(${numOf(m.expected, 0)});`);
      break;
    default:
      return { lines: [], warning: `Operator "${assertion.operator}" belum dipetakan ke Cypress.` };
  }
  return { lines };
}

function listFrom(expected: unknown): unknown[] {
  if (Array.isArray(expected)) return expected;
  if (typeof expected === 'string') {
    return expected.replace(/^\[|\]$/g, '').split(',').map((s) => s.trim()).filter(Boolean);
  }
  return expected === null || expected === undefined ? [] : [expected];
}

function apiSpec(ctx: GenerateContext): { content: string; warnings: string[] } {
  const warnings: string[] = [];
  if (!ctx.requests.length) {
    return {
      content: `${specHeader()}describe('Belum ada API request', () => {
  it.skip('Placeholder — belum ada API request di proyek ini', () => {
    cy.request('/');
  });
});
`,
      warnings,
    };
  }

  const byCollection = new Map<string, typeof ctx.requests>();
  for (const r of ctx.requests) {
    const list = byCollection.get(r.collection_name) ?? [];
    list.push(r);
    byCollection.set(r.collection_name, list);
  }

  const blocks: string[] = [];
  for (const [collectionName, list] of byCollection) {
    const tests: string[] = [];
    for (const r of list) {
      const title = r.test_case_code
        ? `${r.test_case_code} — ${labelOf(r.test_case_title, r.request.name)}`
        : `${r.request.method} ${textOf(r.request.path, '/')} — ${labelOf(r.request.name)}`;

      const headers: Record<string, string> = { ...r.headers };
      if (r.auth.type === 'bearer' && r.auth.token) headers.Authorization = 'Bearer ${QA_TOKEN}';
      if (r.auth.type === 'basic' && r.auth.username) headers.Authorization = `Basic ${r.auth.username}:${r.auth.password ?? ''}`;
      if (r.auth.type === 'api_key' && r.auth.header) headers[r.auth.header] = textOf(r.auth.value, '');

      const path = textOf(r.request.path, '/');
      const url = /^[a-z][a-z0-9+.-]*:\/\//i.test(path) ? path : path;
      const bodyText = textOf(r.request.body, '');
      let bodyLiteral = 'undefined';
      if (bodyText && r.request.body_type === 'json') {
        try {
          bodyLiteral = JSON.stringify(JSON.parse(bodyText));
        } catch {
          bodyLiteral = tsStr(bodyText);
          warnings.push(
            `Cypress: body request "${labelOf(r.request.name)}" diberi tipe JSON tetapi bukan JSON valid; dikirim sebagai string.`,
          );
        }
      } else if (bodyText) {
        bodyLiteral = tsStr(bodyText);
      }

      const assertionLines: string[] = [];
      for (const a of r.assertions) {
        const resolved = resolveApiAssertionJs(a, {
          response: 'response',
          status: 'response.status',
          duration: 'response.duration',
          header: (name) => `response.headers[${tsStr(name.toLowerCase())}]`,
          json: (p) => `dig(${tsStr(p)})`,
          text: 'response.body === undefined ? "" : JSON.stringify(response.body)',
        });
        if (!resolved) {
          warnings.push(
            `Cypress: assertion source "${a.source}" pada request "${labelOf(r.request.name)}" tidak didukung.`,
          );
          continue;
        }
        const rendered = cypressAssertion(a, resolved.subject);
        if (rendered.warning) {
          warnings.push(`Cypress: ${rendered.warning}`);
          continue;
        }
        assertionLines.push(`      // ${commentLine(`${resolved.label} ${a.operator}`)}`);
        assertionLines.push(...rendered.lines);
      }

      if (!assertionLines.length) {
        assertionLines.push(`      // Tidak ada assertion eksplisit; minimal pastikan status < 400.`);
        assertionLines.push('      expect(response.status).to.be.lessThan(400);');
      }

      tests.push(`    it(${tsStr(title)}, () => {
      cy.request({
        method: ${tsStr(textOf(r.request.method, 'GET').toUpperCase())},
        url: ${tsStr(url)},
        failOnStatusCode: false,
${Object.keys(headers).length ? `        headers: ${JSON.stringify(headers)},\n` : ''}${r.query && Object.keys(r.query).length ? `        qs: ${JSON.stringify(r.query)},\n` : ''}${bodyLiteral === 'undefined' ? '' : `        body: ${bodyLiteral},\n`}      }).then((response) => {
        const payload = typeof response.body === 'string' ? safeParse(response.body) : response.body;
        const dig = (path) => {
          if (!payload || !path) return payload;
          return String(path)
            .replace(/^\\$\\.?/, '')
            .split('.')
            .flatMap((segment) => segment.replace(/\\[(\\d+)\\]/g, '.$1').split('.'))
            .filter(Boolean)
            .reduce((acc, part) => (acc === null || acc === undefined ? undefined : acc[part]), payload);
        };

${assertionLines.join('\n')}
      });
    });`);
    }

    blocks.push(`  describe(${tsStr(collectionName)}, () => {
${tests.join('\n\n')}
  });`);
  }

  const content = `${specHeader()}/**
 * Assertion API untuk "${ctx.project.name}".
 * Base URL diambil dari cypress.config.js (override: CYPRESS_BASE_URL=...).
 */
function safeParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

describe(${tsStr(`API — ${ctx.project.name}`)}, () => {
${blocks.join('\n\n')}
});
`;
  return { content, warnings };
}

/* ------------------------------------------------------------------ *
 * Entry point
 * ------------------------------------------------------------------ */

export function generate(ctx: GenerateContext): GeneratedFile[] {
  const files: GeneratedFile[] = [];

  files.push(
    file('cypress.config.js', 'javascript', 'Konfigurasi Cypress: baseUrl, retries, reporter JUnit, screenshot on failure.', cypressConfig(ctx)),
  );
  files.push(
    file('package.json', 'json', 'Manifest dependensi Cypress + skrip menjalankan.', cypressPackageJson(ctx)),
  );
  files.push(file('cypress/support/e2e.js', 'javascript', 'Bootstrap support file Cypress (dimuat sebelum setiap spec).', supportE2e()));
  files.push(
    file('cypress/support/commands.js', 'javascript', 'Custom command: dig() untuk JSONPath dan loginByApi().', supportCommands()),
  );
  files.push(
    file(
      'cypress.env.json',
      'json',
      'Contoh environment Cypress (kredensial) — ganti sebelum menjalankan.',
      `${JSON.stringify({ QA_USER: '', QA_PASSWORD: '', QA_TOKEN: '' }, null, 2)}\n`,
    ),
  );

  if (ctx.layers.includes('web')) {
    const web = webSpec(ctx);
    ctx.warnings.push(...web.warnings);
    files.push(
      file('cypress/e2e/web.cy.js', 'javascript', 'Spec web: satu `it` per web flow dengan cy.visit/cy.get/cy.contains.', web.content),
    );
  }
  if (ctx.layers.includes('api')) {
    const api = apiSpec(ctx);
    ctx.warnings.push(...api.warnings);
    files.push(
      file('cypress/e2e/api.cy.js', 'javascript', 'Spec API memakai cy.request dengan assertion dari DSL QATools.', api.content),
    );
  }
  if (!ctx.layers.includes('web') && !ctx.layers.includes('api')) {
    files.push(
      file(
        'cypress/e2e/smoke.cy.js',
        'javascript',
        'Spec minimal agar `npx cypress run` selalu punya sesuatu untuk dijalankan.',
        `${specHeader()}describe('Smoke', () => {
  it('membuka halaman utama', () => {
    cy.visit('/');
    cy.get('body').should('be.visible');
  });
});
`,
      ),
    );
  }

  return files;
}
