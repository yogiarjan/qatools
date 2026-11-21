/**
 * Lane D — the site crawler.
 *
 * NO cheerio, NO jsdom, NO native parsing library: a hand-written, dependency-free
 * HTML extractor. It fetches with the global `fetch` (timeout + max-byte cap) and then
 * derives features / suggested use cases heuristically.
 *
 * Never throws: a failed fetch yields `{ fetched: false, … }` with a helpful message and
 * a minimal feature set derived from the URL path, so crawl → use case still works offline.
 *
 * `input.url` may be a **local mock path** such as `/mock/health`; when QATOOLS_API_BASE
 * is set the crawler resolves it against that base so the bundled mock system-under-test
 * can be crawled without any internet access.
 */

import { stableHash, type CrawlResult, type CrawledPage, type Priority } from '@qatools/shared';
import { humaniseIdentifier, pick, priorityOf, titleise, truncate, uniq, keywords } from './nlp.js';

export interface CrawlOptions {
  timeoutMs?: number;
  maxBytes?: number;
}

const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;

/** Resolves relative URLs against the API base (used for crawling the bundled mock). */
function resolveTarget(url: string): string {
  const trimmed = (url ?? '').trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  const base =
    process.env.QATOOLS_API_BASE ??
    `http://${process.env.HOST ?? '127.0.0.1'}:${process.env.PORT ?? 5174}`;
  if (trimmed.startsWith('/')) return `${base.replace(/\/+$/, '')}${trimmed}`;
  return `${base.replace(/\/+$/, '')}/api/${trimmed.replace(/^\/+/, '')}`;
}

/* ------------------------------------------------------------------ *
 * Hand-rolled HTML extraction
 * ------------------------------------------------------------------ */

function decodeEntities(input: string): string {
  return (input ?? '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, h: string) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&[a-z]+;/gi, ' ');
}

function stripTags(html: string): string {
  return decodeEntities(
    (html ?? '')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim();
}

interface Attrs {
  [key: string]: string;
}

function parseAttrs(raw: string): Attrs {
  const attrs: Attrs = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw ?? ''))) {
    const name = (m[1] as string).toLowerCase();
    const value = m[2] ?? m[3] ?? m[4] ?? '';
    attrs[name] = decodeEntities(value);
  }
  return attrs;
}

/** All opening tags for a given tag name, with their raw attribute text. */
function tags(html: string, tag: string): Array<{ attrs: Attrs; inner: string }> {
  const out: Array<{ attrs: Attrs; inner: string }> = [];
  const re = new RegExp(`<${tag}\\b([^>]*)>([\\s\\S]*?)<\\/${tag}>`, 'gi');
  let m: RegExpExecArray | null;
  while ((m = re.exec(html ?? ''))) {
    out.push({ attrs: parseAttrs(m[1] ?? ''), inner: m[2] ?? '' });
  }
  return out;
}

/** Self-closing / void tags such as `<input …>` or `<meta …>`. */
function voidTags(html: string, tag: string): Attrs[] {
  const out: Attrs[] = [];
  const re = new RegExp(`<${tag}\\b([^>]*)\\/?>`, 'gi');
  let m: RegExpExecArray | null;
  while ((m = re.exec(html ?? ''))) out.push(parseAttrs(m[1] ?? ''));
  return out;
}

export function extractTitle(html: string): string {
  const og = voidTags(html, 'meta').find((a) => (a.property ?? a.name ?? '').toLowerCase() === 'og:title');
  if (og?.content) return truncate(stripTags(og.content), 200);
  const t = tags(html, 'title')[0];
  if (t) return truncate(stripTags(t.inner), 200);
  const h1 = tags(html, 'h1')[0];
  if (h1) return truncate(stripTags(h1.inner), 200);
  return '';
}

export function extractHeadings(html: string): string[] {
  const out: string[] = [];
  for (const tag of ['h1', 'h2', 'h3']) {
    for (const h of tags(html, tag)) {
      const text = truncate(stripTags(h.inner), 160);
      if (text) out.push(text);
    }
  }
  return uniq(out).slice(0, 40);
}

