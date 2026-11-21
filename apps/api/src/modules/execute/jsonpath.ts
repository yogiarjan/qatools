/**
 * Tiny JSONPath-ish resolver — deliberately dependency-free (no `jsonpath` npm package).
 *
 * Supported grammar (enough for the frozen Assertion DSL):
 *   $.a.b            nested member access
 *   $.a.b[0].c       array index
 *   $.a[0][1]        chained indexes
 *   $['a b']         quoted member (allows spaces/dots in keys)
 *   $.a[*].b         wildcard: returns an array of matches
 *   $.a.length       length of the value at $.a
 *   $                the root document
 *   a.b.c            leading `$.` is optional
 *
 * Anything unsupported returns `{ found: false }` rather than throwing, so an
 * assertion on a missing path becomes `exists -> false` instead of a crash.
 */

export interface JsonPathResult {
  found: boolean;
  value: unknown;
}

type Token = { kind: 'member'; name: string } | { kind: 'index'; index: number } | { kind: 'wildcard' };

/** Splits a path into tokens; returns null when the path is not parseable. */
export function tokenizePath(path: string): Token[] | null {
  const raw = (path ?? '').trim();
  if (!raw || raw === '$') return [];

  let rest = raw;
  if (rest.startsWith('$')) rest = rest.slice(1);
  else if (rest.startsWith('.')) rest = rest.slice(1);

  const tokens: Token[] = [];
  let i = 0;

  while (i < rest.length) {
    const ch = rest[i];

    if (ch === '.') {
      i++;
      continue;
    }

    if (ch === '[') {
      const close = rest.indexOf(']', i);
      if (close === -1) return null;
      const inner = rest.slice(i + 1, close).trim();
      i = close + 1;

      if (inner === '*') {
        tokens.push({ kind: 'wildcard' });
        continue;
      }
      // ['key'] or ["key"]
      if (
        (inner.startsWith("'") && inner.endsWith("'") && inner.length >= 2) ||
        (inner.startsWith('"') && inner.endsWith('"') && inner.length >= 2)
      ) {
        tokens.push({ kind: 'member', name: inner.slice(1, -1) });
        continue;
      }
      if (/^-?\d+$/.test(inner)) {
        tokens.push({ kind: 'index', index: Number(inner) });
        continue;
      }
      return null;
    }

    // bare member name, stops at `.` or `[`
    let j = i;
    while (j < rest.length && rest[j] !== '.' && rest[j] !== '[') j++;
    const name = rest.slice(i, j);
    if (!name) return null;
    tokens.push({ kind: 'member', name });
    i = j;
  }

  return tokens;
}

/**
 * Resolves `path` against `root`.
 * When the path contains a wildcard the result value is an array of matches.
 */
export function resolvePath(root: unknown, path: string): JsonPathResult {
  const tokens = tokenizePath(path);
  if (tokens === null) return { found: false, value: undefined };
  if (tokens.length === 0) return { found: true, value: root };

  // `length` is a pseudo-member applied to the value collected so far.
  let current: unknown[] = [root];

  for (const token of tokens) {
    const next: unknown[] = [];

    for (const node of current) {
      if (token.kind === 'member') {
        if (token.name === 'length') {
          const len = lengthOf(node);
          if (len !== null) next.push(len);
          continue;
        }
        const obj = asObject(node);
        if (obj && Object.prototype.hasOwnProperty.call(obj, token.name)) {
          next.push(obj[token.name]);
        }
        continue;
      }

      if (token.kind === 'index') {
        if (Array.isArray(node)) {
          const idx = token.index < 0 ? node.length + token.index : token.index;
          if (idx >= 0 && idx < node.length) next.push(node[idx]);
        }
        continue;
      }

      // wildcard
      if (Array.isArray(node)) next.push(...node);
      else {
        const obj = asObject(node);
        if (obj) next.push(...Object.values(obj));
      }
    }

    if (!next.length) return { found: false, value: undefined };
    current = next;
  }

  return { found: true, value: current.length === 1 ? current[0] : current };
}

/** `null` when the value has no meaningful length. */
function lengthOf(value: unknown): number | null {
  if (typeof value === 'string') return value.length;
  if (Array.isArray(value)) return value.length;
  const obj = asObject(value);
  if (obj) return Object.keys(obj).length;
  return null;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Human-readable rendering used in assertion messages / step logs. */
export function displayValue(value: unknown, max = 300): string {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (typeof value === 'string') return value.length > max ? `${value.slice(0, max)}…` : value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    const json = JSON.stringify(value);
    return json && json.length > max ? `${json.slice(0, max)}…` : (json ?? String(value));
  } catch {
    return String(value);
  }
}
