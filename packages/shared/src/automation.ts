/**
 * Automation code generation + multi-worker AI agent pool.
 * FROZEN (lead-owned) — part of the v1.2 contract.
 *
 * Two related capabilities:
 *  1. CODEGEN: turn QATools artifacts (test cases, web flows, API requests, DB checks)
 *     into real, runnable projects for established frameworks — Playwright,
 *     Robot Framework, pytest, Cypress, Selenium/TestNG, k6, Postman/Newman.
 *  2. AGENT POOL: execute a regression suite across N parallel workers, optionally
 *     driven by AI agents that can heal selectors and triage failures.
 */

import type { ExecEngine, RunStatus, Severity } from './domain.js';
import type { Assertion, WebStep } from './entities.js';

/* ------------------------------------------------------------------ *
 * 1. Code generation
 * ------------------------------------------------------------------ */

/** Every framework QATools can emit a runnable project for. FROZEN. */
export const CODEGEN_FRAMEWORKS = [
  'playwright',
  'robotframework',
  'pytest',
  'cypress',
  'selenium-java',
  'k6',
  'postman',
  'rest-assured',
] as const;
export type CodegenFramework = (typeof CODEGEN_FRAMEWORKS)[number];

export const CODEGEN_LANGUAGES = ['typescript', 'javascript', 'python', 'java', 'robot', 'json', 'yaml', 'kotlin'] as const;
export type CodegenLanguage = (typeof CODEGEN_LANGUAGES)[number];

export interface FrameworkMeta {
  id: CodegenFramework;
  label: string;
  language: CodegenLanguage;
  /** Which QATools artifacts this framework can be generated from. */
  supports: Array<'web' | 'api' | 'db' | 'performance'>;
  /** Runner command a user executes after downloading the project. */
  runCommand: string;
  /** Install command for the generated project. */
  installCommand: string;
  /** True when the tool requires the user to install something QATools does not bundle. */
  requiresUserInstall: boolean;
  docsUrl: string;
  notes: string;
}

export const FRAMEWORK_META: readonly FrameworkMeta[] = [
  {
    id: 'playwright',
    label: 'Playwright (TypeScript)',
    language: 'typescript',
    supports: ['web', 'api'],
    runCommand: 'npx playwright test',
    installCommand: 'npm install && npx playwright install',
    requiresUserInstall: true,
    docsUrl: 'https://playwright.dev',
    notes:
      'Standard industri untuk web automation. QATools menghasilkan page object + spec + fixtures + config.',
  },
  {
    id: 'robotframework',
    label: 'Robot Framework',
    language: 'robot',
    supports: ['web', 'api'],
    runCommand: 'robot --outputdir results tests/',
    installCommand: 'pip install -r requirements.txt && rfbrowser init',
    requiresUserInstall: true,
    docsUrl: 'https://robotframework.org',
    notes:
      'Keyword-driven, populer di enterprise & tim non-programmer. Memakai Browser (Playwright) atau RequestsLibrary.',
  },
  {
    id: 'pytest',
    label: 'pytest (Python + requests)',
    language: 'python',
    supports: ['api', 'db'],
    runCommand: 'pytest -v --html=report.html',
    installCommand: 'pip install -r requirements.txt',
    requiresUserInstall: true,
    docsUrl: 'https://docs.pytest.org',
    notes: 'Pilihan ringan untuk API & database testing, terintegrasi baik dengan CI.',
  },
  {
    id: 'cypress',
    label: 'Cypress',
    language: 'javascript',
    supports: ['web'],
    runCommand: 'npx cypress run',
    installCommand: 'npm install',
    requiresUserInstall: true,
    docsUrl: 'https://docs.cypress.io',
    notes: 'Pengalaman developer terbaik untuk web; berjalan di dalam browser.',
  },
  {
    id: 'selenium-java',
    label: 'Selenium + TestNG (Java)',
    language: 'java',
    supports: ['web'],
    runCommand: 'mvn test',
    installCommand: 'mvn -q dependency:resolve',
    requiresUserInstall: true,
    docsUrl: 'https://www.selenium.dev',
    notes: 'Untuk tim Java enterprise; menghasilkan struktur Page Object Model + testng.xml paralel.',
  },
  {
    id: 'k6',
    label: 'k6 (performance)',
    language: 'javascript',
    supports: ['api', 'performance'],
    runCommand: 'k6 run script.js',
    installCommand: 'winget install k6   # atau: choco install k6',
    requiresUserInstall: true,
    docsUrl: 'https://k6.io/docs',
    notes: 'Mengubah test case API menjadi skenario beban dengan stages & thresholds.',
  },
  {
    id: 'postman',
    label: 'Postman Collection + Newman',
    language: 'json',
    supports: ['api'],
    runCommand: 'newman run collection.json -e environment.json',
    installCommand: 'npm install -g newman',
    requiresUserInstall: true,
    docsUrl: 'https://learning.postman.com/docs/collections/using-newman-cli/',
    notes: 'Format paling portabel untuk dibagikan ke tim non-QA; bisa diimpor ke Postman GUI.',
  },
  {
    id: 'rest-assured',
    label: 'REST Assured (Java)',
    language: 'java',
    supports: ['api'],
    runCommand: 'mvn test',
    installCommand: 'mvn -q dependency:resolve',
    requiresUserInstall: true,
    docsUrl: 'https://rest-assured.io',
    notes: 'Untuk API testing di ekosistem Java/JUnit.',
  },
] as const;

