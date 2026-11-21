/**
 * Entity interfaces — the wire contract between API modules and the web app.
 * FROZEN (lead-owned). Columns are snake_case to match SQLite; JSON mirrors them directly.
 */

import type {
  AutomationStatus,
  CaseType,
  CoverageStatus,
  CycleStatus,
  DefectSource,
  DefectStatus,
  ExecEngine,
  LayerKind,
  Priority,
  RiskLevel,
  RunStatus,
  Severity,
  SprintStatus,
  TraceLinkType,
} from './domain.js';

export interface Timestamped {
  created_at: string;
  updated_at: string;
}

/* ------------------------------- Projects ------------------------------- */

export interface Project extends Timestamped {
  id: string;
  key: string;                 // short code, e.g. "SHOP"
  name: string;
  description: string | null;
  target_url: string | null;   // existing web under test
  repo_url: string | null;
  owner: string | null;
  status: 'active' | 'on_hold' | 'archived';
  quality_gate: number;        // required pass-rate % to release
  metadata: string | null;     // JSON blob
}

/* ----------------------------- Requirements ----------------------------- */

export interface Requirement extends Timestamped {
  id: string;
  project_id: string;
  code: string;                // REQ-001
  title: string;
  description: string | null;
  source: string | null;       // stakeholder / crawled page / doc
  priority: Priority;
  status: 'draft' | 'approved' | 'changed' | 'deprecated';
  acceptance_criteria: string | null; // JSON array of strings
}

/* -------------------------------- Use cases ----------------------------- */

export interface UseCase extends Timestamped {
  id: string;
  project_id: string;
  code: string;                // UC-001
  name: string;
  goal: string | null;
  actors: string | null;       // JSON array
  preconditions: string | null;   // JSON array
  postconditions: string | null;  // JSON array
  main_flow: string | null;       // JSON array of steps
  alternate_flows: string | null; // JSON array of {name, steps[]}
  business_rules: string | null;  // JSON array
  priority: Priority;
  risk: RiskLevel;
  status: 'draft' | 'review' | 'approved' | 'deprecated';
  generated_by: 'manual' | 'ai' | 'import';
  ai_generation_id: string | null;
}

/* -------------------------------- Scenarios ----------------------------- */

export interface Scenario extends Timestamped {
  id: string;
  project_id: string;
  use_case_id: string | null;
  code: string;                // SC-001
  title: string;
  kind: 'happy_path' | 'alternative' | 'negative' | 'edge' | 'security' | 'performance';
  given_text: string | null;
  when_text: string | null;
  then_text: string | null;
  priority: Priority;
  generated_by: 'manual' | 'ai' | 'import';
  ai_generation_id: string | null;
}

/* ------------------------------- Test cases ----------------------------- */

export interface TestCase extends Timestamped {
  id: string;
  project_id: string;
  scenario_id: string | null;
  use_case_id: string | null;
  code: string;                // TC-001
  title: string;
  objective: string | null;
  preconditions: string | null;
  type: CaseType;
  layer: LayerKind;
  priority: Priority;
  severity: Severity;
  automation_status: AutomationStatus;
  engine: ExecEngine;
  risk_score: number;          // 0..100, computed by riskScore()
  estimated_minutes: number;
  tags: string | null;         // JSON array
  test_data: string | null;    // JSON array of {field, value}
  expected_result: string | null;
  is_regression: number;       // 0/1 — regression suite membership
  status: 'draft' | 'ready' | 'deprecated';
  generated_by: 'manual' | 'ai' | 'import';
  ai_generation_id: string | null;
}

export interface TestStep {
  id: string;
  test_case_id: string;
  order_index: number;
  action: string;
  expected: string | null;
  data: string | null;
  created_at: string;
}

/* --------------------------- Traceability matrix ------------------------ */

export interface MatrixLink {
  id: string;
  project_id: string;
  link_type: TraceLinkType;
  from_kind: string;
  from_id: string;
  to_kind: string;
  to_id: string;
  note: string | null;
  created_at: string;
  created_by: string;
}

