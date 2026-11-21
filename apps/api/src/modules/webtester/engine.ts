/**
 * webtester engine — REAL HTTP-driven UI automation with two honest modes.
 *
 * MODE 1 — "http" (always available, zero dependencies):
 *   fetch the page with the global `fetch`, parse the HTML with the hand-written
 *   extractor in `html.ts`, then evaluate every `WebStep` and `Assertion`
 *   against text / element / selector / url / status sources.
 *
 * MODE 2 — "playwright" (OPTIONAL, user-installed):
 *   if the user installed `playwright` AND ran `npx playwright install`, a real
 *   browser is driven instead. This is attempted with a DYNAMIC
 *   `await import('playwright')` inside try/catch — never a top-level import,
 *   and never a bundled dependency, because this repo must install on a machine
 *   with no C/C++ toolchain and no downloaded browser binaries.
 *
 * `GET /execute/capabilities` reports which mode is live and why. QATools never
 * claims a browser ran when it did not.
 */

import type {
  Assertion,
  EngineResult,
  ExecuteOptions,
  RunStatus,
  StepLog,
  WebFlow,
  WebStep,
} from '@qatools/shared';
import { evaluateAssertion, evaluateAssertions } from '../execute/assertions.js';
import type { ElementObservation } from '../execute/assertions.js';
import { EngineError, emptyEngineResult, statusFromOutcome, truncate } from '../execute/engine-utils.js';
import { normalizeAssertions } from '../execute/scripting.js';
import {
  absolutise,
  analyzeDocument,
  normaliseWhitespace,
  parseHtml,
  querySelectorAll,
  type ParsedDocument,
} from './html.js';

/* ------------------------------------------------------------------ *
 * Mode detection
 * ------------------------------------------------------------------ */

export interface WebModeCapability {
  mode: 'http' | 'playwright';
  available: boolean;
  reason: string;
  /** Playwright version when it could be imported. */
  version?: string | null;
}

let playwrightProbe: { ok: boolean; version: string | null; reason: string; checkedAt: number } | null = null;
const PROBE_TTL_MS = 15_000;

/**
 * Probes for a user-installed Playwright via a guarded dynamic import.
 * Cached briefly so `/capabilities` is not an import storm.
 */
