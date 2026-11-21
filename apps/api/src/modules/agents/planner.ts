/**
 * agents/planner — sharding strategy for the multi-worker AI QA agent pool.
 *
 * Owned by `lane-agents` (Lane G). Types are FROZEN in
 * `packages/shared/src/automation.ts` — this file never redefines them.
 *
 * `plan(projectId, testCaseIds, config)` turns a flat candidate list into
 * `PoolShard[]`, one shard per worker. Every strategy is real and explainable:
 *
 *   round_robin       — interleave, keeps the original order, good for identical cases
 *   risk_weighted     — greedy LPT on `risk_score`; the riskiest work starts first
 *   duration_balanced — greedy LPT on `estimated_minutes`; minimises the makespan
 *   same_engine       — pack one engine per worker to avoid per-worker overhead
 *   ai_optimized      — AI (`predict_risk`) scores drive the LPT ordering
 *
 * Cross-lane calls (Lane C `execute`, Lane D `ai`) are **dynamic and inside the
 * function**, never top-level: a module that is mid-edit must not break boot.
 *
 * Determinism: everything except `ai_optimized`-with-a-live-model is a pure
 * function of the fixture, so `plan()` is reproducible and testable.
 */

import { WORKER_STRATEGIES, type AgentPoolConfig, type PoolShard, type WorkerStrategy } from '@qatools/shared';
import { db, nowIso } from '../../db/index.js';

/* ------------------------------------------------------------------ *
 * Tunables
 * ------------------------------------------------------------------ */

/** Hard ceiling on workers — mirrors ARCHITECTURE.md §11.5 `max_workers`. */
export const MAX_WORKERS = 16;

/** Assumed per-case overhead (setup/teardown) when estimating shard load. */
export const PER_CASE_OVERHEAD_MS = 200;

/** Case types that are more interesting to a QA lead when assigning agents. */
const SPECIALIST_BY_ENGINE: Record<string, { role: string; label: string }> = {
  web: { role: 'Web Automation Specialist', label: 'Web' },
  api: { role: 'API Automation Specialist', label: 'API' },
  db: { role: 'Database Validator', label: 'DB' },
  ai: { role: 'AI Exploration Agent', label: 'AI' },
  manual: { role: 'Manual Verification Agent', label: 'Manual' },
};

/** Deterministic Greek-letter callsigns — used when the AI layer is offline. */
const AGENT_CALLSIGNS = [
  'Alpha',
  'Bravo',
  'Charlie',
  'Delta',
  'Echo',
  'Foxtrot',
  'Golf',
  'Hotel',
  'India',
  'Juliett',
  'Kilo',
  'Lima',
  'Mike',
  'November',
  'Oscar',
  'Papa',
] as const;

/* ------------------------------------------------------------------ *
 * Row shapes
 * ------------------------------------------------------------------ */

export interface PlanCase {
  id: string;
  code: string;
  title: string;
  engine: string;
  risk_score: number;
  estimated_minutes: number;
  layer: string;
  priority: string;
  is_regression: number;
}

export interface PlanShard extends PoolShard {
  /** Sum of `estimated_minutes` in this shard — shown by the dry-run UI. */
  estimated_minutes: number;
  /** Human-readable reason this shard received these cases. */
  allocation_reason: string;
}

export interface PlanSummary {
  project_id: string;
  strategy: WorkerStrategy;
  workers: number;
  total_cases: number;
  shards: PlanShard[];
  estimates: {
    /** Longest shard estimate — the expected makespan given perfect balance. */
    makespan_ms: number;
    /** Sum of all case estimates — what one worker alone would cost. */
    sequential_ms: number;
    /** theoretical_speedup = sequential / makespan (bounded by `workers`). */
    theoretical_speedup: number;
    average_shard_ms: number;
    balance_ratio: number;
  };
  ai_used: boolean;
  notes: string[];
}

/* ------------------------------------------------------------------ *
 * Case loading
 * ------------------------------------------------------------------ */

