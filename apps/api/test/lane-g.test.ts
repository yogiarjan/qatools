/**
 * Lane G — multi-worker AI QA agent pool test suite (node:test).
 *
 * Everything here runs against a scratch node:sqlite database and a STUBBED case
 * runner, so timings measure the pool's own concurrency and nothing else.
 *
 * The headline test is "PROVE REAL PARALLELISM": the same 8 cases are run with
 * `workers: 1` and `workers: 4` against a runner with a real ~300 ms delay, and
 * the 4-worker wall clock must be materially lower with `speedup > 1.5`. If the
 * pool were a sequential loop with a `workers` label, this test would fail.
 *
 * Run from the repo root:
 *   node --test --import ./apps/api/node_modules/tsx/dist/loader.mjs apps/api/test/lane-g.test.ts
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/* ------------------------------------------------------------------ *
 * Isolated scratch database — MUST be set before importing the db module.
 * ------------------------------------------------------------------ */

const scratch = mkdtempSync(join(tmpdir(), 'qatools-lane-g-'));
process.env.QATOOLS_DB = resolve(scratch, 'lane-g.db');

/* ------------------------------------------------------------------ *
 * Imports under test
 * ------------------------------------------------------------------ */

const { migrate, db } = await import('../src/db/index.js');
const { plan, planSummary, loadCases, caseEstimateMs, MAX_WORKERS } = await import(
  '../src/modules/agents/planner.js'
);
const { run, setCaseRunner, runWithLimit, rollup, normaliseConfig } = await import(
  '../src/modules/agents/pool.js'
);
const { heal, proposeCandidates, normaliseSelector } = await import('../src/modules/agents/healing.js');
const { triageFailures, offlineSummary, offlineTriage } = await import('../src/modules/agents/triage.js');
const { DEFAULT_POOL_CONFIG, WORKER_STRATEGIES } = await import('@qatools/shared');

migrate();

/* ------------------------------------------------------------------ *
 * Fixtures
 * ------------------------------------------------------------------ */

const PROJECT_ID = 'prj_laneg_fixture';
const NOW = new Date().toISOString();

function seedProject(): void {
  db.prepare(
    `INSERT OR REPLACE INTO projects (id, key, name, description, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'active', ?, ?)`,
  ).run(PROJECT_ID, 'PRJ-LG', 'Lane G Fixture', 'Fixture untuk uji agent pool.', NOW, NOW);
}

/**
 * Inserts test cases. `estimated_minutes` and `risk_score` are what the sharding
 * strategies actually consume, so they are part of the fixture contract.
 */
function seedCases(
  rows: Array<{ id: string; engine?: string; risk?: number; minutes?: number; title?: string }>,
): string[] {
  const stmt = db.prepare(
    `INSERT OR REPLACE INTO test_cases
       (id, project_id, code, title, type, layer, priority, severity, automation_status, engine,
        risk_score, estimated_minutes, is_regression, status, generated_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'functional', 'web', 'medium', 'major', 'automated', ?, ?, ?, 1, 'ready', 'manual', ?, ?)`,
  );
  rows.forEach((r, i) => {
    stmt.run(
      r.id,
      PROJECT_ID,
      `TC-LG-${String(i + 1).padStart(3, '0')}`,
      r.title ?? `Case ${r.id}`,
      r.engine ?? 'api',
      r.risk ?? 50,
      r.minutes ?? 1,
      NOW,
      NOW,
    );
  });
  return rows.map((r) => r.id);
}

seedProject();

/* ------------------------------------------------------------------ *
 * Stub case runner with a REAL delay
 * ------------------------------------------------------------------ */

interface RunnerCall {
  id: string;
  opts: Record<string, unknown>;
  startedAt: number;
}

let runnerCalls: RunnerCall[] = [];
/** Peak number of simultaneously in-flight runner calls — proves real overlap. */
let peakConcurrency = 0;
let inFlight = 0;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Installs a stub runner. `behaviour` decides the verdict per attempt so the
 * flakiness/retry tests are fully deterministic.
 */
function stubRunner(
  behaviour: (id: string, attempt: number) => { status: string; error?: string | null; extra?: Record<string, unknown> },
  delayMs = 0,
): void {
  runnerCalls = [];
  peakConcurrency = 0;
  inFlight = 0;
  const attempts = new Map<string, number>();

  setCaseRunner(async (id, opts) => {
    const attempt = (attempts.get(id) ?? 0) + 1;
    attempts.set(id, attempt);
    inFlight++;
    peakConcurrency = Math.max(peakConcurrency, inFlight);
    runnerCalls.push({ id, opts, startedAt: Date.now() });
    try {
      if (delayMs > 0) await sleep(delayMs);
      const verdict = behaviour(id, attempt);
      return {
        status: verdict.status,
        duration_ms: delayMs,
        error: verdict.error ?? null,
        engine: 'api',
        logs: [],
        assertions: [],
        evidence: {},
        ...(verdict.extra ?? {}),
      };
    } finally {
      inFlight--;
    }
  });
}

/* ================================================================== *
 * 1. THE ACCEPTANCE TEST — the pool is ACTUALLY parallel
 * ================================================================== */

