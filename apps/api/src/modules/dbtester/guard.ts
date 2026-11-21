/**
 * SQL statement analysis + the readonly_guard safety policy.
 *
 * `readonly_guard` is a SAFETY FEATURE, not a nicety: when it is on, a check may
 * only issue a SINGLE `SELECT` / `WITH ... SELECT` statement — no DML, no DDL,
 * no PRAGMA writes, no ATTACH, and no multiple statements glued by `;`.
 *
 * The analyser is a hand-written tokenizer: it strips string literals and
 * comments first, so `SELECT 'DROP TABLE x'` is correctly allowed while
 * `SELECT 1; DROP TABLE x` is correctly rejected.
 */

import { EngineError } from '../execute/engine-utils.js';

export interface SqlAnalysis {
  /** Statements found after stripping comments and blank fragments. */
  statements: string[];
  /** Verbs of each statement, upper-cased (`SELECT`, `UPDATE`, …). */
  verbs: string[];
  /** True when the SQL is safe to run under the readonly guard. */
  readonly_safe: boolean;
  /** Human-readable reason when `readonly_safe === false`. */
  reason: string | null;
}

/** Verbs that never mutate data and are acceptable under the guard. */
const READONLY_VERBS = new Set(['SELECT', 'WITH', 'VALUES', 'EXPLAIN', 'SHOW', 'DESCRIBE', 'DESC']);

/** Clearly destructive verbs, called out by name in the rejection message. */
const WRITE_VERBS = new Set([
  'INSERT', 'UPDATE', 'DELETE', 'REPLACE', 'UPSERT', 'MERGE',
  'CREATE', 'ALTER', 'DROP', 'TRUNCATE', 'RENAME',
  'GRANT', 'REVOKE', 'ATTACH', 'DETACH', 'VACUUM', 'REINDEX',
  'BEGIN', 'COMMIT', 'ROLLBACK', 'SAVEPOINT', 'RELEASE',
  'CALL', 'EXEC', 'EXECUTE', 'DO', 'SET', 'USE', 'LOAD', 'ANALYZE',
]);

/**
 * Strips `--` line comments, C-style block comments and quoted literals,
 * replacing them with spaces so positions remain stable and keywords inside
 * strings can never be mistaken for SQL.
 */
export function stripLiteralsAndComments(sql: string): string {
  let out = '';
  let i = 0;
  const n = sql.length;

  while (i < n) {
    const ch = sql[i] as string;
    const next = sql[i + 1];

    // line comment
    if (ch === '-' && next === '-') {
      while (i < n && sql[i] !== '\n') i++;
      out += ' ';
      continue;
    }
    // block comment
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < n && !(sql[i] === '*' && sql[i + 1] === '/')) i++;
      i += 2;
      out += ' ';
      continue;
    }
    // single-quoted literal ('' escapes a quote)
    if (ch === "'") {
      i++;
      while (i < n) {
        if (sql[i] === "'" && sql[i + 1] === "'") {
          i += 2;
          continue;
        }
        if (sql[i] === "'") {
          i++;
          break;
        }
        i++;
      }
      out += "''";
      continue;
    }
    // double-quoted / backtick / bracket identifiers keep their content but are
    // not SQL keywords, so they are blanked too.
    if (ch === '"' || ch === '`') {
      const quote = ch;
      i++;
      while (i < n && sql[i] !== quote) i++;
      i++;
      out += '""';
      continue;
    }
    if (ch === '[') {
      while (i < n && sql[i] !== ']') i++;
      i++;
      out += '""';
      continue;
    }

    out += ch;
    i++;
  }

  return out;
}

/** Splits SQL on top-level semicolons (literals/comments already stripped). */
function splitStatements(cleaned: string): string[] {
  return cleaned
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** First keyword of a statement, skipping a leading `EXPLAIN`/`WITH` wrapper noise. */
function firstVerb(statement: string): string {
  const match = /^\s*([a-zA-Z_]+)/.exec(statement);
  return (match?.[1] ?? '').toUpperCase();
}

/** Analyses SQL and decides whether it may run under the readonly guard. */
export function analyzeSql(sql: string): SqlAnalysis {
  const raw = (sql ?? '').trim();
  if (!raw) {
    return { statements: [], verbs: [], readonly_safe: false, reason: 'SQL kosong.' };
  }

  const cleaned = stripLiteralsAndComments(raw);
  const statements = splitStatements(cleaned);
  const verbs = statements.map(firstVerb);

  if (!statements.length) {
    return { statements: [], verbs: [], readonly_safe: false, reason: 'SQL kosong setelah komentar dihapus.' };
  }

  if (statements.length > 1) {
    return {
      statements,
      verbs,
      readonly_safe: false,
      reason:
        `Ditemukan ${statements.length} statement dipisah ";" (${verbs.join(', ')}). ` +
        'Mode readonly hanya mengizinkan SATU statement SELECT/WITH.',
    };
  }

  const verb = verbs[0] as string;

  if (WRITE_VERBS.has(verb)) {
    return {
      statements,
      verbs,
      readonly_safe: false,
      reason: `Statement "${verb}" mengubah data/skema dan ditolak oleh readonly_guard.`,
    };
  }

  if (verb === 'WITH') {
    // A CTE must terminate in a SELECT; reject `WITH ... DELETE/UPDATE/INSERT`.
    if (/\b(insert|update|delete|replace|merge)\b/i.test(statements[0] as string)) {
      return {
        statements,
        verbs,
        readonly_safe: false,
        reason: 'CTE (WITH) yang berisi INSERT/UPDATE/DELETE ditolak oleh readonly_guard.',
      };
    }
    return { statements, verbs, readonly_safe: true, reason: null };
  }

  if (verb === 'PRAGMA') {
    // `PRAGMA table_info(x)` is a read; `PRAGMA journal_mode = WAL` is a write.
    const isRead = !/=/.test(statements[0] as string);
    if (isRead) return { statements, verbs, readonly_safe: true, reason: null };
    return {
      statements,
      verbs,
      readonly_safe: false,
      reason: 'PRAGMA dengan penetapan nilai (menggunakan "=") ditolak oleh readonly_guard.',
    };
  }

  if (!READONLY_VERBS.has(verb)) {
    return {
      statements,
      verbs,
      readonly_safe: false,
      reason: `Statement "${verb}" tidak termasuk operasi baca (SELECT/WITH). Readonly guard aktif.`,
    };
  }

  return { statements, verbs, readonly_safe: true, reason: null };
}

/** Convenience: true when running `sql` under the guard should be rejected. */
export function violatesReadonlyGuard(sql: string): boolean {
  return !analyzeSql(sql).readonly_safe;
}

/**
 * Throws the user-facing 400 the routes/tests expect when the guard is on
 * and the SQL is not a single read statement.
 */
export function assertReadonlySafe(sql: string, guardEnabled: boolean, _context = 'SQL'): void {  if (!guardEnabled) return;
  const analysis = analyzeSql(sql);
  if (analysis.readonly_safe) return;

  throw new EngineError(
    400,
    'readonly_guard_violation',
    `Readonly guard menolak eksekusi: ${analysis.reason ?? 'statement tidak diizinkan.'} ` +
      'Matikan readonly_guard pada connection bila Anda memang perlu menulis data.',
    { statements: analysis.statements, verbs: analysis.verbs },
  );
}

/** True when the SQL is a single read-only statement, regardless of the guard. */
export function isReadonlySafe(sql: string): boolean {
  return analyzeSql(sql).readonly_safe;
}
