/**
 * agents/pool — the multi-worker AI QA agent pool executor.
 *
 * THE headline requirement: parallelism must be REAL. Shards are executed
 * through a hand-rolled async concurrency limiter (no `p-limit`, no
 * `worker_threads`, no new dependency) so exactly `config.workers` shards are
 * in flight at any instant. `workers: 1` degrades to a strict sequential loop,
 * which is what makes the measured `speedup` a meaningful number rather than a
 * label.
 *
 * Why Promise-based concurrency and not `node:worker_threads`:
 *  - the work is I/O bound (HTTP fetches, engine subprocess-free parsing) and
 *    Node's event loop already overlaps it; threads would add serialisation
 *    cost for the DB facade, which is a single synchronous `node:sqlite`
 *    connection and cannot be touched concurrently anyway.
 *  - it is verifiable in-process: the parallelism test measures wall clock with
 *    a stubbed runner and no thread-pool noise.
 *  - `worker_threads` would force every engine and the DB handle to be
 *    re-initialised per thread — a correctness risk with no throughput win here.
 *
 * Table ownership: this module writes ONLY `pool_runs`. Every per-case result is
 * persisted by Lane C's `executeService`, so `test_runs`/`run_results` keep
 * exactly one writer.
 */

import {
  DEFAULT_POOL_CONFIG,
  type AgentPoolConfig,
  type AgentPoolResult,
  type ExecEngine,
  type PoolCaseOutcome,
  type PoolShard,
  type RunStatus,
  type Severity,
} from '@qatools/shared';
import { db, newId, nowIso, parseJson, toJson } from '../../db/index.js';
import { clampWorkers, loadCases, normaliseStrategy, plan, type PlanCase, type PlanShard } from './planner.js';
import { extractSelectorFailure, heal } from './healing.js';
import { buildAiSummary, triageFailures } from './triage.js';

/* ------------------------------------------------------------------ *
 * Case-runner seam (the parallelism test stubs this)
 * ------------------------------------------------------------------ */

export interface CaseRunResult {
  status: RunStatus;
  duration_ms: number;
  error: string | null;
  engine?: ExecEngine;
  logs?: Array<{ index?: number; action?: string; target?: string; status?: string; message?: string; duration_ms?: number }>;
  assertions?: unknown[];
  evidence?: Record<string, unknown>;
  used_ai?: boolean;
}

export type CaseRunner = (testCaseId: string, opts: Record<string, unknown>) => Promise<CaseRunResult>;

let caseRunnerOverride: CaseRunner | null = null;

/**
 * Test seam: registers a stub runner so the pool's concurrency, retry and
 * flakiness logic can be proven without touching real engines.
 *
 * ARCHITECTURE.md §11.2 mandates that production execution flow through Lane C's
 * `executeService.runCase`, imported dynamically inside the handler. This seam
 * exists for the lane's own test suite (including the real-parallelism proof)
 * and always takes precedence when set.
 */
export function setCaseRunner(runner: CaseRunner | null): void {
  caseRunnerOverride = runner;
}

export function getCaseRunnerOverride(): CaseRunner | null {
  return caseRunnerOverride;
}

/**
 * Resolves the runner for one execution: the test override when present,
 * otherwise Lane C's `executeService.runCase` via a guarded dynamic import.
 * Throws a descriptive error when neither is available, which the pool converts
 * into a `blocked` outcome instead of crashing the run.
 */