test('PROVE REAL PARALLELISM: workers=4 wall clock is materially lower than workers=1 (speedup > 1.5)', async () => {
  const CASE_DELAY_MS = 300;
  const ids = seedCases(
    Array.from({ length: 8 }, (_, i) => ({ id: `tc_par_${i + 1}`, engine: 'api', risk: 50, minutes: 1 })),
  );

  /* ------------------------- sequential: 1 worker ------------------------ */
  stubRunner(() => ({ status: 'passed' }), CASE_DELAY_MS);
  const seqStart = Date.now();
  const sequential = await run(PROJECT_ID, ids, {
    ...DEFAULT_POOL_CONFIG,
    workers: 1,
    strategy: 'round_robin',
    max_retries: 0,
    ai_healing: false,
    ai_triage: false,
  });
  const seqWall = Date.now() - seqStart;
  const seqPeak = peakConcurrency;

  /* ------------------------- parallel: 4 workers ------------------------- */
  stubRunner(() => ({ status: 'passed' }), CASE_DELAY_MS);
  const parStart = Date.now();
  const parallel = await run(PROJECT_ID, ids, {
    ...DEFAULT_POOL_CONFIG,
    workers: 4,
    strategy: 'round_robin',
    max_retries: 0,
    ai_healing: false,
    ai_triage: false,
  });
  const parWall = Date.now() - parStart;
  const parPeak = peakConcurrency;

  /* ------------------------------- report -------------------------------- */
  // eslint-disable-next-line no-console
  console.log(
    [
      '',
      '  ┌─ REAL-PARALLELISM MEASUREMENT ──────────────────────────────',
      `  │ cases                 : ${ids.length} × ${CASE_DELAY_MS} ms stub delay`,
      `  │ workers: 1  wall clock: ${seqWall} ms   (pool duration_ms=${sequential.summary.duration_ms}, peak in-flight=${seqPeak})`,
      `  │ workers: 4  wall clock: ${parWall} ms   (pool duration_ms=${parallel.summary.duration_ms}, peak in-flight=${parPeak})`,
      `  │ ratio par/seq         : ${(parWall / seqWall).toFixed(3)}  (must be < 0.60)`,
      `  │ speedup reported      : ${parallel.summary.speedup}x  (must be > 1.5)`,
      `  │ sequential_duration_ms: ${parallel.summary.sequential_duration_ms} ms`,
      `  │ workers_used          : ${parallel.summary.workers_used}`,
      '  └─────────────────────────────────────────────────────────────',
      '',
    ].join('\n'),
  );

  /* ------------------------------ assertions ----------------------------- */
  assert.equal(sequential.summary.total, 8, 'sequential run must cover all 8 cases');
  assert.equal(parallel.summary.total, 8, 'parallel run must cover all 8 cases');
  assert.equal(parallel.summary.passed, 8, 'all 8 cases pass in the parallel run');

  // THE assertion: 4 workers must finish in materially less wall-clock time.
  assert.ok(
    parWall < seqWall * 0.6,
    `parallel wall clock (${parWall} ms) must be < 60% of sequential (${seqWall} ms)`,
  );
  assert.ok(
    parallel.summary.speedup > 1.5,
    `reported speedup must be > 1.5, got ${parallel.summary.speedup}`,
  );

  // Cross-check: the reported speedup must agree with the independent stopwatch.
  const observedSpeedup = seqWall / parWall;
  assert.ok(
    Math.abs(parallel.summary.speedup - observedSpeedup) < 0.35,
    `reported speedup ${parallel.summary.speedup} must match observed ${observedSpeedup.toFixed(2)}`,
  );

  // Concurrency was genuinely simultaneous, not just faster by luck.
  assert.equal(seqPeak, 1, `workers:1 must never have more than 1 call in flight, saw ${seqPeak}`);
  assert.ok(parPeak > 1, `workers:4 must overlap calls, peak in-flight was ${parPeak}`);
  assert.equal(parPeak, 4, `workers:4 must run exactly 4 shards at once, saw ${parPeak}`);

  // And the limiter must not over-subscribe the configured worker count.
  assert.equal(parallel.shards.length, 4, 'workers:4 must produce exactly 4 shards');
});

/* ================================================================== *
 * 2. workers: 1 equals sequential (speedup ≈ 1)
 * ================================================================== */

test('workers=1 behaves sequentially and reports speedup ≈ 1', async () => {
  const ids = seedCases(Array.from({ length: 5 }, (_, i) => ({ id: `tc_seq_${i + 1}` })));

  stubRunner(() => ({ status: 'passed' }), 120);
  const result = await run(PROJECT_ID, ids, {
    ...DEFAULT_POOL_CONFIG,
    workers: 1,
    strategy: 'round_robin',
    max_retries: 0,
    ai_healing: false,
    ai_triage: false,
  });

  // eslint-disable-next-line no-console
  console.log(
    `  workers=1: wall=${result.summary.duration_ms} ms, sequential=${result.summary.sequential_duration_ms} ms, ` +
      `speedup=${result.summary.speedup}x, peak in-flight=${peakConcurrency}`,
  );

  assert.equal(peakConcurrency, 1, 'a single worker must never overlap');
  assert.equal(result.shards.length, 1, 'workers:1 must produce one shard');
  assert.equal(result.summary.workers_used, 1);
  assert.equal(result.summary.total, 5);

  // One worker: the sum of case durations IS the wall clock, so speedup ≈ 1.
  // The tolerance covers scheduling/DB overhead; it is deliberately tight
  // because a loose bound would hide a sequential loop masquerading as parallel.
  assert.ok(
    result.summary.speedup >= 0.8 && result.summary.speedup <= 1.25,
    `workers=1 speedup must be ≈ 1, got ${result.summary.speedup}`,
  );
});

/* ================================================================== *
 * 3. Flakiness classification
 * ================================================================== */

