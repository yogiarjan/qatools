/**
 * String + value safety helpers for code generation.
 *
 * Two jobs, both load-bearing:
 *
 * 1. **Language escaping.** User-authored artifact titles, selectors and expected
 *    values are interpolated into TypeScript / Python / Java / Robot / JSON source.
 *    A title containing `"` or a newline must not break the generated file, so every
 *    emission goes through one of the `js*` / `py*` / `java*` / `robot*` escapers.
 *
 * 2. **Placeholder starvation.** ARCHITECTURE.md §11.3 forbids emitting `undefined`,
 *    `[object Object]`, `NaN` or `TODO` into generated code. `textOf()` is the single
 *    funnel every generator uses to turn `unknown` into a printable string, so a
 *    missing column can never leak those tokens.
 */

/* ------------------------------------------------------------------ *
 * Value normalisation
 * ------------------------------------------------------------------ */

/**
 * Turns any value into a non-placeholder string.
 * `null`/`undefined` become `fallback`; `NaN`/`Infinity` are rejected; objects are
 * JSON-stringified rather than rendered as `[object Object]`.
 */
export function textOf(value: unknown, fallback = ''): string {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'string') {
    const t = value.trim();
    return t === '' ? fallback : value;
  }
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : fallback;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'bigint') return value.toString();
  try {
    const json = JSON.stringify(value);
    return json === undefined ? fallback : json;
  } catch {
    return fallback;
  }
}

/** Same as `textOf` but never returns an empty string — used for titles/labels. */
export function labelOf(value: unknown, fallback = 'Untitled'): string {
  const s = textOf(value, '').trim();
  return s === '' ? fallback : s;
}

/** Finite number or the fallback — the only place `NaN` could otherwise enter. */
export function numOf(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** Clamps an integer into `[min, max]`, replacing non-finite input with `min`. */
export function clampInt(value: unknown, min: number, max: number): number {
  const n = Math.trunc(numOf(value, min));
  return Math.max(min, Math.min(max, n));
}

/** Normalises a JSON column that should hold an object of string→string. */
export function stringRecord(value: unknown): Record<string, string> {
  if (value === null || value === undefined) return {};
  let parsed: unknown = value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return {};
    try {
      parsed = JSON.parse(trimmed) as unknown;
    } catch {
      return {};
    }
  }
  if (Array.isArray(parsed)) {
    // Tolerate `[{key,value}]` (the KeyValueEditor shape) as well as a plain map.
    const out: Record<string, string> = {};
    for (const entry of parsed) {
      if (!entry || typeof entry !== 'object') continue;
      const row = entry as Record<string, unknown>;
      const key = textOf(row.key ?? row.name ?? row.field, '');
      if (!key) continue;
      out[key] = textOf(row.value ?? row.val, '');
    }
    return out;
  }
  if (!parsed || typeof parsed !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    const key = k.trim();
    if (!key) continue;
    out[key] = textOf(v, '');
  }
  return out;
}

/** Normalises a JSON column that should hold an array of strings. */
export function stringArray(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  let parsed: unknown = value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];
    try {
      parsed = JSON.parse(trimmed) as unknown;
    } catch {
      return trimmed
        .split(/\r?\n|,/)
        .map((s) => s.trim())
        .filter(Boolean);
    }
  }
  if (!Array.isArray(parsed)) {
    const single = textOf(parsed, '');
    return single ? [single] : [];
  }
  return parsed.map((v) => textOf(v, '')).filter((s) => s.trim() !== '');
}

/** Normalises the `test_data` column (`[{field,value}]` or a plain map). */
export function dataRows(value: unknown): Array<{ field: string; value: string }> {
  if (value === null || value === undefined) return [];
  let parsed: unknown = value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];
    try {
      parsed = JSON.parse(trimmed) as unknown;
    } catch {
      return [];
    }
  }
  if (Array.isArray(parsed)) {
    const out: Array<{ field: string; value: string }> = [];
    for (const entry of parsed) {
      if (!entry || typeof entry !== 'object') continue;
      const row = entry as Record<string, unknown>;
      const field = textOf(row.field ?? row.key ?? row.name, '');
      if (!field) continue;
      out.push({ field, value: textOf(row.value, '') });
    }
    return out;
  }
  if (parsed && typeof parsed === 'object') {
    return Object.entries(parsed as Record<string, unknown>).map(([field, v]) => ({
      field,
      value: textOf(v, ''),
    }));
  }
  return [];
}

/* ------------------------------------------------------------------ *
 * Identifier + path sanitisation
 * ------------------------------------------------------------------ */

/** Filesystem/URL-safe slug: lowercase, ASCII, dash-separated. */
export function slugify(input: unknown, fallback = 'qatools-project'): string {
  const base = textOf(input, '').toLowerCase();
  const ascii = base
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return ascii || fallback;
}

/** `foo-bar` / `FOO BAR` → `fooBar`. Used for TS identifiers and page-object names. */
export function camelCase(input: unknown, fallback = 'item'): string {
  const parts = slugify(input, fallback).split('-').filter(Boolean);
  if (!parts.length) return fallback;
  return parts
    .map((p, i) => (i === 0 ? p : p.charAt(0).toUpperCase() + p.slice(1)))
    .join('');
}

/** `foo-bar` → `FooBar`. Used for Java classes. */
export function pascalCase(input: unknown, fallback = 'Item'): string {
  const camel = camelCase(input, fallback.toLowerCase());
  return camel.charAt(0).toUpperCase() + camel.slice(1);
}

