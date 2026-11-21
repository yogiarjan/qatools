/**
 * Real render smoke test (lead-owned).
 *
 * The verifier's one honest gap was: "I never rendered a page in a real browser."
 * This closes it WITHOUT adding a dependency — it serves the built SPA, drives it with
 * Chrome DevTools Protocol over a raw WebSocket (no puppeteer/playwright), and asserts
 * that each route actually renders DOM and logs no uncaught error.
 *
 * Usage:
 *   node _verify/render-smoke.mjs [--headed]
 * Requires the API on :5174 (seeded) and a Chrome/Edge binary.
 */

import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const root = resolve(here, '..');
const webDist = resolve(root, 'apps/web/dist');
const API = process.env.QATOOLS_API ?? 'http://127.0.0.1:5174';
const PORT = Number(process.env.RENDER_PORT ?? 4180);

/* ------------------------------------------------------------ static server */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.map': 'application/json',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

function serveDist() {
  return new Promise((resolvePromise) => {
    const server = createServer(async (req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      // Proxy API calls to the real backend so pages get real data.
      // NOTE: must exclude SPA routes that merely start with "/api-" (e.g. /api-tester),
      // otherwise the page request itself is proxied and the app never renders.
      const isApiCall = url.pathname === '/api' || url.pathname.startsWith('/api/');
      if (isApiCall) {
        try {
          const upstream = await fetch(`${API}${url.pathname}${url.search}`, {
            method: req.method,
            headers: { 'content-type': req.headers['content-type'] ?? 'application/json' },
            body: ['GET', 'HEAD'].includes(req.method ?? 'GET') ? undefined : req,
            duplex: 'half',
          });
          res.writeHead(upstream.status, { 'content-type': upstream.headers.get('content-type') ?? 'application/json' });
          res.end(Buffer.from(await upstream.arrayBuffer()));
        } catch (err) {
          res.writeHead(502, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: { code: 'proxy_error', message: String(err) } }));
        }
        return;
      }
      let filePath = join(webDist, url.pathname === '/' ? 'index.html' : url.pathname);
      // SPA fallback for client-side routes.
      if (!existsSync(filePath) || !extname(filePath)) filePath = join(webDist, 'index.html');
      try {
        const { readFileSync } = await import('node:fs');
        const body = readFileSync(filePath);
        res.writeHead(200, { 'content-type': MIME[extname(filePath)] ?? 'application/octet-stream' });
        res.end(body);
      } catch {
        res.writeHead(404).end('not found');
      }
    });
    server.listen(PORT, '127.0.0.1', () => resolvePromise(server));
  });
}

/* ----------------------------------------------------------------- chrome */

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  ].filter(Boolean);
  return candidates.find((p) => existsSync(p)) ?? null;
}

/** Minimal CDP client over the built-in WebSocket (Node 22+ has a global WebSocket). */
class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.events = [];
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve: res, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(msg.error.message)) : res(msg.result);
      } else if (msg.method) {
        this.events.push(msg);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((res, rej) => this.pending.set(id, { resolve: res, reject: rej }));
  }
  async evaluate(expression) {
    const r = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text ?? 'evaluate failed');
    return r.result?.value;
  }
  close() {
    this.ws.close();
  }
}

async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', () => rej(new Error('ws error')), { once: true });
  });
  return new Cdp(ws);
}

/* ------------------------------------------------------------------ main */

const ROUTES = [
  ['/', 'Dashboard'],
  ['/projects', 'Projects'],
  ['/requirements', 'Requirements'],
  ['/usecases', 'Use Cases'],
  ['/site-analyzer', 'Analyzer'],
  ['/scenarios', 'Scenarios'],
  ['/testcases', 'Test Cases'],
  ['/matrix', 'Traceability'],
  ['/cycles', 'Cycle'],
  ['/runs', 'Test Runs'],
  ['/environment', 'Environment'],
  ['/execute', 'Run Center'],
  ['/api-tester', 'API'],
  ['/db-tester', 'Database'],
  ['/web-tester', 'Web'],
  ['/defects', 'Defect'],
  ['/regression', 'Regresi'],
  ['/metrics', 'QA Metrics'],
  ['/ai', 'AI Studio'],
  ['/ai/settings', 'AI'],
  ['/learn', 'Kurikulum'],
  ['/my-learning', 'Learning'],
  ['/certificate', 'e-Certificate'],
  ['/verify', 'Verifikasi'],
  ['/this-route-does-not-exist', 'tidak ditemukan'],
];

const chromePath = findChrome();
if (!chromePath) {
  console.log('RENDER_SMOKE=SKIP (no Chrome/Edge binary found; set CHROME_PATH)');
  process.exit(0);
}
if (!existsSync(webDist)) {
  console.log('RENDER_SMOKE=SKIP (apps/web/dist missing — run the web build first)');
  process.exit(0);
}

