/**
 * THE single assertion evaluator shared by the API, DB and Web engines.
 * Implements the FROZEN `Assertion` / `AssertionOperator` DSL from
 * `packages/shared/src/entities.ts` — do not fork this logic per engine.
 *
 *   import { evaluateAssertions } from '../execute/assertions.js';
 *   const { results, passed } = evaluateAssertions(assertions, ctx);
 *
 * `EngineResult.assertions` uses exactly the `AssertionOutcome` shape below.
 */

import type { Assertion, AssertionOperator } from '@qatools/shared';
import { resolvePath, displayValue } from './jsonpath.js';

/** Observation context — a superset covering api | db | web sources. */
export interface AssertionContext {
  /** HTTP status code (api engine, web engine's page fetch). */
  status?: number | null;
  /** Raw response text / page HTML (api, web). */
  body?: unknown;
  /** Response headers, lower-cased keys preferred. */
  headers?: Record<string, unknown>;
  /** Elapsed wall-clock duration of the operation under test. */
  duration_ms?: number | null;
  /** Parsed JSON document used by `jsonpath` source. */
  json?: unknown;
  /** Number of rows returned (db engine). */
  row_count?: number | null;
  /** Column names of the result set (db). */
  columns?: string[];
  /** First row as a record (db). */
  first_row?: Record<string, unknown> | null;
  /** All rows (db) — `column` source resolves `<path>` against the first row. */
  rows?: Array<Record<string, unknown>>;
  /** Visible text of the page / element (web). */
  text?: string | null;
  /** Selector-hit resolution produced by the web engine's extractor. */
  elements?: Record<string, ElementObservation>;
  /** Free-form already-collected values keyed by name. */
  vars?: Record<string, unknown>;
}

export interface ElementObservation {
  found: boolean;
  count: number;
  text?: string;
  tag?: string;
  attributes?: Record<string, string>;
  selector?: string;
}

export interface AssertionOutcome {
  assertion: Assertion;
  passed: boolean;
  observed: unknown;
  message: string;
}

export interface AssertionReport {
  results: AssertionOutcome[];
  passed: boolean;
  passed_count: number;
  failed_count: number;
}

/* ------------------------------------------------------------------ *
 * Value coercion helpers
 * ------------------------------------------------------------------ */

function toNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'string') {
    const trimmed = v.trim();
    if (trimmed === '') return null;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function toText(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  try {
    return JSON.stringify(v) ?? '';
  } catch {
    return String(v);
  }
}

/** Loose equality: numeric-aware, string-trimmed, deep for objects/arrays. */
function looseEquals(observed: unknown, expected: unknown): boolean {
  const o = toNumber(observed);
  const e = toNumber(expected);
  if (o !== null && e !== null) return o === e;
  if (typeof observed === 'boolean' || typeof expected === 'boolean') {
    return String(observed).toLowerCase() === String(expected).toLowerCase();
  }
  if (observed !== null && expected !== null && typeof observed === 'object' && typeof expected === 'object') {
    return stableStringify(observed) === stableStringify(expected);
  }
  return String(observed ?? '') === String(expected ?? '');
}

function stableStringify(v: unknown): string {
  try {
    return JSON.stringify(v, (_k, val) => {
      if (val && typeof val === 'object' && !Array.isArray(val)) {
        return Object.fromEntries(Object.entries(val as Record<string, unknown>).sort());
      }
      return val;
    }) ?? '';
  } catch {
    return String(v);
  }
}

/** `in` accepts an array literal or a comma-separated string. */
function asList(expected: unknown): unknown[] {
  if (Array.isArray(expected)) return expected;
  if (typeof expected === 'string') {
    const trimmed = expected.trim();
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      try {
        const parsed = JSON.parse(trimmed) as unknown;
        if (Array.isArray(parsed)) return parsed;
      } catch {
        /* fall through to comma split */
      }
    }
    return trimmed.split(',').map((s) => s.trim());
  }
  if (expected === null || expected === undefined) return [];
  return [expected];
}