/**
 * Loads the plan candidates. Reads `test_cases` directly (read-only) rather than
 * importing Lane A's repo, so an in-flight edit in another lane cannot break us.
 * Unknown ids are preserved as placeholder rows so the union invariant
 * (every requested case ends up in exactly one shard) always holds.
 */
export function loadCases(projectId: string, testCaseIds?: string[]): PlanCase[] {
  const ids = dedupe(testCaseIds ?? []);
  let rows: PlanCase[] = [];

  try {
    if (ids.length) {
      const placeholders = ids.map(() => '?').join(', ');
      rows = db
        .prepare(
          `SELECT id, code, title, engine, risk_score, estimated_minutes, layer, priority, is_regression
             FROM test_cases WHERE id IN (${placeholders})`,
        )
        .all(...ids) as unknown as PlanCase[];
    } else if (projectId) {
      rows = db
        .prepare(
          `SELECT id, code, title, engine, risk_score, estimated_minutes, layer, priority, is_regression
             FROM test_cases
            WHERE project_id = ?
            ORDER BY is_regression DESC, risk_score DESC, code ASC`,
        )
        .all(projectId) as unknown as PlanCase[];
    }
  } catch {
    rows = [];
  }

  const byId = new Map(rows.map((r) => [r.id, normaliseCase(r)]));

  // Preserve the caller's ordering; synthesise rows for ids we cannot resolve.
  const ordered = ids.length ? ids : rows.map((r) => r.id);
  return ordered.map(
    (id) =>
      byId.get(id) ?? {
        id,
        code: id,
        title: `Test case ${id} (tidak ditemukan di basis data)`,
        engine: 'manual',
        risk_score: 0,
        estimated_minutes: 0,
        layer: 'web',
        priority: 'medium',
        is_regression: 0,
      },
  );
}

function normaliseCase(row: PlanCase): PlanCase {
  return {
    id: String(row.id),
    code: String(row.code ?? row.id),
    title: String(row.title ?? ''),
    engine: String(row.engine ?? 'manual'),
    risk_score: numberOr(row.risk_score, 0),
    estimated_minutes: numberOr(row.estimated_minutes, 0),
    layer: String(row.layer ?? 'web'),
    priority: String(row.priority ?? 'medium'),
    is_regression: numberOr(row.is_regression, 0),
  };
}

