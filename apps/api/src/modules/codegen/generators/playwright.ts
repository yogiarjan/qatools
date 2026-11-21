/**
 * Playwright (TypeScript) generator.
 *
 * Emits a complete, runnable Playwright project:
 *   playwright.config.ts · package.json · tsconfig.json
 *   fixtures/ · pages/*.page.ts (page objects from web flows) · tests/*.spec.ts
 *   tests/*.api.spec.ts (request-fixture API specs)
 *
 * Mapping rules (ARCHITECTURE.md §11.3 rule 2 — runnable, never pseudocode):
 *   WebStep.goto           → page.goto(url)
 *   WebStep.click          → locator.click()
 *   WebStep.fill           → locator.fill(value)
 *   WebStep.select         → locator.selectOption(value)
 *   WebStep.check/uncheck  → locator.check()/uncheck()
 *   WebStep.press          → locator.press(key)
 *   WebStep.wait           → page.waitForTimeout(ms)   (explicitly flagged as a smell)
 *   WebStep.assert_text    → expect(locator).toContainText(expected)
 *   WebStep.assert_visible → expect(locator).toBeVisible()
 *   WebStep.assert_url     → expect(page).toHaveURL(expected)
 *   WebStep.screenshot     → page.screenshot({ path })
 *   WebStep.hover          → locator.hover()
 *   WebStep.scroll         → locator.scrollIntoViewIfNeeded()
 */

import type { Assertion, WebStep } from '@qatools/shared';
import {
  matcherFor,
  resolveApiAssertionJs,
  type AssertionTarget,
} from '../assertions-map.js';
import { file, type GenerateContext, type GeneratedFile, type ResolvedFlow } from '../types.js';
import {
  camelCase,
  clampInt,
  commentLine,
  labelOf,
  pascalCase,
  safeSegment,
  tsStr,
  textOf,
} from '../util.js';
import { ancestryLine } from '../gather.js';

const PLAYWRIGHT_VERSION = '^1.49.0';
const TYPES_NODE_VERSION = '^22.9.0';
const TYPESCRIPT_VERSION = '^5.6.3';

/* ------------------------------------------------------------------ *
 * Selector handling
 * ------------------------------------------------------------------ */

/**
 * Turns a QATools selector into a Playwright locator expression.
 *
 * QATools selectors are CSS by convention, but an AI-authored flow may contain a
 * Playwright-native selector (`text=`, `role=`, `xpath=`, `//`). Those pass through
 * untouched; everything else becomes `page.locator('...')` with the selector quoted.
 */
function locatorExpr(pageVar: string, selector: unknown, fallback = 'body'): string {
  const raw = textOf(selector, '').trim() || fallback;
  return `${pageVar}.locator(${tsStr(raw)})`;
}

/** `https://x/y` or `/path` → a `page.goto()` argument. */
function gotoArg(value: unknown, baseUrl: string): string {
  const raw = textOf(value, '').trim();
  if (!raw) return tsStr(baseUrl);
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) return tsStr(raw);
  if (raw.startsWith('/') || raw.startsWith('?')) return tsStr(raw);
  if (raw.startsWith('#')) return tsStr(`/${raw}`);
  return tsStr(raw);
}

/* ------------------------------------------------------------------ *
 * WebStep → Playwright statements
 * ------------------------------------------------------------------ */

interface StepEmission {
  code: string[];
  /** Set when the step could not be translated faithfully. */
  warning?: string;
}

