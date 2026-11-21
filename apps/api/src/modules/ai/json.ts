/**
 * Lane D — tolerant JSON extraction from model replies.
 *
 * Models are unreliable narrators: they wrap JSON in markdown fences, prepend
 * "Berikut hasilnya:", append commentary, or emit smart quotes. None of that may
 * ever 500 a request, so we try hard and then hand back `null` so the caller can
 * degrade to the deterministic offline generator.
 */

/** Result of a lenient parse attempt. */
export interface ExtractResult {
  value: unknown;
  /** How the payload was recovered — useful in logs/tests. */
  via: 'direct' | 'fence' | 'balanced' | 'salvage' | null;
}

/** Removes zero-width/BOM noise that models occasionally emit. */
function clean(text: string): string {
  return text
    .replace(/^\uFEFF/, '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\r\n/g, '\n');
}

/**
 * Extracts the first balanced JSON object or array from `text`.
 * Strings and escapes are respected so braces inside strings do not confuse the scan.
 */
export function findBalancedJson(text: string): string | null {
  const src = clean(text);
  for (let start = 0; start < src.length; start++) {
    const ch = src[start];
    if (ch !== '{' && ch !== '[') continue;
    const open = ch;
    const close = ch === '{' ? '}' : ']';
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < src.length; i++) {
      const c = src[i] as string;
      if (inString) {
        if (escaped) escaped = false;
        else if (c === '\\') escaped = true;
        else if (c === '"') inString = false;
        continue;
      }
      if (c === '"') {
        inString = true;
        continue;
      }
      if (c === open) depth++;
      else if (c === close) {
        depth--;
        if (depth === 0) {
          const candidate = src.slice(start, i + 1);
          // A candidate that merely looks balanced but is not JSON (e.g. "{}" inside prose)
          // is still worth returning — the caller validates with JSON.parse.
          try {
            JSON.parse(candidate);
            return candidate;
          } catch {
            break; // unbalanced/not JSON at this start index: move on
          }
        }
      }
    }
  }
  return null;
}

/** Pulls the body out of a ```json … ``` (or plain ```) fenced block, if present. */
export function fencedContent(text: string): string | null {
  const m = /```[ \t]*([a-zA-Z0-9_+-]*)[ \t]*\n([\s\S]*?)```/.exec(clean(text));
  if (!m) return null;
  return (m[2] ?? '').trim();
}

/**
 * Best-effort repair for the two most common model mistakes:
 *  - trailing commas before `}` / `]`
 *  - "smart" typographic quotes used as JSON string delimiters
 * Applied only after a normal parse failed.
 */
function salvageJson(raw: string): unknown {
  const cleaned = raw
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/,\s*([}\]])/g, '$1')
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    /* fall through */
  }
  // Last resort: single-quoted keys/strings → double quotes.
  const requoted = cleaned.replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, (_m, inner: string) =>
    JSON.stringify(String(inner).replace(/\\'/g, "'")),
  );
  try {
    return JSON.parse(requoted);
  } catch {
    return null;
  }
}

/**
 * Full extraction pipeline. Returns `null` when nothing parseable is found —
 * callers must treat that as "fall back to offline generation", never as an error to raise.
 */
export function extractJson(text: string | null | undefined): unknown {
  return extractJsonDetailed(text).value;
}

export function extractJsonDetailed(text: string | null | undefined): ExtractResult {
  if (typeof text !== 'string' || !text.trim()) return { value: null, via: null };
  const src = clean(text).trim();

  // 1. Already pure JSON (the happy path — we instruct models to do exactly this).
  try {
    return { value: JSON.parse(src), via: 'direct' };
  } catch {
    /* keep going */
  }

  // 2. Fenced block.
  const fenced = fencedContent(src);
  if (fenced) {
    try {
      return { value: JSON.parse(fenced), via: 'fence' };
    } catch {
      const balanced = findBalancedJson(fenced);
      if (balanced) {
        try {
          return { value: JSON.parse(balanced), via: 'fence' };
        } catch {
          const salvaged = salvageJson(balanced);
          if (salvaged !== null) return { value: salvaged, via: 'salvage' };
        }
      }
      const salvagedFence = salvageJson(fenced);
      if (salvagedFence !== null) return { value: salvagedFence, via: 'salvage' };
    }
  }

  // 3. First balanced object/array inside surrounding prose.
  const balanced = findBalancedJson(src);
  if (balanced) {
    try {
      return { value: JSON.parse(balanced), via: 'balanced' };
    } catch {
      const salvaged = salvageJson(balanced);
      if (salvaged !== null) return { value: salvaged, via: 'salvage' };
    }
  }

  // 4. Whole thing after repair (e.g. trailing commas at top level).
  const salvaged = salvageJson(src);
  if (salvaged !== null) return { value: salvaged, via: 'salvage' };

  return { value: null, via: null };
}

/** True when `v` is a non-null, non-array object — the shape every AI task emits. */
export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Unwraps common model wrappers so a task payload can be found no matter how the
 * model decided to name it: `{data: …}`, `{result: …}`, `{use_cases: […]}` …
 */
export function unwrapPayload(value: unknown): unknown {
  if (!isPlainObject(value)) return value;
  for (const key of ['data', 'result', 'output', 'response', 'payload', 'json']) {
    const inner = value[key];
    if (inner !== undefined && inner !== null && typeof inner === 'object') return inner;
  }
  return value;
}

/** Coerces a model reply into an array of records, tolerating `{items:[…]}` wrappers. */
export function asRecordArray(value: unknown): Record<string, unknown>[] {
  const v = unwrapPayload(value);
  if (Array.isArray(v)) return v.filter(isPlainObject) as Record<string, unknown>[];
  if (isPlainObject(v)) {
    for (const key of ['items', 'list', 'rows', 'results', 'drafts']) {
      const inner = v[key];
      if (Array.isArray(inner)) return inner.filter(isPlainObject) as Record<string, unknown>[];
    }
  }
  return [];
}