function numberOr(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function dedupe(ids: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids ?? []) {
    if (typeof id !== 'string') continue;
    const trimmed = id.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Estimators
 * ------------------------------------------------------------------ */

/** Per-case estimate: `estimated_minutes` plus fixed engine overhead. */
export function caseEstimateMs(entry: { estimated_minutes?: number }): number {
  const minutes = numberOr(entry.estimated_minutes, 0);
  return Math.max(0, Math.round(minutes * 60_000)) + PER_CASE_OVERHEAD_MS;
}

function shardEstimateMs(cases: PlanCase[]): number {
  return cases.reduce((sum, c) => sum + caseEstimateMs(c), 0);
}

/** `workers` clamped into [1, MAX_WORKERS]; a fractional value is floored. */
export function clampWorkers(workers: unknown): number {
  const n = Math.floor(numberOr(workers, 1));
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(MAX_WORKERS, n);
}

/** Validates/normalises an incoming strategy name. */
export function normaliseStrategy(strategy: unknown, fallback: WorkerStrategy = 'risk_weighted'): WorkerStrategy {
  return typeof strategy === 'string' && (WORKER_STRATEGIES as readonly string[]).includes(strategy)
    ? (strategy as WorkerStrategy)
    : fallback;
}

/* ------------------------------------------------------------------ *
 * Core allocation primitives
 * ------------------------------------------------------------------ */

/**
 * Greedy longest-processing-time packing: sort heaviest-first, then always push
 * the next case onto the currently lightest shard. This is the classic
 * 4/3-approximation heuristic for makespan minimisation and is what makes
 * `duration_balanced` beat `round_robin` on skewed fixtures.
 */
function lptPack(cases: PlanCase[], workers: number, weightOf: (c: PlanCase) => number): PlanCase[][] {
  const buckets: PlanCase[][] = Array.from({ length: workers }, () => []);
  const load: number[] = Array.from({ length: workers }, () => 0);

  const sorted = [...cases].sort((a, b) => {
    const diff = weightOf(b) - weightOf(a);
    // Stable tiebreak so the same input always produces the same shards.
    return diff !== 0 ? diff : a.code.localeCompare(b.code) || a.id.localeCompare(b.id);
  });

  for (const item of sorted) {
    let target = 0;
    for (let i = 1; i < workers; i++) if (load[i] < load[target]) target = i;
    buckets[target].push(item);
    load[target] += weightOf(item);
  }
  return buckets;
}

/** Interleaved round-robin — case `i` goes to worker `i % workers`. */
function roundRobinPack(cases: PlanCase[], workers: number): PlanCase[][] {
  const buckets: PlanCase[][] = Array.from({ length: workers }, () => []);
  cases.forEach((c, i) => buckets[i % workers].push(c));
  return buckets;
}

/**
 * Engine grouping: one engine per worker when there are enough workers; the
 * biggest engine groups are merged into balanced buckets when there are not.
 */
function sameEnginePack(cases: PlanCase[], workers: number): PlanCase[][] {
  const byEngine = new Map<string, PlanCase[]>();
  for (const c of cases) {
    const key = c.engine || 'manual';
    const bucket = byEngine.get(key);
    if (bucket) bucket.push(c);
    else byEngine.set(key, [c]);
  }

  // Largest groups first so they get their own worker.
  const groups = [...byEngine.entries()].sort(
    (a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]),
  );

  if (groups.length >= workers) {
    // More engines than workers: hand each worker the biggest remaining group,
    // then stream the leftovers into the currently lightest worker.
    const buckets: PlanCase[][] = Array.from({ length: workers }, () => []);
    const load: number[] = Array.from({ length: workers }, () => 0);
    const leftovers: PlanCase[] = [];

    groups.forEach(([, group], index) => {
      if (index < workers) {
        buckets[index].push(...group);
        load[index] += group.length;
      } else {
        leftovers.push(...group);
      }
    });
    for (const item of leftovers) {
      let target = 0;
      for (let i = 1; i < workers; i++) if (load[i] < load[target]) target = i;
      buckets[target].push(item);
      load[target] += 1;
    }
    return buckets;
  }

  // Fewer engines than workers: split the largest group so every worker gets work.
  const buckets: PlanCase[][] = Array.from({ length: workers }, () => []);
  let cursor = 0;
  for (const [, group] of groups) {
    // Chunk the group across as many remaining workers as it can fill.
    const perWorker = Math.max(1, Math.ceil(group.length / Math.max(1, workers - cursor)));
    for (let i = 0; i < group.length; i += perWorker) {
      if (cursor >= workers) {
        // No worker left: append to the lightest one instead of dropping cases.
        let target = 0;
        for (let k = 1; k < workers; k++) if (buckets[k].length < buckets[target].length) target = k;
        buckets[target].push(...group.slice(i));
        break;
      }
      buckets[cursor].push(...group.slice(i, i + perWorker));
      cursor++;
    }
  }
  return buckets;
}

/* ------------------------------------------------------------------ *
 * AI risk scoring (Lane D, dynamic + guarded)
 * ------------------------------------------------------------------ */

export interface RiskScore {
  id: string;
  score: number;
  factors: string[];
}

export interface RiskScoreResult {
  scores: Map<string, RiskScore>;
  ai_used: boolean;
  notes: string[];
}

interface AiGenerateLike {
  generate?: (task: string, input: Record<string, unknown>, ctx?: Record<string, unknown>) => Promise<unknown>;
}

type AiModule = { aiService?: AiGenerateLike };

/**
 * Asks Lane D (`predict_risk`) for per-case risk scores. The import is dynamic
 * and guarded; on any failure we fall back to the stored `risk_score` column so
 * `ai_optimized` still behaves like `risk_weighted` offline.
 */
export async function scoreCasesWithAi(cases: PlanCase[]): Promise<RiskScoreResult> {
  const notes: string[] = [];
  // `.catch(() => null)` keeps the awaited value typed as `AiModule | null`;
  // a mutable `let … = null` pre-initialised before the import narrows to
  // `never` in the catch path under `strict`.
  const aiModule = (await import('../ai/index.js').catch(() => null)) as AiModule | null;

  if (!aiModule) {
    notes.push(
      'Modul AI (lane D) tidak dapat dimuat sehingga skor risiko memakai kolom risk_score.',
    );
    return { scores: fallbackScores(cases), ai_used: false, notes };
  }

  const service = aiModule.aiService;
  const generate = service?.generate;
  if (typeof generate !== 'function') {
    notes.push('Modul AI tersedia tetapi tidak mengekspor aiService.generate(); skor risiko memakai kolom risk_score.');
    return { scores: fallbackScores(cases), ai_used: false, notes };
  }

  try {
    const result = (await generate.call(service, 'predict_risk', {
      test_cases: cases.map((c) => ({
        id: c.id,
        code: c.code,
        title: c.title,
        type: c.priority,
        layer: c.layer,
        priority: c.priority,
        tags: [],
      })),
      test_case_ids: cases.map((c) => c.id),
      context: 'Skoring risiko untuk penjadwalan worker pada agent pool regresi paralel.',
    })) as {
      ok?: boolean;
      data?: { items?: Array<{ test_case_id?: string; score?: number; factors?: string[] }> } | null;
      meta?: { used_mock?: boolean };
    };

    const items = result?.data?.items ?? [];
    if (!result?.ok || !items.length) {
      notes.push('AI tidak mengembalikan skor risiko yang dapat dipakai; kolom risk_score tetap menjadi acuan.');
      return { scores: fallbackScores(cases), ai_used: false, notes };
    }

    const scores = new Map<string, RiskScore>();
    for (const item of items) {
      const id = String(item.test_case_id ?? '');
      if (!id) continue;
      scores.set(id, {
        id,
        score: Math.max(0, Math.min(100, numberOr(item.score, 0))),
        factors: Array.isArray(item.factors) ? item.factors.map(String) : [],
      });
    }
    for (const c of cases) {
      if (!scores.has(c.id)) {
        scores.set(c.id, { id: c.id, score: c.risk_score, factors: ['fallback: kolom risk_score'] });
      }
    }

    // `used_mock: true` means the live model did NOT run — report that honestly.
    const usedMock = result?.meta?.used_mock === true;
    if (usedMock) {
      notes.push(
        'Skor risiko dihasilkan generator offline deterministik (tidak ada provider AI aktif); urutan tetap mengikuti risk_score.',
      );
      return { scores, ai_used: false, notes };
    }

    notes.push('Skor risiko berasal dari model AI aktif dan dipakai untuk urutan longest-processing-time.');
    return { scores, ai_used: true, notes };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    notes.push(`Panggilan predict_risk gagal (${reason.slice(0, 160)}); memakai kolom risk_score.`);
    return { scores: fallbackScores(cases), ai_used: false, notes };
  }
}

function fallbackScores(cases: PlanCase[]): Map<string, RiskScore> {
  return new Map(
    cases.map((c) => [c.id, { id: c.id, score: c.risk_score, factors: ['kolom risk_score pada test_cases'] }]),
  );
}

/* ------------------------------------------------------------------ *
 * Agent naming (Lane D, dynamic + guarded, deterministic offline)
 * ------------------------------------------------------------------ */

export interface AgentIdentity {
  name: string;
  role: string;
}

/** Deterministic callsign + specialist role, used offline and as the AI fallback. */
export function offlineIdentity(index: number, engineMix: Record<string, number>): AgentIdentity {
  const callsign = AGENT_CALLSIGNS[index % AGENT_CALLSIGNS.length] as string;
  const suffix = index >= AGENT_CALLSIGNS.length ? ` ${Math.floor(index / AGENT_CALLSIGNS.length) + 1}` : '';
  const dominant = dominantEngine(engineMix);
  const meta = SPECIALIST_BY_ENGINE[dominant] ?? SPECIALIST_BY_ENGINE.manual;
  return { name: `Agent ${callsign}${suffix}`, role: `${meta.label} Specialist` };
}

function dominantEngine(mix: Record<string, number>): string {
  let best = 'manual';
  let bestCount = -1;
  for (const [engine, count] of Object.entries(mix)) {
    if (count > bestCount || (count === bestCount && engine < best)) {
      best = engine;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Names every worker. With `spawn_ai_agents` on and a live model, Lane D's
 * `chat` task proposes the names; otherwise the deterministic callsigns are used
 * so the feature still produces sensible, stable identities with zero config.
 */
export async function nameAgents(
  packs: PlanCase[][],
  spawnAiAgents: boolean,
): Promise<{ identities: AgentIdentity[]; ai_used: boolean; notes: string[] }> {
  const mixes = packs.map(engineMixOf);
  const offline = mixes.map((mix, i) => offlineIdentity(i, mix));
  const notes: string[] = [];

  if (!spawnAiAgents) {
    notes.push('spawn_ai_agents nonaktif — nama agent dibuat deterministik dari komposisi engine shard.');
    return { identities: offline, ai_used: false, notes };
  }

  // Dynamic + guarded: an absent or mid-edit AI module must degrade, not throw.
  const aiModule = (await import('../ai/index.js').catch(() => null)) as AiModule | null;
  if (!aiModule) {
    notes.push('Modul AI tidak dapat dimuat; nama agent dibuat deterministik.');
    return { identities: offline, ai_used: false, notes };
  }

  const service = aiModule.aiService;
  const generate = service?.generate;
  if (typeof generate !== 'function') {
    notes.push('aiService.generate() tidak tersedia; nama agent dibuat deterministik.');
    return { identities: offline, ai_used: false, notes };
  }

  try {
    const result = (await generate.call(service, 'chat', {
      messages: [
        {
          role: 'system',
          content:
            'Anda koordinator QA. Balas JSON: {"agents":[{"name":"...","role":"..."}]} dengan satu entri per worker, ringkas, tanpa markdown.',
        },
        {
          role: 'user',
          content:
            `Beri nama dan peran singkat untuk ${packs.length} worker QA paralel. ` +
            `Komposisi engine tiap worker: ${JSON.stringify(
              mixes.map((m, i) => ({ index: i, cases: packs[i].length, engines: m })),
            )}.`,
        },
      ],
      context: 'Penamaan agent pool regresi paralel.',
    })) as {
      ok?: boolean;
      data?: { reply?: string } | null;
      meta?: { used_mock?: boolean };
    };

    if (result?.ok && result.meta?.used_mock !== true && typeof result.data?.reply === 'string') {
      const parsed = parseAgentNames(result.data.reply);
      if (parsed.length) {
        const identities = offline.map((fallback, i) => parsed[i] ?? fallback);
        notes.push('Nama dan peran agent dihasilkan oleh model AI aktif.');
        return { identities, ai_used: true, notes };
      }
    }

    notes.push(
      result?.meta?.used_mock === true
        ? 'Tidak ada provider AI aktif — nama agent dihasilkan deterministik dari komposisi engine shard.'
        : 'Balasan AI tidak memuat daftar agent yang valid; dipakai nama deterministik.',
    );
    return { identities: offline, ai_used: false, notes };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    notes.push(`Panggilan AI untuk penamaan agent gagal (${reason.slice(0, 120)}); dipakai nama deterministik.`);
    return { identities: offline, ai_used: false, notes };
  }
}

function engineMixOf(cases: PlanCase[]): Record<string, number> {
  const mix: Record<string, number> = {};
  for (const c of cases) {
    const key = c.engine || 'manual';
    mix[key] = (mix[key] ?? 0) + 1;
  }
  return mix;
}

/** Tolerant JSON extraction from a model reply that may be wrapped in prose. */
function parseAgentNames(reply: string): AgentIdentity[] {
  const candidates: string[] = [reply];
  const fenced = reply.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) candidates.push(fenced[1]);
  const braced = reply.match(/\{[\s\S]*\}/);
  if (braced?.[0]) candidates.push(braced[0]);
  const arrayed = reply.match(/\[[\s\S]*\]/);
  if (arrayed?.[0]) candidates.push(arrayed[0]);

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      const list = Array.isArray(parsed)
        ? parsed
        : Array.isArray((parsed as { agents?: unknown })?.agents)
          ? ((parsed as { agents: unknown[] }).agents as unknown[])
          : [];
      const out: AgentIdentity[] = [];
      for (const item of list) {
        if (!item || typeof item !== 'object') continue;
        const name = String((item as { name?: unknown }).name ?? '').trim();
        const role = String((item as { role?: unknown }).role ?? '').trim();
        if (name) out.push({ name, role: role || 'QA Automation Agent' });
      }
      if (out.length) return out;
    } catch {
      /* try the next candidate */
    }
  }
  return [];
}

/* ------------------------------------------------------------------ *
 * plan()
 * ------------------------------------------------------------------ */

/**
 * Builds the shard plan. Returns shards in worker order; the union of
 * `test_case_ids` across shards equals the deduped input exactly once.
 */
export async function plan(
  projectId: string,
  testCaseIds: string[],
  config: AgentPoolConfig,
): Promise<{ shards: PlanShard[]; ai_used: boolean; notes: string[]; total_cases: number }> {
  const strategy = normaliseStrategy(config?.strategy);
  const cases = loadCases(projectId, testCaseIds);
  // Never schedule more workers than there is work for: an empty shard is noise.
  const workers = Math.max(1, Math.min(clampWorkers(config?.workers), Math.max(1, cases.length)));

  const notes: string[] = [];
  let scores = new Map<string, RiskScore>();
  let aiUsed = false;

  let packs: PlanCase[][];
  switch (strategy) {
    case 'round_robin':
      packs = roundRobinPack(cases, workers);
      notes.push(
        `Round robin: kasus ke-i dikirim ke worker ke-(i mod ${workers}). Sederhana dan adil untuk kasus yang setara, ` +
          'tetapi tidak memperhitungkan durasi maupun risiko sehingga satu worker bisa jauh lebih lambat.',
      );
      break;

    case 'duration_balanced':
      packs = lptPack(cases, workers, (c) => caseEstimateMs(c));
      notes.push(
        `Seimbang durasi: longest-processing-time (LPT) pada estimated_minutes + ${PER_CASE_OVERHEAD_MS} ms overhead per kasus. ` +
          'Kasus terberat dijadwalkan lebih dulu ke worker paling ringan sehingga makespan mendekati batas bawah.',
      );
      break;

    case 'same_engine':
      packs = sameEnginePack(cases, workers);
      notes.push(
        'Kelompok per engine: setiap worker sebisa mungkin hanya menangani satu engine, sehingga biaya inisialisasi ' +
          'engine (sesi HTTP, koneksi DB, konteks AI) tidak dibayar berulang kali di worker yang sama.',
      );
      break;

    case 'ai_optimized': {
      const scored = await scoreCasesWithAi(cases);
      scores = scored.scores;
      aiUsed = scored.ai_used;
      notes.push(...scored.notes);
      packs = lptPack(cases, workers, (c) => {
        const score = scores.get(c.id)?.score ?? c.risk_score;
        // Risk score is a 0..100 proxy for "how much attention this case needs";
        // fold the measured estimate in so heavy cases are not starved.
        return score * 1000 + caseEstimateMs(c) / 100;
      });
      notes.push(
        aiUsed
          ? 'Dioptimalkan AI: skor risiko dari model AI dipakai sebagai bobot LPT, digabung dengan estimasi durasi.'
          : 'Dioptimalkan AI: tanpa provider aktif, bobot LPT memakai kolom risk_score (setara risk_weighted) — dilaporkan jujur, bukan diklaim sebagai AI.',
      );
      break;
    }

    case 'risk_weighted':
    default:
      packs = lptPack(cases, workers, (c) => c.risk_score);
      notes.push(
        'Berbasis risiko: kasus dengan risk_score tertinggi dijadwalkan paling awal lewat greedy LPT, ' +
          'sehingga pekerjaan paling berisiko mulai berjalan lebih dulu dan hasilnya lebih cepat diketahui.',
      );
      break;
  }

  const { identities, ai_used: namingAi, notes: namingNotes } = await nameAgents(packs, config?.spawn_ai_agents !== false);
  notes.push(...namingNotes);
  aiUsed = aiUsed || namingAi;

  const shards: PlanShard[] = packs.map((pack, index) => {
    const estimate = shardEstimateMs(pack);
    const mix = engineMixOf(pack);
    return {
      worker_id: `w${index + 1}`,
      index,
      agent_name: identities[index]?.name ?? `Agent ${index + 1}`,
      agent_role: identities[index]?.role ?? 'QA Automation Agent',
      test_case_ids: pack.map((c) => c.id),
      estimated_ms: estimate,
      estimated_minutes: Math.round((estimate / 60_000) * 10) / 10,
      status: 'pending',
      started_at: null,
      finished_at: null,
      passed: 0,
      failed: 0,
      blocked: 0,
      retried: 0,
      healed: 0,
      notes: buildShardNotes(strategy, pack, estimate, mix),
      allocation_reason: buildAllocationReason(strategy, pack, estimate),
    };
  });

  return { shards, ai_used: aiUsed, notes, total_cases: cases.length };
}

function buildShardNotes(
  strategy: WorkerStrategy,
  pack: PlanCase[],
  estimate: number,
  mix: Record<string, number>,
): string[] {
  const engines = Object.entries(mix)
    .map(([engine, count]) => `${engine}:${count}`)
    .join(', ');
  return [
    `${pack.length} test case · komposisi engine ${engines || '—'} · estimasi ${Math.round(estimate / 1000)} s`,
    `Strategi ${strategy}.`,
  ];
}

function buildAllocationReason(strategy: WorkerStrategy, pack: PlanCase[], estimate: number): string {
  if (!pack.length) return `Tidak ada kasus dialokasikan ke shard ini (strategi ${strategy}).`;
  const engines = [...new Set(pack.map((c) => c.engine))].join('/');
  return (
    `Menerima ${pack.length} kasus (${engines || 'engine tidak diketahui'}) dengan total estimasi ` +
    `${Math.round(estimate / 1000)} s melalui strategi ${strategy}.`
  );
}

/* ------------------------------------------------------------------ *
 * planSummary() — used by the dry-run route
 * ------------------------------------------------------------------ */

export async function planSummary(
  projectId: string,
  testCaseIds: string[],
  config: AgentPoolConfig,
): Promise<PlanSummary> {
  const { shards, ai_used, notes, total_cases } = await plan(projectId, testCaseIds, config);
  const estimates = shards.map((s) => s.estimated_ms);
  const makespan = estimates.length ? Math.max(...estimates) : 0;
  const sequential = estimates.reduce((sum, n) => sum + n, 0);
  const average = estimates.length ? sequential / estimates.length : 0;

  return {
    project_id: projectId,
    strategy: normaliseStrategy(config?.strategy),
    workers: shards.length,
    total_cases,
    shards,
    estimates: {
      makespan_ms: makespan,
      sequential_ms: sequential,
      theoretical_speedup: makespan > 0 ? round2(sequential / makespan) : 0,
      average_shard_ms: Math.round(average),
      // 1.0 = perfectly balanced; higher = more skew between workers.
      balance_ratio: average > 0 ? round2(makespan / average) : 0,
    },
    ai_used: ai_used,
    notes,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/* ------------------------------------------------------------------ *
 * Dry-run helper used by the pool (keeps the planner the only sharding code)
 * ------------------------------------------------------------------ */

/** The set of ids covered by a shard list — the union invariant, exposed for tests. */
export function coverageOf(shards: Array<{ test_case_ids: string[] }>): string[] {
  return shards.flatMap((s) => s.test_case_ids);
}

export { nowIso };
