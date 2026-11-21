-- QATools schema v1 — FROZEN (lead-owned).
-- Every module writes only to the tables it owns; see ARCHITECTURE.md §3.
-- Conventions: TEXT ids (prefixed ULID-ish), ISO-8601 TEXT timestamps, JSON stored as TEXT.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ------------------------------------------------------------------ projects
CREATE TABLE IF NOT EXISTS projects (
  id            TEXT PRIMARY KEY,
  key           TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  description   TEXT,
  target_url    TEXT,
  repo_url      TEXT,
  owner         TEXT,
  status        TEXT NOT NULL DEFAULT 'active',
  quality_gate  REAL NOT NULL DEFAULT 90,
  metadata      TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);

-- -------------------------------------------------------------- requirements
CREATE TABLE IF NOT EXISTS requirements (
  id                  TEXT PRIMARY KEY,
  project_id          TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  code                TEXT NOT NULL,
  title               TEXT NOT NULL,
  description         TEXT,
  source              TEXT,
  priority            TEXT NOT NULL DEFAULT 'medium',
  status              TEXT NOT NULL DEFAULT 'draft',
  acceptance_criteria TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  UNIQUE(project_id, code)
);
CREATE INDEX IF NOT EXISTS idx_req_project ON requirements(project_id);

-- ----------------------------------------------------------------- use_cases
CREATE TABLE IF NOT EXISTS use_cases (
  id               TEXT PRIMARY KEY,
  project_id       TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  code             TEXT NOT NULL,
  name             TEXT NOT NULL,
  goal             TEXT,
  actors           TEXT,
  preconditions    TEXT,
  postconditions   TEXT,
  main_flow        TEXT,
  alternate_flows  TEXT,
  business_rules   TEXT,
  priority         TEXT NOT NULL DEFAULT 'medium',
  risk             TEXT NOT NULL DEFAULT 'medium',
  status           TEXT NOT NULL DEFAULT 'draft',
  generated_by     TEXT NOT NULL DEFAULT 'manual',
  ai_generation_id TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  UNIQUE(project_id, code)
);
CREATE INDEX IF NOT EXISTS idx_uc_project ON use_cases(project_id);

-- ----------------------------------------------------------------- scenarios
CREATE TABLE IF NOT EXISTS scenarios (
  id               TEXT PRIMARY KEY,
  project_id       TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  use_case_id      TEXT REFERENCES use_cases(id) ON DELETE CASCADE,
  code             TEXT NOT NULL,
  title            TEXT NOT NULL,
  kind             TEXT NOT NULL DEFAULT 'happy_path',
  given_text       TEXT,
  when_text        TEXT,
  then_text        TEXT,
  priority         TEXT NOT NULL DEFAULT 'medium',
  generated_by     TEXT NOT NULL DEFAULT 'manual',
  ai_generation_id TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  UNIQUE(project_id, code)
);
CREATE INDEX IF NOT EXISTS idx_sc_project ON scenarios(project_id);
CREATE INDEX IF NOT EXISTS idx_sc_usecase ON scenarios(use_case_id);

-- ---------------------------------------------------------------- test_cases
CREATE TABLE IF NOT EXISTS test_cases (
  id                TEXT PRIMARY KEY,
  project_id        TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  scenario_id       TEXT REFERENCES scenarios(id) ON DELETE SET NULL,
  use_case_id       TEXT REFERENCES use_cases(id) ON DELETE SET NULL,
  code              TEXT NOT NULL,
  title             TEXT NOT NULL,
  objective         TEXT,
  preconditions     TEXT,
  type              TEXT NOT NULL DEFAULT 'functional',
  layer             TEXT NOT NULL DEFAULT 'web',
  priority          TEXT NOT NULL DEFAULT 'medium',
  severity          TEXT NOT NULL DEFAULT 'major',
  automation_status TEXT NOT NULL DEFAULT 'manual',
  engine            TEXT NOT NULL DEFAULT 'manual',
  risk_score        REAL NOT NULL DEFAULT 0,
  estimated_minutes INTEGER NOT NULL DEFAULT 10,
  tags              TEXT,
  test_data         TEXT,
  expected_result   TEXT,
  is_regression     INTEGER NOT NULL DEFAULT 0,
  status            TEXT NOT NULL DEFAULT 'ready',
  generated_by      TEXT NOT NULL DEFAULT 'manual',
  ai_generation_id  TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  UNIQUE(project_id, code)
);
CREATE INDEX IF NOT EXISTS idx_tc_project ON test_cases(project_id);
CREATE INDEX IF NOT EXISTS idx_tc_scenario ON test_cases(scenario_id);
CREATE INDEX IF NOT EXISTS idx_tc_regression ON test_cases(project_id, is_regression);

