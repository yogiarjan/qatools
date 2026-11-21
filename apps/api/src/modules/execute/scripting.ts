/**
 * Template interpolation + the RESTRICTED script subset for API automation.
 *
 * SECURITY: `pre_script` / `post_script` are NEVER passed to `eval`/`new Function`.
 * Only a tiny declarative grammar is accepted:
 *
 *   set("token", jsonpath($.data.token))      // extract a value from the response
 *   set("id", status)                          // numbers/strings/paths
 *   set("base", "https://example.test")        // literal
 *   header("X-Trace", "abc")                   // add/override a request header (pre-script)
 *   var("name", jsonpath($.items[0].id))       // alias of set()
 *
 * Anything else is rejected with a clear, actionable error.
 */

import type { Assertion } from '@qatools/shared';
import { resolvePath, displayValue } from './jsonpath.js';

/* ------------------------------------------------------------------ *
 * Variable interpolation
 * ------------------------------------------------------------------ */

/** Replaces every `{{name}}` with `vars[name]`; unknown names stay untouched and are reported. */
export function interpolate(
  template: string | null | undefined,
  vars: Record<string, unknown>,
): { text: string; missing: string[] } {
  if (template === null || template === undefined) return { text: '', missing: [] };
  const missing: string[] = [];
  const text = template.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (whole, name: string) => {
    if (Object.prototype.hasOwnProperty.call(vars, name)) {
      const v = vars[name];
      return v === null || v === undefined ? '' : String(v);
    }
    if (!missing.includes(name)) missing.push(name);
    return whole;
  });
  return { text, missing };
}

/** Recursively interpolates every string value of a plain object. */
export function interpolateObject(
  obj: Record<string, unknown> | null | undefined,
  vars: Record<string, unknown>,
): { value: Record<string, unknown>; missing: string[] } {
  const out: Record<string, unknown> = {};
  const missing: string[] = [];
  for (const [k, v] of Object.entries(obj ?? {})) {
    const key = interpolate(k, vars);
    missing.push(...key.missing);
    if (typeof v === 'string') {
      const r = interpolate(v, vars);
      missing.push(...r.missing);
      out[key.text] = r.text;
    } else {
      out[key.text] = v;
    }
  }
  return { value: out, missing };
}

/** True when the template still contains an unresolved `{{...}}` placeholder. */
export function hasUnresolved(text: string): boolean {
  return /\{\{\s*[\w.-]+\s*\}\}/.test(text);
}

/* ------------------------------------------------------------------ *
 * Restricted script interpreter
 * ------------------------------------------------------------------ */

export interface ScriptEffect {
  /** Values extracted into the run's variable bag. */
  sets: Record<string, unknown>;
  /** Headers to merge into the outgoing request (pre-script). */
  headers: Record<string, string>;
  /** One human-readable log line per accepted statement. */
  logs: string[];
}

export interface ScriptContext {
  /** Parsed response JSON (post-script) — undefined for pre-scripts. */
  json?: unknown;
  /** Raw response text. */
  body?: string;
  /** Response status. */
  status?: number;
  /** Response headers. */
  headers?: Record<string, string>;
  /** Current variable bag (collection variables + environment). */
  vars: Record<string, unknown>;
}

const STATEMENT = /^\s*([a-zA-Z_][\w]*)\s*\((.*)\)\s*;?\s*$/s;
const ALLOWED_FUNCS = new Set(['set', 'var', 'header']);

/**
 * Executes the restricted script subset.
 * @throws Error with a precise message when a statement is not whitelisted.
 */