function emitWebStep(step: WebStep, pageVar: string, index: number, baseUrl: string): StepEmission {
  const note = step.description ? `// ${commentLine(step.description)}` : '';
  const timeout = typeof step.timeout_ms === 'number' && Number.isFinite(step.timeout_ms)
    ? `, { timeout: ${clampInt(step.timeout_ms, 0, 600_000)} }`
    : '';
  const loc = () => locatorExpr(pageVar, step.selector);
  const value = () => textOf(step.value, '');
  const expected = () => textOf(step.expected, '');
  const lines: string[] = [];
  const push = (line: string) => lines.push(line);

  switch (step.action) {
    case 'goto':
      push(`await ${pageVar}.goto(${gotoArg(step.value ?? step.expected, baseUrl)})${timeout};`);
      break;
    case 'click':
      push(`await ${loc()}.click()${timeout};`);
      break;
    case 'fill':
      push(`await ${loc()}.fill(${tsStr(value())})${timeout};`);
      break;
    case 'select':
      push(`await ${loc()}.selectOption(${tsStr(value())})${timeout};`);
      break;
    case 'check':
      push(`await ${loc()}.check()${timeout};`);
      break;
    case 'uncheck':
      push(`await ${loc()}.uncheck()${timeout};`);
      break;
    case 'press':
      push(`await ${loc()}.press(${tsStr(value() || 'Enter')})${timeout};`);
      break;
    case 'wait': {
      // Honest emission: a raw sleep in Playwright is a smell, and the generated
      // comment says so rather than silently pretending it is a smart wait.
      const ms = clampInt(value() || step.timeout_ms, 0, 60_000);
      push(`// QATools "wait" step — pertimbangkan mengganti dengan web-first assertion.`);
      push(`await ${pageVar}.waitForTimeout(${ms});`);
      break;
    }
    case 'assert_text':
      push(`await expect(${loc()}).toContainText(${tsStr(expected())});`);
      break;
    case 'assert_visible':
      push(`await expect(${loc()}).toBeVisible();`);
      break;
    case 'assert_url':
      push(`await expect(${pageVar}).toHaveURL(new RegExp(escapeRegExp(${tsStr(expected())})));`);
      break;
    case 'screenshot':
      push(
        `await ${pageVar}.screenshot({ path: testInfo.outputPath(${tsStr(
          `${String(index + 1).padStart(2, '0')}-${safeSegment(value() || step.selector || 'step', 'step')}.png`,
        )}) });`,
      );
      break;
    case 'hover':
      push(`await ${loc()}.hover()${timeout};`);
      break;
    case 'scroll':
      push(`await ${loc()}.scrollIntoViewIfNeeded()${timeout};`);
      break;
    default:
      return {
        code: [`// TODO tidak dihasilkan: aksi "${textOf(step.action, 'unknown')}" belum dipetakan.`],
        warning: `Aksi web "${textOf(step.action, 'unknown')}" belum punya padanan Playwright.`,
      };
  }

  return { code: note ? [note, ...lines] : lines };
}

/* ------------------------------------------------------------------ *
 * Assertion → expect() chain
 * ------------------------------------------------------------------ */

function renderMatcher(t: AssertionTarget): string {
  const subject = `actual`;
  const m = t.matcher;
  const num = (v: unknown): string => {
    const n = typeof v === 'number' ? v : Number(textOf(v, '0'));
    return Number.isFinite(n) ? String(n) : '0';
  };
  switch (m.kind) {
    case 'equal':
      return `expect(${subject}).toEqual(${tsLiteral(m.expected)});`;
    case 'not_equal':
      return `expect(${subject}).not.toEqual(${tsLiteral(m.expected)});`;
    case 'contains':
      return `expect(String(${subject})).toContain(${tsStr(m.expected)});`;
    case 'not_contains':
      return `expect(String(${subject})).not.toContain(${tsStr(m.expected)});`;
    case 'gt':
      return `expect(${subject}).toBeGreaterThan(${num(m.expected)});`;
    case 'gte':
      return `expect(${subject}).toBeGreaterThanOrEqual(${num(m.expected)});`;
    case 'lt':
      return `expect(${subject}).toBeLessThan(${num(m.expected)});`;
    case 'lte':
      return `expect(${subject}).toBeLessThanOrEqual(${num(m.expected)});`;
    case 'exists':
      return `expect(${subject}).toBeDefined();`;
    case 'not_exists':
      return `expect(${subject}).toBeUndefined();`;
    case 'matches':
      return `expect(String(${subject})).toMatch(new RegExp(${tsStr(`(?:${m.regex ?? ''})`)}));`;
    case 'in':
      return `expect(${arrayLiteral(m.expected)}).toContain(${subject});`;
    case 'length_gte':
      return `expect(${lengthOf(subject)}).toBeGreaterThanOrEqual(${num(m.expected)});`;
    case 'length_lte':
      return `expect(${lengthOf(subject)}).toBeLessThanOrEqual(${num(m.expected)});`;
    default:
      return `expect(${subject}).toBeDefined();`;
  }
}