function safeRegex(pattern: string): RegExp | null {
  try {
    // `/re/flags` literal form or a bare pattern.
    const m = /^\/(.*)\/([gimsuy]*)$/.exec(pattern);
    return m ? new RegExp(m[1] as string, (m[2] as string) || '') : new RegExp(pattern);
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * Source resolution
 * ------------------------------------------------------------------ */

export interface Resolved {
  /** Whether the source itself could be located (false => exists fails). */
  found: boolean;
  value: unknown;
  /** What the source refers to, for messages/evidence. */
  label: string;
}

/**
 * Resolves one `Assertion.source` (+ optional `path`) against the context.
 * This is the ONLY place that knows how a source maps onto the context.
 */
export function resolveSource(assertion: Assertion, ctx: AssertionContext): Resolved {
  const path = assertion.path ?? '';

  switch (assertion.source) {
    case 'status':
      return {
        found: ctx.status !== null && ctx.status !== undefined,
        value: ctx.status ?? null,
        label: 'status',
      };

    case 'duration':
      return {
        found: ctx.duration_ms !== null && ctx.duration_ms !== undefined,
        value: ctx.duration_ms ?? null,
        label: 'duration',
      };

    case 'row_count':
      return {
        found: ctx.row_count !== null && ctx.row_count !== undefined,
        value: ctx.row_count ?? null,
        label: 'row_count',
      };

    case 'header': {
      const headers = ctx.headers ?? {};
      const wanted = path.toLowerCase();
      const key = Object.keys(headers).find((k) => k.toLowerCase() === wanted);
      if (key === undefined) return { found: false, value: undefined, label: `header ${path}` };
      return { found: true, value: headers[key], label: `header ${path}` };
    }

    case 'jsonpath': {
      // Prefer an explicit JSON document (api/web). For DB checks there is no
      // JSON body, so `$.n` resolves against the FIRST ROW — this lets a
      // `SELECT COUNT(*) AS n ...` check be asserted with jsonpath($.n).
      const doc = ctx.json !== undefined ? ctx.json : (ctx.first_row ?? parseMaybeJson(ctx.body));
      const resolved = resolvePath(doc, path);
      return { found: resolved.found, value: resolved.value, label: `jsonpath ${path}` };
    }

    case 'body': {
      if (path) {
        // `body` with a path behaves like a jsonpath lookup first, then a raw substring.
        const doc = ctx.json !== undefined ? ctx.json : parseMaybeJson(ctx.body);
        const resolved = resolvePath(doc, path);
        if (resolved.found) {
          return { found: true, value: resolved.value, label: `body ${path}` };
        }
        const raw = toText(ctx.body);
        const hit = raw.includes(path);
        return { found: hit, value: raw, label: `body ~ ${path}` };
      }
      const raw = toText(ctx.body);
      return { found: raw.length > 0, value: raw, label: 'body' };
    }

    case 'text': {
      const raw = ctx.text ?? toText(ctx.body);
      if (path) {
        // A selector-ish path against `text` means "text of that element" when available.
        const el = ctx.elements?.[path];
        if (el) return { found: el.found, value: el.text ?? '', label: `text of ${path}` };
        const hit = raw.includes(path);
        return { found: hit, value: raw, label: `text ~ ${path}` };
      }
      return { found: raw.length > 0, value: raw, label: 'text' };
    }

    case 'element': {
      const selector = path || (assertion.expected as string) || '';
      const el = ctx.elements?.[selector];
      if (!el) {
        return { found: false, value: null, label: `element ${selector}`, };
      }
      return { found: el.found, value: el.found ? (el.text ?? '') : null, label: `element ${selector}` };
    }

    case 'column': {
      const row = ctx.first_row ?? ctx.rows?.[0] ?? null;
      if (!row) return { found: false, value: undefined, label: `column ${path}` };
      const key = Object.keys(row).find((k) => k.toLowerCase() === path.toLowerCase());
      if (key === undefined) return { found: false, value: undefined, label: `column ${path}` };
      return { found: true, value: row[key], label: `column ${path}` };
    }

    default:
      return { found: false, value: undefined, label: String(assertion.source) };
  }
}

function parseMaybeJson(body: unknown): unknown {
  if (typeof body !== 'string') return body;
  const trimmed = body.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

/* ------------------------------------------------------------------ *
 * Operator application
 * ------------------------------------------------------------------ */

function applyOperator(op: AssertionOperator, resolved: Resolved, expected: unknown): { passed: boolean; detail: string } {
  const { found, value } = resolved;
  const show = (v: unknown) => displayValue(v, 160);

  switch (op) {
    case 'exists':
      return { passed: found, detail: found ? `ditemukan: ${show(value)}` : 'tidak ditemukan' };

    case 'not_exists':
      return { passed: !found, detail: !found ? 'tidak ditemukan (sesuai harapan)' : `justru ditemukan: ${show(value)}` };

    case 'equals':
      return {
        passed: found && looseEquals(value, expected),
        detail: `diamati ${show(value)} vs diharapkan ${show(expected)}`,
      };

    case 'not_equals':
      return {
        passed: found && !looseEquals(value, expected),
        detail: `diamati ${show(value)} vs tidak-diharapkan ${show(expected)}`,
      };

    case 'contains':
      return {
        passed: found && toText(value).includes(toText(expected)),
        detail: `${show(value)} ${toText(value).includes(toText(expected)) ? 'memuat' : 'tidak memuat'} ${show(expected)}`,
      };

    case 'not_contains':
      return {
        passed: found && !toText(value).includes(toText(expected)),
        detail: `diamati ${show(value)} (tidak boleh memuat ${show(expected)})`,
      };

    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      const av = toNumber(value);
      const bv = toNumber(expected);
      if (av === null || bv === null) {
        return { passed: false, detail: `nilai tidak numerik: ${show(value)} / ${show(expected)}` };
      }
      const ok =
        op === 'gt' ? av > bv : op === 'gte' ? av >= bv : op === 'lt' ? av < bv : av <= bv;
      const sym = { gt: '>', gte: '>=', lt: '<', lte: '<=' }[op];
      return { passed: ok, detail: `${av} ${sym} ${bv} = ${ok}` };
    }

    case 'matches': {
      const pattern = toText(expected);
      const re = safeRegex(pattern);
      if (!re) return { passed: false, detail: `regex tidak valid: ${pattern}` };
      const text = toText(value);
      return { passed: found && re.test(text), detail: `${show(text)} ${re.test(text) ? 'cocok' : 'tidak cocok'} /${pattern}/` };
    }

    case 'in': {
      const list = asList(expected);
      const ok = found && list.some((candidate) => looseEquals(value, candidate));
      return { passed: ok, detail: `${show(value)} ${ok ? 'termasuk' : 'tidak termasuk'} [${list.map(show).join(', ')}]` };
    }

    case 'length_gte':
    case 'length_lte': {
      const len = Array.isArray(value)
        ? value.length
        : typeof value === 'string'
          ? value.length
          : value !== null && typeof value === 'object'
            ? Object.keys(value as object).length
            : null;
      const bound = toNumber(expected);
      if (len === null || bound === null) {
        return { passed: false, detail: `panjang tidak terukur: ${show(value)}` };
      }
      const ok = op === 'length_gte' ? len >= bound : len <= bound;
      return { passed: ok, detail: `length ${len} ${op === 'length_gte' ? '>=' : '<='} ${bound} = ${ok}` };
    }

    default:
      return { passed: false, detail: `operator tidak dikenal: ${String(op)}` };
  }
}

/* ------------------------------------------------------------------ *
 * Public API
 * ------------------------------------------------------------------ */

/** Evaluates one assertion; never throws. */
export function evaluateAssertion(assertion: Assertion, ctx: AssertionContext): AssertionOutcome {
  try {
    const resolved = resolveSource(assertion, ctx);
    const { passed, detail } = applyOperator(assertion.operator, resolved, assertion.expected);

    const prefix = assertion.message?.trim() ? `${assertion.message.trim()} — ` : '';
    const message = `${prefix}${resolved.label} ${assertion.operator}: ${detail}`;

    return { assertion, passed, observed: resolved.value, message };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return {
      assertion,
      passed: false,
      observed: undefined,
      message: `evaluasi gagal: ${reason}`,
    };
  }
}

/**
 * Evaluates every assertion. `passed` is true only when the list is non-empty
 * AND every assertion passed — an empty list is an explicit "no checks" result
 * the callers treat as their own policy decision.
 */
export function evaluateAssertions(
  assertions: Assertion[] | null | undefined,
  ctx: AssertionContext,
): AssertionReport {
  const list = Array.isArray(assertions) ? assertions : [];
  const results = list.map((a) => evaluateAssertion(a, ctx));
  const passed_count = results.filter((r) => r.passed).length;
  return {
    results,
    passed: results.length > 0 && passed_count === results.length,
    passed_count,
    failed_count: results.length - passed_count,
  };
}

/** Normalises a JSON column holding `Assertion[]` without importing the db helper. */
export function coerceAssertions(value: unknown): Assertion[] {
  if (Array.isArray(value)) return value as Assertion[];
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? (parsed as Assertion[]) : [];
  } catch {
    return [];
  }
}
