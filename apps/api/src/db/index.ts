/**
 * Database connection + migration runner. FROZEN (lead-owned).
 *
 * Uses Node's built-in `node:sqlite` (Node >= 22.5) — no native compilation required,
 * so `pnpm install` works on any machine without MSVC/Clang toolchains.
 *
 * All modules import `db` from here:
 *   import { db, parseJson, toJson, nextCode } from '../../db/index.js';
 */

import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { newId, nowIso } from '@qatools/shared';

/**
 * Re-exported for convenience: many modules legitimately need id/time helpers alongside
 * `db`. Keeping them here means `import { db, newId, nowIso } from '../../db/index.js'` works,
 * while `@qatools/shared` remains the canonical source for everything else.
 */
export { newId, nowIso };

const here = dirname(fileURLToPath(import.meta.url));

/** apps/api/data/qatools.db by default; override with QATOOLS_DB. */
export const DB_PATH = process.env.QATOOLS_DB
  ? resolve(process.env.QATOOLS_DB)
  : resolve(here, '../../data/qatools.db');

mkdirSync(dirname(DB_PATH), { recursive: true });

/**
 * Thin façade over `node:sqlite` so call sites read like better-sqlite3:
 *   db.prepare(sql).all(...params)
 *   db.prepare(sql).get(...params)
 *   db.prepare(sql).run(...params)
 */
class Db {
  readonly raw: DatabaseSync;

  constructor(path: string) {
    this.raw = new DatabaseSync(path);
    this.raw.exec('PRAGMA journal_mode = WAL');
    this.raw.exec('PRAGMA foreign_keys = ON');
    this.raw.exec('PRAGMA busy_timeout = 5000');
  }

  exec(sql: string): void {
    this.raw.exec(sql);
  }

  /** Returns a statement whose methods accept positional params (spread or array). */
  prepare(sql: string): {
    all: (...params: unknown[]) => Record<string, unknown>[];
    get: (...params: unknown[]) => Record<string, unknown> | undefined;
    run: (...params: unknown[]) => { changes: number; lastInsertRowid: number | bigint };
  } {
    const stmt: StatementSync = this.raw.prepare(sql);
    return {
      // IMPORTANT: map over the ARRAY (normalising each row), never flatten the array itself —
      // doing the latter turns the returned array into an object with numeric keys.
      all: (...params: unknown[]) =>
        (stmt.all(...(params as never[])) as unknown[]).map(flatten) as Record<string, unknown>[],
      get: (...params: unknown[]) =>
        flattenOne(stmt.get(...(params as never[]))) as Record<string, unknown> | undefined,
      run: (...params: unknown[]) => {
        const r = stmt.run(...(params as never[]));
        return {
          changes: Number(r.changes),
          lastInsertRowid: r.lastInsertRowid as number | bigint,
        };
      },
    };
  }

  /** Runs `fn` inside a transaction; rolls back on throw. */
  transaction<T>(fn: () => T): T {
    this.raw.exec('BEGIN');
    try {
      const out = fn();
      this.raw.exec('COMMIT');
      return out;
    } catch (err) {
      try {
        this.raw.exec('ROLLBACK');
      } catch {
        /* ignore rollback failure */
      }
      throw err;
    }
  }
}

/**
 * node:sqlite returns null-prototype row objects; normalise ONE row to a plain object.
 * Never call this on an array — it would destroy the array shape (see `prepare().all`).
 */
function flatten(row: unknown): unknown {
  if (row === null || row === undefined) return row;
  if (Array.isArray(row)) return row.map(flatten);
  return Object.assign({}, row as object);
}
function flattenOne(row: unknown): unknown {
  if (row === null || row === undefined) return undefined;
  return Object.assign({}, row as object);
}

export const db = new Db(DB_PATH);

const SCHEMA_PATH = resolve(here, 'schema.sql');
let migrated = false;

/** Idempotent: every statement uses CREATE TABLE IF NOT EXISTS. */
export function migrate(): void {
  if (migrated) return;
  const sql = readFileSync(SCHEMA_PATH, 'utf8');
  db.exec(sql);
  migrated = true;
}

export function dbHealth(): 'ok' | 'error' {
  try {
    db.prepare('SELECT 1 AS ok').get();
    return 'ok';
  } catch {
    return 'error';
  }
}

/** JSON column helpers — modules never hand-roll JSON.parse with try/catch. */
export function parseJson<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value !== 'string') return value as T;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function toJson(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return JSON.stringify(value);
}

/** Next sequential code for a table, e.g. nextCode('test_cases','TC', projectId) -> "TC-007". */
export function nextCode(table: string, prefix: string, projectId: string, pad = 3): string {
  const row = db
    .prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE project_id = ?`)
    .get(projectId) as { n: number } | undefined;
  const n = Number(row?.n ?? 0) + 1;
  return `${prefix}-${String(n).padStart(pad, '0')}`;
}

/** Next code scoped to a parent column (e.g. sprint codes inside a cycle). */
export function nextCodeBy(
  table: string,
  column: string,
  parentId: string,
  prefix: string,
  pad = 2,
): string {
  const row = db
    .prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${column} = ?`)
    .get(parentId) as { n: number } | undefined;
  return `${prefix}-${String(Number(row?.n ?? 0) + 1).padStart(pad, '0')}`;
}

/** Log an action to activity_log — never throws. */
export function logActivity(entry: {
  project_id?: string | null;
  actor?: string;
  action: string;
  entity_kind: string;
  entity_id?: string | null;
  summary?: string | null;
}): void {
  try {
    db.prepare(
      `INSERT INTO activity_log (id, project_id, actor, action, entity_kind, entity_id, summary, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      newId('act_'),
      entry.project_id ?? null,
      entry.actor ?? 'system',
      entry.action,
      entry.entity_kind,
      entry.entity_id ?? null,
      entry.summary ?? null,
      nowIso(),
    );
  } catch {
    /* activity logging must never break a request */
  }
}

/** Generic CRUD helpers so lane repos stay short and consistent. */

export function insertRow(table: string, data: Record<string, unknown>, idPrefix: string): string {
  const id = (data.id as string) ?? newId(idPrefix);
  const ts = nowIso();
  const payload: Record<string, unknown> = { ...data, id, created_at: data.created_at ?? ts, updated_at: ts };
  const keys = Object.keys(payload).filter((k) => payload[k] !== undefined);
  const sql = `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`;
  db.prepare(sql).run(...keys.map((k) => normalise(payload[k])));
  return id;
}

export function updateRow(table: string, id: string, patch: Record<string, unknown>): number {
  const keys = Object.keys(patch).filter((k) => patch[k] !== undefined && k !== 'id');
  if (!keys.length) return 0;
  const sql = `UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`;
  const res = db.prepare(sql).run(...keys.map((k) => normalise(patch[k])), nowIso(), id);
  return res.changes;
}

export function findById<T = Record<string, unknown>>(table: string, id: string): T | undefined {
  return db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id) as T | undefined;
}

export function deleteById(table: string, id: string): number {
  return db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id).changes;
}

/** SQLite rejects `undefined` and booleans; normalise before binding. */
function normalise(v: unknown): unknown {
  if (v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v !== null && typeof v === 'object') return JSON.stringify(v);
  return v;
}
