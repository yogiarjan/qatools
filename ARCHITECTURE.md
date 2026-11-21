# QATools — Architecture & Lane Contract (v1)

> **This file is the binding contract between parallel workstreams. Do not change shared shapes
> without telling the Lead.** Anything marked **[FROZEN]** is owned by the Lead and must not be
> edited by lane owners.

## 1. Product in one paragraph

QATools is an AI-assisted, end-to-end Quality Assurance platform. It walks a QA team through a
**sequential, ordered testing lifecycle**: capture requirements into use cases → expand them into
test scenarios → derive test cases → build the digital traceability matrix → plan the QA project →
execute manual / DB / API / web-automation tests → let AI generate & heal automation → gate the
release on the **regression suite (the King of the Test)** → report QA metrics → certify the
learners who completed the training track.

## 2. Repository layout

```
qatools/
├─ apps/
│  ├─ api/            @qatools/api    — Fastify + better-sqlite3 + TypeScript  (OWNS ALL PERSISTENCE)
│  └─ web/            @qatools/web    — React 18 + Vite + TypeScript SPA       (ALL UI)
├─ packages/
│  └─ shared/         @qatools/shared — FROZEN domain vocabulary: types, enums, labels, zod schemas
├─ docs/              product + QA-process documentation, ADRs
└─ scripts/           smoke tests, seeders, utilities
```

## 3. Ownership map — **one writer per path**

| Lane | Owner | Write scope (exclusive) |
|---|---|---|
| **Foundation** | lead | `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.gitignore`, `packages/shared/**`, `scripts/smoke.mjs`, `scripts/clean.mjs`, root `README.md` |
| **A — Document Creation** | `lane-docs` | `apps/api/src/modules/{projects,usecases,scenarios,testcases,matrix,requirements,exports}/**`, `apps/web/src/features/{projects,usecases,scenarios,testcases,matrix}/**`, `docs/qa-process/**` |
| **B — QA Project Management** | `lane-pm` | `apps/api/src/modules/{cycles,sprints,regression,metrics,defects,runs,environment}/**`, `apps/web/src/features/{dashboard,cycles,regression,metrics,defects,environment}/**`, `docs/project-management/**` |
| **C — Automation Engines** | `lane-auto` | `apps/api/src/modules/{apitester,dbtester,webtester,execute}/**`, `apps/web/src/features/{apitester,dbtester,webtester,execute}/**`, `docs/automation/**` |
| **D — AI Layer** | `lane-ai` | `apps/api/src/modules/{ai,aimock}/**`, `apps/web/src/features/ai/**`, `docs/ai/**` |
| **E — Learning & Certificate** | `lane-learn` | `apps/api/src/modules/{courses,lessons,quizzes,certificates,enrollments}/**`, `apps/web/src/features/{learn,certificate,curriculum}/**`, `docs/curriculum/**` |
| **Verify** | `verifier` | read-only + `docs/verification/**` |

**Never edit a file outside your scope.** If you need a change in someone else's file, message the
Lead. `apps/api/src/server.ts` and `apps/web/src/App.tsx` are **lead-owned integration files**:
lanes export a route plugin / page component and tell the Lead, who wires it.

## 4. Runtime & stack decisions (do not deviate)

- **Node** ≥ 20 ESM everywhere (`"type": "module"`).
- **API**: Fastify 4, TypeScript run through `tsx` in dev; `tsc` build to `dist/`.
- **DB**: `better-sqlite3` (synchronous, native). Single file at `apps/api/data/qatools.db`
  (override with `QATOOLS_DB` env). WAL mode on.
- **Shared domain vocabulary**: `@qatools/shared` — types, enums, labels, zodiac-free plain TS.
- **Web**: React 18 + Vite 5 + TypeScript + React Router 6. **No Tailwind, no component library** —
  hand-written CSS using the **design tokens** in `apps/web/src/styles/tokens.css` (lead-owned).
  Plain `fetch` wrapper in `apps/web/src/lib/api.ts` (lead-owned).
- **No external services required to boot.** AI features degrade gracefully to a deterministic
  offline stub when no API key is configured.

## 5. [FROZEN] Domain vocabulary

The single most important contract. Lives in `packages/shared/src/`.

### 5.1 The ordered QA lifecycle (drives the whole product UX)

