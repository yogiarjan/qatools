/**
 * dbtester repository — SQL against the frozen schema
 * (db_connections, db_checks). Never returns the raw `dsn` from list calls.
 */

import type { DbCheck, DbConnection } from '@qatools/shared';
import { db, findById, insertRow, updateRow, deleteById, toJson, parseJson } from '../../db/index.js';
import { maskDsn } from '../execute/engine-utils.js';

/* ----------------------------- connections ------------------------------ */

export interface ConnectionInput {
  project_id: string;
  name: string;
  dialect?: string | null;
  dsn: string;
  readonly_guard?: boolean | number | null;
  created_by?: string | null;
}

/**
 * The shape returned to clients: identical to `DbConnection` but with a masked
 * DSN and **no** raw `dsn`. This is what the list/detail routes must send.
 */
export type SafeConnection = Omit<DbConnection, 'dsn'>;

export function toSafeConnection(row: DbConnection): SafeConnection {
  const { dsn: _drop, ...rest } = row;
  return { ...rest, dsn_masked: row.dsn_masked || maskDsn(_drop) };
}

export function listConnections(projectId: string): DbConnection[] {
  return db
    .prepare('SELECT * FROM db_connections WHERE project_id = ? ORDER BY created_at ASC')
    .all(projectId) as unknown as DbConnection[];
}

export function getConnection(id: string): DbConnection | undefined {
  return findById<DbConnection>('db_connections', id);
}

export function createConnection(input: ConnectionInput): DbConnection {
  const id = insertRow(
    'db_connections',
    {
      project_id: input.project_id,
      name: input.name,
      dialect: input.dialect ?? 'sqlite',
      dsn: input.dsn,
      dsn_masked: maskDsn(input.dsn),
      readonly_guard: input.readonly_guard === false || input.readonly_guard === 0 ? 0 : 1,
      created_by: input.created_by ?? 'system',
    },
    // ARCHITECTURE.md §5.3 (amended v1.1): db_connections use the `dbcn_` prefix;
    // `dbc_` belongs to db_checks.
    'dbcn_',
  );
  return getConnection(id) as DbConnection;
}

export function updateConnection(id: string, patch: Record<string, unknown>): DbConnection | undefined {
  const clean: Record<string, unknown> = {};
  if (typeof patch.name === 'string') clean.name = patch.name;
  if (typeof patch.dialect === 'string') clean.dialect = patch.dialect;
  if (patch.readonly_guard !== undefined) clean.readonly_guard = patch.readonly_guard ? 1 : 0;
  if (typeof patch.dsn === 'string' && patch.dsn.trim()) {
    clean.dsn = patch.dsn.trim();
    clean.dsn_masked = maskDsn(patch.dsn.trim());
  }
  updateRow('db_connections', id, clean);
  return getConnection(id);
}

export function removeConnection(id: string): number {
  return deleteById('db_connections', id);
}

/* -------------------------------- checks -------------------------------- */

export interface CheckInput {
  project_id: string;
  connection_id: string;
  test_case_id?: string | null;
  name: string;
  sql: string;
  assertions?: unknown;
  setup_sql?: string | null;
  teardown_sql?: string | null;
  generated_by?: string | null;
}

export function listChecks(projectId: string, connectionId?: string): DbCheck[] {
  if (connectionId) {
    return db
      .prepare('SELECT * FROM db_checks WHERE project_id = ? AND connection_id = ? ORDER BY created_at ASC')
      .all(projectId, connectionId) as unknown as DbCheck[];
  }
  return db
    .prepare('SELECT * FROM db_checks WHERE project_id = ? ORDER BY created_at ASC')
    .all(projectId) as unknown as DbCheck[];
}

export function getCheck(id: string): DbCheck | undefined {
  return findById<DbCheck>('db_checks', id);
}

export function findCheckForCase(testCaseId: string): DbCheck | undefined {
  return db
    .prepare('SELECT * FROM db_checks WHERE test_case_id = ? ORDER BY created_at ASC LIMIT 1')
    .get(testCaseId) as DbCheck | undefined;
}

export function createCheck(input: CheckInput): DbCheck {
  const id = insertRow(
    'db_checks',
    {
      project_id: input.project_id,
      connection_id: input.connection_id,
      test_case_id: input.test_case_id ?? null,
      name: input.name,
      sql: input.sql,
      assertions: input.assertions === undefined ? null : toJson(input.assertions),
      setup_sql: input.setup_sql ?? null,
      teardown_sql: input.teardown_sql ?? null,
      generated_by: input.generated_by ?? 'manual',
    },
    // `dbc_` is the db_checks prefix (ARCHITECTURE.md §5.3, amended v1.1).
    'dbc_',
  );
  return getCheck(id) as DbCheck;
}

export function updateCheck(id: string, patch: Record<string, unknown>): DbCheck | undefined {
  const clean: Record<string, unknown> = {};
  for (const key of ['name', 'sql', 'setup_sql', 'teardown_sql', 'test_case_id'] as const) {
    if (patch[key] !== undefined) clean[key] = patch[key];
  }
  if (patch.assertions !== undefined) clean.assertions = toJson(patch.assertions);
  updateRow('db_checks', id, clean);
  return getCheck(id);
}

export function removeCheck(id: string): number {
  return deleteById('db_checks', id);
}

export function touchCheckRun(id: string, status: string, rows: number | null): void {
  updateRow('db_checks', id, {
    last_status: status,
    last_rows: rows,
    last_run_at: new Date().toISOString(),
  });
}

/** Parses the JSON assertion column of a check. */
export function checkAssertions(check: DbCheck): unknown {
  return parseJson<unknown>(check.assertions, []);
}