test('terminal non-executions (not_run / skipped / blocked) are never retried and never counted as failures', async () => {
  // Regression: an earlier version retried ANY non-passing status, so a pool of
  // manual cases reported attempts=2, retried=N and failed=N — a false red run.
  const ids = seedCases([
    { id: 'tc_term_manual', engine: 'manual', title: 'Manual case (not_run)' },
    { id: 'tc_term_skip', engine: 'db', title: 'Skipped case' },
    { id: 'tc_term_block', engine: 'api', title: 'Blocked case' },
  ]);

  stubRunner((id) => {
    if (id === 'tc_term_manual') return { status: 'not_run' };
    if (id === 'tc_term_skip') return { status: 'skipped' };
    return { status: 'blocked', error: 'driver_not_installed' };
  });

  const result = await run(PROJECT_ID, ids, {
    ...DEFAULT_POOL_CONFIG,
    workers: 3,
    max_retries: 3, // generous budget: none of these statuses may consume it
    retry_failed_only: true,
    ai_healing: false,
    ai_triage: false,
  });

  for (const outcome of result.outcomes) {
    assert.equal(outcome.attempts, 1, `${outcome.code} (${outcome.final_status}) must run exactly once`);
    assert.equal(outcome.flaky, false, `${outcome.code} must never be flaky`);
  }

  assert.equal(result.summary.retried, 0, 'terminal statuses must not produce retries');
  assert.equal(result.summary.failed, 0, 'a manual/skipped/blocked case is NOT a failure');
  assert.equal(result.summary.blocked, 1, 'the blocked case is counted as blocked');
  assert.equal(result.summary.skipped, 2, 'not_run and skipped are terminal non-executions');
  assert.equal(result.summary.total, 3);
  assert.equal(result.summary.flaky, 0);

  // eslint-disable-next-line no-console
  console.log(
    `  terminal statuses: ${result.outcomes
      .map((o) => `${o.code}=${o.final_status}(attempts=${o.attempts})`)
      .join(', ')} · failed=${result.summary.failed} blocked=${result.summary.blocked} skipped=${result.summary.skipped}`,
  );
});

test('a case that fails then passes is flaky, final=passed, initial=failed, and is NOT counted in passed', async () => {
  const ids = seedCases([
    { id: 'tc_flaky_1', title: 'Flaky case' },
    { id: 'tc_stable_1', title: 'Stable pass' },
    { id: 'tc_stable_2', title: 'Stable fail' },
  ]);

  stubRunner((id, attempt) => {
    if (id === 'tc_flaky_1') return attempt === 1 ? { status: 'failed', error: 'intermittent timeout' } : { status: 'passed' };
    if (id === 'tc_stable_2') return { status: 'failed', error: 'hard failure' };
    return { status: 'passed' };
  });

  const result = await run(PROJECT_ID, ids, {
    ...DEFAULT_POOL_CONFIG,
    workers: 2,
    strategy: 'round_robin',
    max_retries: 2,
    retry_failed_only: true,
    ai_healing: false,
    ai_triage: false,
  });

  const flaky = result.outcomes.find((o) => o.test_case_id === 'tc_flaky_1');
  assert.ok(flaky, 'flaky case must appear in outcomes');
  assert.equal(flaky.flaky, true, 'fail-then-pass must be flagged flaky');
  assert.equal(flaky.final_status, 'passed', 'final verdict keeps the retry result');
  assert.equal(flaky.initial_status, 'failed', 'initial verdict keeps the first attempt');
  assert.equal(flaky.attempts, 2, 'the flaky case took exactly 2 attempts');

  // THE counter contract: flaky is its own bucket and is NOT a clean pass.
  assert.equal(result.summary.flaky, 1, 'summary.flaky must be 1');
  assert.equal(result.summary.passed, 1, 'only the genuinely stable case counts as passed');
  assert.equal(result.summary.failed, 1, 'the always-failing case counts as failed');
  assert.equal(result.summary.total, 3);
  // The roll-up helper must agree with the summary.
  const counters = rollup(result.outcomes);
  assert.equal(counters.passed, 1);
  assert.equal(counters.failed, 1);
  assert.equal(counters.flaky, 1);

  // Shard-level accounting must agree with the case-level outcomes.
  const shardPassed = result.shards.reduce((n, s) => n + s.passed, 0);
  const shardFailed = result.shards.reduce((n, s) => n + s.failed, 0);
  assert.equal(shardPassed, result.outcomes.filter((o) => o.final_status === 'passed').length, 'shard.passed must sum to the passed outcomes (flaky included)');
  assert.equal(shardFailed, result.outcomes.filter((o) => o.final_status === 'failed').length, 'shard.failed must sum to the failed outcomes');

  // The shard that hosted the flaky case must record the retry.
  const shard = result.shards.find((s) => s.test_case_ids.includes('tc_flaky_1'));
  assert.ok(shard, 'flaky case must belong to a shard');
  assert.ok(shard.retried >= 1, 'shard.retried must count the flaky retry');

  // eslint-disable-next-line no-console
  console.log(
    `  flaky classification: passed=${result.summary.passed} failed=${result.summary.failed} flaky=${result.summary.flaky} ` +
      `(flaky case: initial=${flaky.initial_status} final=${flaky.final_status} attempts=${flaky.attempts})`,
  );
});

/* ================================================================== *
 * 4. Retry counts
 * ================================================================== */

test('max_retries=0 means exactly 1 attempt; max_retries=2 on an always-failing case gives attempts=3 and failed', async () => {
  const ids = seedCases([{ id: 'tc_noret_1', title: 'Always fails' }]);

  stubRunner(() => ({ status: 'failed', error: 'always broken' }));
  const noRetry = await run(PROJECT_ID, ids, {
    ...DEFAULT_POOL_CONFIG,
    workers: 1,
    max_retries: 0,
    ai_healing: false,
    ai_triage: false,
  });

  assert.equal(noRetry.outcomes[0].attempts, 1, 'max_retries=0 must produce exactly 1 attempt');
  assert.equal(noRetry.outcomes[0].final_status, 'failed');
  assert.equal(noRetry.outcomes[0].flaky, false, 'a case that fails every attempt is not flaky');
  assert.equal(noRetry.summary.retried, 0);
  assert.equal(noRetry.summary.failed, 1);

  stubRunner(() => ({ status: 'failed', error: 'always broken' }));
  const twoRetries = await run(PROJECT_ID, ids, {
    ...DEFAULT_POOL_CONFIG,
    workers: 1,
    max_retries: 2,
    ai_healing: false,
    ai_triage: false,
  });

  assert.equal(twoRetries.outcomes[0].attempts, 3, 'max_retries=2 must produce 3 attempts');
  assert.equal(twoRetries.outcomes[0].final_status, 'failed');
  assert.equal(twoRetries.outcomes[0].flaky, false, 'failing every attempt is failed, never flaky');
  assert.equal(twoRetries.summary.failed, 1);
  // `retried` counts EXTRA ATTEMPTS (attempts - 1), not cases that were retried:
  // 3 attempts on one case = 2 retries. `total` stays 1 because it is ONE case.
  assert.equal(twoRetries.summary.retried, 2, 'attempts - 1 across all cases = 2 retries');
  assert.equal(twoRetries.summary.total, 1, 'three attempts are still ONE case');

  // eslint-disable-next-line no-console
  console.log(
    `  retries: max_retries=0 -> attempts=${noRetry.outcomes[0].attempts}, ` +
      `max_retries=2 -> attempts=${twoRetries.outcomes[0].attempts} (status=${twoRetries.outcomes[0].final_status})`,
  );
});