export async function probePlaywright(force = false): Promise<{ ok: boolean; version: string | null; reason: string }> {
  if (!force && playwrightProbe && Date.now() - playwrightProbe.checkedAt < PROBE_TTL_MS) {
    return playwrightProbe;
  }

  let result: { ok: boolean; version: string | null; reason: string };
  try {
    // The specifier is intentionally a runtime string so bundlers/tsc never
    // resolve it at build time and it stays a true optional peer.
    const specifier = 'playwright';
    const mod = (await import(/* @vite-ignore */ specifier)) as {
      chromium?: { launch: (opts?: unknown) => Promise<unknown> };
      default?: { chromium?: unknown };
    };
    const hasChromium = Boolean(mod?.chromium?.launch) || Boolean(mod?.default?.chromium);
    if (!hasChromium) {
      result = {
        ok: false,
        version: null,
        reason: 'Paket "playwright" dapat diimpor tetapi tidak mengekspor `chromium`. Mode browser dinonaktifkan.',
      };
    } else {
      const version = await readPlaywrightVersion(specifier);
      result = {
        ok: true,
        version,
        reason:
          'Paket "playwright" terdeteksi. Mode browser aktif bila peramban sudah diunduh ' +
          '(`npx playwright install chromium`); jika belum, eksekusi akan jatuh kembali ke mode HTTP.',
      };
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    result = {
      ok: false,
      version: null,
      reason:
        'Paket "playwright" tidak terpasang, sehingga mode browser dinonaktifkan dan engine memakai mode HTTP ' +
        `(fetch + parser HTML bawaan). Pasang sendiri bila perlu: \`pnpm -F @qatools/api add -D playwright\` lalu ` +
        '`npx playwright install chromium`. Detail: ' + reason.slice(0, 160),
    };
  }

  playwrightProbe = { ...result, checkedAt: Date.now() };
  return result;
}

async function readPlaywrightVersion(specifier: string): Promise<string | null> {
  try {
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    const pkg = require(`${specifier}/package.json`) as { version?: string };
    return pkg?.version ?? null;
  } catch {
    return null;
  }
}

/** The honest capability descriptor returned by /execute/capabilities. */
export async function webModeCapabilities(force = false): Promise<WebModeCapability[]> {
  const pw = await probePlaywright(force);
  return [
    {
      mode: 'http',
      available: true,
      reason:
        'AKTIF — mode HTTP bawaan: fetch halaman, parse HTML dengan ekstraktor internal, ' +
        'lalu evaluasi assertion pada text/element/selector/url. Tanpa dependensi native.',
      version: null,
    },
    {
      mode: 'playwright',
      available: pw.ok,
      reason: pw.ok
        ? `${pw.reason} Versi terdeteksi: ${pw.version ?? 'tidak diketahui'}.`
        : pw.reason,
      version: pw.version,
    },
  ];
}

/* ------------------------------------------------------------------ *
 * Page fetching + observation model
 * ------------------------------------------------------------------ */

interface PageSnapshot {
  url: string;
  status: number;
  html: string;
  headers: Record<string, string>;
  doc: ParsedDocument;
  /** Selector → observation, filled lazily as steps touch selectors. */
  elements: Record<string, ElementObservation>;
  duration_ms: number;
}

async function fetchPage(
  url: string,
  opts: { timeout_ms?: number; headers?: Record<string, string>; method?: string; body?: string } = {},
): Promise<PageSnapshot> {
  const started = Date.now();
  let res: Response;
  try {
    res = await fetch(url, {
      method: opts.method ?? 'GET',
      headers: opts.headers,
      body: opts.body,
      redirect: 'follow',
      signal: AbortSignal.timeout(opts.timeout_ms ?? 15000),
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw EngineError.unreachable(`Tidak dapat memuat ${url}: ${reason}`, { url });
  }

  const html = await res.text();
  const headers: Record<string, string> = {};
  res.headers.forEach((v, k) => {
    headers[k] = v;
  });

  const doc = analyzeDocument(html, res.url || url);

  return {
    url: res.url || url,
    status: res.status,
    html,
    headers,
    doc,
    elements: {},
    duration_ms: Date.now() - started,
  };
}

/** Resolves a selector against the snapshot and caches the observation. */
function observe(snapshot: PageSnapshot, selector: string): ElementObservation {
  if (snapshot.elements[selector]) return snapshot.elements[selector] as ElementObservation;

  const root = parseHtml(snapshot.html);
  const matches = querySelectorAll(root, selector);
  const first = matches[0];

  const observation: ElementObservation = first
    ? {
        found: true,
        count: matches.length,
        text: normaliseWhitespace(first.text).slice(0, 500),
        tag: first.node.tag,
        attributes: first.node.attrs,
        selector,
      }
    : { found: false, count: 0, text: '', selector };

  snapshot.elements[selector] = observation;
  return observation;
}

/** Mirrors a node:sqlite-free "element exists" check used by assert_visible. */
function elementCount(snapshot: PageSnapshot, selector: string): number {
  return observe(snapshot, selector).count;
}

/* ------------------------------------------------------------------ *
 * Step execution (HTTP mode)
 * ------------------------------------------------------------------ */

interface HttpStepOutcome {
  log: StepLog;
  status: RunStatus;
}

/** Executes one WebStep in HTTP mode. Navigation steps re-fetch the page. */
async function runHttpStep(
  snapshot: PageSnapshot | null,
  step: WebStep,
  index: number,
  opts: { timeout_ms?: number },
): Promise<{ snapshot: PageSnapshot | null; outcome: HttpStepOutcome; screenshots: string[] }> {
  const started = Date.now();
  const done = (status: RunStatus, message: string, observed?: unknown): HttpStepOutcome => ({
    status,
    log: {
      index,
      action: step.action,
      target: step.selector ?? step.value,
      status: status === 'passed' ? 'ok' : status === 'skipped' ? 'skip' : status === 'blocked' ? 'fail' : 'fail',
      message,
      duration_ms: Date.now() - started,
      observed,
    },
  });

  const needPage = step.action !== 'goto';
  if (needPage && !snapshot) {
    return {
      snapshot,
      outcome: done('blocked', 'Belum ada halaman termuat. Tambahkan langkah "goto" sebagai langkah pertama.'),
      screenshots: [],
    };
  }

  switch (step.action) {
    case 'goto': {
      const url = step.value ?? step.selector ?? '';
      if (!url) return { snapshot, outcome: done('failed', 'Langkah goto memerlukan URL pada field value.'), screenshots: [] };
      try {
        const next = await fetchPage(absolutise(url, snapshot?.url), { timeout_ms: step.timeout_ms ?? opts.timeout_ms });
        return {
          snapshot: next,
          outcome: done(
            next.status < 400 ? 'passed' : 'failed',
            `GET ${next.url} → HTTP ${next.status}, ${next.html.length} byte, ${next.doc.interactive.length} elemen interaktif`,
            next.status,
          ),
          screenshots: [],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { snapshot, outcome: done('blocked', message), screenshots: [] };
      }
    }

    case 'click':
    case 'hover':
    case 'scroll': {
      const selector = step.selector ?? '';
      if (!selector) return { snapshot, outcome: done('failed', `Langkah ${step.action} memerlukan selector.`), screenshots: [] };
      const count = elementCount(snapshot as PageSnapshot, selector);
      if (!count) {
        return {
          snapshot,
          outcome: done('failed', `Elemen "${selector}" tidak ditemukan, jadi aksi ${step.action} tidak dapat dijalankan (mode HTTP).`),
          screenshots: [],
        };
      }
      return {
        snapshot,
        outcome: done(
          'passed',
          `Elemen "${selector}" ada (${count} kecocokan). Aksi ${step.action} diverifikasi keberadaannya; ` +
            'interaksi DOM sungguhan memerlukan mode Playwright.',
          count,
        ),
        screenshots: [],
      };
    }

    case 'fill':
    case 'select':
    case 'check':
    case 'uncheck':
    case 'press': {
      const selector = step.selector ?? '';
      if (!selector) return { snapshot, outcome: done('failed', `Langkah ${step.action} memerlukan selector.`), screenshots: [] };
      const obs = observe(snapshot as PageSnapshot, selector);
      if (!obs.found) {
        return { snapshot, outcome: done('failed', `Field "${selector}" tidak ditemukan pada halaman.`), screenshots: [] };
      }
      const tag = obs.tag ?? '';
      const writable = tag === 'input' || tag === 'textarea' || tag === 'select';
      if (!writable && step.action !== 'press') {
        return {
          snapshot,
          outcome: done(
            'failed',
            `Elemen "${selector}" bertag <${tag}> dan bukan field masukan, sehingga tidak bisa di-${step.action}.`,
            obs,
          ),
          screenshots: [],
        };
      }
      return {
        snapshot,
        outcome: done(
          'passed',
          `Field "${selector}" (<${tag}>) terverifikasi ada. Nilai "${step.value ?? ''}" dicatat; ` +
            'pengisian DOM nyata memerlukan mode Playwright.',
          obs,
        ),
        screenshots: [],
      };
    }

    case 'assert_text': {
      const expected = step.expected ?? step.value ?? '';
      const scope = step.selector ?? '';
      const haystack = scope ? (observe(snapshot as PageSnapshot, scope).text ?? '') : (snapshot as PageSnapshot).doc.text;
      const ok = haystack.toLowerCase().includes(expected.toLowerCase());
      return {
        snapshot,
        outcome: done(
          ok ? 'passed' : 'failed',
          ok
            ? `Teks "${expected}" ditemukan${scope ? ` di dalam "${scope}"` : ' pada halaman'}.`
            : `Teks "${expected}" TIDAK ditemukan${scope ? ` di dalam "${scope}"` : ' pada halaman'}.`,
          truncate(haystack, 300),
        ),
        screenshots: [],
      };
    }

    case 'assert_visible': {
      const selector = step.selector ?? '';
      const count = elementCount(snapshot as PageSnapshot, selector);
      return {
        snapshot,
        outcome: done(
          count > 0 ? 'passed' : 'failed',
          count > 0 ? `Elemen "${selector}" terlihat (ada di HTML).` : `Elemen "${selector}" tidak ada di HTML.`,
          count,
        ),
        screenshots: [],
      };
    }

    case 'assert_url': {
      const expected = step.expected ?? step.value ?? '';
      const current = (snapshot as PageSnapshot).url;
      const ok = current.includes(expected);
      return {
        snapshot,
        outcome: done(
          ok ? 'passed' : 'failed',
          `URL saat ini ${current}${ok ? ' memuat ' : ' tidak memuat '}"${expected}".`,
          current,
        ),
        screenshots: [],
      };
    }

    case 'wait': {
      const ms = Number(step.value ?? 0) || step.timeout_ms || 0;
      // A real wait is only meaningful in browser mode; HTTP mode records it.
      return {
        snapshot,
        outcome: done('skipped', `Langkah "wait" ${ms} ms dilewati pada mode HTTP (halaman sudah termuat penuh).`),
        screenshots: [],
      };
    }

    case 'screenshot': {
      return {
        snapshot,
        outcome: done(
          'skipped',
          'Screenshot memerlukan mode Playwright; pada mode HTTP tidak ada render grafis yang bisa diambil.',
        ),
        screenshots: [],
      };
    }

    default: {
      const unknown = step.action as string;
      return { snapshot, outcome: done('failed', `Aksi "${unknown}" belum didukung oleh engine web.`), screenshots: [] };
    }
  }
}

/* ------------------------------------------------------------------ *
 * Playwright mode (optional)
 * ------------------------------------------------------------------ */

interface BrowserStepOutcome {
  log: StepLog;
  status: RunStatus;
  screenshot: string | null;
}

/**
 * Attempts real browser execution. Returns null when Playwright is unavailable
 * so the caller can fall back to HTTP mode WITHOUT pretending a browser ran.
 */
async function tryRunWithPlaywright(
  flow: WebFlow,
  steps: WebStep[],
  opts: ExecuteOptions,
): Promise<{ result: EngineResult } | null> {
  const probe = await probePlaywright();
  if (!probe.ok) return null;

  const started = Date.now();
  const logs: StepLog[] = [];
  let browser: { close?: () => Promise<void> } | null = null;

  try {
    const specifier = 'playwright';
    const mod = (await import(/* @vite-ignore */ specifier)) as {
      chromium: { launch: (opts?: unknown) => Promise<unknown> };
    };

    const launched = (await mod.chromium.launch({ headless: true })) as {
      newContext: (opts?: unknown) => Promise<unknown>;
      close: () => Promise<void>;
    };
    browser = launched;

    const viewport = parseViewport(flow.viewport);
    const context = (await launched.newContext({ viewport })) as {
      newPage: () => Promise<unknown>;
      close: () => Promise<void>;
    };
    const page = (await context.newPage()) as unknown as PlaywrightPage;

    let logIndex = 0;
    const screenshots: string[] = [];
    let status: RunStatus = 'passed';

    for (const [i, step] of steps.entries()) {
      const stepStart = Date.now();
      try {
        const outcome = await runBrowserStep(page, step, i, opts);
        if (outcome.screenshot) screenshots.push(outcome.screenshot);
        if (outcome.status === 'failed') status = 'failed';
        logs.push({ ...outcome.log, duration_ms: Date.now() - stepStart });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logs.push({
          index: logIndex++,
          action: step.action,
          target: step.selector ?? step.value,
          status: 'fail',
          message,
          duration_ms: Date.now() - stepStart,
        });
        status = 'failed';
      }
    }

    const pageUrl = typeof page.url === 'function' ? page.url() : (flow.start_url ?? '');

    await context.close().catch(() => undefined);

    return {
      result: {
        status,
        engine: 'web',
        duration_ms: Date.now() - started,
        logs,
        assertions: [],
        evidence: {
          mode: 'playwright',
          mode_label: 'Playwright (browser sungguhan)',
          playwright_version: probe.version,
          url: pageUrl,
          screenshots,
          steps_executed: steps.length,
        },
        error: status === 'failed' ? 'Satu atau lebih langkah browser gagal.' : null,
        used_ai: false,
      },
    };
  } catch (err) {
    // Playwright is installed but the BROWSER BINARY is missing — the common case.
    const reason = err instanceof Error ? err.message : String(err);
    logs.push({
      index: logs.length,
      action: 'playwright-launch',
      status: 'skip',
      message:
        'Playwright terpasang tetapi browser gagal dijalankan ' +
        `(${reason.slice(0, 200)}). Jalankan \`npx playwright install chromium\`. ` +
        'Engine melanjutkan dengan mode HTTP.',
      duration_ms: 0,
    });
    return null;
  } finally {
    try {
      await browser?.close?.();
    } catch {
      /* closing a browser must never mask the result */
    }
  }
}

interface PlaywrightPage {
  goto: (url: string, opts?: unknown) => Promise<unknown>;
  click: (sel: string, opts?: unknown) => Promise<void>;
  fill: (sel: string, value: string, opts?: unknown) => Promise<void>;
  selectOption: (sel: string, value: string, opts?: unknown) => Promise<unknown>;
  check: (sel: string, opts?: unknown) => Promise<void>;
  uncheck: (sel: string, opts?: unknown) => Promise<void>;
  press: (sel: string, key: string, opts?: unknown) => Promise<void>;
  hover: (sel: string, opts?: unknown) => Promise<void>;
  waitForTimeout: (ms: number) => Promise<void>;
  waitForSelector: (sel: string, opts?: unknown) => Promise<unknown>;
  screenshot: (opts?: unknown) => Promise<Buffer>;
  url: () => string;
  content: () => Promise<string>;
  textContent: (sel: string) => Promise<string | null>;
  evaluate?: (script: string) => Promise<unknown>;
}

async function runBrowserStep(page: PlaywrightPage, step: WebStep, index: number, opts: ExecuteOptions): Promise<BrowserStepOutcome> {
  const timeout = step.timeout_ms ?? opts.timeout_ms ?? 15000;
  const selector = step.selector;
  const base = { index, action: step.action, target: selector ?? step.value, duration_ms: 0 };
  const ok = (message: string): BrowserStepOutcome => ({
    status: 'passed',
    screenshot: null,
    log: { ...base, status: 'ok', message },
  });
  const bad = (message: string): BrowserStepOutcome => ({
    status: 'failed',
    screenshot: null,
    log: { ...base, status: 'fail', message },
  });

  switch (step.action) {
    case 'goto': {
      const url = step.value ?? selector ?? '';
      const res = (await page.goto(url, { timeout, waitUntil: 'domcontentloaded' })) as { status?: () => number } | null;
      const code = typeof res?.status === 'function' ? res.status() : 0;
      return code >= 400 ? bad(`Navigasi ke ${url} → HTTP ${code}`) : ok(`Navigasi ke ${page.url()} (HTTP ${code})`);
    }
    case 'click':
      await page.click(selector as string, { timeout });
      return ok(`Klik "${selector}"`);
    case 'fill':
      await page.fill(selector as string, step.value ?? '', { timeout });
      return ok(`Isi "${selector}" dengan "${step.value ?? ''}"`);
    case 'select':
      await page.selectOption(selector as string, step.value ?? '', { timeout });
      return ok(`Pilih "${step.value ?? ''}" pada "${selector}"`);
    case 'check':
      await page.check(selector as string, { timeout });
      return ok(`Centang "${selector}"`);
    case 'uncheck':
      await page.uncheck(selector as string, { timeout });
      return ok(`Hilangkan centang "${selector}"`);
    case 'press':
      await page.press(selector as string, step.value ?? 'Enter', { timeout });
      return ok(`Tekan "${step.value ?? 'Enter'}" pada "${selector}"`);
    case 'hover':
      await page.hover(selector as string, { timeout });
      return ok(`Hover "${selector}"`);
    case 'wait': {
      const ms = Number(step.value ?? 0) || 500;
      await page.waitForTimeout(ms);
      return ok(`Menunggu ${ms} ms`);
    }
    case 'assert_text': {
      const expected = step.expected ?? step.value ?? '';
      const actual = selector ? ((await page.textContent(selector)) ?? '') : await page.content();
      return actual.includes(expected)
        ? ok(`Teks "${expected}" ditemukan`)
        : bad(`Teks "${expected}" tidak ditemukan (diamati: ${truncate(actual, 160)})`);
    }
    case 'assert_visible':
      await page.waitForSelector(selector as string, { timeout, state: 'visible' });
      return ok(`Elemen "${selector}" terlihat`);
    case 'assert_url': {
      const expected = step.expected ?? step.value ?? '';
      return page.url().includes(expected)
        ? ok(`URL ${page.url()} memuat "${expected}"`)
        : bad(`URL ${page.url()} tidak memuat "${expected}"`);
    }
    case 'screenshot': {
      const buffer = await page.screenshot({ fullPage: true });
      return {
        status: 'passed',
        screenshot: `data:image/png;base64,${Buffer.from(buffer).toString('base64')}`,
        log: { ...base, status: 'ok', message: 'Screenshot diambil' },
      };
    }
    case 'scroll':
      await page.evaluate?.('window.scrollBy(0, window.innerHeight)');
      return ok('Halaman digulir');
    default:
      return bad(`Aksi "${step.action as string}" belum didukung.`);
  }
}

function parseViewport(raw: string | null | undefined): { width: number; height: number } {
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as { width?: number; height?: number };
      if (parsed?.width && parsed?.height) return { width: Number(parsed.width), height: Number(parsed.height) };
    } catch {
      /* fall through to the default */
    }
  }
  return { width: 1280, height: 720 };
}

/* ------------------------------------------------------------------ *
 * Public entry point
 * ------------------------------------------------------------------ */

export interface WebRunOutcome extends EngineResult {
  flow_id: string;
  /** Which mode ACTUALLY executed: 'http' or 'playwright'. */
  mode: 'http' | 'playwright';
  mode_reason: string;
  url: string;
}

/**
 * Runs a WebFlow.
 * 1. If Playwright is installed AND launches, the real browser path is used.
 * 2. Otherwise the HTTP path runs and the evidence states that plainly.
 */
export async function executeWebFlow(
  flow: WebFlow,
  opts: ExecuteOptions & { vars?: Record<string, unknown> } = {},
): Promise<WebRunOutcome> {
  const steps = parseSteps(flow.steps);
  const startUrl = resolveStartUrl(flow, steps, opts);

  /* --------------------------- dry run ------------------------------- */
  if (opts.dry_run) {
    const logs: StepLog[] = [];
    let index = 0;
    const problems: string[] = [];
    if (!startUrl) problems.push('start_url kosong dan tidak ada langkah "goto" pertama.');

    for (const step of steps) {
      const needsSelector = step.action !== 'goto' && step.action !== 'wait';
      if (needsSelector && !step.selector) problems.push(`Langkah ${index + 1} (${step.action}) tanpa selector.`);
      if (step.action === 'goto' && !step.value && !step.selector) {
        problems.push(`Langkah ${index + 1} (goto) tanpa URL.`);
      }
      logs.push({
        index: index++,
        action: step.action,
        target: step.selector ?? step.value,
        status: 'info',
        message: `Validasi langkah ${index}: ${step.action}${step.selector ? ` pada "${step.selector}"` : ''}`,
        duration_ms: 0,
      });
    }

    const pw = await probePlaywright();
    const mode: 'http' | 'playwright' = pw.ok ? 'playwright' : 'http';

    logs.push({
      index: index++,
      action: 'dry-run',
      status: problems.length ? 'fail' : 'info',
      message: problems.length
        ? `Dry-run menemukan ${problems.length} masalah: ${problems.join(' ')}`
        : `Dry-run OK: ${steps.length} langkah valid. Target tidak dihubungi. Mode yang akan dipakai: ${mode}.`,
      duration_ms: 0,
    });

    return {
      ...emptyEngineResult('web', problems.length ? 'failed' : 'skipped', problems.length ? problems.join(' ') : null),
      logs,
      evidence: {
        mode,
        mode_label: mode === 'playwright' ? 'Playwright (browser)' : 'HTTP (fetch + parser HTML)',
        dry_run: true,
        planned_steps: steps.length,
        start_url: startUrl,
        problems,
      },
      flow_id: flow.id,
      mode,
      mode_reason: problems.length ? 'Dry-run menemukan masalah pada definisi flow.' : 'Dry-run berhasil.',
      url: startUrl,
    };
  }

  /* ----------------------- Playwright first, if present -------------- */
  if (steps.length) {
    const browserAttempt = await tryRunWithPlaywright(flow, steps, opts);
    if (browserAttempt) {
      return {
        ...browserAttempt.result,
        flow_id: flow.id,
        mode: 'playwright',
        mode_reason: 'Playwright terdeteksi dan browser berhasil dijalankan.',
        url: String((browserAttempt.result.evidence as { url?: unknown }).url ?? startUrl),
      };
    }
  }

  /* ------------------------------ HTTP mode -------------------------- */
  const started = Date.now();
  const logs: StepLog[] = [];
  let index = 0;

  const pw = await probePlaywright();
  const modeReason = pw.ok
    ? 'Playwright terpasang tetapi browser tidak dapat dijalankan; engine memakai mode HTTP (bukan browser).'
    : 'Playwright tidak terpasang; engine memakai mode HTTP: fetch + parser HTML internal.';

  logs.push({
    index: index++,
    action: 'mode',
    status: 'info',
    message: `Mode eksekusi: HTTP (fetch + parser HTML). ${modeReason}`,
    duration_ms: 0,
  });

  if (!steps.length) {
    return {
      ...emptyEngineResult('web', 'skipped', 'Flow tidak memiliki langkah untuk dijalankan.'),
      logs,
      flow_id: flow.id,
      mode: 'http',
      mode_reason: modeReason,
      url: startUrl,
    };
  }

  let snapshot: PageSnapshot | null = null;
  const stepStatuses: RunStatus[] = [];
  const screenshots: string[] = [];

  for (const [i, step] of steps.entries()) {
    const { snapshot: next, outcome, screenshots: shots } = await runHttpStep(snapshot, step, i, {
      timeout_ms: opts.timeout_ms,
    });
    snapshot = next;
    logs.push(outcome.log);
    stepStatuses.push(outcome.status);
    screenshots.push(...shots);
  }

  /* ----------------------- flow assertions --------------------------- */
  const assertions = normalizeAssertions((flow as unknown as { assertions?: unknown }).assertions);
  const pageForAssertions = snapshot;
  const assertionResults = pageForAssertions
    ? assertions.map((a: Assertion) =>
        evaluateAssertion(a, {
          status: pageForAssertions.status,
          body: pageForAssertions.html,
          headers: pageForAssertions.headers,
          text: pageForAssertions.doc.text,
          elements: pageForAssertions.elements,
          duration_ms: pageForAssertions.duration_ms,
          vars: opts.vars,
        }),
      )
    : [];

  if (assertions.length) {
    const report = evaluateAssertions(assertions, {
      status: snapshot?.status ?? null,
      body: snapshot?.html ?? '',
      headers: snapshot?.headers ?? {},
      text: snapshot?.doc.text ?? '',
      elements: snapshot?.elements ?? {},
      duration_ms: snapshot?.duration_ms ?? null,
      vars: opts.vars,
    });
    logs.push({
      index: index++,
      action: 'assertions',
      status: report.passed ? 'ok' : 'fail',
      message: `${report.passed_count}/${assertions.length} assertion flow lulus`,
      duration_ms: 0,
    });
    for (const item of report.results) {
      logs.push({
        index: index++,
        action: 'assert',
        status: item.passed ? 'ok' : 'fail',
        message: item.message,
        duration_ms: 0,
        observed: item.observed,
      });
    }
  }

  const failedSteps = stepStatuses.filter((s) => s === 'failed').length;
  const blockedSteps = stepStatuses.filter((s) => s === 'blocked').length;
  const failedAssertions = assertionResults.filter((a) => !a.passed).length;

  let status: RunStatus = statusFromOutcome(assertionResults, null);
  if (failedSteps) status = 'failed';
  else if (blockedSteps && !failedSteps) status = 'blocked';

  const error =
    failedSteps || failedAssertions
      ? [
          failedSteps ? `${failedSteps} langkah gagal` : null,
          failedAssertions ? `${failedAssertions} assertion gagal` : null,
        ]
          .filter(Boolean)
          .join(', ')
      : null;

  return {
    status: stepStatuses.length === 0 && !assertions.length ? 'skipped' : status,
    engine: 'web',
    duration_ms: Date.now() - started,
    logs,
    assertions: assertionResults,
    evidence: {
      mode: 'http',
      mode_label: 'HTTP (fetch + parser HTML internal) — BUKAN browser sungguhan',
      mode_reason: modeReason,
      url: snapshot?.url ?? startUrl,
      status_code: snapshot?.status ?? null,
      page_title: snapshot?.doc.title ?? '',
      steps_total: steps.length,
      steps_passed: stepStatuses.filter((s) => s === 'passed').length,
      steps_failed: failedSteps,
      steps_blocked: blockedSteps,
      elements_observed: Object.keys(snapshot?.elements ?? {}).length,
      screenshots,
      text_sample: truncate(snapshot?.doc.text ?? '', 2000),
      interactive_elements: (snapshot?.doc.interactive ?? []).slice(0, 60),
      forms: snapshot?.doc.forms ?? [],
      tables: snapshot?.doc.tables ?? [],
    },
    error,
    used_ai: false,
    flow_id: flow.id,
    mode: 'http',
    mode_reason: modeReason,
    url: snapshot?.url ?? startUrl,
  };
}

/** Parses the `steps` JSON column defensively. */
export function parseSteps(raw: string | null | undefined): WebStep[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (s): s is WebStep => s !== null && typeof s === 'object' && typeof (s as WebStep).action === 'string',
    );
  } catch {
    return [];
  }
}