CREATE TABLE IF NOT EXISTS test_steps (
  id           TEXT PRIMARY KEY,
  test_case_id TEXT NOT NULL REFERENCES test_cases(id) ON DELETE CASCADE,
  order_index  INTEGER NOT NULL,
  action       TEXT NOT NULL,
  expected     TEXT,
  data         TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_steps_case ON test_steps(test_case_id, order_index);

-- ------------------------------------------------------------ matrix_links
CREATE TABLE IF NOT EXISTS matrix_links (
  id         TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  link_type  TEXT NOT NULL,
  from_kind  TEXT NOT NULL,
  from_id    TEXT NOT NULL,
  to_kind    TEXT NOT NULL,
  to_id      TEXT NOT NULL,
  note       TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL DEFAULT 'system',
  UNIQUE(link_type, from_id, to_id)
);
CREATE INDEX IF NOT EXISTS idx_ml_project ON matrix_links(project_id);
CREATE INDEX IF NOT EXISTS idx_ml_from ON matrix_links(from_id);
CREATE INDEX IF NOT EXISTS idx_ml_to ON matrix_links(to_id);

-- -------------------------------------------------------------------- cycles
CREATE TABLE IF NOT EXISTS cycles (
  id            TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  code          TEXT NOT NULL,
  name          TEXT NOT NULL,
  goal          TEXT,
  start_date    TEXT,
  end_date      TEXT,
  status        TEXT NOT NULL DEFAULT 'planned',
  entry_criteria TEXT,
  exit_criteria TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  UNIQUE(project_id, code)
);
CREATE INDEX IF NOT EXISTS idx_cyc_project ON cycles(project_id);

CREATE TABLE IF NOT EXISTS sprints (
  id              TEXT PRIMARY KEY,
  cycle_id        TEXT NOT NULL REFERENCES cycles(id) ON DELETE CASCADE,
  project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  code            TEXT NOT NULL,
  name            TEXT NOT NULL,
  goal            TEXT,
  start_date      TEXT,
  end_date        TEXT,
  capacity_points INTEGER NOT NULL DEFAULT 40,
  status          TEXT NOT NULL DEFAULT 'planned',
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  UNIQUE(cycle_id, code)
);
CREATE INDEX IF NOT EXISTS idx_spr_cycle ON sprints(cycle_id);

CREATE TABLE IF NOT EXISTS sprint_scope (
  id               TEXT PRIMARY KEY,
  sprint_id        TEXT NOT NULL REFERENCES sprints(id) ON DELETE CASCADE,
  test_case_id     TEXT NOT NULL REFERENCES test_cases(id) ON DELETE CASCADE,
  assignee         TEXT,
  estimate_minutes INTEGER NOT NULL DEFAULT 10,
  status           TEXT NOT NULL DEFAULT 'todo',
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  UNIQUE(sprint_id, test_case_id)
);
CREATE INDEX IF NOT EXISTS idx_scope_sprint ON sprint_scope(sprint_id);

-- ------------------------------------------------------------- environments
CREATE TABLE IF NOT EXISTS environments (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  base_url    TEXT,
  db_uri      TEXT,
  api_base    TEXT,
  kind        TEXT NOT NULL DEFAULT 'staging',
  variables   TEXT,
  is_default  INTEGER NOT NULL DEFAULT 0,
  notes       TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_env_project ON environments(project_id);

CREATE TABLE IF NOT EXISTS test_data_sets (
  id             TEXT PRIMARY KEY,
  project_id     TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  environment_id TEXT REFERENCES environments(id) ON DELETE SET NULL,
  name           TEXT NOT NULL,
  description    TEXT,
  columns        TEXT,
  rows           TEXT,
  generated_by   TEXT NOT NULL DEFAULT 'manual',
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tds_project ON test_data_sets(project_id);

-- -------------------------------------------------------------- test runs
CREATE TABLE IF NOT EXISTS test_runs (
  id             TEXT PRIMARY KEY,
  project_id     TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  cycle_id       TEXT REFERENCES cycles(id) ON DELETE SET NULL,
  sprint_id      TEXT REFERENCES sprints(id) ON DELETE SET NULL,
  environment_id TEXT REFERENCES environments(id) ON DELETE SET NULL,
  code           TEXT NOT NULL,
  name           TEXT NOT NULL,
  kind           TEXT NOT NULL DEFAULT 'manual',
  engine         TEXT NOT NULL DEFAULT 'manual',
  status         TEXT NOT NULL DEFAULT 'running',
  started_at     TEXT,
  finished_at    TEXT,
  executed_by    TEXT,
  notes          TEXT,
  total          INTEGER NOT NULL DEFAULT 0,
  passed         INTEGER NOT NULL DEFAULT 0,
  failed         INTEGER NOT NULL DEFAULT 0,
  blocked        INTEGER NOT NULL DEFAULT 0,
  skipped        INTEGER NOT NULL DEFAULT 0,
  duration_ms    INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  UNIQUE(project_id, code)
);
CREATE INDEX IF NOT EXISTS idx_run_project ON test_runs(project_id);
CREATE INDEX IF NOT EXISTS idx_run_cycle ON test_runs(cycle_id);

CREATE TABLE IF NOT EXISTS run_results (
  id            TEXT PRIMARY KEY,
  run_id        TEXT NOT NULL REFERENCES test_runs(id) ON DELETE CASCADE,
  test_case_id  TEXT NOT NULL REFERENCES test_cases(id) ON DELETE CASCADE,
  status        TEXT NOT NULL DEFAULT 'not_run',
  engine        TEXT NOT NULL DEFAULT 'manual',
  duration_ms   INTEGER NOT NULL DEFAULT 0,
  actual_result TEXT,
  error_message TEXT,
  evidence      TEXT,
  executed_by   TEXT,
  executed_at   TEXT,
  defect_id     TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  UNIQUE(run_id, test_case_id)
);
CREATE INDEX IF NOT EXISTS idx_res_run ON run_results(run_id);
CREATE INDEX IF NOT EXISTS idx_res_case ON run_results(test_case_id);

-- ----------------------------------------------------------------- defects
CREATE TABLE IF NOT EXISTS defects (
  id                 TEXT PRIMARY KEY,
  project_id         TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  code               TEXT NOT NULL,
  title              TEXT NOT NULL,
  description        TEXT,
  steps_to_reproduce TEXT,
  expected_result    TEXT,
  actual_result      TEXT,
  severity           TEXT NOT NULL DEFAULT 'major',
  priority           TEXT NOT NULL DEFAULT 'medium',
  status             TEXT NOT NULL DEFAULT 'new',
  source             TEXT NOT NULL DEFAULT 'manual',
  test_case_id       TEXT REFERENCES test_cases(id) ON DELETE SET NULL,
  run_result_id      TEXT REFERENCES run_results(id) ON DELETE SET NULL,
  environment_id     TEXT REFERENCES environments(id) ON DELETE SET NULL,
  assignee           TEXT,
  reporter           TEXT,
  found_in_cycle_id  TEXT REFERENCES cycles(id) ON DELETE SET NULL,
  fixed_in_build     TEXT,
  is_escaped         INTEGER NOT NULL DEFAULT 0,
  ai_triage          TEXT,
  closed_at          TEXT,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  UNIQUE(project_id, code)
);
CREATE INDEX IF NOT EXISTS idx_bug_project ON defects(project_id);
CREATE INDEX IF NOT EXISTS idx_bug_case ON defects(test_case_id);

-- ------------------------------------------------------- api automation
CREATE TABLE IF NOT EXISTS api_collections (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT,
  base_url    TEXT,
  auth_type   TEXT NOT NULL DEFAULT 'none',
  auth_config TEXT,
  variables   TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_coll_project ON api_collections(project_id);

CREATE TABLE IF NOT EXISTS api_requests (
  id               TEXT PRIMARY KEY,
  collection_id    TEXT NOT NULL REFERENCES api_collections(id) ON DELETE CASCADE,
  project_id       TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  test_case_id     TEXT REFERENCES test_cases(id) ON DELETE SET NULL,
  name             TEXT NOT NULL,
  method           TEXT NOT NULL DEFAULT 'GET',
  path             TEXT NOT NULL,
  headers          TEXT,
  query            TEXT,
  body             TEXT,
  body_type        TEXT NOT NULL DEFAULT 'none',
  assertions       TEXT,
  pre_script       TEXT,
  post_script      TEXT,
  generated_by     TEXT NOT NULL DEFAULT 'manual',
  last_status      INTEGER,
  last_duration_ms INTEGER,
  last_run_at      TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_apr_coll ON api_requests(collection_id);

-- -------------------------------------------------------- db testing
CREATE TABLE IF NOT EXISTS db_connections (
  id             TEXT PRIMARY KEY,
  project_id     TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  dialect        TEXT NOT NULL DEFAULT 'sqlite',
  dsn_masked     TEXT NOT NULL,
  dsn            TEXT,
  readonly_guard INTEGER NOT NULL DEFAULT 1,
  created_by     TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dbc_project ON db_connections(project_id);

CREATE TABLE IF NOT EXISTS db_checks (
  id            TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  connection_id TEXT NOT NULL REFERENCES db_connections(id) ON DELETE CASCADE,
  test_case_id  TEXT REFERENCES test_cases(id) ON DELETE SET NULL,
  name          TEXT NOT NULL,
  sql           TEXT NOT NULL,
  assertions    TEXT,
  setup_sql     TEXT,
  teardown_sql  TEXT,
  generated_by  TEXT NOT NULL DEFAULT 'manual',
  last_status   TEXT,
  last_rows     INTEGER,
  last_run_at   TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dbc_check_project ON db_checks(project_id);

-- ------------------------------------------------------- web automation
CREATE TABLE IF NOT EXISTS web_flows (
  id            TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  test_case_id  TEXT REFERENCES test_cases(id) ON DELETE SET NULL,
  name          TEXT NOT NULL,
  start_url     TEXT,
  steps         TEXT NOT NULL,
  viewport      TEXT,
  generated_by  TEXT NOT NULL DEFAULT 'manual',
  last_status   TEXT,
  last_run_at   TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wbf_project ON web_flows(project_id);

-- ---------------------------------------------------------------- ai
CREATE TABLE IF NOT EXISTS ai_settings (
  id               TEXT PRIMARY KEY,
  provider         TEXT NOT NULL DEFAULT 'mock',
  model            TEXT NOT NULL DEFAULT 'qatools-mock-1',
  base_url         TEXT,
  api_key          TEXT,
  api_key_masked   TEXT,
  temperature      REAL NOT NULL DEFAULT 0.3,
  max_tokens       INTEGER NOT NULL DEFAULT 4096,
  enabled          INTEGER NOT NULL DEFAULT 1,
  fallback_to_mock INTEGER NOT NULL DEFAULT 1,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_generations (
  id                TEXT PRIMARY KEY,
  project_id        TEXT,
  task              TEXT NOT NULL,
  provider          TEXT NOT NULL,
  model             TEXT NOT NULL,
  prompt_tokens     INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  latency_ms        INTEGER NOT NULL DEFAULT 0,
  status            TEXT NOT NULL DEFAULT 'success',
  used_mock         INTEGER NOT NULL DEFAULT 0,
  input_ref         TEXT,
  output_ref        TEXT,
  error             TEXT,
  created_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_aig_project ON ai_generations(project_id);

-- ------------------------------------------------------------ learning
CREATE TABLE IF NOT EXISTS courses (
  id                TEXT PRIMARY KEY,
  slug              TEXT NOT NULL UNIQUE,
  title             TEXT NOT NULL,
  subtitle          TEXT,
  description       TEXT,
  level             TEXT NOT NULL DEFAULT 'beginner',
  pillar            TEXT NOT NULL,
  estimated_minutes INTEGER NOT NULL DEFAULT 0,
  order_index       INTEGER NOT NULL DEFAULT 0,
  icon              TEXT,
  is_published      INTEGER NOT NULL DEFAULT 1,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS course_modules (
  id          TEXT PRIMARY KEY,
  course_id   TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  code        TEXT NOT NULL,
  title       TEXT NOT NULL,
  summary     TEXT,
  order_index INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_mod_course ON course_modules(course_id, order_index);

CREATE TABLE IF NOT EXISTS lessons (
  id               TEXT PRIMARY KEY,
  module_id        TEXT NOT NULL REFERENCES course_modules(id) ON DELETE CASCADE,
  course_id        TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  code             TEXT NOT NULL,
  title            TEXT NOT NULL,
  kind             TEXT NOT NULL DEFAULT 'reading',
  content_md       TEXT NOT NULL DEFAULT '',
  duration_minutes INTEGER NOT NULL DEFAULT 10,
  order_index      INTEGER NOT NULL DEFAULT 0,
  lab_ref          TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_lsn_module ON lessons(module_id, order_index);

CREATE TABLE IF NOT EXISTS quizzes (
  id                  TEXT PRIMARY KEY,
  course_id           TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  module_id           TEXT REFERENCES course_modules(id) ON DELETE SET NULL,
  title               TEXT NOT NULL,
  pass_score          INTEGER NOT NULL DEFAULT 70,
  time_limit_minutes  INTEGER,
  order_index         INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_qz_course ON quizzes(course_id);

CREATE TABLE IF NOT EXISTS quiz_questions (
  id           TEXT PRIMARY KEY,
  quiz_id      TEXT NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  prompt       TEXT NOT NULL,
  options      TEXT NOT NULL,
  answer_index INTEGER NOT NULL,
  explanation  TEXT,
  points       INTEGER NOT NULL DEFAULT 1,
  order_index  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_qq_quiz ON quiz_questions(quiz_id, order_index);

CREATE TABLE IF NOT EXISTS enrollments (
  id             TEXT PRIMARY KEY,
  course_id      TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  learner_name   TEXT NOT NULL,
  learner_email  TEXT NOT NULL,
  progress_pct   REAL NOT NULL DEFAULT 0,
  started_at     TEXT,
  completed_at   TEXT,
  status         TEXT NOT NULL DEFAULT 'active',
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  UNIQUE(course_id, learner_email)
);
CREATE INDEX IF NOT EXISTS idx_enr_course ON enrollments(course_id);

CREATE TABLE IF NOT EXISTS lesson_progress (
  id            TEXT PRIMARY KEY,
  enrollment_id TEXT NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
  lesson_id     TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  completed     INTEGER NOT NULL DEFAULT 0,
  completed_at  TEXT,
  score         REAL,
  UNIQUE(enrollment_id, lesson_id)
);
CREATE INDEX IF NOT EXISTS idx_lp_enr ON lesson_progress(enrollment_id);

-- A durable record of each quiz attempt. Required so the certificate gate can prove
-- "all course quizzes were passed" rather than merely "all lessons were completed".
-- UNIQUE(enrollment_id, quiz_id) keeps the best/latest attempt per quiz.
CREATE TABLE IF NOT EXISTS quiz_attempts (
  id            TEXT PRIMARY KEY,
  quiz_id       TEXT NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  enrollment_id TEXT NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
  score         REAL NOT NULL DEFAULT 0,
  passed        INTEGER NOT NULL DEFAULT 0,
  answers       TEXT,
  submitted_at  TEXT NOT NULL,
  UNIQUE(enrollment_id, quiz_id)
);
CREATE INDEX IF NOT EXISTS idx_qa_enrollment ON quiz_attempts(enrollment_id);
CREATE INDEX IF NOT EXISTS idx_qa_quiz ON quiz_attempts(quiz_id);

CREATE TABLE IF NOT EXISTS certificates (
  id                TEXT PRIMARY KEY,
  code              TEXT NOT NULL UNIQUE,
  enrollment_id     TEXT NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
  course_id         TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  learner_name      TEXT NOT NULL,
  course_title      TEXT NOT NULL,
  issued_at         TEXT NOT NULL,
  score             REAL NOT NULL DEFAULT 0,
  grade             TEXT NOT NULL DEFAULT 'Pass',
  verification_hash TEXT NOT NULL,
  revoked           INTEGER NOT NULL DEFAULT 0,
  revoked_reason    TEXT
);
CREATE INDEX IF NOT EXISTS idx_cert_enr ON certificates(enrollment_id);

-- ------------------------------------------------------------- activity log
CREATE TABLE IF NOT EXISTS activity_log (
  id          TEXT PRIMARY KEY,
  project_id  TEXT,
  actor       TEXT NOT NULL DEFAULT 'system',
  action      TEXT NOT NULL,
  entity_kind TEXT NOT NULL,
  entity_id   TEXT,
  summary     TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_act_project ON activity_log(project_id, created_at);

-- ------------------------------------------- generated automation projects
-- A codegen run: QATools artifacts compiled into a runnable project for an
-- external framework (Playwright, Robot Framework, pytest, …).
CREATE TABLE IF NOT EXISTS generated_projects (
  id           TEXT PRIMARY KEY,
  project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  framework    TEXT NOT NULL,
  language     TEXT NOT NULL,
  name         TEXT NOT NULL,
  files        TEXT NOT NULL,          -- JSON GeneratedFile[]
  readme       TEXT,
  summary      TEXT,                   -- JSON summary object
  warnings     TEXT,                   -- JSON string[]
  generated_by TEXT NOT NULL DEFAULT 'template',
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_genproj_project ON generated_projects(project_id, created_at);

-- ------------------------------------------------- AI agent pool run records
-- One row per multi-worker regression execution (the "spawn QA agents" feature).
CREATE TABLE IF NOT EXISTS pool_runs (
  id           TEXT PRIMARY KEY,
  project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  run_id       TEXT,                   -- links to test_runs
  name         TEXT NOT NULL,
  workers      INTEGER NOT NULL DEFAULT 1,
  strategy     TEXT NOT NULL DEFAULT 'risk_weighted',
  config       TEXT,                   -- JSON AgentPoolConfig
  status       TEXT NOT NULL DEFAULT 'running',
  total        INTEGER NOT NULL DEFAULT 0,
  passed       INTEGER NOT NULL DEFAULT 0,
  failed       INTEGER NOT NULL DEFAULT 0,
  blocked      INTEGER NOT NULL DEFAULT 0,
  skipped      INTEGER NOT NULL DEFAULT 0,
  flaky        INTEGER NOT NULL DEFAULT 0,
  healed       INTEGER NOT NULL DEFAULT 0,
  retried      INTEGER NOT NULL DEFAULT 0,
  duration_ms  INTEGER NOT NULL DEFAULT 0,
  sequential_duration_ms INTEGER NOT NULL DEFAULT 0,
  speedup      REAL NOT NULL DEFAULT 0,
  ai_used      INTEGER NOT NULL DEFAULT 0,
  shards       TEXT,                   -- JSON PoolShard[]
  outcomes     TEXT,                   -- JSON PoolCaseOutcome[]
  ai_summary   TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pool_project ON pool_runs(project_id, created_at);
