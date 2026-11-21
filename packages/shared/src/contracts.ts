/**
 * Cross-lane request/response shapes for the AI layer and the automation engines.
 * FROZEN (lead-owned).
 */

import type { AiTask, ExecEngine, LayerKind, Priority, RiskLevel, RunStatus, Severity } from './domain.js';
import type { Assertion, WebStep } from './entities.js';

/* --------------------------------- AI ----------------------------------- */

export interface AiStatus {
  configured: boolean;
  provider: string;
  model: string;
  mode: 'live' | 'mock';
  fallback_to_mock: boolean;
  message: string;
}

export interface AiResult<T> {
  ok: boolean;
  data: T | null;
  error: string | null;
  meta: {
    provider: string;
    model: string;
    task: AiTask | string;
    used_mock: boolean;
    latency_ms: number;
    prompt_tokens: number;
    completion_tokens: number;
    generation_id: string | null;
    /** Set when the AI call failed and a deterministic offline stub produced the data. */
    degraded: boolean;
  };
}

export interface AiGenerateRequest {
  task: AiTask;
  project_id?: string | null;
  /** Free-form task payload; each task documents its own shape. */
  input?: Record<string, unknown>;
  /** When true the result is persisted and returned, but no entities are created. */
  preview_only?: boolean;
  /** Persist created entity ids here for UI navigation. */
  persist?: boolean;
  input_ref?: string | null;
}

export interface AiChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/* --- per-task payload / output shapes (all optional-safe) --- */

export interface CrawlSiteInput {
  url: string;
  max_pages?: number;
  depth?: number;
  include_links?: boolean;
  /** Raw HTML supplied by the caller (used when the server cannot fetch, e.g. auth-walled). */
  html?: string;
}

export interface CrawledPage {
  url: string;
  title: string;
  headings: string[];
  forms: Array<{ action: string; method: string; fields: Array<{ name: string; type: string; required: boolean; label?: string }> }>;
  links: Array<{ text: string; href: string }>;
  buttons: string[];
  inputs: Array<{ name: string; type: string; placeholder?: string }>;
  tables: Array<{ headers: string[]; rowCount: number }>;
  textSample: string;
}

export interface CrawlResult {
  url: string;
  fetched: boolean;
  pages: CrawledPage[];
  features: Array<{
    name: string;
    kind: 'form' | 'navigation' | 'listing' | 'detail' | 'action' | 'auth' | 'search';
    evidence: string;
    suggested_actor: string;
    suggested_priority: Priority;
  }>;
  suggested_use_cases: Array<{ name: string; goal: string; actors: string[]; priority: Priority }>;
  used_mock: boolean;
}

export interface GenerateUseCasesInput {
  requirement_ids?: string[];
  feature_description?: string;
  crawl?: CrawlResult;
  count?: number;
}

export interface UseCaseDraft {
  name: string;
  goal: string;
  actors: string[];
  preconditions: string[];
  postconditions: string[];
  main_flow: string[];
  alternate_flows: Array<{ name: string; steps: string[] }>;
  business_rules: string[];
  priority: Priority;
  risk: RiskLevel;
  requirement_refs?: string[];
}

export interface GenerateScenariosInput {
  use_case_ids?: string[];
  use_case?: UseCaseDraft;
  per_use_case?: number;
}

export interface ScenarioDraft {
  title: string;
  kind: 'happy_path' | 'alternative' | 'negative' | 'edge' | 'security' | 'performance';
  given_text: string;
  when_text: string;
  then_text: string;
  priority: Priority;
}

export interface GenerateTestCasesInput {
  scenario_ids?: string[];
  scenario?: ScenarioDraft;
  per_scenario?: number;
  include_types?: string[];
}

export interface TestCaseDraft {
  title: string;
  objective: string;
  preconditions: string;
  type: string;
  layer: LayerKind;
  priority: Priority;
  severity: Severity;
  estimated_minutes: number;
  tags: string[];
  test_data: Array<{ field: string; value: string }>;
  expected_result: string;
  steps: Array<{ action: string; expected: string; data?: string }>;
}

export interface GenerateApiTestsInput {
  openapi?: string;            // raw OpenAPI/Swagger JSON text
  endpoints?: string;          // free-text endpoint description
  base_url?: string;
  collection_id?: string;
}

export interface ApiRequestDraft {
  name: string;
  method: string;
  path: string;
  headers: Record<string, string>;
  query: Record<string, string>;
  body: string | null;
  body_type: 'json' | 'form' | 'raw' | 'none';
  assertions: Assertion[];
}