```ts
export const QA_STAGES = [
  'requirements',   // 1. Capture requirement
  'usecases',       // 2. Author use case
  'scenarios',      // 3. Derive scenarios
  'testcases',      // 4. Design test cases
  'matrix',         // 5. Traceability matrix
  'planning',       // 6. QA project & cycle planning
  'environment',    // 7. Environment & test data
  'execution',      // 8. Execute (manual / DB / API / web)
  'defects',        // 9. Log & triage defects
  'regression',     // 10. Regression — King of the Test
  'release',        // 11. Release gate
  'metrics',        // 12. QA metrics & reporting
] as const;
export type QaStage = (typeof QA_STAGES)[number];
```

### 5.2 Core entities

```ts
export type Priority = 'low' | 'medium' | 'high' | 'critical';
export type RiskLevel = 'low' | 'medium' | 'high';
export type CaseType = 'functional' | 'negative' | 'boundary' | 'security' | 'performance' | 'usability' | 'compatibility' | 'regression';
export type AutomationStatus = 'manual' | 'automated' | 'to_be_automated' | 'cannot_automate';
export type RunStatus = 'passed' | 'failed' | 'blocked' | 'skipped' | 'not_run';
export type LayerKind = 'web' | 'api' | 'db' | 'mobile' | 'unit';
export type DefectStatus = 'new' | 'triaged' | 'in_progress' | 'fixed' | 'retest' | 'verified' | 'reopened' | 'closed' | 'rejected' | 'deferred';
export type Severity = 'cosmetic' | 'minor' | 'major' | 'critical' | 'blocker';
```

Entities (`snake_case` columns in SQLite, `camelCase` in TS/JSON — the API layer converts):

`projects`, `requirements`, `use_cases`, `scenarios`, `test_cases`, `test_steps`,
`matrix_links`, `cycles`, `sprints`, `test_runs`, `run_results`, `defects`, `environments`,
`test_data_sets`, `api_collections`, `api_requests`, `db_checks`, `web_flows`,
`ai_generations`, `ai_settings`, `courses`, `modules`, `lessons`, `quizzes`, `quiz_questions`,
`enrollments`, `lesson_progress`, `certificates`, `activity_log`.

### 5.3 Entity-ID convention

All primary keys are `TEXT` ids with a typed prefix, generated by the API:

| Entity | Prefix | Example |
|---|---|---|
| project | `prj_` | `prj_01J8X…` |
| requirement | `req_` | `req_…` |
| use case | `uc_` | `uc_…` |
| scenario | `sc_` | `sc_…` |
| test case | `tc_` | `tc_…` |
| test step | `stp_` | `stp_…` |
| cycle | `cyc_` | `cyc_…` |
| sprint | `spr_` | `spr_…` |
| sprint scope | `scp_` | `scp_…` |
| test run | `run_` | `run_…` |
| run result | `res_` | `res_…` |
| defect | `bug_` | `bug_…` |
| environment | `env_` | `env_…` |
| test data set | `tds_` | `tds_…` |
| api collection | `col_` | `col_…` |
| api request | `apr_` | `apr_…` |
| db connection | `dbcn_` | `dbcn_…` |
| db check | `dbc_` | `dbc_…` |
| web flow | `wbf_` | `wbf_…` |
| matrix link | `mlk_` | `mlk_…` |
| ai generation | `aig_` | `aig_…` |
| activity log | `act_` | `act_…` |
| course | `crs_` | `crs_…` |
| course module | `mod_` | `mod_…` |
| lesson | `lsn_` | `lsn_…` |
| quiz | `qz_` | `qz_…` |
| quiz question | `qq_` | `qq_…` |
| enrollment | `enr_` | `enr_…` |
| lesson progress | `lp_` | `lp_…` |
| certificate | `cert_` | `cert_…` |

Implement with `newId(prefix)` from `@qatools/shared`.

> **Amendment (v1.1, lead ruling):** `dbc_` is reserved for **db checks** — the entity the original
> table named. `db_connections` uses **`dbcn_`** (it previously borrowed `dbc_`, which collided with
> the spec). Any module emitting `dbk_` for db checks must switch to `dbc_`.

Use **ULID-ish sortable ids**: `<prefix><base32-time><random>` so ids sort by creation time.