export function runScript(script: string | null | undefined, ctx: ScriptContext): ScriptEffect {
  const effect: ScriptEffect = { sets: {}, headers: {}, logs: [] };
  const source = (script ?? '').trim();
  if (!source) return effect;

  const statements = splitStatements(source);
  if (!statements.length) return effect;

  for (const raw of statements) {
    const stmt = raw.trim();
    if (!stmt || stmt.startsWith('//') || stmt.startsWith('#')) continue;

    const match = STATEMENT.exec(stmt);
    if (!match) {
      throw new Error(
        `Skrip tidak diizinkan: "${truncateStmt(stmt)}". Hanya pernyataan ` +
          `set("nama", ...) / var("nama", ...) / header("Nama", "nilai") yang didukung.`,
      );
    }

    const fn = match[1] as string;
    if (!ALLOWED_FUNCS.has(fn)) {
      throw new Error(
        `Fungsi "${fn}" tidak diizinkan. QATools tidak mengeksekusi JavaScript bebas; ` +
          `gunakan set(), var(), atau header().`,
      );
    }

    const args = splitArgs(match[2] ?? '');
    if (args.length < 2) {
      throw new Error(`Pernyataan "${fn}(...)" butuh minimal 2 argumen.`);
    }

    const name = readStringLiteral(args[0] as string);
    const value = evaluateExpression(args[1] as string, ctx);

    if (fn === 'header') {
      effect.headers[name] = String(value ?? '');
      effect.logs.push(`header ${name} = ${displayValue(value, 80)}`);
    } else {
      effect.sets[name] = value;
      effect.logs.push(`set ${name} = ${displayValue(value, 120)}`);
    }

    if (args.length > 2) {
      throw new Error(`Pernyataan "${fn}(${name}, …)" menerima tepat 2 argumen.`);
    }
  }

  return effect;
}