/* ================================================================== *
 * 5. abort_after_failures
 * ================================================================== */

test('abort_after_failures stops the pool and marks remaining shards aborted', async () => {
  const ids = seedCases(Array.from({ length: 8 }, (_, i) => ({ id: `tc_abort_${i + 1}` })));

  // Every case fails; with 4 workers, 2 failures are reached almost immediately.
  stubRunner(() => ({ status: 'failed', error: 'boom' }), 10);

  const result = await run(PROJECT_ID, ids, {
    ...DEFAULT_POOL_CONFIG,
    workers: 4,
    strategy: 'round_robin',
    max_retries: 0,
    abort_after_failures: 2,
    ai_healing: false,
    ai_triage: false,
  });

  const abortedShards = result.shards.filter((s) => s.status === 'aborted');
  assert.ok(abortedShards.length > 0, `at least one shard must be aborted, shards=${JSON.stringify(result.shards.map((s) => s.status))}`);
  assert.ok(
    abortedShards.every((s) => s.finished_at !== null),
    'aborted shards must be timestamped',
  );
  assert.ok(
    abortedShards.every((s) => s.notes.some((n) => /abort/i.test(n))),
    'aborted shards must explain why in notes',
  );

  // The pool must stop early: fewer cases executed than were requested.
  assert.ok(
    result.outcomes.length < ids.length,
    `aborted pool must not execute every case, ran ${result.outcomes.length}/${ids.length}`,
  );
  assert.ok(
    result.summary.total < ids.length,
    `summary.total must reflect only executed cases, got ${result.summary.total}`,
  );

  // Aborted shards must not claim work for the cases they never reached. In a
  // real pool a shard stops at a CASE BOUNDARY, so the cases it already executed
  // are legitimately counted — only the untouched tail must be absent.
  const executed = new Set(result.outcomes.map((o) => o.test_case_id));
  for (const shard of abortedShards) {
    const unreached = shard.test_case_ids.filter((id) => !executed.has(id));
    assert.ok(unreached.length > 0, `aborted shard ${shard.worker_id} must have unreached cases`);
    const countedWork = shard.passed + shard.failed + shard.blocked;
    assert.equal(
      countedWork,
      shard.test_case_ids.length - unreached.length,
      `aborted shard ${shard.worker_id} counters must match exactly the cases it actually ran`,
    );
  }
  // Cases in a shard that never started at all must be entirely unaccounted for.
  const neverStarted = result.shards.filter((s) => s.status === 'aborted' && s.test_case_ids.every((id) => !executed.has(id)));
  for (const shard of neverStarted) {
    assert.equal(shard.passed + shard.failed + shard.blocked, 0, 'a shard that never started must report zero work');
  }

  const row = db.prepare('SELECT status FROM pool_runs WHERE id = ?').get(result.run_id) as { status?: string } | undefined;
  assert.equal(row?.status, 'aborted', 'pool_runs row must be persisted with status=aborted');

  // eslint-disable-next-line no-console
  console.log(
    `  abort: ran ${result.outcomes.length}/${ids.length} cases, shards=${JSON.stringify(
      result.shards.map((s) => s.status),
    )}`,
  );
});

/* ================================================================== *
 * 6. Sharding invariants — every strategy
 * ================================================================== */

test('every strategy produces shards whose union equals the input set exactly once', async () => {
  const ids = seedCases([
    { id: 'tc_sh_a', engine: 'web', risk: 90, minutes: 8 },
    { id: 'tc_sh_b', engine: 'api', risk: 20, minutes: 1 },
    { id: 'tc_sh_c', engine: 'web', risk: 70, minutes: 5 },
    { id: 'tc_sh_d', engine: 'db', risk: 40, minutes: 2 },
    { id: 'tc_sh_e', engine: 'api', risk: 85, minutes: 6 },
    { id: 'tc_sh_f', engine: 'ai', risk: 10, minutes: 1 },
    { id: 'tc_sh_g', engine: 'db', risk: 55, minutes: 3 },
  ]);

  for (const strategy of WORKER_STRATEGIES) {
    const { shards } = await plan(PROJECT_ID, ids, { ...DEFAULT_POOL_CONFIG, workers: 3, strategy });
    const flat = shards.flatMap((s) => s.test_case_ids);

    assert.equal(flat.length, ids.length, `${strategy}: shard union must have exactly ${ids.length} entries`);
    assert.equal(new Set(flat).size, ids.length, `${strategy}: no case may be duplicated`);
    assert.deepEqual(
      [...new Set(flat)].sort(),
      [...ids].sort(),
      `${strategy}: union must equal the input set exactly`,
    );
    assert.ok(shards.length <= 3, `${strategy}: must not exceed the requested worker count`);
    assert.ok(
      shards.every((s) => s.agent_name && s.agent_role),
      `${strategy}: every shard needs an agent name and role`,
    );
    assert.ok(
      shards.every((s) => typeof s.estimated_ms === 'number' && s.estimated_ms >= 0),
      `${strategy}: every shard needs a non-negative estimate`,
    );
  }

  // eslint-disable-next-line no-console
  console.log(`  union invariant holds for all ${WORKER_STRATEGIES.length} strategies: ${WORKER_STRATEGIES.join(', ')}`);
});