export interface MatrixCell {
  requirement_id: string;
  use_case_ids: string[];
  scenario_ids: string[];
  test_case_ids: string[];
  defect_ids: string[];
  coverage: CoverageStatus;
  coverage_pct: number;
  automation_pct: number;
  risk: RiskLevel;
}

export interface MatrixDocument {
  project_id: string;
  generated_at: string;
  cells: MatrixCell[];
  summary: {
    requirements: number;
    covered: number;
    partial: number;
    gaps: number;
    orphans: number;
    coverage_pct: number;
    automation_pct: number;
  };
}

/* --------------------------------- Cycles ------------------------------- */

export interface Cycle extends Timestamped {
  id: string;
  project_id: string;
  code: string;                // CYC-2026-Q1
  name: string;
  goal: string | null;
  start_date: string | null;
  end_date: string | null;
  status: CycleStatus;
  entry_criteria: string | null;
  exit_criteria: string | null;
}

export interface Sprint extends Timestamped {
  id: string;
  cycle_id: string;
  project_id: string;
  code: string;                // SPR-01
  name: string;
  goal: string | null;
  start_date: string | null;
  end_date: string | null;
  capacity_points: number;
  status: SprintStatus;
}

/** Sprint ↔ test-case assignment with estimate and owner. */
export interface SprintScope {
  id: string;
  sprint_id: string;
  test_case_id: string;
  assignee: string | null;
  estimate_minutes: number;
  status: 'todo' | 'in_progress' | 'done';
  created_at: string;
  updated_at: string;
}

/* -------------------------------- Runs ---------------------------------- */

export interface TestRun extends Timestamped {
  id: string;
  project_id: string;
  cycle_id: string | null;
  sprint_id: string | null;
  environment_id: string | null;
  code: string;                // RUN-0007
  name: string;
  kind: 'manual' | 'automation' | 'regression' | 'smoke' | 'ai';
  engine: ExecEngine;
  status: 'running' | 'completed' | 'aborted';
  started_at: string | null;
  finished_at: string | null;
  executed_by: string | null;
  notes: string | null;
  total: number;
  passed: number;
  failed: number;
  blocked: number;
  skipped: number;
  duration_ms: number;
}

export interface RunResult extends Timestamped {
  id: string;
  run_id: string;
  test_case_id: string;
  status: RunStatus;
  engine: ExecEngine;
  duration_ms: number;
  actual_result: string | null;
  error_message: string | null;
  evidence: string | null;     // JSON: {logs[], screenshots[], responseBody, sqlRows}
  executed_by: string | null;
  executed_at: string | null;
  defect_id: string | null;
}

/* ------------------------------- Defects -------------------------------- */

export interface Defect extends Timestamped {
  id: string;
  project_id: string;
  code: string;                // BUG-012
  title: string;
  description: string | null;
  steps_to_reproduce: string | null;
  expected_result: string | null;
  actual_result: string | null;
  severity: Severity;
  priority: Priority;
  status: DefectStatus;
  source: DefectSource;
  test_case_id: string | null;
  run_result_id: string | null;
  environment_id: string | null;
  assignee: string | null;
  reporter: string | null;
  found_in_cycle_id: string | null;
  fixed_in_build: string | null;
  is_escaped: number;          // 0/1 — found in production
  ai_triage: string | null;    // JSON from AI triage
  closed_at: string | null;
}

/* ----------------------------- Environments ----------------------------- */

export interface Environment extends Timestamped {
  id: string;
  project_id: string;
  name: string;
  base_url: string | null;
  db_uri: string | null;
  api_base: string | null;
  kind: 'dev' | 'staging' | 'uat' | 'prod' | 'local';
  variables: string | null;    // JSON object
  is_default: number;
  notes: string | null;
}

