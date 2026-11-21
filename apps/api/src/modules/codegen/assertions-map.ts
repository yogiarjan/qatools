/**
 * The shared `Assertion` DSL → per-framework matcher translation table.
 *
 * Every generator translates assertions through this module so the eight frameworks
 * agree on semantics. The reference implementation of the DSL is
 * `modules/execute/assertions.ts` — where the two disagree, that file is right.
 *
 * Returned matchers are *descriptor objects*, not strings, because each target
 * language needs a different call shape (`expect(x).toBe(y)` vs `assert x == y`
 * vs Hamcrest's `equalTo(y)`). One descriptor, eight renderers.
 */

import type { Assertion, AssertionOperator } from '@qatools/shared';
import { numOf, regexSource, textOf } from './util.js';
import type { ResolvedDbCheck, ResolvedRequest } from './types.js';

export type MatcherKind =
  | 'equal'
  | 'not_equal'
  | 'contains'
  | 'not_contains'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'exists'
  | 'not_exists'
  | 'matches'
  | 'in'
  | 'length_gte'
  | 'length_lte';

export interface Matcher {
  kind: MatcherKind;
  /** Expected value as authored (string | number | boolean | null | array). */
  expected: unknown;
  /** JSON-ish display of `expected`, safe for comments. */
  display: string;
  /** Extra matcher argument, e.g. the substring for `contains`. */
  extra?: string;
  /** 1-based capture-group index for `matches` when the source used `/re/g`. */
  regex: string | null;
}

export interface AssertionTarget {
  /** Subject expression in the target language, e.g. `response.status()`. */
  subject: string;
  /** Human label of the resolved source, for comments and messages. */
  label: string;
  /** Present for `matches` — a `RegExp` literal in the target language. */
  pattern?: string;
  matcher: Matcher;
  /** Original assertion, for `message` and provenance. */
  assertion: Assertion;
}

/* ------------------------------------------------------------------ *
 * Operator → matcher
 * ------------------------------------------------------------------ */

const KIND_BY_OPERATOR: Record<AssertionOperator, MatcherKind> = {
  equals: 'equal',
  not_equals: 'not_equal',
  contains: 'contains',
  not_contains: 'not_contains',
  gt: 'gt',
  gte: 'gte',
  lt: 'lt',
  lte: 'lte',
  exists: 'exists',
  not_exists: 'not_exists',
  matches: 'matches',
  in: 'in',
  length_gte: 'length_gte',
  length_lte: 'length_lte',
};

export function matcherFor(assertion: Assertion): Matcher {
  const kind = KIND_BY_OPERATOR[assertion.operator] ?? 'exists';
  const expected = assertion.expected;
  let display: string;
  try {
    display = typeof expected === 'string' ? expected : JSON.stringify(expected ?? null) ?? 'null';
  } catch {
    display = textOf(expected, 'null');
  }
  return {
    kind,
    expected,
    display,
    regex: kind === 'matches' ? regexSource(expected) : null,
  };
}

/* ------------------------------------------------------------------ *
 * Source resolution per target family
 * ------------------------------------------------------------------ */

/** Where an API assertion reads from. */
export type ApiSource = 'status' | 'duration' | 'header' | 'jsonpath' | 'body' | 'text' | 'element';

export interface JsApiSubjects {
  /** Response object expression, e.g. `response` (Playwright) or `res` (Cypress). */
  response: string;
  /** Parsed-JSON accessor expression builder. */
  json: (path: string) => string;
  /** Header accessor builder. */
  header: (name: string) => string;
  /** Raw text accessor. */
  text: string;
  /** Status accessor. */
  status: string;
  /** Duration accessor. */
  duration: string;
}

/**
 * Maps an API assertion onto a subject expression for a JS/TS-family target.
 * Unknown sources are reported as `null` so the caller can raise a warning instead
 * of emitting a silently-passing assertion.
 */
export function resolveApiAssertionJs(
  assertion: Assertion,
  s: JsApiSubjects,
): { subject: string; label: string } | null {
  const path = (assertion.path ?? '').trim();
  switch (assertion.source) {
    case 'status':
      return { subject: s.status, label: 'HTTP status' };
    case 'duration':
      return { subject: s.duration, label: 'response duration (ms)' };
    case 'header':
      return path
        ? { subject: s.header(path), label: `header ${path}` }
        : { subject: s.header('content-type'), label: 'header content-type' };
    case 'jsonpath':
    case 'body':
      return path
        ? { subject: s.json(path), label: `body ${path}` }
        : { subject: s.text, label: 'response body' };
    case 'text':
      return { subject: s.text, label: path ? `text ~ ${path}` : 'response text' };
    case 'element':
      return path
        ? { subject: s.json(path), label: `element ${path}` }
        : { subject: s.text, label: 'response body' };
    default:
      // `row_count` / `column` are database sources — an API target cannot honour them.
      return null;
  }
}