function lengthOf(subject: string): string {
  return `(Array.isArray(${subject}) ? ${subject}.length : typeof ${subject} === 'string' ? ${subject}.length : Object.keys(${subject} ?? {}).length)`;
}

/** TypeScript literal for an arbitrary expected value. */
function tsLiteral(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (Array.isArray(value)) return arrayLiteral(value);
  if (typeof value === 'string') return tsStr(value);
  try {
    return JSON.stringify(value) ?? 'null';
  } catch {
    return 'null';
  }
}

function arrayLiteral(value: unknown): string {
  const list = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.replace(/^\[|\]$/g, '').split(',').map((s) => s.trim()).filter(Boolean)
      : [];
  return `[${list.map((v) => tsLiteral(v)).join(', ')}]`;
}

/** Emits one assertion as an `expect()` block with the DSL message preserved. */
function assertionBlock(t: AssertionTarget, subjectExpr: string, indent = ''): string[] {
  const lines: string[] = [];
  const label = `${t.label} ${t.assertion.operator}${t.matcher.display !== 'null' ? ` ${t.matcher.display}` : ''}`;
  lines.push(`${indent}// Assertion DSL: ${commentLine(label)}`);
  if (t.assertion.message) lines.push(`${indent}// ${commentLine(t.assertion.message)}`);
  lines.push(`${indent}const actual = ${subjectExpr};`);
  lines.push(`${indent}${renderMatcher(t)}`);
  return lines;
}

/* ------------------------------------------------------------------ *
 * API spec rendering
 * ------------------------------------------------------------------ */

function apiSubjectPairs(assertion: Assertion, responseVar: string, parsedVar: string): { subject: string; label: string } | null {
  return resolveApiAssertionJs(assertion, {
    response: responseVar,
    status: `${responseVar}.status()`,
    duration: `Number(${responseVar}.headers()['x-response-time'] ?? 0)`,
    header: (name) => `${responseVar}.headers()[${tsStr(name.toLowerCase())}]`,
    json: (path) => `getByPath(${parsedVar}, ${tsStr(path)})`,
    text: `${parsedVar} === undefined ? '' : JSON.stringify(${parsedVar})`,
  });
}

/* ------------------------------------------------------------------ *
 * Config + manifests
 * ------------------------------------------------------------------ */

function playwrightConfig(ctx: GenerateContext): string {
  const workers = ctx.parallel ? clampInt(ctx.workers, 1, 16) : 1;
  const shard = ctx.parallel
    ? `\n  // Sharding: jalankan per-shard di CI, mis.\n  //   npx playwright test --shard=$SHARD_INDEX/${workers}\n`
    : '';
  return `import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config — digenerate oleh QATools untuk proyek "${ctx.project.name}".
 *
 * Menjalankan:
 *   npx playwright test              # semua test
 *   npx playwright test --ui         # mode interaktif
 *   npx playwright show-report       # buka laporan HTML
 */
export default defineConfig({
  testDir: './tests',
  // Playwright hanya menjalankan *.spec.ts; hasil generate QATools memakai pola ini.
  testMatch: '**/*.spec.ts',
  fullyParallel: ${ctx.parallel ? 'true' : 'false'},
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: ${workers},
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['junit', { outputFile: 'test-results/junit.xml' }],
  ],
  use: {
    baseURL: process.env.PW_BASE_URL ?? ${tsStr(ctx.base_url)},
    // Trace selalu aktif; artefak hanya disimpan ketika test gagal.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    ignoreHTTPSErrors: true,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  outputDir: 'test-results',
});${shard}
`;
}

function packageJson(ctx: GenerateContext): string {
  return `${JSON.stringify(
    {
      name: ctx.slug,
      version: '1.0.0',
      private: true,
      description: `Automation project untuk "${ctx.project.name}" — digenerate QATools (Playwright).`,
      scripts: {
        test: 'playwright test',
        'test:headed': 'playwright test --headed',
        'test:ui': 'playwright test --ui',
        'test:debug': 'playwright test --debug',
        report: 'playwright show-report',
        typecheck: 'tsc --noEmit',
      },
      devDependencies: {
        '@playwright/test': PLAYWRIGHT_VERSION,
        '@types/node': TYPES_NODE_VERSION,
        typescript: TYPESCRIPT_VERSION,
      },
    },
    null,
    2,
  )}\n`;
}

