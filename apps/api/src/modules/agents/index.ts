/**
 * agents — multi-worker AI QA agent pool (Lane G).
 *
 * Registered by the Lead in `server.ts` with prefix `/api`, so every path here
 * is declared WITHOUT the `/api` prefix.
 *
 * Exports the frozen cross-lane surface from ARCHITECTURE.md §11.2:
 *   agentPoolService.run(projectId, testCaseIds, config): Promise<AgentPoolResult>
 * plus `plan`, `heal`, `history`, `getRun` and `capabilities`.
 *
 * Routes (ARCHITECTURE.md §11.5):
 *   GET  /agents/capabilities
 *   POST /projects/:projectId/agents/plan
 *   POST /projects/:projectId/agents/run
 *   GET  /projects/:projectId/agents/runs
 *   GET  /agents/runs/:id
 *   POST /agents/heal
 *
 * Cross-lane calls (Lane C `execute`, Lane D `ai`) are ALWAYS dynamic and inside
 * the handler, wrapped in try/catch, so a module that is mid-edit cannot break
 * the API boot.
 */

import type { FastifyInstance } from 'fastify';
import {
  DEFAULT_POOL_CONFIG,
  WORKER_STRATEGIES,
  WORKER_STRATEGY_LABEL,
  type AgentPoolConfig,
  type AgentPoolResult,
  type HealRequest,
  type HealResult,
  type PoolRunMeta,
  type WorkerStrategy,
} from '@qatools/shared';
import { badRequest, fail, list, notFound, one } from '../../lib/http.js';
import { db } from '../../db/index.js';
import {
  MAX_WORKERS,
  PER_CASE_OVERHEAD_MS,
  clampWorkers,
  loadCases,
  normaliseStrategy,
  plan,
  planSummary,
  type PlanSummary,
} from './planner.js';
import {
  getRun as getPoolRunRow,
  listRuns,
  normaliseConfig,
  rehydrateRun,
  run as runPool,
  setCaseRunner,
} from './pool.js';
import { heal } from './healing.js';

/* ------------------------------------------------------------------ *
 * One-line explanations surfaced in the UI (Bahasa Indonesia)
 * ------------------------------------------------------------------ */

export const STRATEGY_DESCRIPTION: Record<WorkerStrategy, string> = {
  round_robin:
    'Membagi test case bergiliran (kasus ke-i ke worker ke-i mod N). Adil dan mudah diprediksi, tetapi tidak memperhitungkan durasi atau risiko.',
  risk_weighted:
    'Mengurutkan kasus paling berisiko lebih dulu lalu membaginya dengan greedy LPT, sehingga pekerjaan berisiko tinggi selesai lebih awal.',
  duration_balanced:
    'Greedy longest-processing-time pada estimated_minutes; meminimalkan makespan sehingga tidak ada worker yang menanggung beban jauh lebih berat.',
  same_engine:
    'Mengelompokkan kasus per engine (web/api/db/ai) agar setiap worker memakai satu engine dan biaya inisialisasi tidak dibayar berulang.',
  ai_optimized:
    'Meminta AI (predict_risk) menilai risiko setiap kasus lalu memakai skor itu sebagai bobot penjadwalan; tanpa API key otomatis turun ke risk_weighted.',
};

export interface AgentCapabilities {
  strategies: Array<{ id: WorkerStrategy; label: string; description: string }>;
  defaults: AgentPoolConfig;
  max_workers: number;
  /** Fixed per-case overhead used by the estimator. */
  per_case_overhead_ms: number;
  ai: {
    configured: boolean;
    provider: string;
    model: string;
    mode: string;
    message: string;
  };
  /** Honest statement of what the pool does and does not do offline. */
  offline_capable: boolean;
  executor: {
    /** `lane-c` when executeService.runCase is importable, `unavailable` otherwise. */
    source: 'lane-c' | 'unavailable';
    mode: string;
    reason: string;
  };
  probe: {
    /** Whether ANY test case exists for the given project_id. */
    project_id: string | null;
    test_cases: number;
  };
  notes: string[];
}

/* ------------------------------------------------------------------ *
 * Capabilities
 * ------------------------------------------------------------------ */

/**
 * Probes Lane C's execute module dynamically. Never throws: an absent module is
 * reported as `unavailable` so `/agents/capabilities` always answers.
 */