export interface TestDataSet extends Timestamped {
  id: string;
  project_id: string;
  environment_id: string | null;
  name: string;
  description: string | null;
  columns: string | null;      // JSON array of names
  rows: string | null;         // JSON array of objects
  generated_by: 'manual' | 'ai' | 'import';
}

/* --------------------------- Automation artifacts ----------------------- */

export interface ApiCollection extends Timestamped {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  base_url: string | null;
  auth_type: 'none' | 'bearer' | 'basic' | 'api_key';
  auth_config: string | null;  // JSON
  variables: string | null;    // JSON
}

export interface ApiRequest extends Timestamped {
  id: string;
  collection_id: string;
  project_id: string;
  test_case_id: string | null;
  name: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';
  path: string;
  headers: string | null;      // JSON object
  query: string | null;        // JSON object
  body: string | null;
  body_type: 'json' | 'form' | 'raw' | 'none';
  assertions: string | null;   // JSON array of Assertion
  pre_script: string | null;
  post_script: string | null;
  generated_by: 'manual' | 'ai' | 'import';
  last_status: number | null;
  last_duration_ms: number | null;
  last_run_at: string | null;
}

/** Assertion DSL shared by API / DB / Web engines. FROZEN. */
export type AssertionOperator =
  | 'equals' | 'not_equals' | 'contains' | 'not_contains'
  | 'gt' | 'gte' | 'lt' | 'lte'
  | 'exists' | 'not_exists' | 'matches' | 'in' | 'length_gte' | 'length_lte';

export interface Assertion {
  source: 'status' | 'body' | 'header' | 'duration' | 'jsonpath' | 'row_count' | 'column' | 'text' | 'element';
  path?: string;               // JSONPath-ish: $.data.id  |  column name  |  CSS selector
  operator: AssertionOperator;
  expected?: unknown;
  message?: string;
}

export interface DbConnection extends Timestamped {
  id: string;
  project_id: string;
  name: string;
  dialect: 'sqlite' | 'postgres' | 'mysql';
  dsn_masked: string;
  dsn: string | null;          // encrypted-at-rest is out of scope; never returned by list APIs
  readonly_guard: number;      // 1 = block non-SELECT statements
  created_by: string | null;
}

export interface DbCheck extends Timestamped {
  id: string;
  project_id: string;
  connection_id: string;
  test_case_id: string | null;
  name: string;
  sql: string;
  assertions: string | null;   // JSON Assertion[]
  setup_sql: string | null;
  teardown_sql: string | null;
  generated_by: 'manual' | 'ai' | 'import';
  last_status: RunStatus | null;
  last_rows: number | null;
  last_run_at: string | null;
}

export interface WebFlow extends Timestamped {
  id: string;
  project_id: string;
  test_case_id: string | null;
  name: string;
  start_url: string | null;
  steps: string;               // JSON WebStep[]
  viewport: string | null;     // JSON {width,height}
  generated_by: 'manual' | 'ai' | 'import';
  last_status: RunStatus | null;
  last_run_at: string | null;
}

export type WebStepAction =
  | 'goto' | 'click' | 'fill' | 'select' | 'check' | 'uncheck'
  | 'press' | 'wait' | 'assert_text' | 'assert_visible' | 'assert_url'
  | 'screenshot' | 'hover' | 'scroll';

export interface WebStep {
  action: WebStepAction;
  selector?: string;
  value?: string;
  expected?: string;
  timeout_ms?: number;
  description?: string;
}

/* --------------------------------- AI ----------------------------------- */

export interface AiSettings extends Timestamped {
  id: string;
  provider: 'deepseek' | 'openai' | 'anthropic' | 'google' | 'ollama' | 'custom' | 'mock';
  model: string;
  base_url: string | null;
  api_key_masked: string | null;
  api_key: string | null;      // stored locally; never returned in full by the API
  temperature: number;
  max_tokens: number;
  enabled: number;
  fallback_to_mock: number;
}