test('strategies behave differently in the way they document (risk / engine / round robin)', async () => {
  const ids = seedCases([
    { id: 'tc_beh_1', engine: 'web', risk: 95, minutes: 9 },
    { id: 'tc_beh_2', engine: 'web', risk: 10, minutes: 1 },
    { id: 'tc_beh_3', engine: 'api', risk: 80, minutes: 7 },
    { id: 'tc_beh_4', engine: 'api', risk: 15, minutes: 1 },
    { id: 'tc_beh_5', engine: 'db', risk: 60, minutes: 4 },
    { id: 'tc_beh_6', engine: 'db', risk: 5, minutes: 1 },
  ]);

  const rr = await plan(PROJECT_ID, ids, { ...DEFAULT_POOL_CONFIG, workers: 2, strategy: 'round_robin' });
  // Round robin is positional: worker 0 gets indices 0,2,4 and worker 1 gets 1,3,5.
  assert.deepEqual(rr.shards[0].test_case_ids, ['tc_beh_1', 'tc_beh_3', 'tc_beh_5']);
  assert.deepEqual(rr.shards[1].test_case_ids, ['tc_beh_2', 'tc_beh_4', 'tc_beh_6']);

  const risk = await plan(PROJECT_ID, ids, { ...DEFAULT_POOL_CONFIG, workers: 2, strategy: 'risk_weighted' });
  // LPT on risk: sorted 95, 80, 60, 15, 10, 5. Greedy lightest-first alternates,
  // so the two heaviest land on different workers and the loads end up close.
  assert.deepEqual(risk.shards[0].test_case_ids, ['tc_beh_1', 'tc_beh_4', 'tc_beh_2', 'tc_beh_6']);
  assert.deepEqual(risk.shards[1].test_case_ids, ['tc_beh_3', 'tc_beh_5']);
  // The documented behaviour: the highest-risk case starts first.
  assert.equal(risk.shards[0].test_case_ids[0], 'tc_beh_1', 'the riskiest case must be scheduled first');
  const riskSums = risk.shards.map((s) =>
    s.test_case_ids.reduce((sum, id) => sum + (loadCases(PROJECT_ID, [id])[0]?.risk_score ?? 0), 0),
  );
  assert.ok(
    Math.abs(riskSums[0] - riskSums[1]) <= 15,
    `risk_weighted must balance risk load, got ${riskSums.join(' vs ')}`,
  );

  const engine = await plan(PROJECT_ID, ids, { ...DEFAULT_POOL_CONFIG, workers: 3, strategy: 'same_engine' });
  // With 3 engines and 3 workers each worker must own exactly one engine.
  for (const shard of engine.shards) {
    const engines = new Set(
      shard.test_case_ids.map((id) => loadCases(PROJECT_ID, [id])[0]?.engine ?? 'unknown'),
    );
    assert.equal(engines.size, 1, `same_engine shard ${shard.worker_id} must hold one engine, got ${[...engines]}`);
  }
});

/* ================================================================== *
 * 7. duration_balanced beats round_robin on a skewed fixture
 * ================================================================== */

test('duration_balanced produces a smaller max-shard estimate than round_robin on a skewed fixture', async () => {
  // Deliberately skewed: one very long case plus several tiny ones. Round robin
  // always parks the long case on worker 0 and never compensates for it.
  const ids = seedCases([
    { id: 'tc_skew_1', minutes: 10, risk: 50 },
    { id: 'tc_skew_2', minutes: 5, risk: 50 },
    { id: 'tc_skew_3', minutes: 4, risk: 50 },
    { id: 'tc_skew_4', minutes: 4, risk: 50 },
    { id: 'tc_skew_5', minutes: 1, risk: 50 },
    { id: 'tc_skew_6', minutes: 1, risk: 50 },
    { id: 'tc_skew_7', minutes: 1, risk: 50 },
    { id: 'tc_skew_8', minutes: 1, risk: 50 },
  ]);

  const rr = await planSummary(PROJECT_ID, ids, { ...DEFAULT_POOL_CONFIG, workers: 3, strategy: 'round_robin' });
  const balanced = await planSummary(PROJECT_ID, ids, {
    ...DEFAULT_POOL_CONFIG,
    workers: 3,
    strategy: 'duration_balanced',
  });

  const rrMax = rr.estimates.makespan_ms;
  const balancedMax = balanced.estimates.makespan_ms;

  // eslint-disable-next-line no-console
  console.log(
    [
      '',
      '  ┌─ SHARD BALANCE (3 workers, skewed fixture) ─────────────────',
      `  │ case estimates (ms)   : ${ids.map((id) => caseEstimateMs(loadCases(PROJECT_ID, [id])[0])).join(', ')}`,
      `  │ round_robin       max : ${rrMax} ms  (loads: ${rr.shards.map((s) => s.estimated_ms).join(', ')})`,
      `  │ duration_balanced max : ${balancedMax} ms  (loads: ${balanced.shards.map((s) => s.estimated_ms).join(', ')})`,
      `  │ improvement           : ${(((rrMax - balancedMax) / rrMax) * 100).toFixed(1)}% lower makespan`,
      `  │ balance_ratio         : rr=${rr.estimates.balance_ratio} vs balanced=${balanced.estimates.balance_ratio}`,
      '  └─────────────────────────────────────────────────────────────',
      '',
    ].join('\n'),
  );

  assert.ok(
    balancedMax < rrMax,
    `duration_balanced max shard (${balancedMax} ms) must be smaller than round_robin (${rrMax} ms)`,
  );
  assert.ok(
    balanced.estimates.balance_ratio <= rr.estimates.balance_ratio,
    `duration_balanced must be at least as balanced, got ${balanced.estimates.balance_ratio} vs ${rr.estimates.balance_ratio}`,
  );
  // The theoretical speedup is a documented dry-run number and must be sane.
  assert.ok(balanced.estimates.theoretical_speedup > 1, 'theoretical speedup must exceed 1 with 3 workers');
  assert.ok(
    balanced.estimates.theoretical_speedup <= 3.01,
    `theoretical speedup cannot exceed the worker count, got ${balanced.estimates.theoretical_speedup}`,
  );
});