async function probeExecutor(): Promise<{
  source: 'lane-c' | 'unavailable';
  mode: string;
  reason: string;
}> {
  // `.catch(() => null)` keeps the awaited value typed as the module shape;
  // a mutable `let … = null` assigned inside try/catch narrows to `never`.
  const mod = (await import('../execute/index.js').catch(() => null)) as {
    executeService?: { runCase?: unknown };
  } | null;

  if (!mod) {
    return {
      source: 'unavailable',
      mode: 'none',
      reason:
        'Modul eksekusi (lane C) belum dapat dimuat, sehingga agent pool belum bisa menjalankan test case. ' +
        'Endpoint lain tetap berfungsi: perencanaan shard dan penyembuhan selector tidak butuh lane C.',
    };
  }

  if (typeof mod.executeService?.runCase === 'function') {
    return {
      source: 'lane-c',
      mode: 'executeService.runCase (in-process)',
      reason:
        'Kasus dijalankan lewat lane C sehingga hanya satu penulis yang menyentuh test_runs/run_results. ' +
        'Engine manual/api/db/web/ai semuanya mengalir melalui jalur ini.',
    };
  }

  return {
    source: 'unavailable',
    mode: 'none',
    reason: 'Modul execute ada tetapi tidak mengekspor executeService.runCase().',
  };
}

/** Reads Lane D's AI status; a missing module degrades to "offline". */
async function probeAi(): Promise<AgentCapabilities['ai']> {
  try {
    const specifier = '../ai/index.js';
    const mod = (await import(/* @vite-ignore */ specifier)) as {
      aiService?: { status?: () => Promise<{ configured?: boolean; provider?: string; model?: string; mode?: string; message?: string }> };
    };
    const status = await mod?.aiService?.status?.();
    if (status) {
      return {
        configured: Boolean(status.configured),
        provider: status.provider ?? 'mock',
        model: status.model ?? 'qatools-mock-1',
        mode: status.mode ?? 'mock',
        message: status.message ?? 'Status AI tidak memberikan pesan.',
      };
    }
  } catch {
    /* fall through to the offline description below */
  }
  return {
    configured: false,
    provider: 'unavailable',
    model: '—',
    mode: 'mock',
    message:
      'Modul AI (lane D) tidak tersedia. Seluruh jalur AI (penamaan agent, penyembuhan selector, triase, ringkasan) ' +
      'memakai generator offline deterministik dan ai_used dilaporkan false.',
  };
}

function countCases(projectId: string | null): number {
  if (!projectId) return 0;
  try {
    const row = db.prepare('SELECT COUNT(*) AS n FROM test_cases WHERE project_id = ?').get(projectId) as
      | { n?: number }
      | undefined;
    return Number(row?.n ?? 0);
  } catch {
    return 0;
  }
}

export async function capabilities(projectId?: string | null): Promise<AgentCapabilities> {
  const [ai, executor] = await Promise.all([probeAi(), probeExecutor()]);

  const notes: string[] = [
    'Paralelisme nyata: shard dijalankan lewat concurrency limiter buatan sendiri (tanpa dependensi p-limit).',
    'Kecepatan dilaporkan apa adanya: speedup = total durasi kasus berurutan ÷ wall-clock pool.',
  ];
  if (!ai.configured) {
    notes.push(
      'Tanpa API key: penamaan agent deterministik, penyembuhan selector memindai DOM asli, triase memakai aturan kata kunci, ' +
        'dan ringkasan dibuat deterministik. ai_used akan bernilai false.',
    );
  }
  if (executor.source === 'unavailable') notes.push(executor.reason);

  return {
    strategies: WORKER_STRATEGIES.map((id) => ({
      id,
      label: WORKER_STRATEGY_LABEL[id],
      description: STRATEGY_DESCRIPTION[id],
    })),
    defaults: { ...DEFAULT_POOL_CONFIG },
    max_workers: MAX_WORKERS,
    per_case_overhead_ms: PER_CASE_OVERHEAD_MS,
    ai,
    offline_capable: true,
    executor: {
      source: executor.source,
      mode: executor.mode,
      reason: executor.reason,
    },
    probe: {
      project_id: projectId ?? null,
      test_cases: countCases(projectId ?? null),
    },
    notes,
  };
}