export interface AiGeneration {
  id: string;
  project_id: string | null;
  task: string;
  provider: string;
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  latency_ms: number;
  status: 'success' | 'error';
  used_mock: number;
  input_ref: string | null;    // artifact id the generation was based on
  output_ref: string | null;   // artifact id(s) created
  error: string | null;
  created_at: string;
}

/* ------------------------------- Learning ------------------------------- */

export interface Course extends Timestamped {
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  description: string | null;
  level: 'beginner' | 'intermediate' | 'advanced';
  pillar: string;              // one of CURRICULUM_PILLARS
  estimated_minutes: number;
  order_index: number;
  icon: string | null;
  is_published: number;
}

export interface CourseModule {
  id: string;
  course_id: string;
  code: string;
  title: string;
  summary: string | null;
  order_index: number;
}

export interface Lesson extends Timestamped {
  id: string;
  module_id: string;
  course_id: string;
  code: string;
  title: string;
  kind: 'reading' | 'video' | 'lab' | 'quiz';
  content_md: string;
  duration_minutes: number;
  order_index: number;
  lab_ref: string | null;      // deep-link into a QATools feature, e.g. "/scenarios"
}

export interface Quiz {
  id: string;
  course_id: string;
  module_id: string | null;
  title: string;
  pass_score: number;
  time_limit_minutes: number | null;
  order_index: number;
}

export interface QuizQuestion {
  id: string;
  quiz_id: string;
  prompt: string;
  options: string;             // JSON string[]
  answer_index: number;
  explanation: string | null;
  points: number;
  order_index: number;
}

export interface Enrollment extends Timestamped {
  id: string;
  course_id: string;
  learner_name: string;
  learner_email: string;
  progress_pct: number;
  started_at: string | null;
  completed_at: string | null;
  status: 'active' | 'completed' | 'dropped';
}

export interface LessonProgress {
  id: string;
  enrollment_id: string;
  lesson_id: string;
  completed: number;
  completed_at: string | null;
  score: number | null;
}

export interface Certificate {
  id: string;
  code: string;                // QAT-2026-XXXXXX
  enrollment_id: string;
  course_id: string;
  learner_name: string;
  course_title: string;
  issued_at: string;
  score: number;
  grade: 'A' | 'B' | 'C' | 'Pass';
  verification_hash: string;
  revoked: number;
  revoked_reason: string | null;
}

/** Result of public certificate verification: /api/certificates/verify/:code */
export interface CertificateVerification {
  valid: boolean;
  certificate?: Certificate;
  reason?: string;
  learner_name?: string;
  course_title?: string;
  issued_at?: string;
}

/* ------------------------------- Metrics -------------------------------- */

export interface MetricsSnapshot {
  project_id: string;
  generated_at: string;
  totals: {
    requirements: number;
    use_cases: number;
    scenarios: number;
    test_cases: number;
    automated: number;
    defects_open: number;
    defects_total: number;
    runs: number;
  };
  coverage: {
    requirement_coverage_pct: number;
    test_case_execution_pct: number;
    automation_pct: number;
    regression_suite_size: number;
  };
  quality: {
    pass_rate: number;
    fail_rate: number;
    block_rate: number;
    defect_density: number;       // defects per test case
    defect_leakage_pct: number;   // escaped / total
    reopen_rate: number;
    regression_suite_pass_pct: number;
  };
  efficiency: {
    avg_case_duration_ms: number;
    automation_roi_minutes_saved: number;
    estimated_hours_saved_per_run: number;
  };
  readiness: {
    release_gate_pct: number;     // project.quality_gate
    go_no_go: 'go' | 'conditional' | 'no_go';
    blockers: string[];
  };
  trend: Array<{ date: string; passed: number; failed: number; blocked: number; total: number }>;
  defects_by_severity: Record<string, number>;
  defects_by_status: Record<string, number>;
  flaky_cases: Array<{ test_case_id: string; code: string; title: string; flips: number; pass_rate: number }>;
}