/** Maps a DB assertion onto a Python/SQL subject expression. */
export function resolveDbAssertion(
  assertion: Assertion,
  opts: { rows: string; rowCount: string; row: string },
): { subject: string; label: string } | null {
  const path = (assertion.path ?? '').trim();
  switch (assertion.source) {
    case 'row_count':
      return { subject: opts.rowCount, label: 'jumlah baris' };
    case 'column':
      return path ? { subject: `${opts.row}["${path}"]`, label: `kolom ${path}` } : null;
    case 'jsonpath':
    case 'body': {
      // `$.n` against a DB check resolves to the FIRST ROW, mirroring
      // `resolveSource()` in modules/execute/assertions.ts.
      const key = jsonPathToKey(path);
      return key ? { subject: `${opts.row}["${key}"]`, label: `kolom ${key}` } : null;
    }
    case 'text':
      return { subject: opts.rows, label: 'hasil query (teks)' };
    default:
      return null;
  }
}

/** `$.data.n` / `data.n` / `n` → `n` (the first row's column name). */
export function jsonPathToKey(path: string): string {
  const cleaned = textOf(path, '')
    .replace(/^\$\.?/, '')
    .replace(/\[(\d+)\]/g, '')
    .trim();
  const parts = cleaned.split('.').filter(Boolean);
  return parts.length ? (parts[parts.length - 1] as string) : '';
}

/* ------------------------------------------------------------------ *
 * Web assertion mapping
 * ------------------------------------------------------------------ */

export interface WebSubjectHint {
  /** Playwright locator expression for the step's selector. */
  locator: string;
}

/** Maps a web-layer assertion (or a `WebStep` expectation) to a locator matcher. */
export function matcherFromOperator(op: AssertionOperator | 'equals', expected: unknown): Matcher {
  return matcherFor({
    source: 'text',
    path: '',
    operator: op,
    expected,
  });
}

/* ------------------------------------------------------------------ *
 * Convenience projections used by every API-oriented generator
 * ------------------------------------------------------------------ */

/** Assertions attached to an API request, already normalised. */
export function apiAssertionsOf(req: ResolvedRequest): Assertion[] {
  return req.assertions;
}

/** Assertions attached to a DB check, already normalised. */
export function dbAssertionsOf(check: ResolvedDbCheck): Assertion[] {
  return check.assertions;
}

/**
 * Performance thresholds for k6, distilled from the case's own expectations.
 * Preference order: explicit `*_ms`/`vus` keys in test_data → a `performance`
 * tag's numbers → conservative defaults. Never invents a value from nothing.
 */
export function performanceFromExpectations(input: {
  data: Array<{ field: string; value: string }>;
  tags: string[];
  estimated_minutes: number;
}): { p95_ms: number; vus: number; duration_s: number; error_rate: number } {
  const bag = new Map<string, string>();
  for (const row of input.data) bag.set(row.field.toLowerCase(), row.value);

  // Tags like `sla:p95=800ms`, `vus=20`, `duration=60s`.
  for (const tag of input.tags) {
    const m = /^\s*([a-z_]+)\s*[:=]\s*([0-9.]+)\s*([a-z%]*)\s*$/i.exec(tag);
    if (!m) continue;
    const key = (m[1] as string).toLowerCase();
    bag.set(key === 'p95' || key === 'sla' ? 'p95_ms' : key, `${m[2]}${m[3] ?? ''}`);
  }

  const read = (...keys: string[]): string | null => {
    for (const k of keys) {
      const v = bag.get(k);
      if (v !== undefined && v !== '') return v;
    }
    return null;
  };
  const ms = (raw: string | null, fallback: number): number => {
    if (raw === null) return fallback;
    const m = /^([0-9.]+)\s*(ms|s|m|%)?$/i.exec(raw.trim());
    if (!m) return fallback;
    const n = numOf(m[1], fallback);
    const unit = (m[2] ?? 'ms').toLowerCase();
    const value = unit === 's' ? n * 1000 : unit === 'm' ? n * 60_000 : n;
    return Math.max(1, Math.round(value));
  };

  const p95 = ms(read('p95_ms', 'p95', 'response_time', 'sla_ms'), 1500);
  const estMin = numOf(input.estimated_minutes, 1);
  return {
    p95_ms: p95,
    vus: Math.max(1, Math.round(numOf(read('vus', 'users', 'concurrency'), 10))),
    duration_s: Math.max(1, Math.round(numOf(read('duration_s', 'duration'), Math.max(10, estMin * 10)))),
    error_rate: Math.min(50, Math.max(0, numOf(read('error_rate', 'error_pct'), 1))),
  };
}