export function frameworkMeta(id: CodegenFramework): FrameworkMeta {
  return FRAMEWORK_META.find((f) => f.id === id) as FrameworkMeta;
}

/** A single generated file inside a generated project. */
export interface GeneratedFile {
  path: string;
  language: CodegenLanguage;
  content: string;
  /** Rough size, so the UI can show "12 files · 340 lines". */
  lines: number;
  /** Why this file exists (shown in the UI). */
  purpose: string;
}

export interface GeneratedProject {
  id: string | null;
  project_id: string;
  framework: CodegenFramework;
  language: CodegenLanguage;
  name: string;
  files: GeneratedFile[];
  /** Flat README content for the generated project. */
  readme: string;
  /** Human-readable summary of what was generated and from which artifacts. */
  summary: {
    test_cases: number;
    web_flows: number;
    api_requests: number;
    db_checks: number;
    total_files: number;
    total_lines: number;
  };
  /** Honest list of anything that could not be generated, with the reason. */
  warnings: string[];
  generated_by: 'ai' | 'template';
  created_at: string;
}

export interface CodegenRequest {
  framework: CodegenFramework;
  /** Which test cases to generate for. Empty = all automatable cases in the project. */
  test_case_ids?: string[];
  /** Include only these layers, e.g. ['web','api']. Empty = all supported. */
  layers?: string[];
  base_url?: string;
  /** Emit a parallel-execution config (sharding / workers). */
  parallel?: boolean;
  workers?: number;
  /** Ask the AI layer to enrich the output (comments, better names). */
  use_ai?: boolean;
  /** Persist the generated project so it can be re-downloaded. */
  persist?: boolean;
}

/* ------------------------------------------------------------------ *
 * 2. Multi-worker AI agent pool
 * ------------------------------------------------------------------ */

export const WORKER_STRATEGIES = [
  'round_robin',
  'risk_weighted',
  'duration_balanced',
  'same_engine',
  'ai_optimized',
] as const;
export type WorkerStrategy = (typeof WORKER_STRATEGIES)[number];

export const WORKER_STRATEGY_LABEL: Record<WorkerStrategy, string> = {
  round_robin: 'Round Robin',
  risk_weighted: 'Berbasis Risiko',
  duration_balanced: 'Seimbang Durasi',
  same_engine: 'Kelompok per Engine',
  ai_optimized: 'Dioptimalkan AI',
};

export interface AgentPoolConfig {
  /** Number of parallel workers (agents). 1 = sequential. */
  workers: number;
  strategy: WorkerStrategy;
  /** Per-case timeout applied by each worker. */
  case_timeout_ms: number;
  /** Max attempts per case (1 = no retry). Retries are how flaky cases are detected. */
  max_retries: number;
  /** Retry only cases that failed — used to separate real failures from flakiness. */
  retry_failed_only: boolean;
  /** Let AI workers heal broken selectors / propose fixes when a step fails. */
  ai_healing: boolean;
  /** Let AI triage each failure into severity/root cause after the run. */
  ai_triage: boolean;
  /** Stop the whole pool after this many consecutive worker-level failures (0 = never). */
  abort_after_failures: number;
  /** Attach an AI agent to each worker (names the worker, summarises its shard). */
  spawn_ai_agents: boolean;
}