function tsconfig(): string {
  return `${JSON.stringify(
    {
      compilerOptions: {
        target: 'ES2022',
        module: 'ESNext',
        moduleResolution: 'Bundler',
        lib: ['ES2022', 'DOM'],
        strict: true,
        noEmit: true,
        esModuleInterop: true,
        skipLibCheck: true,
        forceConsistentCasingInFileNames: true,
        resolveJsonModule: true,
        types: ['node'],
        baseUrl: '.',
        paths: { '@fixtures/*': ['fixtures/*'], '@pages/*': ['pages/*'] },
      },
      include: ['tests/**/*.ts', 'pages/**/*.ts', 'fixtures/**/*.ts', 'playwright.config.ts'],
    },
    null,
    2,
  )}\n`;
}

/* ------------------------------------------------------------------ *
 * Fixtures
 * ------------------------------------------------------------------ */

function fixturesFile(ctx: GenerateContext): string {
  const flowsUsingPageObject = ctx.flows.filter((f) => f.steps.length > 0);
  const pageImports = flowsUsingPageObject
    .map((f) => f.flow.name)
    .map((name) => pascalCase(name, 'Flow'))
    .filter((v, i, arr) => arr.indexOf(v) === i);

  const pageEntries = pageImports
    .map((cls) => `  ${camelCase(cls)}: ${cls};`)
    .join('\n');

  const pageFixtureCode = pageImports.length
    ? `
/** Page object yang tersedia otomatis di setiap test. */
export type QaPages = {
${pageEntries}
};

type QaFixtures = {
  pages: QaPages;
};

export const test = base.extend<QaFixtures>({
  pages: async ({ page }, use) => {
    const pages: QaPages = {
${pageImports.map((cls) => `      ${camelCase(cls)}: new ${cls}(page),`).join('\n')}
    };
    await use(pages);
  },
});
`
    : `
/** Tidak ada web flow pada generate ini, jadi tidak ada page object. */
export const test = base;
`;

  return `import { test as base, expect, type Page, type APIRequestContext } from '@playwright/test';
${pageImports.map((cls) => `import { ${cls} } from '../pages/${safeSegment(snakeKebab(cls))}.page';`).join('\n')}

/**
 * Fixtures bersama untuk seluruh spec QATools.
 * Diekspor sebagai \`test\`/\`expect\` supaya spec cukup:
 *   import { test, expect } from '../fixtures/qa.fixture';
 */

/** Utilitas kecil yang dipakai spec API. */
export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&');
}

/** JSONPath sederhana (\`$.data.items[0].id\`) — cukup untuk assertion QATools. */
export function getByPath(doc: unknown, path: string): unknown {
  if (!path) return doc;
  const parts = path
    .replace(/^\\$\\.?/, '')
    .split('.')
    .flatMap((segment) =>
      segment
        .replace(/\\[(\\d+)\\]/g, '.$1')
        .split('.')
        .filter(Boolean),
    );
  let current: unknown = doc;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (Array.isArray(current)) {
      const index = Number(part);
      if (!Number.isInteger(index)) return undefined;
      current = current[index];
      continue;
    }
    if (typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/** Header Authorization sesuai konfigurasi auth collection. */
export function authHeaders(token: string | undefined): Record<string, string> {
  return token ? { Authorization: \`Bearer \${token}\` } : {};
}
${pageFixtureCode}
export { expect };

/** Tipe yang dipakai spec API QATools. */
export type { Page, APIRequestContext };
`;
}

/** `OrderPage` → `order-page`. */
function snakeKebab(pascal: string): string {
  return pascal
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .toLowerCase();
}

/* ------------------------------------------------------------------ *
 * Page objects
 * ------------------------------------------------------------------ */