/* ------------------------------------------------------------------ *
 * agentPoolService — the frozen cross-lane surface
 * ------------------------------------------------------------------ */

export const agentPoolService = {
  /** Executes a regression suite across N parallel AI QA agents. */
  run(projectId: string, testCaseIds: string[], config: Partial<AgentPoolConfig> = {}): Promise<AgentPoolResult> {
    return runPool(projectId, testCaseIds, config);
  },

  /** Dry run: shard allocation + load estimates, no execution. */
  plan(projectId: string, testCaseIds: string[], config: Partial<AgentPoolConfig> = {}): Promise<PlanSummary> {
    return planSummary(projectId, testCaseIds, normaliseConfig(config));
  },

  /** Selector healing (used by the UI playground and the pool's ai_healing path). */
  heal(req: HealRequest): Promise<HealResult> {
    return heal(req);
  },

  /** Run history for one project. */
  history(projectId: string, limit = 50): PoolRunMeta[] {
    return listRuns(projectId, limit).map((row) => ({
      id: row.id,
      project_id: row.project_id,
      run_id: row.run_id ?? '',
      name: row.name,
      workers: Number(row.workers ?? 0),
      strategy: normaliseStrategy(row.strategy),
      status: (['running', 'completed', 'aborted'].includes(row.status) ? row.status : 'completed') as PoolRunMeta['status'],
      total: Number(row.total ?? 0),
      passed: Number(row.passed ?? 0),
      failed: Number(row.failed ?? 0),
      flaky: Number(row.flaky ?? 0),
      speedup: Number(row.speedup ?? 0),
      duration_ms: Number(row.duration_ms ?? 0),
      ai_used: Number(row.ai_used ?? 0),
      created_at: row.created_at,
    }));
  },

  /** Rehydrates a stored run into a full `AgentPoolResult`. */
  getRun(id: string): AgentPoolResult | null {
    const row = getPoolRunRow(id);
    return row ? rehydrateRun(row as unknown as Record<string, unknown>) : null;
  },

  capabilities,

  /** The strategies with their labels/descriptions (for pickers). */
  strategies(): AgentCapabilities['strategies'] {
    return WORKER_STRATEGIES.map((id) => ({
      id,
      label: WORKER_STRATEGY_LABEL[id],
      description: STRATEGY_DESCRIPTION[id],
    }));
  },

  /** Test seam re-exported so tests can prove parallelism with a stub runner. */
  setCaseRunner,
  loadCases,
  clampWorkers,
};

export { plan, planSummary, heal, setCaseRunner, MAX_WORKERS };

/* ------------------------------------------------------------------ *
 * Request parsing helpers
 * ------------------------------------------------------------------ */

function parseIds(input: unknown): string[] {
  if (Array.isArray(input)) return input.filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
  if (typeof input === 'string' && input.trim()) {
    try {
      const parsed = JSON.parse(input) as unknown;
      if (Array.isArray(parsed)) return parsed.filter((v): v is string => typeof v === 'string');
    } catch {
      return input.split(',').map((s) => s.trim()).filter(Boolean);
    }
  }
  return [];
}

/** Accepts either a nested `config` object or flat fields on the body. */
function parseConfig(body: Record<string, unknown>): Partial<AgentPoolConfig> {
  const nested = (typeof body.config === 'object' && body.config !== null ? body.config : {}) as Record<string, unknown>;
  const merged: Record<string, unknown> = { ...body, ...nested };
  const out: Partial<AgentPoolConfig> = {};

  if (merged.workers !== undefined) out.workers = clampWorkers(merged.workers);
  if (merged.strategy !== undefined) out.strategy = normaliseStrategy(merged.strategy);
  if (merged.case_timeout_ms !== undefined) out.case_timeout_ms = Number(merged.case_timeout_ms);
  if (merged.timeout_ms !== undefined) out.case_timeout_ms = Number(merged.timeout_ms);
  if (merged.max_retries !== undefined) out.max_retries = Number(merged.max_retries);
  for (const key of ['retry_failed_only', 'ai_healing', 'ai_triage', 'spawn_ai_agents'] as const) {
    if (merged[key] !== undefined) out[key] = Boolean(merged[key]);
  }
  if (merged.abort_after_failures !== undefined) out.abort_after_failures = Number(merged.abort_after_failures);
  return out;
}