const server = await serveDist();
console.log(`static server on http://127.0.0.1:${PORT} (proxying /api -> ${API})`);

const userDataDir = resolve(root, '_verify/.chrome-profile');
const chrome = spawn(
  chromePath,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${userDataDir}`,
    '--remote-debugging-port=9333',
    'about:blank',
  ],
  { stdio: 'ignore' },
);

async function waitForCdp(timeoutMs = 25000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch('http://127.0.0.1:9333/json/version', { signal: AbortSignal.timeout(1500) });
      if (r.ok) return (await r.json()).webSocketDebuggerUrl;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error('Chrome DevTools endpoint did not come up');
}

function cleanup(code) {
  try { chrome.kill('SIGKILL'); } catch { /* ignore */ }
  try { server.close(); } catch { /* ignore */ }
  process.exit(code);
}

let pass = 0;
let fail = 0;
const failures = [];

try {
  const browserWs = await waitForCdp();
  const browser = await connect(browserWs);
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
  const { targetInfo } = await browser.send('Target.getTargetInfo', { targetId }).then((r) => ({ targetInfo: r.targetInfo }));
  void targetInfo;

  // Attach a session to the new tab.
  const attached = await browser.send('Target.attachToTarget', { targetId, flatten: true });
  const sessionId = attached.sessionId;

  // Route session-scoped CDP messages through the browser socket.
  const sessionSend = (method, params = {}) => {
    const id = ++browser.id;
    browser.ws.send(JSON.stringify({ id, method, params, sessionId }));
    return new Promise((res, rej) => browser.pending.set(id, { resolve: res, reject: rej }));
  };

  await sessionSend('Page.enable');
  await sessionSend('Runtime.enable');
  await sessionSend('Log.enable');

  for (const [route, expect] of ROUTES) {
    // Reset the per-route error collectors.
    browser.events.length = 0;
    const pageErrors = [];

    // Collect console errors + uncaught exceptions for this route.
    const onMsg = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.method === 'Runtime.exceptionThrown') {
        pageErrors.push(m.params.exceptionDetails?.text ?? 'exception');
      }
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
        const text = (m.params.args ?? []).map((a) => a.value ?? a.description ?? '').join(' ');
        // Ignore expected 404/network noise from optional AI routes.
        if (text && !/Failed to load resource|favicon|404/i.test(text)) pageErrors.push(text);
      }
    };
    browser.ws.addEventListener('message', onMsg);

    try {
      await sessionSend('Page.navigate', { url: `http://127.0.0.1:${PORT}${route}` });
      // Wait for React to mount and data to settle.
      await new Promise((r) => setTimeout(r, 1400));

      const info = await sessionSend('Runtime.evaluate', {
        expression: `(() => {
          const root = document.getElementById('root');
          const text = (document.body.innerText || '');
          return {
            rootChildren: root ? root.children.length : 0,
            chars: text.trim().length,
            title: document.title,
            hasSpinner: !!document.querySelector('.spinner'),
            hasError: /terjadi kesalahan/i.test(text),
            matched: text.includes(${JSON.stringify(expect)}),
            snippet: text.slice(0, 90).replace(/\\n/g, ' '),
          };
        })()`,
        returnByValue: true,
      });
      const v = info.result.value;

      const problems = [];
      if (v.rootChildren === 0) problems.push('root has no children (did not mount)');
      if (v.chars < 40) problems.push(`only ${v.chars} chars rendered`);
      if (v.hasError) problems.push('rendered the error box');
      if (!v.matched) problems.push(`expected text "${expect}" not found`);
      if (pageErrors.length) problems.push(`console errors: ${pageErrors.slice(0, 2).join(' | ')}`);

      if (problems.length) {
        fail++;
        failures.push({ route, problems, snippet: v.snippet });
        console.log(`FAIL  ${route.padEnd(30)} ${problems.join('; ')}`);
      } else {
        pass++;
        console.log(`PASS  ${route.padEnd(30)} ${v.chars} chars · "${v.snippet.slice(0, 52)}"`);
      }
    } catch (err) {
      fail++;
      failures.push({ route, problems: [err.message] });
      console.log(`FAIL  ${route.padEnd(30)} ${err.message}`);
    } finally {
      browser.ws.removeEventListener('message', onMsg);
    }
  }

  console.log(`\n=== SUMMARY ===\nPASS=${pass} FAIL=${fail} TOTAL=${ROUTES.length}`);
  if (failures.length) {
    console.log('\n--- failures ---');
    for (const f of failures) console.log(`${f.route}: ${f.problems.join('; ')}`);
  }
  console.log(fail === 0 ? 'RENDER_SMOKE=PASS' : 'RENDER_SMOKE=FAIL');
  cleanup(fail === 0 ? 0 : 1);
} catch (err) {
  console.error('RENDER_SMOKE=ERROR', err.message);
  cleanup(1);
}