/* ================================================================== *
 * 8. Selector healing — a genuine DOM scan
 * ================================================================== */

const HEAL_HTML = `<!doctype html>
<html>
  <head><title>QATools Demo Shop</title></head>
  <body>
    <header id="main-header" class="top">
      <h1>Demo Shop</h1>
      <a href="/products" data-testid="nav-products">Produk</a>
    </header>
    <form id="login-form" action="/login" method="post">
      <input type="text" name="username" placeholder="Username" aria-label="Nama pengguna" />
      <input type="password" name="password" placeholder="Password" />
      <button type="submit" data-testid="btn-login">Masuk</button>
    </form>
    <p id="footer-note">Halaman demo tanpa dependensi jaringan.</p>
  </body>
</html>`;

test('heal() performs a real DOM scan and returns specific, existing candidate selectors', async () => {
  const result = await heal({
    selector: '#login-button-legacy',
    action: 'click',
    html: HEAL_HTML,
    intent: 'Tombol login pada form',
  });

  assert.equal(result.healed, true, 'a healable page must produce a replacement');
  assert.ok(result.selector, 'healed result must carry a selector');
  assert.ok(result.candidates.length >= 2, `expected several candidates, got ${result.candidates.length}`);
  assert.ok(result.rationale.length > 40, 'the rationale must actually explain the choice');
  assert.equal(result.used_mock, true, 'with no AI key the deterministic scan must report used_mock=true');

  const offered = result.candidates.map((c) => c.selector);

  // The candidates must be REAL selectors drawn from the supplied HTML.
  assert.ok(offered.includes('[data-testid="btn-login"]'), `expected the login button testid, got ${offered.join(' | ')}`);
  assert.ok(offered.includes('#login-form'), `expected the form id, got ${offered.join(' | ')}`);
  assert.ok(
    offered.includes('button >> text=Masuk'),
    `expected the button text selector, got ${offered.join(' | ')}`,
  );

  // Ranking contract: data-testid > id > class/text.
  const testidRank = offered.indexOf('[data-testid="btn-login"]');
  const idRank = offered.indexOf('#login-form');
  assert.ok(testidRank >= 0 && idRank >= 0);
  assert.ok(
    testidRank < idRank,
    `data-testid ("${offered[testidRank]}") must outrank id ("${offered[idRank]}")`,
  );

  const top = result.candidates[0];
  assert.ok(top.score > 0, 'top candidate must have a positive score');
  assert.ok(/data-testid|test/i.test(top.reason), `top candidate reason should mention its tier: ${top.reason}`);

  // Every candidate must be specific — a bare tag is not a useful heal.
  for (const candidate of result.candidates) {
    assert.ok(candidate.selector.trim().length > 0, 'no empty selectors');
    assert.ok(candidate.reason.trim().length > 0, 'every candidate must explain itself');
    assert.ok(candidate.score > 0);
  }

  // eslint-disable-next-line no-console
  console.log(
    `  heal(#login-button-legacy) -> "${result.selector}"\n  candidates: ${result.candidates
      .slice(0, 5)
      .map((c) => `${c.selector}(${c.score})`)
      .join(', ')}`,
  );
});

test('heal() returns healed:false with a clear rationale when nothing matches', async () => {
  const result = await heal({
    selector: '#definitely-not-here',
    action: 'click',
    html: '<html><body><div></div></body></html>',
  });

  assert.equal(result.healed, false, 'an empty page must not produce a fake heal');
  assert.equal(result.selector, null, 'no selector may be invented');
  assert.equal(result.candidates.length, 0, 'no candidates may be fabricated');
  assert.ok(result.rationale.length > 30, 'the failure must be explained');
  assert.match(result.rationale, /tidak dapat diselamatkan|tidak menemukan|tidak dikirim/i);

  // A request with no HTML at all must also degrade honestly, not throw.
  const noHtml = await heal({ selector: '#x', action: 'click' });
  assert.equal(noHtml.healed, false);
  assert.equal(noHtml.selector, null);
  assert.ok(noHtml.rationale.length > 20);

  // And a request with no selector is a caller error, reported clearly.
  const noSelector = await heal({ selector: '   ', action: 'click', html: HEAL_HTML });
  assert.equal(noSelector.healed, false);
  assert.match(noSelector.rationale, /selector/i);
});