/** start_url wins; otherwise the first `goto` step supplies the entry point. */
function resolveStartUrl(
  flow: WebFlow,
  steps: WebStep[],
  opts: ExecuteOptions & { vars?: Record<string, unknown> },
): string {
  const override = opts.overrides?.start_url;
  if (typeof override === 'string' && override.trim()) return override.trim();

  const fromFlow = flow.start_url?.trim();
  if (fromFlow) return fromFlow;

  const firstGoto = steps.find((s) => s.action === 'goto');
  return (firstGoto?.value ?? firstGoto?.selector ?? '').trim();
}

/* ------------------------------------------------------------------ *
 * record-hint
 * ------------------------------------------------------------------ */

export interface RecordHint {
  url: string;
  fetched: boolean;
  status: number | null;
  title: string;
  suggested_steps: WebStep[];
  elements: Array<{ tag: string; text: string; selector: string; candidates: string[]; attributes: Record<string, string> }>;
  forms: ParsedDocument['forms'];
  links: ParsedDocument['links'];
  tables: ParsedDocument['tables'];
  message: string;
}

/**
 * POST /web-flows/:id/record-hint — fetches a URL and SUGGESTS steps.
 * Nothing is written to the DB: the user reviews the suggestions in the UI.
 */
export async function recordHint(url: string, opts: { timeout_ms?: number; max_elements?: number } = {}): Promise<RecordHint> {
  let snapshot: PageSnapshot;
  try {
    snapshot = await fetchPage(url, { timeout_ms: opts.timeout_ms ?? 15000 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      url,
      fetched: false,
      status: null,
      title: '',
      suggested_steps: [{ action: 'goto', value: url, description: 'Langkah pembuka — periksa URL target' }],
      elements: [],
      forms: [],
      links: [],
      tables: [],
      message: `Tidak dapat mengambil ${url}: ${message}. Periksa apakah server target berjalan dan dapat dijangkau dari API.`,
    };
  }

  const max = opts.max_elements ?? 40;
  const suggested: WebStep[] = [
    { action: 'goto', value: snapshot.url, description: 'Buka halaman target' },
  ];

  if (snapshot.doc.title) {
    suggested.push({
      action: 'assert_text',
      value: snapshot.doc.title.slice(0, 60),
      expected: snapshot.doc.title.slice(0, 60),
      description: `Pastikan judul halaman memuat "${snapshot.doc.title.slice(0, 60)}"`,
    });
  }

  for (const el of snapshot.doc.interactive.slice(0, max)) {
    if (el.tag === 'input' || el.tag === 'textarea') {
      const type = el.attributes.type ?? 'text';
      if (type === 'hidden' || type === 'submit') continue;
      suggested.push({
        action: 'fill',
        selector: el.selector,
        value: '',
        description: `Isi field ${el.attributes.name ?? el.selector} (${type})`,
      });
      continue;
    }
    if (el.tag === 'select') {
      suggested.push({ action: 'select', selector: el.selector, value: '', description: 'Pilih opsi' });
      continue;
    }
    if (el.tag === 'form') {
      continue;
    }
    // Buttons and links become visibility assertions the user can tighten into clicks.
    suggested.push({
      action: 'assert_visible',
      selector: el.selector,
      description: `Pastikan "${el.text || el.selector}" tampil${el.text ? ` — kandidat klik` : ''}`,
    });
  }

  return {
    url: snapshot.url,
    fetched: true,
    status: snapshot.status,
    title: snapshot.doc.title,
    suggested_steps: suggested,
    elements: snapshot.doc.interactive.slice(0, max).map((el) => ({
      tag: el.tag,
      text: el.text,
      selector: el.selector,
      candidates: el.candidates,
      attributes: el.attributes,
    })),
    forms: snapshot.doc.forms,
    links: snapshot.doc.links.slice(0, 40),
    tables: snapshot.doc.tables,
    message:
      `Berhasil mengambil ${snapshot.url} (HTTP ${snapshot.status}). ` +
      `${suggested.length} langkah disarankan dari ${snapshot.doc.interactive.length} elemen interaktif. ` +
      'Langkah bersifat SARAN — tinjau sebelum menyimpan flow.',
  };
}