export const DEFAULT_POOL_CONFIG: AgentPoolConfig = {
  workers: 4,
  strategy: 'risk_weighted',
  case_timeout_ms: 120_000,
  max_retries: 1,
  retry_failed_only: true,
  ai_healing: true,
  ai_triage: true,
  abort_after_failures: 0,
  spawn_ai_agents: true,
};

export interface PoolShard {
  worker_id: string;
  /** 0-based index of the worker in the pool. */
  index: number;
  /** AI-generated name/role for this worker when spawn_ai_agents is on. */
  agent_name: string;
  agent_role: string;
  test_case_ids: string[];
  estimated_ms: number;
  status: 'pending' | 'running' | 'done' | 'failed' | 'aborted';
  started_at: string | null;
  finished_at: string | null;
  passed: number;
  failed: number;
  blocked: number;
  /** Cases this worker retried, and whether the retry changed the verdict (flaky signal). */
  retried: number;
  healed: number;
  notes: string[];
}

export interface PoolCaseOutcome {
  test_case_id: string;
  code: string;
  title: string;
  engine: ExecEngine;
  final_status: RunStatus;
  initial_status: RunStatus;
  attempts: number;
  duration_ms: number;
  worker_id: string;
  /** True when the first attempt failed but a retry passed — a flaky case. */
  flaky: boolean;
  error: string | null;
  /** Populated when ai_healing proposed a fix. */
  healing: {
    applied: boolean;
    original_selector?: string;
    healed_selector?: string;
    rationale?: string;
  } | null;
  /** Populated when ai_triage ran on a failure. */
  triage: {
    severity: Severity;
    likely_root_cause: string;
    suggested_owner_role: string;
    rationale: string;
  } | null;
}

export interface AgentPoolResult {
  run_id: string;
  project_id: string;
  config: AgentPoolConfig;
  summary: {
    total: number;
    passed: number;
    failed: number;
    blocked: number;
    skipped: number;
    flaky: number;
    healed: number;
    retried: number;
    /** Wall-clock duration of the whole pool. */
    duration_ms: number;
    /** Sum of all case durations — how long it would have taken sequentially. */
    sequential_duration_ms: number;
    /** sequential / wall-clock. >1 means parallelism helped. */
    speedup: number;
    workers_used: number;
  };
  shards: PoolShard[];
  outcomes: PoolCaseOutcome[];
  /** AI-written narrative summary of the whole regression run. */
  ai_summary: string | null;
  ai_used: boolean;
  created_at: string;
}

/* ------------------------------------------------------------------ *
 * 3. Selector healing (used by ai_healing)
 * ------------------------------------------------------------------ */

export interface HealRequest {
  /** The selector that failed. */
  selector: string;
  /** The step action that failed. */
  action: string;
  /** Raw HTML of the page at the time of failure (or a fragment). */
  html?: string;
  url?: string;
  /** Optional description of what the element should be. */
  intent?: string;
}

export interface HealResult {
  healed: boolean;
  selector: string | null;
  candidates: Array<{ selector: string; score: number; reason: string }>;
  rationale: string;
  used_mock: boolean;
}

export interface GeneratedProjectMeta {
  id: string;
  project_id: string;
  framework: CodegenFramework;
  name: string;
  file_count: number;
  total_lines: number;
  summary: string | null;
  generated_by: string;
  created_at: string;
}

export interface PoolRunMeta {
  id: string;
  project_id: string;
  run_id: string;
  name: string;
  workers: number;
  strategy: WorkerStrategy;
  status: 'running' | 'completed' | 'aborted';
  total: number;
  passed: number;
  failed: number;
  flaky: number;
  speedup: number;
  duration_ms: number;
  ai_used: number;
  created_at: string;
}

/** Re-exported for convenience by consumers of the codegen API. */
export type { Assertion, WebStep, Severity };
