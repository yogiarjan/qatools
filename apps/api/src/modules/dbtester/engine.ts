/**
 * dbtester engine.
 *
 * The working dialect is **sqlite**, executed through Node's built-in
 * `node:sqlite` — no `better-sqlite3`, no `sqlite3`, no native compilation.
 *
 * `postgres` and `mysql` are recognised but have NO bundled driver on purpose:
 * this repo must install with plain `pnpm install` on a machine without a C/C++
 * toolchain. The user may install `pg` / `mysql2` themselves; until then the
 * engine returns an honest 501 `driver_not_installed`. See docs/automation/engines.md.
 */

import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { dirname, resolve, isAbsolute } from 'node:path';
import type { DbCheck, DbConnection, EngineResult, ExecuteOptions, StepLog } from '@qatools/shared';
import { evaluateAssertions } from '../execute/assertions.js';
import { EngineError, statusFromOutcome, truncate, emptyEngineResult } from '../execute/engine-utils.js';
import { normalizeAssertions } from '../execute/scripting.js';
import { assertReadonlySafe, analyzeSql } from './guard.js';

/* ------------------------------------------------------------------ *
 * Dialect availability — the honest capability matrix
 * ------------------------------------------------------------------ */

export type Dialect = 'sqlite' | 'postgres' | 'mysql';

export interface DialectCapability {
  dialect: Dialect;
  available: boolean;
  driver: string;
  reason: string;
}

export function dialectCapability(dialect: string): DialectCapability {
  switch (dialect) {
    case 'sqlite':
      return {
        dialect: 'sqlite',
        available: true,
        driver: 'node:sqlite (bawaan Node 22+)',
        reason: 'Aktif — node:sqlite tersedia tanpa kompilasi native.',
      };
    case 'postgres':
      return {
        dialect: 'postgres',
        available: false,
        driver: 'pg',
        reason:
          'Driver "pg" tidak dipaketkan. QATools tidak menambahkan dependensi native agar `pnpm install` ' +
          'tetap berhasil di mesin tanpa toolchain C/C++. Pasang sendiri: `pnpm -F @qatools/api add pg`.',
      };
    case 'mysql':
      return {
        dialect: 'mysql',
        available: false,
        driver: 'mysql2',
        reason:
          'Driver "mysql2" tidak dipaketkan. Pasang sendiri bila diperlukan: ' +
          '`pnpm -F @qatools/api add mysql2`.',
      };
    default:
      return {
        dialect: 'sqlite',
        available: false,
        driver: '—',
        reason: `Dialect "${dialect}" tidak dikenal. Gunakan sqlite, postgres, atau mysql.`,
      };
  }
}

/** Throws the documented 501 for dialects without a bundled driver. */
export function requireDialect(dialect: string): void {
  if (dialect === 'sqlite') return;
  const cap = dialectCapability(dialect);
  if (cap.available) return;
  throw EngineError.notInstalled('driver_not_installed', cap.reason, {
    dialect,
    driver: cap.driver,
    install_hint: dialect === 'postgres' ? 'pnpm -F @qatools/api add pg' : 'pnpm -F @qatools/api add mysql2',
  });
}

/* ------------------------------------------------------------------ *
 * SQLite file resolution
 * ------------------------------------------------------------------ */

/**
 * Turns a connection DSN into a filesystem path.
 * Accepts `:memory:`, `/abs/path.db`, `C:\path\db.sqlite`, and
 * `sqlite:///abs/path.db` / `file:name.db`.
 */