### 5.4 [FROZEN] `matrix_links` direction convention — **BINDING, read before querying**

`matrix_links` is the single source of truth for traceability, and **all lanes must agree on the
direction of every link type.** The rule is: **`from_id` is the *upstream / parent* artifact and
`to_id` is the *downstream / derived* artifact** — the links always point in the direction the QA
lifecycle flows (requirement → use case → scenario → test case).

| `link_type` | `from_kind` / `from_id` | `to_kind` / `to_id` | Meaning |
|---|---|---|---|
| `requirement_to_usecase` | `requirement` | `usecase` | this use case realises the requirement |
| `usecase_to_scenario` | `usecase` | `scenario` | this scenario was derived from the use case |
| `scenario_to_testcase` | `scenario` | `testcase` | this test case covers the scenario |
| `requirement_to_testcase` | **`requirement`** | **`testcase`** | derived shortcut link |
| `usecase_to_testcase` | `usecase` | `testcase` | derived shortcut link |
| `testcase_to_automation` | `testcase` | `automation` | the artifact that automates the case |
| `testcase_to_defect` | `testcase` | `defect` | the defect found by this case |
| `usecase_to_defect` | `usecase` | `defect` | derived shortcut link |

**Consequences every lane must honour:**

1. **To find what covers a requirement**, query links where **`from_id = <requirement id>`** and
   `link_type IN ('requirement_to_testcase','requirement_to_usecase')`, then resolve the downstream
   ids. Do **not** look for `to_id = <requirement id>` — a requirement is never the downstream end
   of a coverage link.
2. **To find the blast radius of an artifact**, walk **both** directions: downstream
   (`from_id = X`) for what it covers, upstream (`to_id = X`) for what depends on it.
3. **Coverage is derived from links, never from a denormalised column.** A requirement is `covered`
   when ≥1 test case is reachable from it; `partial` when reachable test cases exist but not every
   scenario has one; `gap` when none exist; `orphan` when a test case has no reachable requirement.
4. **`matrixService.document()` (Lane A) is the canonical coverage implementation.**
   `metricsService` (Lane B) **MUST** call it for `requirement_coverage_pct` instead of
   reimplementing the traversal — the two numbers are shown side by side in the UI and must never
   disagree.

> **Amendment (v1.1, lead ruling):** the original spec listed `TRACE_LINK_TYPES` without stating
> direction. Lane A (writer) stored `requirement → testcase` with `from_id = requirement`, while
> Lane B (reader) looked for `to_id = requirement`, so `requirement_coverage_pct` was permanently
> `0` even for fully covered projects — and readiness/go-no-go inherited the error. The table above
> is now binding. Lane A additionally writes the derived shortcut links so downstream consumers do
> not need multi-hop traversal.

## 6. [FROZEN] API conventions

- Base path: `/api`.
- JSON in, JSON out. `Content-Type: application/json`.
- **List envelope**: `{ "data": T[], "total": number }`.
- **Error envelope**: `{ "error": { "code": string, "message": string, "details"?: unknown } }`
  with a proper HTTP status.
- **CUD responses** return the full mutated row as `{ "data": T }`.
- Timestamps are ISO-8601 UTC strings (`created_at`, `updated_at`).
- Health: `GET /api/health` → `{ status: 'ok', version, uptime, db: 'ok' }`.
- Every module registers a Fastify plugin: `export default async function routes(app: FastifyInstance)`.
- The Lead registers modules in `apps/api/src/server.ts` in **stage order**.

### 6.1 [FROZEN] Cross-lane service surface

Lanes must expose these so other lanes can call them **in-process** rather than via HTTP:

| Provider lane | Exported symbol | Location | Consumed by |
|---|---|---|---|
| D | `aiService.generate<T>(task, input, ctx?): Promise<AiResult<T>>` | `apps/api/src/modules/ai/index.ts` | A, B, C, E |
| D | `aiService.status(): Promise<AiStatus>` | same | all |
| C | `executeService.runCase(caseId, opts): Promise<RunResult>` | `apps/api/src/modules/execute/index.ts` | B (regression) |
| C | `executeService.runSuite(ids, opts): Promise<SuiteResult>` | same | B |
| A | `matrixService.impactOf(artifactId): Promise<ImpactReport>` | `apps/api/src/modules/matrix/index.ts` | B, C |
| B | `metricsService.snapshot(projectId): Promise<MetricsSnapshot>` | `apps/api/src/modules/metrics/index.ts` | A, C, E |
| B | `regressionService.selectSuite(projectId, opts): Promise<RegressionPlan>` | `apps/api/src/modules/regression/index.ts` | C |
| foundation | `db` (better-sqlite3 handle) | `apps/api/src/db/index.ts` | all |