function pageObjectFor(flow: ResolvedFlow): string {
  const cls = pascalCase(flow.flow.name, 'Flow');
  const steps = flow.steps;

  const selectors = steps
    .map((s, i) => ({ selector: textOf(s.selector, '').trim(), index: i }))
    .filter((s) => s.selector !== '')
    .reduce<Map<string, string>>((acc, s) => {
      if (!acc.has(s.selector)) {
        const prop = camelCase(`el ${snakeKebab(s.selector.replace(/[^A-Za-z0-9]+/g, '-'))}`.trim(), `element${acc.size + 1}`);
        acc.set(s.selector, prop);
      }
      return acc;
    }, new Map());

  const fields = [...selectors.entries()]
    .map(([selector, prop]) => `  /** Selector: ${commentLine(selector)} */\n  readonly ${prop}: Locator;`)
    .join('\n');

  const assignments = [...selectors.entries()]
    .map(([selector, prop]) => `    this.${prop} = page.locator(${tsStr(selector)});`)
    .join('\n');

  const methods: string[] = [];
  if (steps.some((s) => s.action === 'goto' || flow.start_url)) {
    methods.push(
      `  /** Buka halaman awal flow. */\n  async open(): Promise<void> {\n    await this.page.goto(${tsStr(
        flow.start_url || '',
      )});\n  }`,
    );
  }

  for (const step of steps) {
    const name = camelCase(step.description || `${step.action} ${step.selector ?? step.value ?? ''}`, `step${methods.length + 1}`);
    const emission = emitWebStep(step, 'this.page', 0, flow.start_url);
    const body = emission.code
      .filter((l) => !l.startsWith('// QATools "wait"'))
      .map((l) => `    ${l}`)
      .join('\n');
    methods.push(
      `  /** ${commentLine(step.description || `${step.action} ${step.selector ?? ''}`)} */\n  async ${name}(): Promise<void> {\n${body || '    // No-op: step ini tidak punya aksi yang bisa diotomasi.'}\n  }`,
    );
  }

  return `import { type Locator, type Page, expect } from '@playwright/test';

/**
 * Page object untuk web flow "${commentLine(flow.flow.name)}".
${flow.test_case_code ? ` * Test case: ${flow.test_case_code} — ${commentLine(flow.test_case_title)}\n` : ''} * Halaman awal: ${commentLine(flow.start_url)}
 * Digenerate QATools — sunting selector di sini ketika UI berubah.
 */
export class ${cls} {
  readonly page: Page;

${fields || '  // Flow ini belum punya selector; tambahkan locator di sini.'}

  constructor(page: Page) {
    this.page = page;
${assignments}
  }

${methods.join('\n\n') || '  // Belum ada langkah pada flow ini.'}
}

export default ${cls};
`;
}

/* ------------------------------------------------------------------ *
 * Specs
 * ------------------------------------------------------------------ */

function isSafeTsIdentifier(value: string): boolean {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value);
}