test('the pool wires ai_healing into failed selector steps and only counts a real heal', async () => {
  const ids = seedCases([{ id: 'tc_heal_1', title: 'Broken selector case', engine: 'web' }]);

  // Simulate exactly what Lane C's HTTP web engine reports on a selector miss:
  // a failed step log carrying the selector as `target`, plus the page HTML in
  // evidence so a DOM-based heal is genuinely possible.
  stubRunner(() => ({
    status: 'failed',
    error: '1 langkah gagal',
    extra: {
      engine: 'web',
      logs: [
        {
          index: 2,
          action: 'click',
          target: '#login-button-legacy',
          status: 'fail',
          message: 'Elemen "#login-button-legacy" tidak ditemukan, jadi aksi click tidak dapat dijalankan (mode HTTP).',
          duration_ms: 3,
        },
      ],
      evidence: { mode: 'http', url: 'https://shop.example/login', html: HEAL_HTML },
    },
  }));

  const result = await run(PROJECT_ID, ids, {
    ...DEFAULT_POOL_CONFIG,
    workers: 1,
    max_retries: 0,
    ai_healing: true,
    ai_triage: false,
  });

  const outcome = result.outcomes[0];
  assert.ok(outcome.healing, 'a selector failure must produce a healing record');
  assert.equal(outcome.healing.applied, true, 'a real replacement selector must be marked applied');
  assert.equal(outcome.healing.original_selector, '#login-button-legacy');
  assert.ok(outcome.healing.healed_selector, 'the healed selector must be recorded');
  assert.ok(
    /data-testid|btn-login/.test(outcome.healing.healed_selector),
    `healed selector should be the strongest candidate, got ${outcome.healing.healed_selector}`,
  );

  // healed counter moves ONLY because a selector was actually produced.
  assert.equal(result.summary.healed, 1, 'summary.healed must count the applied heal');
  assert.equal(result.shards[0].healed, 1, 'the shard must count the applied heal');

  // eslint-disable-next-line no-console
  console.log(
    `  ai_healing wired: ${outcome.healing.original_selector} -> ${outcome.healing.healed_selector} ` +
      `(shard.healed=${result.shards[0].healed}, summary.healed=${result.summary.healed})`,
  );
});

test('healing is NOT claimed when the failure has no HTML evidence to scan', async () => {
  const ids = seedCases([{ id: 'tc_noh_1', title: 'Selector fail without evidence', engine: 'web' }]);

  stubRunner(() => ({
    status: 'failed',
    error: 'Elemen "#ghost" tidak ditemukan.',
    extra: {
      engine: 'web',
      logs: [{ index: 1, action: 'click', target: '#ghost', status: 'fail', message: 'Elemen "#ghost" tidak ditemukan.' }],
      evidence: { mode: 'http' }, // no html captured
    },
  }));

  const result = await run(PROJECT_ID, ids, {
    ...DEFAULT_POOL_CONFIG,
    workers: 1,
    max_retries: 0,
    ai_healing: true,
    ai_triage: false,
  });

  const outcome = result.outcomes[0];
  assert.equal(outcome.final_status, 'failed');
  assert.ok(outcome.healing, 'the attempted healing must still be reported');
  assert.equal(outcome.healing.applied, false, 'no HTML means no honest heal');
  assert.equal(result.summary.healed, 0, 'summary.healed must stay 0 without a real heal');
  assert.equal(result.shards[0].healed, 0);
});

/* ================================================================== *
 * 9. Offline AI behaviour
 * ================================================================== */

test('with no AI key the pool still completes, reports ai_used=false, and produces a non-empty ai_summary', async () => {
  // Force the AI layer offline regardless of the machine's settings.
  db.prepare('DELETE FROM ai_settings').run();

  const ids = seedCases([
    { id: 'tc_off_1', title: 'Passes' },
    { id: 'tc_off_2', title: 'Fails with a 500' },
    { id: 'tc_off_3', title: 'Flaky login case' },
  ]);

  stubRunner((id, attempt) => {
    if (id === 'tc_off_2') return { status: 'failed', error: 'HTTP 500 internal server error pada endpoint pembayaran' };
    if (id === 'tc_off_3') return attempt === 1 ? { status: 'failed', error: 'timeout' } : { status: 'passed' };
    return { status: 'passed' };
  });

  const result = await run(PROJECT_ID, ids, {
    ...DEFAULT_POOL_CONFIG,
    workers: 3,
    strategy: 'ai_optimized', // exercises the offline fallback of the AI path too
    max_retries: 1,
    ai_healing: true,
    ai_triage: true,
    spawn_ai_agents: true,
  });

  assert.equal(result.summary.total, 3, 'the run must still complete offline');
  assert.equal(result.summary.flaky, 1, 'flakiness detection must work offline');
  assert.equal(result.ai_used, false, 'ai_used must be false without a key — no fake AI claims');

  assert.ok(typeof result.ai_summary === 'string' && result.ai_summary.trim().length > 80, 'ai_summary must be non-empty');
  assert.match(result.ai_summary, /lulus|kelulusan/i, 'the narrative must report the pass rate');
  assert.match(result.ai_summary, /speedup/i, 'the narrative must report the measured speedup');
  assert.match(result.ai_summary, /flaky/i, 'the narrative must call out flaky cases');

  // Triage must have run for every failing case, offline and deterministically.
  const failed = result.outcomes.filter((o) => o.final_status === 'failed');
  assert.ok(failed.length >= 1, 'there must be a failing case to triage');
  for (const outcome of failed) {
    assert.ok(outcome.triage, `${outcome.code} must have a triage row`);
    assert.ok(
      ['cosmetic', 'minor', 'major', 'critical', 'blocker'].includes(outcome.triage.severity),
      `invalid severity ${outcome.triage.severity}`,
    );
    assert.ok(outcome.triage.likely_root_cause.length > 10, 'root cause must be substantive');
    assert.ok(outcome.triage.suggested_owner_role.length > 2, 'an owner role must be suggested');
    assert.ok(outcome.triage.rationale.length > 20, 'the triage must explain itself');
  }

  // Deterministic agent names even with zero configuration.
  for (const shard of result.shards) {
    assert.match(shard.agent_name, /^Agent /, `offline agent name must be sensible, got "${shard.agent_name}"`);
    assert.ok(shard.agent_role.length > 4, 'every agent must have a role');
  }

  const row = db.prepare('SELECT ai_used, ai_summary, speedup FROM pool_runs WHERE id = ?').get(result.run_id) as
    | { ai_used?: number; ai_summary?: string; speedup?: number }
    | undefined;
  assert.ok(row, 'the pool_runs row must be persisted');
  assert.equal(Number(row?.ai_used), 0, 'persisted ai_used must be honest');
  assert.ok((row?.ai_summary ?? '').length > 80, 'the persisted narrative must survive a reload');

  // eslint-disable-next-line no-console
  console.log(`\n  offline ai_summary (${result.ai_summary?.length} chars):\n  ${result.ai_summary}`);
});