If a dependency is not ready yet, **code against the interface and use a local fallback**; never
block. Tell the Lead what you stubbed.

## 7. [FROZEN] Database access rules

- The Lead owns `apps/api/src/db/index.ts` (connection + `migrate()` runner) and
  `apps/api/src/db/schema.sql` — **the full schema is pre-written there so no lane needs to write
  DDL**. Read it; if you need a table or column that is missing, ask the Lead.
- Each module creates its own **repository file** `<module>/repo.ts` with SQL against the frozen
  schema. Only the module that owns the entity writes to its table.
- Use `db.prepare(...).all()/get()/run()`. Parameterized statements only.
- Wrap multi-statement writes in `db.transaction(fn)`.

## 8. [FROZEN] Web app conventions

- `apps/web/src/App.tsx` (lead-owned) declares routes. Each lane delivers a **default-exported
  page component** at `apps/web/src/features/<area>/<Page>.tsx`.
- Sidebar navigation groups by lifecycle stage; the Lead owns the nav config and will import each
  lane's exported `navEntries` (optional, see below).
- **Each lane MAY export** from its feature folder an `nav.ts`:
  ```ts
  import type { NavEntry } from '../../lib/nav'; // lead-owned type
  export const navEntries: NavEntry[] = [
    { id: 'usecases', label: 'Use Cases', path: '/usecases', stage: 'usecases', icon: '📘' },
  ];
  ```
  If absent, the Lead wires the route manually.
- **Styling**: import nothing but global CSS. Use the class names from
  `apps/web/src/styles/components.css` (lead-owned): `.card`, `.btn`, `.btn-primary`, `.btn-ghost`,
  `.btn-danger`, `.input`, `.select`, `.textarea`, `.table`, `.badge`, `.badge-*`, `.grid`,
  `.row`, `.stack`, `.modal`, `.modal-panel`, `.tabs`, `.tab`, `.empty`, `.spinner`, `.toast`,
  `.stat`, `.stat-value`, `.stat-label`, `.progress`, `.progress-bar`, `.chip`, `.toolbar`,
  `.page-header`, `.page-title`, `.page-sub`, `.sidebar`, `.nav-item`, `.nav-group`.
  Add **no** new global CSS; scope any extra CSS inside your feature with a unique prefix class,
  e.g. `.uc-…` for use cases.
- Tokens available as CSS vars: `--bg`, `--bg-elev`, `--surface`, `--border`, `--text`, `--text-dim`,
  `--accent` (#7c3aed purple), `--accent-2` (#db2777 pink), `--ok`, `--warn`, `--err`, `--info`,
  `--radius`, `--shadow`, `--font`, `--mono`, `--space-1..8`.
- **API access**: `import { api } from '../../lib/api';` → `api.get<T>(path)`, `api.post`,
  `api.patch`, `api.del`. It throws `ApiError` with `.code` and `.message`. Show errors with
  `import { toast } from '../../lib/toast';`.
- Every page must handle three states: **loading** (`.spinner`), **error**, **empty** (`.empty`).

## 9. Definition of Done for every lane

1. `pnpm -F @qatools/api typecheck` and `pnpm -F @qatools/web typecheck` pass with **zero** errors.
2. `pnpm --filter @qatools/api test` passes (lane adds its own tests).
3. Your routes respond correctly — prove it with `curl`/`Invoke-RestMethod` output pasted into
   your completion report.
4. Your page renders — report the route + what the user sees.
5. No writes outside your declared scope.
6. Documentation under `docs/<your-area>/` explaining the feature **in Bahasa Indonesia**
   (product language: Indonesian users, English code identifiers).

## 10. Language policy

- **UI copy: Bahasa Indonesia** (the product serves Indonesian QA learners/professionals).
- **Code identifiers, comments, commit messages, docs/ADRs: English**, except user-facing docs which
  may be Indonesian. Mixed is fine in `docs/`.
