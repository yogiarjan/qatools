/**
 * Small helpers shared by Lane C's four engine modules.
 * Kept dependency-free so both routes and in-process services can use them.
 */

import type { EngineResult, ExecEngine, RunStatus, StepLog } from '@qatools/shared';
import type { AssertionOutcome } from './assertions.js';

/* ------------------------------------------------------------------ *
 * Engine failure signalling
 * ------------------------------------------------------------------ */

/**
 * Thrown by an engine when the run cannot even start (missing artifact,
 * driver not installed, guard rejection). The route layer maps `status`
 * onto the HTTP status and `code` onto the error envelope.
 */
export class EngineError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'EngineError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  static notFound(what: string): EngineError {
    return new EngineError(404, 'not_found', `${what} tidak ditemukan`);
  }

  static badRequest(message: string, details?: unknown): EngineError {
    return new EngineError(400, 'bad_request', message, details);
  }

  static notInstalled(code: string, message: string, details?: unknown): EngineError {
    return new EngineError(501, code, message, details);
  }

  /** The target could not be reached — the case is `blocked`, not `failed`. */
  static unreachable(message: string, details?: unknown): EngineError {
    return new EngineError(502, 'target_unreachable', message, details);
  }
}

/* ------------------------------------------------------------------ *
 * Result assembly
 * ------------------------------------------------------------------ */

export function emptyEngineResult(engine: ExecEngine, status: RunStatus = 'not_run', error: string | null = null): EngineResult {
  return {
    status,
    engine,
    duration_ms: 0,
    logs: [],
    assertions: [],
    evidence: {},
    error,
    used_ai: false,
  };
}

export function okLog(index: number, action: string, message: string, opts: Partial<StepLog> = {}): StepLog {
  return { index, action, status: 'ok', message, duration_ms: 0, ...opts };
}

export function failLog(index: number, action: string, message: string, opts: Partial<StepLog> = {}): StepLog {
  return { index, action, status: 'fail', message, duration_ms: 0, ...opts };
}

export function infoLog(index: number, action: string, message: string, opts: Partial<StepLog> = {}): StepLog {
  return { index, action, status: 'info', message, duration_ms: 0, ...opts };
}

export function skipLog(index: number, action: string, message: string): StepLog {
  return { index, action, status: 'skip', message, duration_ms: 0 };
}

/** Derives the case status from the assertion report + hard error. */
export function statusFromOutcome(
  assertions: AssertionOutcome[],
  error: string | null,
  opts: { blocked?: boolean } = {},
): RunStatus {
  if (opts.blocked) return 'blocked';
  if (error) return 'failed';
  if (!assertions.length) return 'passed'; // nothing asserted => the call itself was the check
  return assertions.every((a) => a.passed) ? 'passed' : 'failed';
}

export function rollupCounters(statuses: RunStatus[]): {
  total: number;
  passed: number;
  failed: number;
  blocked: number;
  skipped: number;
} {
  return {
    total: statuses.length,
    passed: statuses.filter((s) => s === 'passed').length,
    failed: statuses.filter((s) => s === 'failed').length,
    blocked: statuses.filter((s) => s === 'blocked').length,
    skipped: statuses.filter((s) => s === 'skipped').length,
  };
}

/** Coerces an unknown value into the frozen RunStatus vocabulary. */
export function asRunStatus(value: unknown, fallback: RunStatus = 'not_run'): RunStatus {
  return value === 'passed' || value === 'failed' || value === 'blocked' || value === 'skipped' || value === 'not_run'
    ? value
    : fallback;
}

/** Truncates long evidence strings so a result row stays reasonable. */
export function truncate(value: string, max = 4000): string {
  return value.length > max ? `${value.slice(0, max)}\n… (dipotong, total ${value.length} karakter)` : value;
}

/* ------------------------------------------------------------------ *
 * Secrets
 * ------------------------------------------------------------------ */

/**
 * Masks credentials inside a DSN/URL for list responses:
 *   postgres://user:secret@host/db -> postgres://user:***@host/db
 *   /path/to/scratch.db            -> /path/to/scratch.db  (sqlite has no secret)
 */
export function maskDsn(dsn: string | null | undefined): string {
  if (!dsn) return '';
  const raw = dsn.trim();
  if (!raw) return '';

  // URL-style DSN (postgres://, mysql://, sqlite://)
  const urlMatch = /^([a-z0-9+.-]+):\/\/([^/@]*@)?(.*)$/i.exec(raw);
  if (urlMatch) {
    const scheme = urlMatch[1] as string;
    const userinfo = urlMatch[2];
    const restRaw = urlMatch[3] as string;
    const rest = maskQuerySecrets(restRaw);
    if (userinfo) {
      const user = userinfo.slice(0, -1).split(':')[0] ?? '';
      return `${scheme}://${user}:***@${rest}`;
    }
    return `${scheme}://${rest}`;
  }

  // Plain file path: show the basename only when it looks like a home dir.
  if (raw.includes('\\') || raw.includes('/')) {
    const parts = raw.split(/[\\/]/);
    const file = parts[parts.length - 1] ?? raw;
    return parts.length > 2 ? `…/${file}` : raw;
  }
  return raw;
}

function maskQuerySecrets(s: string): string {
  return s.replace(/([?&](?:password|passwd|pwd|token|apikey|api_key)=)[^&#]*/gi, '$1***');
}