/* ------------------------------------------------------------------ *
 * Fastify plugin
 * ------------------------------------------------------------------ */

export default async function routes(app: FastifyInstance): Promise<void> {
  /* --------------------------- capabilities --------------------------- */

  app.get('/agents/capabilities', async (req) => {
    const query = (req.query ?? {}) as Record<string, unknown>;
    const projectId = typeof query.project_id === 'string' && query.project_id ? query.project_id : null;
    return one(await capabilities(projectId));
  });

  /* ------------------------------- plan ------------------------------- */

  app.post<{ Params: { projectId: string } }>('/projects/:projectId/agents/plan', async (req, reply) => {
    const projectId = req.params?.projectId;
    if (!projectId) return badRequest(reply, 'projectId wajib diisi pada path.');
    const body = (req.body ?? {}) as Record<string, unknown>;
    const config = normaliseConfig(parseConfig(body));

    // `test_case_ids` empty = every case in the project (the dry-run default).
    const ids = parseIds(body.test_case_ids);
    if (!ids.length && !loadCases(projectId).length) {
      return badRequest(
        reply,
        'Tidak ada test case untuk direncanakan. Pilih minimal satu test case, atau buat test case pada project ini terlebih dahulu.',
      );
    }

    try {
      const summary = await planSummary(projectId, ids, config);
      return one({
        shards: summary.shards,
        estimates: summary.estimates,
        strategy: summary.strategy,
        workers: summary.workers,
        total_cases: summary.total_cases,
        ai_used: summary.ai_used,
        notes: summary.notes,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return fail(reply, 500, 'plan_failed', `Perencanaan shard gagal: ${message}`);
    }
  });

  /* -------------------------------- run ------------------------------- */

  app.post<{ Params: { projectId: string } }>('/projects/:projectId/agents/run', async (req, reply) => {
    const projectId = req.params?.projectId;
    if (!projectId) return badRequest(reply, 'projectId wajib diisi pada path.');
    const body = (req.body ?? {}) as Record<string, unknown>;

    const ids = parseIds(body.test_case_ids);
    const config = normaliseConfig(parseConfig(body));

    // Resolution order: explicit ids → every case in the project.
    const resolvedIds = ids.length ? ids : loadCases(projectId).map((c) => c.id);
    if (!resolvedIds.length) {
      return badRequest(
        reply,
        'Tidak ada test case untuk dijalankan. Kirim field "test_case_ids" atau buat test case pada project ini.',
      );
    }

    try {
      const result = await agentPoolService.run(projectId, resolvedIds, config);
      return one(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return fail(reply, 500, 'pool_failed', `Eksekusi agent pool gagal: ${message}`);
    }
  });

  /* ------------------------------ history ----------------------------- */

  app.get<{ Params: { projectId: string } }>('/projects/:projectId/agents/runs', async (req) => {
    const projectId = req.params?.projectId;
    const query = (req.query ?? {}) as Record<string, unknown>;
    const limit = Math.min(500, Math.max(1, Number(query.limit ?? 50) || 50));
    if (!projectId) return list<PoolRunMeta>([], 0);
    const rows = agentPoolService.history(projectId, limit);
    return list(rows, rows.length);
  });

  app.get<{ Params: { id: string } }>('/agents/runs/:id', async (req, reply) => {
    const result = agentPoolService.getRun(req.params.id);
    if (!result) return notFound(reply, 'Riwayat agent pool');
    return one(result);
  });

  /* ------------------------------- healing ---------------------------- */

  app.post('/agents/heal', async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const selector = typeof body.selector === 'string' ? body.selector.trim() : '';
    if (!selector) {
      return badRequest(reply, 'Field "selector" wajib diisi.', {
        example: { selector: '#login-btn', action: 'click', html: '<button data-testid="btn-login">Masuk</button>' },
      });
    }

    try {
      return one(
        await heal({
          selector,
          action: typeof body.action === 'string' && body.action ? body.action : 'click',
          html: typeof body.html === 'string' ? body.html : undefined,
          url: typeof body.url === 'string' ? body.url : undefined,
          intent: typeof body.intent === 'string' ? body.intent : undefined,
        }),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return fail(reply, 500, 'heal_failed', `Penyembuhan selector gagal: ${message}`);
    }
  });
}