test('offline triage classifies severity from the observed failure text', () => {
  const base = {
    test_case_id: 'tc_x',
    code: 'TC-X',
    title: 'Checkout',
    engine: 'api' as const,
    final_status: 'failed' as const,
    initial_status: 'failed' as const,
    attempts: 1,
    duration_ms: 10,
    worker_id: 'w1',
    flaky: false,
    healing: null,
    triage: null,
  };

  assert.equal(offlineTriage({ ...base, error: 'connect ECONNREFUSED 127.0.0.1:8080' }).severity, 'blocker');
  assert.equal(offlineTriage({ ...base, error: 'HTTP 500 internal server error' }).severity, 'critical');
  assert.equal(offlineTriage({ ...base, error: 'Elemen "#a" tidak ditemukan' }).severity, 'major');
  assert.match(
    offlineTriage({ ...base, error: 'selector .btn tidak cocok' }).likely_root_cause,
    /selector|DOM/i,
  );

  // A blocked/never-run manual case is not a product defect.
  const manual = offlineTriage({ ...base, engine: 'manual', final_status: 'blocked', error: 'tidak dijalankan' });
  assert.equal(manual.severity, 'minor');
});

/* ================================================================== *
 * 10. Limiter unit test — the mechanism behind the parallelism
 * ================================================================== */

test('runWithLimit never exceeds its concurrency limit and preserves input order', async () => {
  let active = 0;
  let peak = 0;

  const tasks = Array.from({ length: 12 }, (_, i) => ({
    run: async () => {
      active++;
      peak = Math.max(peak, active);
      await sleep(30);
      active--;
      return i;
    },
  }));

  const results = await runWithLimit(tasks, 3);
  assert.equal(peak, 3, `limiter must cap concurrency at 3, peaked at ${peak}`);
  assert.deepEqual(
    results.map((r) => (r.ok ? r.value : -1)),
    Array.from({ length: 12 }, (_, i) => i),
    'results must come back in input order',
  );

  // A throwing task must not cancel its siblings.
  const mixed = await runWithLimit<number>(
    [
      { run: async () => 1 },
      { run: async () => Promise.reject(new Error('nope')) },
      { run: async () => 3 },
    ],
    2,
  );
  assert.equal(mixed[0].ok && mixed[0].value, 1);
  assert.equal(mixed[1].ok, false, 'the failing task is captured, not thrown');
  assert.equal(mixed[2].ok && mixed[2].value, 3, 'later tasks still complete');

  assert.equal(peak, 3);
});

/* ================================================================== *
 * 11. Config / persistence hygiene
 * ================================================================== */

test('pool config is clamped to safe bounds and the run is persisted once in pool_runs', async () => {
  const ids = seedCases([{ id: 'tc_cfg_1' }]);

  const config = normaliseConfig({ workers: 999, max_retries: -5, case_timeout_ms: 10, abort_after_failures: -1 });
  assert.equal(config.workers, MAX_WORKERS, `workers must clamp to ${MAX_WORKERS}`);
  assert.equal(config.max_retries, 0, 'negative retries clamp to 0');
  assert.equal(config.case_timeout_ms, 1000, 'timeouts clamp to the 1s floor');
  assert.equal(config.abort_after_failures, 0, 'negative abort threshold clamps to 0');

  stubRunner(() => ({ status: 'passed' }));
  const before = Number(
    (db.prepare('SELECT COUNT(*) AS n FROM pool_runs WHERE project_id = ?').get(PROJECT_ID) as { n?: number })?.n ?? 0,
  );

  const result = await run(PROJECT_ID, ids, { ...DEFAULT_POOL_CONFIG, workers: 1, ai_healing: false, ai_triage: false });

  const after = Number(
    (db.prepare('SELECT COUNT(*) AS n FROM pool_runs WHERE project_id = ?').get(PROJECT_ID) as { n?: number })?.n ?? 0,
  );
  assert.equal(after - before, 1, 'exactly one pool_runs row must be written per run');

  const row = db.prepare('SELECT * FROM pool_runs WHERE id = ?').get(result.run_id) as Record<string, unknown> | undefined;
  assert.ok(row, 'the run row must exist');
  assert.equal(row?.project_id, PROJECT_ID);
  assert.equal(Number(row?.total), 1);
  assert.equal(Number(row?.workers), 1);
  assert.ok(JSON.parse(String(row?.shards)).length === 1, 'shards JSON must round-trip');
  assert.ok(JSON.parse(String(row?.outcomes)).length === 1, 'outcomes JSON must round-trip');

  // The pool owns ONLY pool_runs: it must not have written test_runs/run_results
  // itself (the stub runner bypasses Lane C entirely, so those stay untouched).
  const runRows = Number(
    (db.prepare('SELECT COUNT(*) AS n FROM test_runs WHERE project_id = ?').get(PROJECT_ID) as { n?: number })?.n ?? 0,
  );
  assert.equal(runRows, 0, 'the agent pool must never write test_runs directly');
});

test('a selector-less page never yields a fabricated candidate', async () => {
  const { candidates, scan } = await proposeCandidates('#gone', '<html><body><span>x</span></body></html>');
  assert.equal(scan.nodes_scanned > 0, true, 'the DOM scan must actually run');
  // A bare tag fallback is allowed ONLY when it is specific enough; assert every
  // candidate is a real selector string rather than a placeholder.
  for (const candidate of candidates) {
    assert.ok(normaliseSelector(candidate.selector).length > 0);
    assert.ok(!/undefined|null|TODO/i.test(candidate.selector), `candidate must not be a placeholder: ${candidate.selector}`);
  }
});