function webSpec(ctx: GenerateContext): { content: string; warnings: string[] } {
  const warnings: string[] = [];
  const pageObjectClasses = [
    ...new Set(ctx.flows.map((f) => pascalCase(f.flow.name, 'Flow'))),
  ];

  // A page object is instantiated inside the spec, so it MUST be imported — an
  // unimported class is a ReferenceError the moment the user runs the suite.
  const imports = [
    `import { test, expect, escapeRegExp } from '../fixtures/qa.fixture';`,
    ...pageObjectClasses.map(
      (cls) => `import { ${cls} } from '../pages/${safeSegment(snakeKebab(cls))}.page';`,
    ),
  ].join('\n');

  const header = `${imports}\n`;

  const blocks: string[] = [];

  if (!ctx.flows.length) {
    blocks.push(`test.describe(${tsStr('Belum ada web flow')}, () => {
  test.skip(${tsStr('Placeholder — belum ada web flow di proyek ini')}, async ({ page }) => {
    // Proyek ini belum punya web flow, jadi tidak ada skenario UI yang bisa dijalankan.
    // Buat web flow di QATools (menu Web Automation) lalu generate ulang.
    await page.goto('/');
  });
});`);
    return { content: `${header}\n${blocks.join('\n\n')}\n`, warnings };
  }

  // One describe per web flow, titled with the real test-case title when bound.
  for (const flow of ctx.flows) {
    const title = flow.test_case_title
      ? `${flow.test_case_code ? `${flow.test_case_code} — ` : ''}${flow.test_case_title}`
      : `Web flow: ${flow.flow.name}`;
    const cls = pascalCase(flow.flow.name, 'Flow');
    const caseRecord = flow.test_case_id
      ? ctx.cases.find((c) => c.test_case.id === flow.test_case_id)
      : undefined;
    const ancestry = caseRecord ? ancestryLine(caseRecord.ancestry) : '';

    const stepsCode: string[] = [];
    // Only emit the implicit navigation when the flow does not already navigate as
    // its first step — otherwise the spec contains a redundant double `goto`.
    const firstIsGoto = flow.steps[0]?.action === 'goto';
    if (flow.start_url && !firstIsGoto) {
      stepsCode.push(`    await page.goto(${tsStr(flow.start_url)});`);
    }
    for (let i = 0; i < flow.steps.length; i++) {
      const step = flow.steps[i] as WebStep;
      const emission = emitWebStep(step, 'page', i, flow.start_url || ctx.base_url);
      if (emission.warning) warnings.push(`${flow.flow.name}: ${emission.warning}`);
      for (const line of emission.code) {
        if (line.startsWith('// TODO tidak dihasilkan')) {
          warnings.push(`${flow.flow.name}: ${line.replace('// TODO tidak dihasilkan: ', '')}`);
          continue;
        }
        stepsCode.push(`    ${line}`);
      }
    }

    const assertionsCode: string[] = [];
    if (caseRecord) {
      for (const step of caseRecord.steps) {
        const expectedText = textOf(step.expected, '');
        const actionText = textOf(step.action, '');
        if (!expectedText) {
          // Steps without an expectation are still emitted as a comment so the
          // generated test remains a faithful record of the manual case.
          assertionsCode.push(`    // Langkah manual: ${commentLine(`${actionText} ${textOf(step.data, '')}`)}`);
          continue;
        }
        assertionsCode.push(
          `    // ${commentLine(`${step.order_index}. ${actionText} → ${expectedText}`)}`,
        );
        assertionsCode.push(
          `    await expect(page.locator('body')).toContainText(${tsStr(expectedText.slice(0, 120))});`,
        );
      }
      for (const row of caseRecord.data) {
        assertionsCode.push(`    // Data uji ${commentLine(row.field)} = ${commentLine(row.value)}`);
      }
    }

    blocks.push(`test.describe(${tsStr(title)}, () => {
${ancestry ? `  // Traceability: ${commentLine(ancestry)}\n` : ''}  test(${tsStr(
      labelOf(flow.test_case_title ?? flow.flow.name, 'Web flow'),
    )}, async ({ page }) => {
    const ${camelCase(flow.flow.name, 'flow')} = new ${cls}(page);
${stepsCode.join('\n') || '    // Flow belum punya langkah.'}
${assertionsCode.length ? `\n${assertionsCode.join('\n')}\n` : ''}  });
});`);
  }

  // Manual cases that have no web flow yet — surfaced instead of silently dropped.
  const uncovered = ctx.cases.filter(
    (c) =>
      !ctx.flows.some((f) => f.test_case_id === c.test_case.id) &&
      c.test_case.layer === 'web',
  );
  if (uncovered.length) {
    for (const c of uncovered) {
      const id = camelCase(c.test_case.code, 'case');
      const safe = isSafeTsIdentifier(id) ? id : `case_${safeSegment(id, 'case').replace(/-/g, '_')}`;
      if (safe !== id) warnings.push(`Kode test case "${c.test_case.code}" bukan identifier TS valid; dipakai "${safe}".`);
      const comments = c.steps
        .map((s) => `    // ${commentLine(`${s.order_index}. ${textOf(s.action, '')} → ${textOf(s.expected, '')}`)}`)
        .join('\n');
      blocks.push(`test.describe(${tsStr(`${c.test_case.code} — ${c.test_case.title}`)}, () => {
${
  ancestryLine(c.ancestry) ? `  // Traceability: ${commentLine(ancestryLine(c.ancestry))}\n` : ''
}  test.fixme(${tsStr('Belum ada web flow otomatis untuk test case ini')}, async ({ page }) => {
    // Test case ini ber-layer web tetapi belum punya web flow di QATools.
    // Langkah manualnya dipertahankan sebagai komentar supaya tidak hilang.
${comments || '    // Belum ada langkah pada test case ini.'}
    await page.goto('/');
  });
});`);
    }
    warnings.push(
      `${uncovered.length} test case ber-layer web belum punya web flow; spec-nya dibuat sebagai test.fixme berisi langkah manual.`,
    );
  }

  return { content: `${header}\n${blocks.join('\n\n')}\n`, warnings };
}

function apiSpec(ctx: GenerateContext): { content: string; warnings: string[] } {
  const warnings: string[] = [];
  const header = `import { test, expect } from '../fixtures/qa.fixture';