export function resolveSqlitePath(dsn: string | null | undefined): string {
  const raw = (dsn ?? '').trim();
  if (!raw) throw EngineError.badRequest('DSN sqlite kosong.');
  if (raw === ':memory:' || raw === 'file::memory:') return ':memory:';

  let path = raw;
  if (/^sqlite:\/\//i.test(path)) path = path.replace(/^sqlite:\/\//i, '/').replace(/^\/\//, '');
  else if (/^file:/i.test(path)) path = path.replace(/^file:/i, '');

  path = path.trim();
  // Windows absolute path or already-absolute POSIX path.
  if (isAbsolute(path)) return resolve(path);
  // A bare name resolves against the API's data directory, so relative DSNs are stable.
  const cwd = process.env.QATOOLS_DB ? dirname(resolve(process.env.QATOOLS_DB)) : resolve(process.cwd(), 'data');
  return resolve(cwd, path);
}

/** Opens a read/write sqlite handle; `readOnly` opens it for `EXPLAIN`-only inspection. */
export function openSqlite(dsn: string, opts: { readOnly?: boolean } = {}): DatabaseSync {
  const path = resolveSqlitePath(dsn);

  if (path !== ':memory:' && opts.readOnly) {
    if (!existsSync(path)) {
      throw EngineError.unreachable(`Berkas database sqlite tidak ditemukan: ${path}`);
    }
    return new DatabaseSync(path, { readOnly: true });
  }

  try {
    const handle = new DatabaseSync(path);
    handle.exec('PRAGMA foreign_keys = ON');
    handle.exec('PRAGMA busy_timeout = 5000');
    return handle;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw EngineError.unreachable(`Tidak dapat membuka database sqlite "${path}": ${reason}`);
  }
}

/* ------------------------------------------------------------------ *
 * Result shapes
 * ------------------------------------------------------------------ */

export interface QueryOutcome {
  columns: string[];
  rows: Array<Record<string, unknown>>;
  row_count: number;
  /** `changes` for a write statement, null for a read. */
  changes: number | null;
  duration_ms: number;
}

/** Runs one statement and normalises the result into columns + plain rows. */
export function runQuery(handle: DatabaseSync, sql: string): QueryOutcome {
  const started = Date.now();
  const stmt = handle.prepare(sql);

  // node:sqlite throws on `all()` for a statement with no result columns
  // (INSERT/UPDATE/CREATE), so writes are detected from the analysis.
  const analysis = analyzeSql(sql);
  const verb = analysis.verbs[0];

  if (verb && !['SELECT', 'WITH', 'VALUES', 'EXPLAIN', 'PRAGMA'].includes(verb)) {
    const info = stmt.run();
    return {
      columns: [],
      rows: [],
      row_count: 0,
      changes: Number(info.changes ?? 0),
      duration_ms: Date.now() - started,
    };
  }

  const raw = stmt.all() as Array<Record<string, unknown>>;
  const rows = raw.map((row) => ({ ...row }));
  const columns = rows.length ? Object.keys(rows[0] as Record<string, unknown>) : columnsFromStatement(handle, sql);

  return {
    columns,
    rows,
    row_count: rows.length,
    changes: null,
    duration_ms: Date.now() - started,
  };
}

/** Recovers column names for an empty result set via a prepared-statement probe. */
function columnsFromStatement(handle: DatabaseSync, sql: string): string[] {
  try {
    // `columns()` exists on node:sqlite StatementSync in Node 22.5+.
    const stmt = handle.prepare(sql) as unknown as { columns?: () => Array<{ name?: string; column?: string }> };
    const cols = typeof stmt.columns === 'function' ? stmt.columns() : [];
    return cols.map((c) => String(c.name ?? c.column ?? '')).filter(Boolean);
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------------ *
 * Engine entry points
 * ------------------------------------------------------------------ */

export interface DbRunOptions extends ExecuteOptions {
  /** Values available for `{{var}}` substitution inside the SQL. */
  vars?: Record<string, unknown>;
}

export interface DbRunOutcome extends EngineResult {
  check_id: string;
  columns: string[];
  rows: Array<Record<string, unknown>>;
  row_count: number;
  dialect: Dialect;
}

/** Substitutes `{{name}}` placeholders in SQL with safely-quoted literals. */
function bindVars(sql: string, vars: Record<string, unknown>): { sql: string; missing: string[] } {
  const missing: string[] = [];
  const out = sql.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (whole, name: string) => {
    if (!Object.prototype.hasOwnProperty.call(vars, name)) {
      if (!missing.includes(name)) missing.push(name);
      return whole;
    }
    const v = vars[name];
    if (v === null || v === undefined) return 'NULL';
    if (typeof v === 'number') return String(v);
    if (typeof v === 'boolean') return v ? '1' : '0';
    // Always escape as a SQL string literal — never concatenate raw input.
    return `'${String(v).replace(/'/g, "''")}'`;
  });
  return { sql: out, missing };
}

/**
 * Runs a DbCheck: setup_sql → main sql → assertions → teardown_sql.
 * The readonly guard applies to setup and main statements.
 */
export async function executeDbCheck(check: DbCheck, connection: DbConnection, opts: DbRunOptions = {}): Promise<DbRunOutcome> {
  const started = Date.now();
  const logs: StepLog[] = [];
  let logIndex = 0;
  const dialect = (connection.dialect ?? 'sqlite') as Dialect;

  requireDialect(dialect);

  const guardEnabled = Number(connection.readonly_guard ?? 1) === 1;
  const vars = opts.vars ?? {};

  logs.push({
    index: logIndex++,
    action: 'connect',
    target: connection.dsn_masked,
    status: 'ok',
    message: `Dialect ${dialect} — ${connection.name}${guardEnabled ? ' (readonly guard AKTIF)' : ' (readonly guard NONAKTIF)'}`,
    duration_ms: 0,
  });

  /* ------------------------------ dry run ----------------------------- */
  if (opts.dry_run) {
    const mainAnalysis = analyzeSql(check.sql);
    let guardOk = true;
    let guardMessage = 'Statement utama lolos readonly guard.';
    try {
      assertReadonlySafe(check.sql, guardEnabled);
      if (check.setup_sql?.trim()) assertReadonlySafe(check.setup_sql, guardEnabled, 'setup');
    } catch (err) {
      guardOk = false;
      guardMessage = err instanceof Error ? err.message : String(err);
    }

    logs.push({
      index: logIndex++,
      action: 'dry-run',
      status: guardOk ? 'info' : 'fail',
      message: guardOk
        ? `Dry-run: SQL terurai sebagai ${mainAnalysis.verbs.join(', ') || 'tidak dikenal'}; target tidak dihubungi.`
        : guardMessage,
      duration_ms: 0,
    });

    return {
      ...emptyEngineResult('db', guardOk ? 'skipped' : 'failed', guardOk ? null : guardMessage),
      logs,
      duration_ms: Date.now() - started,
      check_id: check.id,
      columns: [],
      rows: [],
      row_count: 0,
      dialect,
    };
  }

  // The guard is enforced BEFORE any connection is opened — a destructive
  // statement must never even reach the database.
  assertReadonlySafe(check.sql, guardEnabled);
  if (check.setup_sql?.trim()) assertReadonlySafe(check.setup_sql, guardEnabled, 'setup');

  let handle: DatabaseSync | null = null;
  try {
    handle = openSqlite(connection.dsn ?? '', { readOnly: false });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logs.push({ index: logIndex++, action: 'connect', status: 'fail', message, duration_ms: 0 });
    return {
      ...emptyEngineResult('db', 'blocked', message),
      logs,
      duration_ms: Date.now() - started,
      check_id: check.id,
      columns: [],
      rows: [],
      row_count: 0,
      dialect,
    };
  }

  try {
    /* ----------------------------- setup ------------------------------ */
    if (check.setup_sql?.trim()) {
      const bound = bindVars(check.setup_sql, vars);
      const setupStart = Date.now();
      try {
        for (const statement of splitForSetup(bound.sql)) {
          if (!statement.trim()) continue;
          runQuery(handle, statement);
        }
        logs.push({
          index: logIndex++,
          action: 'setup',
          status: 'ok',
          message: `Setup dijalankan (${bound.sql.length} karakter)${bound.missing.length ? `; variabel belum terdefinisi: ${bound.missing.join(', ')}` : ''}`,
          duration_ms: Date.now() - setupStart,
        });
      } catch (err) {
        const message = `Setup gagal: ${err instanceof Error ? err.message : String(err)}`;
        logs.push({ index: logIndex++, action: 'setup', status: 'fail', message, duration_ms: Date.now() - setupStart });
        return finish(handle, check, 'failed', message, [], [], 0, logs, started, logIndex, dialect, opts);
      }
    }

    /* ------------------------------ query ----------------------------- */
    const bound = bindVars(check.sql, vars);
    const queryStart = Date.now();
    let outcome: QueryOutcome;
    try {
      outcome = runQuery(handle, bound.sql);
    } catch (err) {
      const message = `Query gagal: ${err instanceof Error ? err.message : String(err)}`;
      logs.push({ index: logIndex++, action: 'query', status: 'fail', message, duration_ms: Date.now() - queryStart });
      return finish(handle, check, 'failed', message, [], [], 0, logs, started, logIndex, dialect, opts);
    }

    logs.push({
      index: logIndex++,
      action: 'query',
      status: 'ok',
      message: `${outcome.row_count} baris × ${outcome.columns.length} kolom dalam ${outcome.duration_ms} ms`,
      duration_ms: outcome.duration_ms,
      observed: outcome.row_count,
    });

    /* --------------------------- assertions --------------------------- */
    const assertions = normalizeAssertions(check.assertions);
    const report = evaluateAssertions(assertions, {
      row_count: outcome.row_count,
      columns: outcome.columns,
      rows: outcome.rows,
      first_row: outcome.rows[0] ?? null,
      duration_ms: outcome.duration_ms,
      vars,
    });

    for (const item of report.results) {
      logs.push({
        index: logIndex++,
        action: 'assert',
        status: item.passed ? 'ok' : 'fail',
        message: item.message,
        duration_ms: 0,
        observed: item.observed,
      });
    }

    if (!assertions.length) {
      logs.push({
        index: logIndex++,
        action: 'assertions',
        status: 'info',
        message: 'Tidak ada assertion; eksekusi SQL yang berhasil dianggap lulus.',
        duration_ms: 0,
      });
    }

    const error = assertions.length && !report.passed
      ? report.results.filter((r) => !r.passed).map((r) => r.message).join(' | ')
      : null;

    const status = statusFromOutcome(report.results, null);

    return finish(handle, check, status, error, outcome.columns, outcome.rows, outcome.row_count, logs, started, logIndex, dialect, opts, report.results);
  } finally {
    try {
      handle?.close();
    } catch {
      /* closing a scratch connection must never mask the real result */
    }
  }
}

/** Runs teardown, persists last-run metadata and assembles the EngineResult. */
function finish(
  handle: DatabaseSync,
  check: DbCheck,
  status: EngineResult['status'],
  error: string | null,
  columns: string[],
  rows: Array<Record<string, unknown>>,
  rowCount: number,
  logs: StepLog[],
  started: number,
  logIndex: number,
  dialect: Dialect,
  _opts: DbRunOptions,
  assertionResults: EngineResult['assertions'] = [],
): DbRunOutcome {
  if (check.teardown_sql?.trim()) {
    const teardownStart = Date.now();
    try {
      for (const statement of splitForSetup(check.teardown_sql)) {
        if (!statement.trim()) continue;
        runQuery(handle, statement);
      }
      logs.push({
        index: logIndex++,
        action: 'teardown',
        status: 'ok',
        message: 'Teardown dijalankan',
        duration_ms: Date.now() - teardownStart,
      });
    } catch (err) {
      logs.push({
        index: logIndex++,
        action: 'teardown',
        status: 'fail',
        message: `Teardown gagal: ${err instanceof Error ? err.message : String(err)}`,
        duration_ms: Date.now() - teardownStart,
      });
    }
  }

  return {
    status,
    engine: 'db',
    duration_ms: Date.now() - started,
    logs,
    assertions: assertionResults,
    evidence: {
      dialect,
      columns,
      rows: rows.slice(0, 200),
      row_count: rowCount,
      truncated: rows.length > 200,
      result_text: renderRowsAsText(columns, rows),
    },
    error,
    used_ai: false,
    check_id: check.id,
    columns,
    rows,
    row_count: rowCount,
    dialect,
  };
}

/**
 * Setup/teardown may legitimately contain several statements, so they are split
 * on top-level semicolons rather than being forced into a single statement.
 */
function splitForSetup(sql: string): string[] {
  return sql
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Renders rows as a fixed-width table for the evidence panel. */
export function renderRowsAsText(columns: string[], rows: Array<Record<string, unknown>>, max = 50): string {
  if (!columns.length) return '(tidak ada kolom)';
  const shown = rows.slice(0, max);
  const widths = columns.map((c) =>
    Math.max(c.length, ...shown.map((r) => String(r[c] ?? 'NULL').length), 3),
  );
  const header = columns.map((c, i) => c.padEnd(widths[i] as number)).join(' | ');
  const sep = widths.map((w) => '-'.repeat(w)).join('-+-');
  const body = shown.map((r) => columns.map((c, i) => String(r[c] ?? 'NULL').padEnd(widths[i] as number)).join(' | '));
  const more = rows.length > max ? `\n… ${rows.length - max} baris lainnya tidak ditampilkan` : '';
  return [header, sep, ...body].join('\n') + more;
}

/* ------------------------------------------------------------------ *
 * Connectivity test + EXPLAIN
 * ------------------------------------------------------------------ */

export interface TestConnectionResult {
  ok: boolean;
  dialect: Dialect;
  latency_ms: number;
  version: string | null;
  tables: number | null;
  message: string;
}

/** POST /db-connections/:id/test — a real connectivity probe. */
export async function testConnection(connection: DbConnection): Promise<TestConnectionResult> {
  const dialect = (connection.dialect ?? 'sqlite') as Dialect;
  requireDialect(dialect);

  const started = Date.now();
  let handle: DatabaseSync | null = null;
  try {
    handle = openSqlite(connection.dsn ?? '');
    const versionRow = handle.prepare('SELECT sqlite_version() AS v').get() as { v?: string } | undefined;
    const tableRow = handle
      .prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .get() as { n?: number } | undefined;

    return {
      ok: true,
      dialect,
      latency_ms: Date.now() - started,
      version: versionRow?.v ? `sqlite ${versionRow.v}` : null,
      tables: Number(tableRow?.n ?? 0),
      message: `Koneksi sqlite berhasil (${Number(tableRow?.n ?? 0)} tabel).`,
    };
  } catch (err) {
    return {
      ok: false,
      dialect,
      latency_ms: Date.now() - started,
      version: null,
      tables: null,
      message: err instanceof Error ? err.message : String(err),
    };
  } finally {
    try {
      handle?.close();
    } catch {
      /* ignore */
    }
  }
}

export interface ExplainResult {
  plan: string[];
  raw: string;
  available: boolean;
  message: string;
}

/** POST /db-checks/:id/explain — SQLite's QUERY PLAN. */
export async function explainCheck(check: DbCheck, connection: DbConnection): Promise<ExplainResult> {
  const dialect = (connection.dialect ?? 'sqlite') as Dialect;
  requireDialect(dialect);

  const analysis = analyzeSql(check.sql);
  if (!analysis.readonly_safe) {
    throw EngineError.badRequest(
      `EXPLAIN hanya tersedia untuk statement baca. ${analysis.reason ?? ''}`.trim(),
      { statements: analysis.statements },
    );
  }

  const handle = openSqlite(connection.dsn ?? '', { readOnly: false });
  try {
    const rows = handle.prepare(`EXPLAIN QUERY PLAN ${check.sql}`).all() as Array<Record<string, unknown>>;
    const plan = rows.map((r) => String(r.detail ?? JSON.stringify(r)));
    return {
      available: true,
      plan,
      raw: plan.join('\n'),
      message:
        plan.length === 0
          ? 'Query plan kosong (mungkin tabel tidak ada atau query sangat sederhana).'
          : `${plan.length} langkah query plan.`,
    };
  } catch (err) {
    return {
      available: false,
      plan: [],
      raw: '',
      message: err instanceof Error ? err.message : String(err),
    };
  } finally {
    try {
      handle.close();
    } catch {
      /* ignore */
    }
  }
}

/* ------------------------------------------------------------------ *
 * Schema browser (sqlite)
 * ------------------------------------------------------------------ */

export interface SchemaTable {
  name: string;
  type: string;
  columns: Array<{ name: string; type: string; notnull: number; pk: number; dflt_value: unknown }>;
}

/** Lists tables + columns — powers the DbTester schema browser. */
export async function readSchema(connection: DbConnection): Promise<{ dialect: Dialect; tables: SchemaTable[] }> {
  const dialect = (connection.dialect ?? 'sqlite') as Dialect;
  requireDialect(dialect);

  const handle = openSqlite(connection.dsn ?? '');
  try {
    const tables = handle
      .prepare(
        "SELECT name, type FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all() as Array<{ name: string; type: string }>;

    const out: SchemaTable[] = tables.map((t) => {
      // Identifiers cannot be parameterised; quote and escape the discovered name.
      const safe = String(t.name).replace(/"/g, '""');
      const cols = handle.prepare(`PRAGMA table_info("${safe}")`).all() as Array<Record<string, unknown>>;
      return {
        name: t.name,
        type: t.type,
        columns: cols.map((c) => ({
          name: String(c.name ?? ''),
          type: String(c.type ?? ''),
          notnull: Number(c.notnull ?? 0),
          pk: Number(c.pk ?? 0),
          dflt_value: c.dflt_value ?? null,
        })),
      };
    });

    return { dialect, tables: out };
  } finally {
    try {
      handle.close();
    } catch {
      /* ignore */
    }
  }
}

/** Used by the execute module when a test case has engine=db. */
export async function runDbCheckForCase(
  checkId: string,
  opts: DbRunOptions = {},
): Promise<DbRunOutcome> {
  const { getCheck, getConnection } = await import('./repo.js');
  const check = getCheck(checkId);
  if (!check) throw EngineError.notFound('DB check');
  const connection = getConnection(check.connection_id);
  if (!connection) throw EngineError.notFound('DB connection');
  return executeDbCheck(check, connection, opts);
}

export { truncate };