/** `foo-bar` → `foo_bar`. Used for Python modules and Robot variables. */
export function snakeCase(input: unknown, fallback = 'item'): string {
  const parts = slugify(input, fallback).split('-').filter(Boolean);
  return parts.length ? parts.join('_') : fallback;
}

/** `foo-bar` → `foo.bar`. Used for Java package segments. */
export function packageSegment(input: unknown, fallback = 'qatools'): string {
  const parts = slugify(input, fallback)
    .split('-')
    .filter((p) => p && !/^\d/.test(p));
  return parts.length ? parts.join('') : fallback;
}

/**
 * Makes a string safe as a **path segment** inside the generated project.
 * Rejects traversal and strips characters that break ZIP readers on Windows.
 */
export function safeSegment(input: unknown, fallback = 'file'): string {
  const raw = textOf(input, fallback)
    .replace(/[\\/]+/g, '-')
    .replace(/[\u0000-\u001f<>:"|?*]/g, '')
    .replace(/\.\.+/g, '.')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .trim();
  const out = raw.replace(/\s+/g, '-');
  return out === '' ? fallback : out.slice(0, 120);
}

/** Ensures a URL has a scheme, so `example.com` does not break `new URL()`. */
export function normaliseUrl(input: unknown, fallback = ''): string {
  const raw = textOf(input, '').trim();
  if (!raw) return fallback;
  if (/^https?:\/\//i.test(raw)) return raw.replace(/\/+$/, '');
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) return raw.replace(/\/+$/, '');
  if (raw.startsWith('/')) return fallback;
  return `https://${raw.replace(/\/+$/, '')}`;
}

/**
 * Joins a base URL and a path without doubling slashes.
 * An already-absolute `path` wins, which is how API requests store full URLs.
 */
export function joinUrl(base: string, path: unknown): string {
  const p = textOf(path, '').trim();
  if (/^https?:\/\//i.test(p)) return p;
  const b = textOf(base, '').replace(/\/+$/, '');
  if (!p) return b;
  const suffix = p.startsWith('/') ? p : `/${p}`;
  return `${b}${suffix}`;
}

/* ------------------------------------------------------------------ *
 * Language escapers
 * ------------------------------------------------------------------ */

/** Single-quoted TypeScript/JavaScript string literal (safe for any input). */
export function tsStr(value: unknown, fallback = ''): string {
  const s = textOf(value, fallback);
  const escaped = s
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t')
    // Neutralise line/paragraph separators, which are valid in JS strings but
    // invisible in diffs and confusing in generated code.
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  return `'${escaped}'`;
}

/** Double-quoted TypeScript string literal — used for regex/JSON-ish values. */
export function tsDq(value: unknown, fallback = ''): string {
  const s = textOf(value, fallback);
  const escaped = s
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t');
  return `"${escaped}"`;
}

/** Python string literal. Prefers single quotes so titles with `"` stay readable. */
export function pyStr(value: unknown, fallback = ''): string {
  const s = textOf(value, fallback);
  const escaped = s
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t');
  return `'${escaped}'`;
}

/** Java string literal (double-quoted; `"` and `\` escaped). */
export function javaStr(value: unknown, fallback = ''): string {
  const s = textOf(value, fallback);
  const escaped = s
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t');
  return `"${escaped}"`;
}

/**
 * A JSON string literal (already quoted) — used when hand-assembling JSON documents
 * such as the Postman collection, where `JSON.stringify` is not an option because
 * the surrounding text is templated.
 */
export function jsonStr(value: unknown, fallback = ''): string {
  return JSON.stringify(textOf(value, fallback));
}

/** Robot Framework scalar value, escaped for a `*** Variables ***` table cell. */
export function robotCell(value: unknown, fallback = ''): string {
  // Robot splits table cells on 2+ spaces; collapse runs so a title cannot open a column.
  return (
    textOf(value, fallback)
      .replace(/\r?\n/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .replace(/\$\{/g, '\\${')
      .replace(/%\{/g, '\\%{')
      .replace(/@\{/g, '\\@{')
      .replace(/&\{/g, '\\&{')
      .trim() || fallback
  );
}

/** Robot test/keyword name: title-like, single-spaced, never empty. */
export function robotName(value: unknown, fallback = 'Test Case'): string {
  const s = robotCell(value, fallback);
  return s === '' ? fallback : s;
}

/** A safe content-disposition filename. */
export function safeFilename(input: unknown, fallback = 'qatools-automation'): string {
  const s = textOf(input, fallback)
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '');
  return s || fallback;
}

/** Comment text collapsed onto one line so it cannot break out of a `//` or `#`. */
export function commentLine(value: unknown, fallback = ''): string {
  return textOf(value, fallback)
    .replace(/\r?\n/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * A regex-source string safe to embed: escaped and WITHOUT the `g` flag, so a
 * generated assertion cannot become stateful between Playwright retries.
 */
export function regexSource(value: unknown): string {
  const raw = textOf(value, '');
  // `/re/flags` literal form → keep the inner source only, dropping global flags.
  const m = /^\/(.*)\/([gimsuy]*)$/.exec(raw);
  const source = m ? (m[1] as string) : raw;
  return source.replace(/\r?\n/g, '').replace(/\//g, '\\/');
}

/** Returns true when a string is empty enough that emitting it would be a lie. */
export function blank(value: unknown): boolean {
  return textOf(value, '').trim() === '';
}