import { getByPath } from '../fixtures/qa.fixture';
`;

  if (!ctx.requests.length) {
    return {
      content: `${header}
test.describe(${tsStr('Belum ada API request')}, () => {
  test.skip(${tsStr('Placeholder — belum ada API request di proyek ini')}, async ({ request }) => {
    // Buat API request di QATools (menu API Tester) lalu generate ulang.
    await request.get('/');
  });
});
`,
      warnings,
    };
  }

  // Group requests by collection so the spec reads like the QATools UI.
  const byCollection = new Map<string, typeof ctx.requests>();
  for (const r of ctx.requests) {
    const list = byCollection.get(r.collection_name) ?? [];
    list.push(r);
    byCollection.set(r.collection_name, list);
  }

  const groups: string[] = [];
  for (const [collectionName, list] of byCollection) {
    const tests: string[] = [];
    for (const r of list) {
      const title = r.test_case_code
        ? `${r.test_case_code} — ${labelOf(r.test_case_title, r.request.name)}`
        : `${r.request.method} ${textOf(r.request.path, '/')} — ${labelOf(r.request.name)}`;
      const url = /^https?:\/\//i.test(textOf(r.request.path, ''))
        ? textOf(r.request.path, '')
        : `${textOf(r.base_url, '').replace(/\/+$/, '')}${textOf(r.request.path, '/').startsWith('/') ? '' : '/'}${textOf(r.request.path, '/')}`;

      const headers: Record<string, string> = { ...r.headers };
      if (r.auth.type === 'bearer' && r.auth.token) headers.Authorization = `Bearer ${r.auth.token}`;
      if (r.auth.type === 'basic' && r.auth.username) headers.Authorization = `Basic ${r.auth.username}:${r.auth.password ?? ''}`;
      if (r.auth.type === 'api_key' && r.auth.header) headers[r.auth.header] = r.auth.value ?? '';

      const body = textOf(r.request.body, '');
      let dataLiteral = 'undefined';
      if (body && r.request.body_type === 'json') {
        try {
          dataLiteral = JSON.stringify(JSON.parse(body));
        } catch {
          dataLiteral = JSON.stringify(body);
          warnings.push(
            `Body request "${labelOf(r.request.name)}" diberi tipe JSON tetapi bukan JSON valid; dikirim sebagai string mentah.`,
          );
        }
      } else if (body) {
        dataLiteral = JSON.stringify(body);
      }

      const assertions: string[] = [];
      const parsedVar = 'parsed';
      for (const a of r.assertions) {
        const pair = apiSubjectPairs(a, 'response', parsedVar);
        if (!pair) {
          warnings.push(
            `Assertion "${a.source}" pada request "${labelOf(r.request.name)}" tidak bisa dipetakan ke Playwright API testing dan dilewati.`,
          );
          continue;
        }
        const target: AssertionTarget = {
          subject: pair.subject,
          label: pair.label,
          matcher: matcherFor(a),
          assertion: a,
        };
        assertions.push(...assertionBlock(target, pair.subject, '      '));
      }

      if (!r.assertions.length) {
        // No declared assertions: at minimum prove the endpoint answered 2xx.
        assertions.push('      // Tidak ada assertion eksplisit pada request ini; default: status < 400.');
        assertions.push('      expect(response.status(), `HTTP ${response.status()}`).toBeLessThan(400);');
      }

      tests.push(`    test(${tsStr(title)}, async ({ request }) => {
      const response = await request.fetch(${tsStr(url)}, {
        method: ${tsStr(textOf(r.request.method, 'GET'))},
        headers: ${JSON.stringify(headers)},
${r.query && Object.keys(r.query).length ? `        params: ${JSON.stringify(r.query)},\n` : ''}${dataLiteral === 'undefined' ? '' : `        data: ${dataLiteral},\n`}      });

      const raw = await response.text();
      let ${parsedVar}: unknown = undefined;
      try {
        ${parsedVar} = raw ? JSON.parse(raw) : undefined;
      } catch {
        ${parsedVar} = undefined;
      }

${assertions.join('\n')}
    });`);
    }

    groups.push(`  test.describe(${tsStr(collectionName)}, () => {
${tests.join('\n\n')}
  });`);
  }

  return {
    content: `${header}