export async function resolveRunner(): Promise<{ runner: CaseRunner; source: 'stub' | 'lane-c'; notes: string[] }> {
  if (caseRunnerOverride) return { runner: caseRunnerOverride, source: 'stub', notes: [] };

  const notes: string[] = [];
  // `.catch(() => null)` keeps the awaited value typed as `LaneCModule | null`;
  // a mutable `let … = null` assigned inside try/catch narrows to `never`.
  const mod = (await import('../execute/index.js').catch((err: unknown) => {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Modul eksekusi (lane C) tidak dapat dimuat sehingga agent pool tidak bisa menjalankan test case. Detail: ${reason.slice(0, 200)}`,
    );
  })) as { executeService?: { runCase?: unknown } };

  const runCase = mod?.executeService?.runCase;
  if (typeof runCase !== 'function') {
    throw new Error(
      'Modul eksekusi (lane C) tersedia tetapi tidak mengekspor executeService.runCase(); agent pool tidak dapat menjalankan test case.',
    );
  }

  const service = mod.executeService;
  notes.push('Eksekusi test case didelegasikan ke executeService.runCase (lane C) — satu-satunya penulis tabel run_results.');
  return {
    runner: async (testCaseId, opts) =>
      (await (runCase as (id: string, o: Record<string, unknown>) => Promise<CaseRunResult>).call(
        service,
        testCaseId,
        opts,
      )) as CaseRunResult,
    source: 'lane-c',
    notes,
  };
}

/* ------------------------------------------------------------------ *
 * Hand-rolled concurrency limiter
 * ------------------------------------------------------------------ */

export interface LimiterTask<T> {
  run: () => Promise<T>;
  onStart?: () => void;
}

/**
 * Runs `tasks` with at most `limit` concurrently and resolves with the results
 * in **input order**. A task that throws is captured as a rejected result so one
 * bad shard cannot cancel its siblings.
 *
 * This is the primitive that makes the pool genuinely parallel: a naive
 * `Promise.all(tasks.map(t => t.run()))` would fan out ALL shards at once (so
 * `workers` would be meaningless), while a `for … await` loop would be
 * sequential. The slot hand-off below keeps exactly `limit` promises alive.
 */
export async function runWithLimit<T>(
  tasks: Array<LimiterTask<T>>,
  limit: number,
): Promise<Array<{ ok: true; value: T } | { ok: false; error: unknown }>> {
  const results: Array<{ ok: true; value: T } | { ok: false; error: unknown }> = new Array(tasks.length);
  const slots = Math.max(1, Math.min(Math.floor(limit) || 1, tasks.length || 1));
  let cursor = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      const index = cursor++;
      if (index >= tasks.length) return;
      const task = tasks[index];
      task.onStart?.();
      try {
        results[index] = { ok: true, value: await task.run() };
      } catch (error) {
        results[index] = { ok: false, error };
      }
    }
  };

  await Promise.all(Array.from({ length: slots }, () => worker()));
  return results;
}

/* ------------------------------------------------------------------ *
 * Config normalisation
 * ------------------------------------------------------------------ */

export function normaliseConfig(config: Partial<AgentPoolConfig> | undefined | null): AgentPoolConfig {
  const base = config ?? {};
  const asInt = (value: unknown, fallback: number, min: number, max: number): number => {
    const n = Math.floor(Number(value));
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
  };

  return {
    workers: clampWorkers(base.workers ?? DEFAULT_POOL_CONFIG.workers),
    strategy: normaliseStrategy(base.strategy, DEFAULT_POOL_CONFIG.strategy),
    case_timeout_ms: asInt(base.case_timeout_ms ?? DEFAULT_POOL_CONFIG.case_timeout_ms, DEFAULT_POOL_CONFIG.case_timeout_ms, 1_000, 3_600_000),
    max_retries: asInt(base.max_retries ?? DEFAULT_POOL_CONFIG.max_retries, DEFAULT_POOL_CONFIG.max_retries, 0, 10),
    retry_failed_only: base.retry_failed_only ?? DEFAULT_POOL_CONFIG.retry_failed_only,
    ai_healing: base.ai_healing ?? DEFAULT_POOL_CONFIG.ai_healing,
    ai_triage: base.ai_triage ?? DEFAULT_POOL_CONFIG.ai_triage,
    abort_after_failures: asInt(
      base.abort_after_failures ?? DEFAULT_POOL_CONFIG.abort_after_failures,
      DEFAULT_POOL_CONFIG.abort_after_failures,
      0,
      10_000,
    ),
    spawn_ai_agents: base.spawn_ai_agents ?? DEFAULT_POOL_CONFIG.spawn_ai_agents,
  };
}

/** Tolerant `RunStatus` normalisation for whatever an engine returns. */
export function normaliseStatus(value: unknown): RunStatus {
  return (['passed', 'failed', 'blocked', 'skipped', 'not_run'] as const).includes(value as RunStatus)
    ? (value as RunStatus)
    : 'failed';
}

/* ------------------------------------------------------------------ *
 * Pool state (per run)
 * ------------------------------------------------------------------ */

interface SharedState {
  /** Total failures observed across the pool; drives `abort_after_failures`. */
  failedCases: number;
  aborted: boolean;
  abortReason: string | null;
}

/* ------------------------------------------------------------------ *
 * run()
 * ------------------------------------------------------------------ */

/**
 * Executes a regression suite across N parallel AI QA agents.
 *
 * Contract notes:
 *  - Each shard is executed as ONE limiter task; exactly `workers` shards are in
 *    flight at a time, and cases inside a shard run sequentially (that is what
 *    "a worker" means — otherwise retries would overlap the same case).
 *  - Retries happen **inside the shard**, so a retry never consumes another
 *    worker's slot and the flakiness signal stays attributable.
 *  - `sequential_duration_ms` is the sum of every attempt's duration, i.e. what
 *    the same work would have cost on one worker with the same retry policy.
 */
export async function run(
  projectId: string,
  testCaseIds: string[],
  rawConfig: Partial<AgentPoolConfig> = {},
): Promise<AgentPoolResult> {
  const config = normaliseConfig(rawConfig);
  const startedAt = Date.now();
  const runId = newId('pool_');
  const notes: string[] = [];

  const planned = await plan(projectId, testCaseIds, config);
  const shards: PoolShard[] = planned.shards;
  notes.push(...planned.notes);

  // Resolve the runner up front so an absent lane C produces a clean, honest
  // result (all shards blocked) instead of an unhandled rejection per case.
  let runner: CaseRunner | null = null;
  let runnerError: string | null = null;
  const aiStatus = await readAiStatus();
  try {
    const resolved = await resolveRunner();
    runner = resolved.runner;
    notes.push(...resolved.notes);
  } catch (err) {
    runnerError = err instanceof Error ? err.message : String(err);
    notes.push(runnerError);
  }

  const outcomes: PoolCaseOutcome[] = [];
  const shared: SharedState = { failedCases: 0, aborted: false, abortReason: null };
  const caseIndex = new Map(planned.shards.flatMap((s) => s.test_case_ids.map((id) => [id, loadCases(projectId, [id])[0]])));

  const tasks: Array<LimiterTask<{ shard: PoolShard; outcomes: PoolCaseOutcome[] }>> = shards.map((shard) => ({
    run: async () => {
      if (shared.aborted) {
        markShardAborted(shard, 'Pool dihentikan sebelum shard ini mulai (abort_after_failures).');
        return { shard, outcomes: [] };
      }
      return runShard(shard, {
        projectId,
        config,
        runner,
        runnerError,
        caseIndex,
        shared,
        aiHealthy: aiStatus.configured,
      });
    },
  }));

  const results = await runWithLimit(tasks, config.workers);

  for (const result of results) {
    if (!result.ok) {
      const message = result.error instanceof Error ? result.error.message : String(result.error);
      notes.push(`Sebuah shard berhenti karena galat tak terduga: ${message.slice(0, 200)}`);
      continue;
    }
    outcomes.push(...result.value.outcomes);
  }

  const finishedAt = Date.now();
  const durationMs = Math.max(1, finishedAt - startedAt);
  const sequentialMs = outcomes.reduce((sum, o) => sum + o.duration_ms, 0);
  const workersUsed = shards.filter((s) => s.status === 'done' || s.status === 'failed').length;

  const counters = rollup(outcomes);
  const summary = {
    total: outcomes.length,
    passed: counters.passed,
    failed: counters.failed,
    blocked: counters.blocked,
    skipped: counters.skipped,
    flaky: outcomes.filter((o) => o.flaky).length,
    healed: outcomes.filter((o) => o.healing?.applied).length,
    retried: outcomes.reduce((sum, o) => sum + Math.max(0, o.attempts - 1), 0),
    duration_ms: durationMs,
    sequential_duration_ms: sequentialMs,
    // Guard divide-by-zero: durationMs is clamped to >= 1 above.
    speedup: round2(sequentialMs / durationMs),
    workers_used: workersUsed,
  };

  /* ------------------------------- triage ------------------------------ */
  let triageAiUsed = false;
  if (config.ai_triage) {
    const triaged = await triageFailures(outcomes, { enabled: true, concurrency: config.workers });
    triageAiUsed = triaged.summary.ai_used;
    notes.push(...triaged.summary.notes);
  } else {
    notes.push('ai_triage nonaktif — kegagalan tidak ditriase otomatis.');
  }

  /* ------------------------------ narrative ---------------------------- */
  const narrative = await buildAiSummary({
    project_id: projectId,
    strategy: config.strategy,
    workers: shards.length,
    summary,
    outcomes,
    aiConfigured: aiStatus.configured,
    aiProvider: aiStatus.provider,
    aiMode: aiStatus.mode,
    aborted: shared.aborted,
  });
  notes.push(...narrative.notes);

  // AI is only "used" when a live model produced something we actually returned:
  // an agent name, a triage row, a reranked selector, or the narrative.
  const healingAiUsed = outcomes.some((o) => o.healing?.rationale?.includes('model AI aktif'));
  const aiUsed = planned.ai_used || triageAiUsed || narrative.ai_used || healingAiUsed;

  const result: AgentPoolResult = {
    run_id: runId,
    project_id: projectId,
    config,
    summary,
    shards,
    outcomes: sortOutcomes(outcomes, shards),
    ai_summary: narrative.ai_summary,
    ai_used: aiUsed,
    created_at: nowIso(),
  };

  try {
    persistRun(result, notes, shared);
  } catch (err) {
    // Persistence must never invalidate an otherwise successful execution.
    const reason = err instanceof Error ? err.message : String(err);
    notes.push(`Gagal menyimpan riwayat pool_runs: ${reason.slice(0, 200)}`);
  }

  return result;
}

/* ------------------------------------------------------------------ *
 * Shard execution
 * ------------------------------------------------------------------ */

interface ShardContext {
  projectId: string;
  config: AgentPoolConfig;
  runner: CaseRunner | null;
  runnerError: string | null;
  caseIndex: Map<string, PlanCase | undefined>;
  shared: SharedState;
  aiHealthy: boolean;
}

async function runShard(
  shard: PoolShard,
  ctx: ShardContext,
): Promise<{ shard: PoolShard; outcomes: PoolCaseOutcome[] }> {
  const outcomes: PoolCaseOutcome[] = [];

  if (ctx.runnerError || !ctx.runner) {
    // Lane C absent: report honestly rather than pretending the cases ran.
    shard.status = 'failed';
    shard.started_at = nowIso();
    shard.finished_at = nowIso();
    shard.notes.push(ctx.runnerError ?? 'Runner eksekusi tidak tersedia.');
    for (const id of shard.test_case_ids) {
      const meta = ctx.caseIndex.get(id);
      outcomes.push({
        test_case_id: id,
        code: meta?.code ?? id,
        title: meta?.title ?? id,
        engine: (meta?.engine as ExecEngine) ?? 'manual',
        final_status: 'blocked',
        initial_status: 'blocked',
        attempts: 0,
        duration_ms: 0,
        worker_id: shard.worker_id,
        flaky: false,
        error: ctx.runnerError ?? 'Runner eksekusi tidak tersedia.',
        healing: null,
        triage: null,
      });
      shard.blocked++;
    }
    return { shard, outcomes };
  }

  shard.status = 'running';
  shard.started_at = nowIso();

  for (const testCaseId of shard.test_case_ids) {
    // Re-check abort BETWEEN cases: a shard already running stops at the next
    // case boundary, which is the honest granularity for an in-flight worker.
    if (ctx.shared.aborted) {
      markShardAborted(shard, `Dihentikan di tengah shard: ${ctx.shared.abortReason ?? 'ambang kegagalan tercapai'}.`);
      return { shard, outcomes };
    }

    const outcome = await runCaseWithRetries(testCaseId, shard, ctx);
    outcomes.push(outcome);

    // Terminal non-executions (`not_run` / `skipped`, e.g. a manual case or a
    // driver that is not installed) are NOT failures. Counting them as such
    // would make a pool of manual cases report as a red regression run.
    if (outcome.final_status === 'failed') shard.failed++;
    else if (outcome.final_status === 'blocked') shard.blocked++;
    else shard.passed++; // passed | skipped | not_run

    if (outcome.attempts > 1) shard.retried++;
    if (outcome.healing?.applied) shard.healed++;

    if (outcome.final_status === 'failed') {
      ctx.shared.failedCases++;
      const threshold = ctx.config.abort_after_failures;
      if (threshold > 0 && ctx.shared.failedCases >= threshold) {
        ctx.shared.aborted = true;
        ctx.shared.abortReason =
          `Ambang abort_after_failures=${threshold} tercapai setelah ${ctx.shared.failedCases} kegagalan ` +
          `(terakhir: ${outcome.code}).`;
      }
    }
  }

  shard.status = shard.failed > 0 ? 'failed' : 'done';
  shard.finished_at = nowIso();
  shard.notes.push(
    `Selesai: ${shard.passed} lulus, ${shard.failed} gagal, ${shard.blocked} terblokir` +
      (shard.retried ? `, ${shard.retried} kasus dicoba ulang` : '') +
      (shard.healed ? `, ${shard.healed} selector disembuhkan` : '') +
      '.',
  );
  return { shard, outcomes };
}

/** Marks a shard aborted without pretending its cases ran. */
function markShardAborted(shard: PoolShard, reason: string): void {
  shard.status = 'aborted';
  if (!shard.started_at) shard.started_at = nowIso();
  shard.finished_at = nowIso();
  shard.notes.push(reason);
}

/* ------------------------------------------------------------------ *
 * Per-case execution with retries + flakiness classification
 * ------------------------------------------------------------------ */

/**
 * Decides whether a verdict is worth another attempt.
 *
 * Only `failed` qualifies: retries exist to tell a real failure apart from a
 * flaky one. `passed` is already decided, and `not_run` / `skipped` / `blocked`
 * are terminal outcomes that no amount of retrying will change (a manual case
 * is never executed by the server; a missing artifact stays missing).
 */
export function shouldRetry(status: RunStatus | null): boolean {
  return status === 'failed';
}

async function runCaseWithRetries(
  testCaseId: string,
  shard: PoolShard,
  ctx: ShardContext,
): Promise<PoolCaseOutcome> {
  const meta = ctx.caseIndex.get(testCaseId);
  const code = meta?.code ?? testCaseId;
  const title = meta?.title ?? testCaseId;
  const engine = (meta?.engine as ExecEngine) ?? 'manual';

  const maxAttempts = 1 + ctx.config.max_retries;
  const attemptResults: CaseRunResult[] = [];
  let totalDuration = 0;
  let firstStatus: RunStatus | null = null;
  let lastResult: CaseRunResult | null = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // A retry exists to separate a REAL failure from a flaky one, so only a hard
    // `failed` verdict is re-run. `passed` is already decided; `not_run` /
    // `skipped` / `blocked` are TERMINAL non-executions (a manual case, a
    // missing artifact, an absent driver) that retrying can never change —
    // re-running them would inflate `attempts`/`retried` for no signal.
    //
    // `retry_failed_only: false` widens this to also re-run a case that already
    // passed, which is how a user deliberately measures a case's stability.
    if (attempt > 0) {
      const retryable = ctx.config.retry_failed_only ? shouldRetry(firstStatus) : firstStatus !== 'not_run' && firstStatus !== 'skipped' && firstStatus !== 'blocked';
      if (!retryable) break;
    }

    const caseStarted = Date.now();
    let result: CaseRunResult;
    try {
      result = await ctx.runner!(testCaseId, {
        timeout_ms: ctx.config.case_timeout_ms,
        executed_by: shard.worker_id,
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      result = {
        status: 'failed',
        duration_ms: Date.now() - caseStarted,
        error: reason,
        engine,
      };
    }

    const measured = Number.isFinite(result.duration_ms) && result.duration_ms > 0
      ? Number(result.duration_ms)
      : Date.now() - caseStarted;

    attemptResults.push({ ...result, duration_ms: measured });
    totalDuration += measured;
    lastResult = result;
    if (firstStatus === null) firstStatus = normaliseStatus(result.status);

    // Stop early once the case passes: further attempts only add flakiness noise.
    if (normaliseStatus(result.status) === 'passed') break;
  }

  const initialStatus = firstStatus ?? 'failed';
  const finalStatus = normaliseStatus(lastResult?.status);
  const attempts = attemptResults.length;
  const error = lastResult?.error ?? null;

  // THE flakiness rule: first attempt failed, a later attempt passed.
  // Such a case is reported `flaky` — never folded into a clean pass.
  const flaky = attempts > 1 && initialStatus !== 'passed' && finalStatus === 'passed';

  let healing: PoolCaseOutcome['healing'] = null;
  if (finalStatus !== 'passed' && ctx.config.ai_healing && lastResult) {
    healing = await attemptHealing(lastResult, code);
  }

  return {
    test_case_id: testCaseId,
    code,
    title,
    engine,
    final_status: finalStatus,
    initial_status: initialStatus,
    attempts,
    duration_ms: totalDuration,
    worker_id: shard.worker_id,
    flaky,
    error,
    healing,
    triage: null,
  };
}

/**
 * Attempts an AI heal for a selector-related failure. Only records
 * `applied: true` when a replacement selector was genuinely produced.
 */
async function attemptHealing(result: CaseRunResult, code: string): Promise<PoolCaseOutcome['healing']> {
  const detected = extractSelectorFailure({
    logs: result.logs,
    evidence: result.evidence,
    error: result.error,
  });

  if (!detected) {
    return {
      applied: false,
      rationale:
        `Tidak ada langkah selector yang gagal pada ${code}, atau HTML halaman tidak tersedia pada evidence ` +
        'sehingga penyembuhan DOM tidak dapat dilakukan secara jujur.',
    };
  }

  try {
    const outcome = await heal({
      selector: detected.selector,
      action: detected.action,
      html: detected.html,
      intent: `Memulihkan langkah ${detected.action} yang gagal pada test case ${code}.`,
    });

    return {
      applied: outcome.healed && Boolean(outcome.selector),
      original_selector: detected.selector,
      ...(outcome.selector ? { healed_selector: outcome.selector } : {}),
      rationale: outcome.rationale,
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return {
      applied: false,
      original_selector: detected.selector,
      rationale: `Penyembuhan selector gagal dijalankan: ${reason.slice(0, 200)}`,
    };
  }
}

/* ------------------------------------------------------------------ *
 * Counters, AI status, persistence
 * ------------------------------------------------------------------ */

/** Roll-up that keeps `flaky` OUT of `passed` — the whole point of the feature. */
export function rollup(outcomes: PoolCaseOutcome[]): {
  passed: number;
  failed: number;
  blocked: number;
  skipped: number;
  flaky: number;
} {
  let passed = 0;
  let failed = 0;
  let blocked = 0;
  let skipped = 0;

  for (const o of outcomes) {
    switch (o.final_status) {
      case 'passed':
        // A flaky case is NOT a clean pass; it is counted separately.
        if (!o.flaky) passed++;
        break;
      case 'blocked':
        blocked++;
        break;
      case 'skipped':
      case 'not_run':
        // Terminal non-execution (manual case, missing artifact): not a failure.
        skipped++;
        break;
      default:
        failed++;
    }
  }

  return { passed, failed, blocked, skipped, flaky: outcomes.filter((o) => o.flaky).length };
}

async function readAiStatus(): Promise<{ configured: boolean; provider: string; mode: string }> {
  try {
    const specifier = '../ai/index.js';
    const mod = (await import(/* @vite-ignore */ specifier)) as {
      aiService?: { status?: () => Promise<{ configured?: boolean; provider?: string; mode?: string }> };
    };
    const status = await mod?.aiService?.status?.();
    return {
      configured: Boolean(status?.configured),
      provider: status?.provider ?? 'mock',
      mode: status?.mode ?? 'mock',
    };
  } catch {
    return { configured: false, provider: 'unavailable', mode: 'mock' };
  }
}

/** Order outcomes by shard, then by the case order inside each shard. */
function sortOutcomes(outcomes: PoolCaseOutcome[], shards: PoolShard[]): PoolCaseOutcome[] {
  const rank = new Map<string, number>();
  let cursor = 0;
  for (const shard of shards) for (const id of shard.test_case_ids) rank.set(id, cursor++);
  return [...outcomes].sort((a, b) => (rank.get(a.test_case_id) ?? 0) - (rank.get(b.test_case_id) ?? 0));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Writes the `pool_runs` row. This module owns ONLY that table: every
 * `test_runs` / `run_results` write belongs to Lane C's `executeService`.
 */
function persistRun(result: AgentPoolResult, notes: string[], shared: SharedState): void {
  const status: 'completed' | 'aborted' = shared.aborted ? 'aborted' : 'completed';
  const shardsWithNotes = result.shards.map((s) => ({
    ...s,
    notes: [...s.notes, ...(s.status === 'aborted' ? [shared.abortReason ?? 'Shard dihentikan.'] : [])],
  }));

  db.prepare(
    `INSERT INTO pool_runs
       (id, project_id, run_id, name, workers, strategy, config, status,
        total, passed, failed, blocked, skipped, flaky, healed, retried,
        duration_ms, sequential_duration_ms, speedup, ai_used, shards, outcomes, ai_summary, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    result.run_id,
    result.project_id,
    null, // Lane C creates the test_runs row; the pool does not write that table.
    `Agent pool — ${result.summary.total} test case / ${result.shards.length} worker (${result.config.strategy})`,
    result.shards.length,
    result.config.strategy,
    toJson({ ...result.config, planner_notes: notes }),
    status,
    result.summary.total,
    result.summary.passed,
    result.summary.failed,
    result.summary.blocked,
    result.summary.skipped,
    result.summary.flaky,
    result.summary.healed,
    result.summary.retried,
    Math.round(result.summary.duration_ms),
    Math.round(result.summary.sequential_duration_ms),
    result.summary.speedup,
    result.ai_used ? 1 : 0,
    toJson(shardsWithNotes),
    toJson(result.outcomes),
    result.ai_summary,
    result.created_at,
  );
}

/* ------------------------------------------------------------------ *
 * History (read-only)
 * ------------------------------------------------------------------ */

export interface PoolRunRow {
  id: string;
  project_id: string;
  run_id: string | null;
  name: string;
  workers: number;
  strategy: string;
  status: string;
  total: number;
  passed: number;
  failed: number;
  blocked: number;
  skipped: number;
  flaky: number;
  healed: number;
  retried: number;
  duration_ms: number;
  sequential_duration_ms: number;
  speedup: number;
  ai_used: number;
  created_at: string;
}

export function listRuns(projectId: string, limit = 50): PoolRunRow[] {
  try {
    return db
      .prepare(
        `SELECT id, project_id, run_id, name, workers, strategy, status, total, passed, failed, blocked,
                skipped, flaky, healed, retried, duration_ms, sequential_duration_ms, speedup, ai_used, created_at
           FROM pool_runs
          WHERE project_id = ?
          ORDER BY created_at DESC, id DESC
          LIMIT ?`,
      )
      .all(projectId, Math.max(1, Math.min(500, limit))) as unknown as PoolRunRow[];
  } catch {
    return [];
  }
}

export function getRun(id: string): PoolRunRow | undefined {
  try {
    return db.prepare('SELECT * FROM pool_runs WHERE id = ?').get(id) as unknown as PoolRunRow | undefined;
  } catch {
    return undefined;
  }
}

/** Rehydrates a full `AgentPoolResult` from a stored `pool_runs` row. */
export function rehydrateRun(row: Record<string, unknown>): AgentPoolResult | null {
  try {
    const shards = parseJson<PoolShard[]>(row.shards, []);
    const outcomes = parseJson<PoolCaseOutcome[]>(row.outcomes, []);
    const config = parseJson<Partial<AgentPoolConfig>>(row.config, {});
    const duration = Number(row.duration_ms ?? 0);
    const sequential = Number(row.sequential_duration_ms ?? 0);

    return {
      run_id: String(row.id),
      project_id: String(row.project_id),
      config: normaliseConfig(config),
      summary: {
        total: Number(row.total ?? outcomes.length),
        passed: Number(row.passed ?? 0),
        failed: Number(row.failed ?? 0),
        blocked: Number(row.blocked ?? 0),
        skipped: Number(row.skipped ?? 0),
        flaky: Number(row.flaky ?? 0),
        healed: Number(row.healed ?? 0),
        retried: Number(row.retried ?? 0),
        duration_ms: duration,
        sequential_duration_ms: sequential,
        speedup: Number(row.speedup ?? (duration > 0 ? round2(sequential / duration) : 0)),
        workers_used: Number(row.workers ?? shards.length),
      },
      shards,
      outcomes,
      ai_summary: (row.ai_summary as string | null) ?? null,
      ai_used: Number(row.ai_used ?? 0) === 1,
      created_at: String(row.created_at ?? ''),
    };
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * Dry-run helper
 * ------------------------------------------------------------------ */

export interface DryRunReport {
  shards: PlanShard[];
  estimates: {
    makespan_ms: number;
    sequential_ms: number;
    theoretical_speedup: number;
    average_shard_ms: number;
    balance_ratio: number;
  };
  strategy: string;
  workers: number;
  total_cases: number;
  ai_used: boolean;
  notes: string[];
}

export type { Severity };