export interface GenerateDbChecksInput {
  requirement_text?: string;
  schema_sql?: string;
  connection_id?: string;
}

export interface DbCheckDraft {
  name: string;
  sql: string;
  assertions: Assertion[];
  rationale: string;
}

export interface GenerateWebFlowInput {
  scenario_text?: string;
  url?: string;
  crawl?: CrawlResult;
}

export interface WebFlowDraft {
  name: string;
  start_url: string;
  steps: WebStep[];
}

export interface CoverageReviewInput {
  matrix_summary?: Record<string, unknown>;
  gaps?: Array<{ requirement_id: string; title: string }>;
}

export interface CoverageReviewResult {
  findings: Array<{ requirement_id: string; severity: Severity; issue: string; recommendation: string }>;
  suggested_test_cases: TestCaseDraft[];
  overall_assessment: string;
}

export interface DefectTriageInput {
  title: string;
  description?: string;
  actual_result?: string;
  expected_result?: string;
  evidence?: string;
}

export interface DefectTriageResult {
  severity: Severity;
  priority: Priority;
  component: string;
  likely_root_cause: string;
  reproduction_hint: string;
  suggested_owner_role: string;
  duplicate_risk: 'low' | 'medium' | 'high';
  rationale: string;
}

export interface RiskPredictionInput {
  test_case_ids?: string[];
}

export interface RiskPredictionResult {
  items: Array<{
    test_case_id: string;
    code?: string;
    title?: string;
    score: number;
    level: RiskLevel;
    factors: string[];
    should_be_in_regression: boolean;
    recommended_order: number;
  }>;
}

/* ---------------------------- Execution engine --------------------------- */

export interface ExecuteOptions {
  environment_id?: string | null;
  /** When true, the engine performs a dry-run: validate and compile but do not hit the target. */
  dry_run?: boolean;
  timeout_ms?: number;
  /** Overrides the artifact used by the engine (e.g. run an ApiRequest with a different base URL). */
  overrides?: Record<string, unknown>;
  executed_by?: string | null;
  run_id?: string | null;
  /** `ai` engine only: let the model reason about the outcome when assertions are inconclusive. */
  ai_assist?: boolean;
}

export interface StepLog {
  index: number;
  action: string;
  target?: string;
  status: 'ok' | 'fail' | 'skip' | 'info';
  message: string;
  duration_ms: number;
  /** Scalar values observed at this step (assertion sources). */
  observed?: unknown;
}

export interface EngineResult {
  status: RunStatus;
  engine: ExecEngine;
  duration_ms: number;
  logs: StepLog[];
  assertions: Array<{ assertion: Assertion; passed: boolean; observed: unknown; message: string }>;
  evidence: Record<string, unknown>;
  error: string | null;
  used_ai: boolean;
}

export interface SuiteResult {
  run_id: string;
  total: number;
  passed: number;
  failed: number;
  blocked: number;
  skipped: number;
  duration_ms: number;
  results: Array<{
    test_case_id: string;
    code: string;
    title: string;
    status: RunStatus;
    duration_ms: number;
    error: string | null;
  }>;
}

/* --------------------------- Impact / regression ------------------------- */

export interface ImpactReport {
  artifact_kind: string;
  artifact_id: string;
  artifact_code: string | null;
  artifact_title: string | null;
  affected_requirements: Array<{ id: string; code: string; title: string }>;
  affected_use_cases: Array<{ id: string; code: string; name: string }>;
  affected_scenarios: Array<{ id: string; code: string; title: string }>;
  affected_test_cases: Array<{ id: string; code: string; title: string; is_regression: number; risk_score: number }>;
  affected_defects: Array<{ id: string; code: string; title: string; status: string }>;
  recommended_regression_suite: string[];
  blast_radius: number;
}

export interface RegressionPlan {
  project_id: string;
  generated_at: string;
  strategy: 'risk_based' | 'full' | 'impact_only' | 'smoke_then_full' | 'time_boxed';
  selected: Array<{
    test_case_id: string;
    code: string;
    title: string;
    risk_score: number;
    risk_level: RiskLevel;
    reason: string;
    engine: ExecEngine;
    automation_status: string;
  }>;
  excluded: Array<{ test_case_id: string; code: string; title: string; reason: string }>;
  estimates: {
    total_cases: number;
    selected_cases: number;
    estimated_minutes: number;
    automated_share_pct: number;
    coverage_of_high_risk_pct: number;
  };
  rationale: string;
}