test.describe(${tsStr(`API — ${ctx.project.name}`)}, () => {
  // Base URL dapat dioverride tanpa mengubah file: PW_BASE_URL=https://staging.example.com
${groups.join('\n\n')}
});
`,
    warnings,
  };
}

/* ------------------------------------------------------------------ *
 * Orchestration docs
 * ------------------------------------------------------------------ */

function helpersFile(): string {
  return `/**
 * Helper kecil yang dipakai spec QATools.
 * Fungsi-fungsi ini sengaja tanpa dependensi tambahan.
 */

/** Escape sebuah string agar aman dipakai di dalam \`new RegExp(...)\`. */
export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&');
}

/** Ambil nilai dari dokumen JSON memakai JSONPath sederhana (\`$.data.id\`). */
export function getByPath(doc: unknown, path: string): unknown {
  if (!path) return doc;
  const parts = path
    .replace(/^\\$\\.?/, '')
    .split('.')
    .flatMap((segment) => segment.replace(/\\[(\\d+)\\]/g, '.$1').split('.').filter(Boolean));
  let current: unknown = doc;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (Array.isArray(current)) {
      const index = Number(part);
      if (!Number.isInteger(index)) return undefined;
      current = current[index];
      continue;
    }
    if (typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}
`;
}

/* ------------------------------------------------------------------ *
 * Entry point
 * ------------------------------------------------------------------ */

export function generate(ctx: GenerateContext): GeneratedFile[] {
  const files: GeneratedFile[] = [];

  const web: { content: string; warnings: string[] } = ctx.layers.includes('web')
    ? webSpec(ctx)
    : { content: '', warnings: [] };
  const api: { content: string; warnings: string[] } = ctx.layers.includes('api')
    ? apiSpec(ctx)
    : { content: '', warnings: [] };
  for (const w of [...web.warnings, ...api.warnings]) ctx.warnings.push(w);

  files.push(
    file(
      'playwright.config.ts',
      'typescript',
      'Konfigurasi Playwright: reporters, trace on failure, workers/sharding, dan baseURL.',
      playwrightConfig(ctx),
    ),
  );
  files.push(
    file(
      'package.json',
      'json',
      'Manifest dependensi proyek Playwright (@playwright/test, typescript).',
      packageJson(ctx),
    ),
  );
  files.push(
    file('tsconfig.json', 'json', 'Konfigurasi TypeScript untuk spec dan page object.', tsconfig()),
  );

  files.push(
    file(
      'fixtures/qa.fixture.ts',
      'typescript',
      'Fixture bersama (test/expect + page object otomatis + helper getByPath).',
      fixturesFile(ctx),
    ),
  );
  files.push(
    file('fixtures/helpers.ts', 'typescript', 'Helper murni: escapeRegExp dan getByPath.', helpersFile()),
  );

  const generatedPageObjects: Array<{ cls: string; path: string }> = [];
  for (const flow of ctx.flows) {
    const cls = pascalCase(flow.flow.name, 'Flow');
    if (generatedPageObjects.some((p) => p.cls === cls)) continue;
    const path = `pages/${safeSegment(snakeKebab(cls))}.page.ts`;
    generatedPageObjects.push({ cls, path });
    files.push(
      file(path, 'typescript', `Page object untuk web flow "${flow.flow.name}".`, pageObjectFor(flow)),
    );
  }

  if (ctx.layers.includes('web')) {
    files.push(
      file(
        'tests/web.spec.ts',
        'typescript',
        'Spec web: satu test per web flow (dan test.fixme untuk test case web tanpa flow).',
        web.content,
      ),
    );
  }
  if (ctx.layers.includes('api')) {
    files.push(
      file(
        'tests/api.spec.ts',
        'typescript',
        'Spec API memakai fixture `request` Playwright dengan assertion dari DSL QATools.',
        api.content,
      ),
    );
  }

  if (!ctx.flows.length && !ctx.requests.length) {
    ctx.warnings.push(
      'Tidak ada web flow maupun API request: spec yang dihasilkan hanya placeholder agar `npx playwright test` tetap berjalan.',
    );
  }

  return files;
}