/** Splits on newlines and top-level semicolons, respecting quotes and parens. */
function splitStatements(source: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let current = '';

  for (let i = 0; i < source.length; i++) {
    const ch = source[i] as string;
    if (quote) {
      current += ch;
      if (ch === '\\') {
        current += source[i + 1] ?? '';
        i++;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if ((ch === ';' || ch === '\n') && depth === 0) {
      if (current.trim()) out.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) out.push(current);
  return out;
}

/** Splits a call's argument list at top-level commas. */
function splitArgs(argSource: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let current = '';

  for (let i = 0; i < argSource.length; i++) {
    const ch = argSource[i] as string;
    if (quote) {
      current += ch;
      if (ch === '\\') {
        current += argSource[i + 1] ?? '';
        i++;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    if (ch === ')' || ch === ']' || ch === '}') depth--;
    if (ch === ',' && depth === 0) {
      out.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

function readStringLiteral(token: string): string {
  const t = token.trim();
  if (
    (t.startsWith('"') && t.endsWith('"') && t.length >= 2) ||
    (t.startsWith("'") && t.endsWith("'") && t.length >= 2)
  ) {
    return t.slice(1, -1);
  }
  throw new Error(`Argumen pertama harus berupa string literal (contoh: "token"), bukan ${truncateStmt(t)}.`);
}

/** The only expression forms allowed as the second argument. */
function evaluateExpression(token: string, ctx: ScriptContext): unknown {
  const t = token.trim();

  if (
    (t.startsWith('"') && t.endsWith('"') && t.length >= 2) ||
    (t.startsWith("'") && t.endsWith("'") && t.length >= 2)
  ) {
    return t.slice(1, -1);
  }

  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  if (t === 'true') return true;
  if (t === 'false') return false;
  if (t === 'null') return null;

  const call = /^([a-zA-Z_][\w]*)\s*\((.*)\)$/s.exec(t);
  if (call) {
    const fn = call[1] as string;
    const arg = (call[2] ?? '').trim();

    if (fn === 'jsonpath' || fn === 'jsonPath') {
      const path = readStringLiteral(arg);
      const doc = ctx.json;
      const resolved = resolvePath(doc, path);
      if (!resolved.found) {
        throw new Error(`jsonpath("${path}") tidak menemukan nilai pada respons.`);
      }
      return resolved.value;
    }

    if (fn === 'status') return ctx.status ?? null;
    if (fn === 'body') return ctx.body ?? '';
    if (fn === 'header') {
      const wanted = readStringLiteral(arg).toLowerCase();
      const key = Object.keys(ctx.headers ?? {}).find((k) => k.toLowerCase() === wanted);
      return key ? (ctx.headers as Record<string, string>)[key] : null;
    }

    throw new Error(`Fungsi "${fn}" tidak dikenal dalam ekspresi skrip. Gunakan jsonpath("$.a.b"), status, body, atau header("Nama").`);
  }

  // Bare identifiers: context keywords first, then the variable bag.
  if (/^[a-zA-Z_][\w.]*$/.test(t)) {
    if (t === 'status') return ctx.status ?? null;
    if (t === 'body') return ctx.body ?? '';
    if (Object.prototype.hasOwnProperty.call(ctx.vars, t)) return ctx.vars[t];
    throw new Error(`Variabel "${t}" belum terdefinisi.`);
  }

  throw new Error(`Ekspresi tidak didukung: ${truncateStmt(t)}.`);
}

function truncateStmt(s: string): string {
  return s.length > 80 ? `${s.slice(0, 80)}…` : s;
}

/* ------------------------------------------------------------------ *
 * Auth
 * ------------------------------------------------------------------ */

export interface AuthResult {
  headers: Record<string, string>;
  /** Query parameters contributed by the auth scheme (e.g. api_key in query). */
  query: Record<string, string>;
  describe: string;
}

/**
 * Builds auth headers/query from an `ApiCollection.auth_type` + `auth_config`.
 * Never throws — an incomplete config degrades into a reported no-op.
 */
export function applyAuth(
  authType: string | null | undefined,
  authConfig: Record<string, unknown> | null | undefined,
  vars: Record<string, unknown>,
): AuthResult {
  const headers: Record<string, string> = {};
  const query: Record<string, string> = {};
  const cfg = authConfig ?? {};
  const type = authType ?? 'none';

  const valueOf = (key: string): string => {
    const raw = cfg[key];
    if (raw === undefined || raw === null) return '';
    const { text } = interpolate(String(raw), vars);
    return text;
  };

  switch (type) {
    case 'bearer': {
      const token = valueOf('token') || valueOf('api_key');
      if (token) headers.Authorization = `Bearer ${token}`;
      return { headers, query, describe: token ? 'bearer token diterapkan' : 'bearer tanpa token (dilewati)' };
    }
    case 'basic': {
      const user = valueOf('username');
      const pass = valueOf('password');
      const encoded = Buffer.from(`${user}:${pass}`, 'utf8').toString('base64');
      headers.Authorization = `Basic ${encoded}`;
      return { headers, query, describe: `basic auth untuk user "${user}"` };
    }
    case 'api_key': {
      const name = valueOf('key') || 'X-API-Key';
      const value = valueOf('value');
      const where = (valueOf('in') || 'header').toLowerCase();
      if (!value) return { headers, query, describe: 'api_key tanpa nilai (dilewati)' };
      if (where === 'query') {
        query[name] = value;
        return { headers, query, describe: `api_key "${name}" di query string` };
      }
      headers[name] = value;
      return { headers, query, describe: `api_key "${name}" di header` };
    }
    default:
      return { headers, query, describe: 'tanpa auth' };
  }
}

/* ------------------------------------------------------------------ *
 * Assertion JSON helpers (never leak a parse crash to a route)
 * ------------------------------------------------------------------ */

export function normalizeAssertions(input: unknown): Assertion[] {
  if (Array.isArray(input)) {
    return input.filter(isAssertionLike) as Assertion[];
  }
  if (typeof input === 'string' && input.trim()) {
    try {
      const parsed = JSON.parse(input) as unknown;
      return Array.isArray(parsed) ? (parsed.filter(isAssertionLike) as Assertion[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function isAssertionLike(v: unknown): boolean {
  return (
    v !== null &&
    typeof v === 'object' &&
    typeof (v as { source?: unknown }).source === 'string' &&
    typeof (v as { operator?: unknown }).operator === 'string'
  );
}