export function extractLinks(html: string, baseUrl: string): Array<{ text: string; href: string }> {
  const out: Array<{ text: string; href: string }> = [];
  for (const a of tags(html, 'a')) {
    const href = (a.attrs.href ?? '').trim();
    if (!href || /^(javascript:|mailto:|tel:|#)/i.test(href)) continue;
    const text = truncate(stripTags(a.inner), 120) || a.attrs.title || href;
    out.push({ text, href: absolutise(href, baseUrl) });
  }
  return dedupeLinks(out).slice(0, 100);
}

function dedupeLinks(links: Array<{ text: string; href: string }>): Array<{ text: string; href: string }> {
  const seen = new Set<string>();
  const out: Array<{ text: string; href: string }> = [];
  for (const l of links) {
    const key = `${l.text.toLowerCase()}|${l.href}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(l);
  }
  return out;
}

function absolutise(href: string, base: string): string {
  try {
    return new URL(href, base).toString();
  } catch {
    return href;
  }
}

export function extractButtons(html: string): string[] {
  const out: string[] = [];
  for (const b of tags(html, 'button')) {
    const text = truncate(stripTags(b.inner), 80) || b.attrs['aria-label'] || b.attrs.title || '';
    if (text) out.push(text);
  }
  for (const i of voidTags(html, 'input')) {
    const type = (i.type ?? '').toLowerCase();
    if (type === 'submit' || type === 'button' || type === 'reset') {
      const text = truncate(i.value ?? '', 80) || truncate(i['aria-label'] ?? '', 80);
      if (text) out.push(text);
    }
  }
  for (const a of tags(html, 'a')) {
    const cls = (a.attrs.class ?? '').toLowerCase();
    if (/\bbtn\b|\bbutton\b/.test(cls)) {
      const text = truncate(stripTags(a.inner), 80);
      if (text) out.push(text);
    }
  }
  return uniq(out).slice(0, 60);
}

export function extractInputs(html: string): Array<{ name: string; type: string; placeholder?: string }> {
  const out: Array<{ name: string; type: string; placeholder?: string }> = [];
  for (const i of voidTags(html, 'input')) {
    const type = (i.type ?? 'text').toLowerCase();
    if (type === 'hidden' || type === 'submit' || type === 'button' || type === 'reset') continue;
    const name = i.name || i.id || i.placeholder || type;
    out.push({ name, type, ...(i.placeholder ? { placeholder: i.placeholder } : {}) });
  }
  for (const s of tags(html, 'select')) {
    const name = s.attrs.name || s.attrs.id || 'select';
    out.push({ name, type: 'select' });
  }
  for (const t of tags(html, 'textarea')) {
    const name = t.attrs.name || t.attrs.id || 'textarea';
    out.push({ name, type: 'textarea', ...(t.attrs.placeholder ? { placeholder: t.attrs.placeholder } : {}) });
  }
  const seen = new Set<string>();
  return out.filter((i) => {
    const key = `${i.name}|${i.type}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Extracts forms with action/method + fields (name, type, required, label).
 * Labels are resolved from `<label for=…>`, a wrapping `<label>`, or `aria-label`.
 */
export function extractForms(html: string): CrawledPage['forms'] {
  const labelsByFor = new Map<string, string>();
  for (const l of tags(html, 'label')) {
    const forId = l.attrs.for ?? '';
    const text = truncate(stripTags(l.inner), 120);
    if (forId && text) labelsByFor.set(forId, text);
  }

  const forms: CrawledPage['forms'] = [];
  for (const f of tags(html, 'form')) {
    const fields: CrawledPage['forms'][number]['fields'] = [];
    const push = (name: string, type: string, required: boolean, label?: string) => {
      if (!name) return;
      fields.push({ name, type, required, ...(label ? { label } : {}) });
    };

    for (const i of voidTags(f.inner, 'input')) {
      const type = (i.type ?? 'text').toLowerCase();
      if (type === 'hidden') continue;
      const name = i.name || i.id || i.placeholder || type;
      const label = labelsByFor.get(i.id ?? '') ?? i['aria-label'];
      push(name, type, 'required' in i, label);
    }
    for (const s of tags(f.inner, 'select')) {
      const name = s.attrs.name || s.attrs.id || 'select';
      push(name, 'select', 'required' in s.attrs, labelsByFor.get(s.attrs.id ?? '') ?? s.attrs['aria-label']);
    }
    for (const t of tags(f.inner, 'textarea')) {
      const name = t.attrs.name || t.attrs.id || 'textarea';
      push(name, 'textarea', 'required' in t.attrs, labelsByFor.get(t.attrs.id ?? '') ?? t.attrs['aria-label']);
    }

    forms.push({
      action: f.attrs.action ?? '',
      method: (f.attrs.method ?? 'get').toUpperCase(),
      fields,
    });
  }
  return forms;
}

export function extractTables(html: string): Array<{ headers: string[]; rowCount: number }> {
  const out: Array<{ headers: string[]; rowCount: number }> = [];
  for (const t of tags(html, 'table')) {
    const headerCells: string[] = [];
    const thead = tags(t.inner, 'thead')[0];
    const headScope = thead ? thead.inner : t.inner;
    for (const th of tags(headScope, 'th')) {
      const text = truncate(stripTags(th.inner), 60);
      if (text) headerCells.push(text);
    }
    const body = tags(t.inner, 'tbody')[0];
    const bodyScope = body ? body.inner : t.inner;
    const rowCount = tags(bodyScope, 'tr').length;
    if (headerCells.length || rowCount) out.push({ headers: uniq(headerCells).slice(0, 20), rowCount });
  }
  return out;
}

export function extractTextSample(html: string, max = 800): string {
  return truncate(stripTags(html), max);
}

/** Full single-page parse. */
export function parseHtml(html: string, url: string): CrawledPage {
  return {
    url,
    title: extractTitle(html),
    headings: extractHeadings(html),
    forms: extractForms(html),
    links: extractLinks(html, url),
    buttons: extractButtons(html),
    inputs: extractInputs(html),
    tables: extractTables(html),
    textSample: extractTextSample(html),
  };
}

/* ------------------------------------------------------------------ *
 * Heuristic feature / use-case derivation
 * ------------------------------------------------------------------ */

function actorFor(page: CrawledPage, fieldNames: string[]): string {
  const lower = `${page.title} ${page.headings.join(' ')} ${fieldNames.join(' ')}`.toLowerCase();
  if (/login|masuk|sign ?in/.test(lower)) return 'Pengguna';
  if (/admin|dashboard admin|pengelola/.test(lower)) return 'Admin';
  if (/register|daftar|sign ?up/.test(lower)) return 'Calon Pengguna';
  if (/checkout|bayar|cart|keranjang/.test(lower)) return 'Customer';
  return 'Pengguna';
}

function featurePriority(text: string): Priority {
  const p = priorityOf(text);
  return p === 'critical' ? 'critical' : p;
}

/** Derives `features` + `suggested_use_cases` from parsed pages. */
export function deriveFeatures(page: CrawledPage): {
  features: CrawlResult['features'];
  suggested: CrawlResult['suggested_use_cases'];
} {
  const features: CrawlResult['features'] = [];
  const suggested: CrawlResult['suggested_use_cases'] = [];
  const fieldNames = page.inputs.map((i) => i.name);
  const actor = actorFor(page, fieldNames);
  const host = (() => {
    try {
      return new URL(page.url).pathname;
    } catch {
      return page.url;
    }
  })();

  const add = (
    name: string,
    kind: CrawlResult['features'][number]['kind'],
    evidence: string,
    priority: Priority,
    goal: string,
    useCaseName: string,
    actors: string[] = [actor],
  ) => {
    if (!name || features.some((f) => f.name.toLowerCase() === name.toLowerCase())) return;
    features.push({ name, kind, evidence: truncate(evidence, 200), suggested_actor: actors[0] ?? actor, suggested_priority: priority });
    suggested.push({ name: useCaseName, goal, actors, priority });
  };

  // Forms → the highest-value features.
  page.forms.forEach((form, i) => {
    const names = form.fields.map((f) => f.name);
    const isAuth = form.fields.some((f) => /password|passwd|pwd/i.test(f.name) || /password/i.test(f.type));
    const isSearch = /search|cari|q\b|query|keyword/i.test(names.join(' '));
    const formTitle = page.headings[i] ?? page.headings[0] ?? page.title ?? 'Form';
    const label = titleise(truncate(formTitle, 60));
    const fieldsSummary = names.slice(0, 6).join(', ') || 'tanpa field';

    if (isAuth) {
      add(
        'Login / Autentikasi',
        'auth',
        `Form ${form.method} ${form.action || '(halaman ini)'} dengan field ${fieldsSummary}`,
        'high',
        `${actor} dapat masuk menggunakan kredensial yang valid dan mendapatkan sesi.`,
        'Login ke Aplikasi',
      );
      return;
    }
    if (isSearch) {
      add(
        'Pencarian',
        'search',
        `Form pencarian dengan field ${fieldsSummary}`,
        'medium',
        `${actor} dapat mencari data berdasarkan kata kunci dan melihat hasil yang relevan.`,
        'Mencari Data',
      );
      return;
    }
    add(
      `Form ${label}`,
      'form',
      `Form ${form.method} ${form.action || '(halaman ini)'} dengan field ${fieldsSummary}`,
      featurePriority(`${label} ${fieldsSummary}`),
      `${actor} dapat mengisi dan mengirim ${label.toLowerCase()} serta memperoleh konfirmasi hasil.`,
      `Mengisi ${label}`,
    );
  });

  // Tables / lists → listing features.
  page.tables.forEach((t) => {
    add(
      t.headers.length ? `Daftar ${titleise(t.headers[0] as string)}` : 'Daftar Data',
      'listing',
      `Tabel dengan kolom ${t.headers.slice(0, 6).join(', ') || '(tanpa header)'} dan ${t.rowCount} baris`,
      'medium',
      `${actor} dapat melihat, mencari, dan menelusuri daftar data yang tersedia.`,
      'Menelusuri Daftar Data',
    );
  });

  // Navigation + actions from links/buttons.
  const navLinks = page.links.filter((l) => l.text && l.text.length < 40).slice(0, 12);
  if (navLinks.length) {
    add(
      'Navigasi Halaman',
      'navigation',
      `Tautan: ${navLinks.slice(0, 5).map((l) => l.text).join(', ')}`,
      'low',
      `${actor} dapat berpindah antar halaman/fitur aplikasi tanpa menemui tautan rusak.`,
      'Menjelajahi Navigasi Aplikasi',
    );
  }

  page.buttons.slice(0, 8).forEach((b) => {
    const lower = b.toLowerCase();
    if (/login|masuk/.test(lower)) return;
    add(
      `Aksi ${titleise(b)}`,
      'action',
      `Tombol "${b}" pada ${host}`,
      featurePriority(b),
      `${actor} dapat menjalankan aksi "${b}" dan sistem memberi umpan balik yang sesuai.`,
      `Menjalankan Aksi ${titleise(b)}`,
    );
  });

  // Headings that look like detail pages.
  page.headings.slice(0, 6).forEach((h) => {
    if (h.length < 6 || h.length > 90) return;
    add(
      titleise(truncate(h, 60)),
      'detail',
      `Heading "${truncate(h, 80)}"`,
      'low',
      `${actor} dapat melihat detail informasi pada bagian "${truncate(h, 60)}".`,
      `Melihat Detail ${truncate(h, 50)}`,
    );
  });

  return { features: features.slice(0, 20), suggested: suggested.slice(0, 12) };
}

/** Minimal, honest feature set built from the URL path when the fetch failed. */
export function featuresFromUrl(url: string): {
  features: CrawlResult['features'];
  suggested: CrawlResult['suggested_use_cases'];
} {
  const segments = (() => {
    try {
      return new URL(url).pathname.split('/').filter(Boolean);
    } catch {
      return url.split('/').filter(Boolean);
    }
  })();
  const features: CrawlResult['features'] = [];
  const suggested: CrawlResult['suggested_use_cases'] = [];
  const names = segments.length ? segments : ['halaman-utama'];
  names.slice(0, 6).forEach((seg, i) => {
    const label = humaniseIdentifier(seg);
    const kind: CrawlResult['features'][number]['kind'] = i === 0 ? 'navigation' : 'listing';
    features.push({
      name: label,
      kind,
      evidence: `Segmen URL "/${seg}"`,
      suggested_actor: 'Pengguna',
      suggested_priority: 'medium',
    });
    suggested.push({
      name: `Menjelajahi ${label}`,
      goal: `Memahami dan memverifikasi fungsi bagian "${label}" pada aplikasi.`,
      actors: ['Pengguna'],
      priority: 'medium',
    });
  });
  return { features, suggested };
}

/* ------------------------------------------------------------------ *
 * Fetch + orchestration
 * ------------------------------------------------------------------ */

async function fetchHtml(
  url: string,
  opts: CrawlOptions,
): Promise<{ ok: boolean; html: string; error: string | null; finalUrl: string; contentType: string }> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  try {
    const res = await fetch(url, {
      headers: { Accept: 'text/html,application/xhtml+xml,application/json;q=0.8,*/*;q=0.5', 'User-Agent': 'QATools-Crawler/1.0' },
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    });
    const contentType = res.headers.get('content-type') ?? '';
    const body = await res.text();
    const html = body.length > maxBytes ? body.slice(0, maxBytes) : body;
    if (!res.ok) {
      return {
        ok: false,
        html,
        error: `HTTP ${res.status} ${res.statusText || ''}`.trim(),
        finalUrl: res.url || url,
        contentType,
      };
    }
    return { ok: true, html, error: null, finalUrl: res.url || url, contentType };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const friendly = /timeout|abort/i.test(message)
      ? `Timeout setelah ${Math.round(timeoutMs / 1000)} detik — host tidak merespons.`
      : message;
    return { ok: false, html: '', error: friendly, finalUrl: url, contentType: '' };
  }
}

/** Builds a readable JSON/plain-text page when the target is not HTML (e.g. the mock API). */
function pageFromPlainText(text: string, url: string, contentType: string): CrawledPage {
  const isJson = /json/i.test(contentType);
  let keys: string[] = [];
  if (isJson) {
    try {
      const parsed = JSON.parse(text) as unknown;
      keys = Object.keys((Array.isArray(parsed) ? { data: parsed } : parsed) as Record<string, unknown>).slice(0, 12);
    } catch {
      keys = [];
    }
  }
  const title = isJson ? `JSON endpoint ${(() => { try { return new URL(url).pathname; } catch { return url; } })()}` : 'Halaman Teks';
  return {
    url,
    title,
    headings: keys.length ? keys.map((k) => `field: ${k}`).slice(0, 8) : [],
    forms: [],
    links: [],
    buttons: [],
    inputs: [],
    tables: isJson && keys.length ? [{ headers: keys, rowCount: 1 }] : [],
    textSample: truncate(text, 800),
  };
}

/**
 * `crawlSite` — the public entry point used by `aiService.crawl` and the `crawl_site` task.
 *
 * Resolution order:
 *  1. `input.html` supplied → parse it, no network at all (`fetched: true`).
 *  2. Otherwise fetch `input.url` (relative paths resolve against the local API base).
 *  3. On any failure → `fetched: false` + `featuresFromUrl()`; never throws.
 */
export async function crawlSite(
  input: { url?: string; html?: string; max_pages?: number; depth?: number; include_links?: boolean },
  opts: CrawlOptions = {},
): Promise<CrawlResult> {
  const url = (input?.url ?? '').trim();
  const inline = typeof input?.html === 'string' && input.html.trim().length > 0;

  if (inline) {
    const page = parseHtml(input.html as string, url || 'inline://html');
    const { features, suggested } = deriveFeatures(page);
    return { url: page.url, fetched: true, pages: [page], features, suggested_use_cases: suggested, used_mock: false };
  }

  if (!url) {
    return {
      url: '',
      fetched: false,
      pages: [],
      features: [],
      suggested_use_cases: [],
      used_mock: true,
    };
  }

  const target = resolveTarget(url);
  const res = await fetchHtml(target, opts);

  if (!res.ok) {
    const { features, suggested } = featuresFromUrl(target);
    // A failed fetch still yields a usable page describing why it failed.
    const page: CrawledPage = {
      url: target,
      title: `Tidak dapat mengambil ${target}`,
      headings: [],
      forms: [],
      links: [],
      buttons: [],
      inputs: [],
      tables: [],
      textSample: `Gagal mengambil halaman: ${res.error ?? 'tidak diketahui'}. Fitur di bawah diturunkan dari segmen URL.`,
    };
    return { url: target, fetched: false, pages: [page], features, suggested_use_cases: suggested, used_mock: true };
  }

  const isHtml = /html|xml/i.test(res.contentType) || /^\s*<(!doctype|html)/i.test(res.html);
  const page = isHtml ? parseHtml(res.html, res.finalUrl) : pageFromPlainText(res.html, res.finalUrl, res.contentType);
  const { features, suggested } = deriveFeatures(page);
  return {
    url: res.finalUrl,
    fetched: true,
    pages: [page],
    features,
    suggested_use_cases: suggested,
    used_mock: false,
  };
}

/** Deterministic sample HTML used by docs/demo and tests when nothing can be fetched. */
export const SAMPLE_HTML = `<!doctype html><html><head><title>Toko Demo</title></head><body>
<h1>Katalog Produk</h1>
<form action="/login" method="post"><label for="email">Email</label><input id="email" name="email" type="email" required><label for="password">Kata Sandi</label><input id="password" name="password" type="password" required><button type="submit">Masuk</button></form>
<table><thead><tr><th>Produk</th><th>Harga</th></tr></thead><tbody><tr><td>A</td><td>1</td></tr><tr><td>B</td><td>2</td></tr></tbody></table>
<a href="/produk">Produk</a><a href="/keranjang">Keranjang</a>
</body></html>`;

/** Never used for output — keeps the deterministic pick helper imported and exercised. */
export function crawlSeedHint(url: string): number {
  return stableHash(url) + pick(['a', 'b', 'c'], stableHash(url)).length + keywords(url, 1).length;
}
