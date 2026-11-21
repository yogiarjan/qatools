# QATools — Independent Verification Report

**Verifier:** `verifier` (independent; read-only over all lane source)
**Date:** 2026-11-21
**Repo:** `qatools/`
**Environment:** bundled Node **v24.21.0**, Windows, run from repo root
**Contract verified against:** `ARCHITECTURE.md` (v1 + the v1.1 prefix amendment)

```
$env:PATH = "C:\Users\yogia\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin;$env:PATH"
```

All commands below were **re-run by me** on the final tree. Raw output is in
[`_verify/raw-output.txt`](../../_verify/raw-output.txt). Nothing in this report is taken from a lane's
completion claim; every number was produced by a command I executed.

**Headline:** the platform boots, the complete ordered QA lifecycle works end-to-end over real HTTP
(58/58 assertions), both typechecks are clean, the web build succeeds, and all 204 lane tests pass.
Every blocker I raised during the build was reproducible, reported with evidence, and is now
**verified fixed**. Three minor defects remain open; none is release-blocking.

---

## 1. PASS/FAIL matrix

| # | Check | Exact command | Observed output | Result |
|---|---|---|---|---|
| 1 | API boots; all modules register | `node scripts/probe.mjs /api/projects /api/courses /api/ai/settings /api/execute/capabilities` | `MODULES 21/21 registered`; 4 probes all `200`; `PROBE_RESULT=PASS` | **PASS** |
| 2 | Health contract | `GET /api/health` | `{"status":"ok","version":"0.1.0","db":"ok",...}` | **PASS** |
| 3 | API typecheck | `node node_modules/typescript/bin/tsc --noEmit -p apps/api/tsconfig.json` | no output, `EXIT=0` (was **37 errors**) | **PASS** |
| 4 | Web typecheck | `node node_modules/typescript/bin/tsc --noEmit -p apps/web/tsconfig.json` | no output, `EXIT=0` (was **25 errors**) | **PASS** |
| 5 | Web production build | `cd apps/web && node node_modules/vite/bin/vite.js build` | `✓ 72 modules transformed` · `✓ built in 5.59s` · `EXIT=0` | **PASS** |
| 6 | Built bundle exists | `Get-ChildItem apps/web/dist -Recurse -File` | `dist/index.html` 0.96 kB · `assets/index-Bw2r8p4a.css` 28.72 kB · `assets/index-BieMqEEf.js` 531.51 kB · `.js.map` | **PASS** |
| 7 | Lane tests (documented invocation) | `node --test --import ./apps/api/node_modules/tsx/dist/loader.mjs apps/api/test/*.test.ts` | `tests 204` · `pass 204` · `fail 0` (was **196/203**) | **PASS** |
| 8 | Curriculum seeder (run 1) | `$env:QATOOLS_DB=<scratch>; node apps/api/node_modules/tsx/dist/cli.mjs apps/api/src/seed/run.ts` | `SEED_RESULT=OK` · `9 courses · 32 modules · 101 lessons (90 labs) · 9 quizzes · 52 questions` · `EXIT=0` | **PASS** |
| 9 | Curriculum seeder idempotent | same command, run 2 against the same DB | `new courses : none (all courses already existed — idempotent re-run)` · identical totals · `EXIT=0` | **PASS** |
| 10 | Demo seeder | `$env:QATOOLS_DB=<scratch>; node apps/api/node_modules/tsx/dist/cli.mjs apps/api/src/seed/demo.ts` | `QATools demo seed selesai` · req 8, uc 8, sc 24, tc 24, steps 52, links 104, api_requests 12, db_checks 6, web_flows 3, cycles 1, sprints 3, runs 7, results 52, defects 3 · `EXIT=0` | **PASS** |
| 11 | **Full ordered lifecycle E2E** | `node _verify/e2e.mjs` | `PASS=58 FAIL=0 SKIP=0 TOTAL=58` · `E2E_RESULT=PASS` | **PASS** |
| 12 | Whole-surface 5xx sweep | `node _verify/sweep-5xx.mjs` | `routes swept: 100 GET \| negative cases: 14` · `ZERO 5xx responses across the entire swept surface.` · `SWEEP=PASS` | **PASS** |
| 13 | UI smoke (routes + CSS) | `node _verify/ui-smoke.mjs` | `page imports: 26 \| routes: 27` · `every referenced class resolves to a real stylesheet rule` · `UI_SMOKE=PASS` | **PASS** |
| 14 | Id prefixes match §5.3 | step in `_verify/e2e.mjs` | `id prefixes match ARCHITECTURE.md §5.3 — 10 entity ids conform to §5.3` | **PASS** |
| 15 | Matrix ↔ metrics agreement | step in `_verify/e2e.mjs` | `matrix and metrics agree on requirement coverage — both report 100%` | **PASS** |
| 16 | API test executes for real | step in `_verify/e2e.mjs` | `status=passed assertions=2 evidence={"mode":"http","method":"GET","url":".../api/mock/products",...,"status":200,...}` | **PASS** |
| 17 | DB check executes for real | step in `_verify/e2e.mjs` | `status=passed evidence={"dialect":"sqlite","columns":["n"],"rows":[{"n":31}],"row_count":1,...}` | **PASS** |
| 18 | AI offline mode | step in `_verify/e2e.mjs` | `used_mock=true provider=mock latency=15ms items=3` | **PASS** |
| 19 | Regression plan explains itself | step in `_verify/e2e.mjs` | `selected=2 risk=65/high reason="MASUK — risiko tinggi 65 ≥ ambang 65; anggota faktor skor: ..."` | **PASS** |
| 20 | Defect traceable to failure | step in `_verify/e2e.mjs` | `id=bug_… code=BUG-001 linked_tc=tc_… run_result=res_…` | **PASS** |
| 21 | Certificate chain | steps in `_verify/e2e.mjs` | `13/13 lessons, progress_pct=100` → `1/1 quizzes passed; score=100` → `code=QAT-2026-… grade=A` → `valid=true` | **PASS** |
| 22 | Certificate hash is load-bearing | step in `_verify/e2e.mjs` | mutated enrollment email in SQLite → `valid=false reason="Data sertifikat tidak cocok dengan sidik verifikasinya…"` | **PASS** |
| 23 | Quiz answer key not leaked | step in `_verify/e2e.mjs` | `no answer_index/explanation in public course or quiz payloads` | **PASS** |
| 24 | SQL injection in filters | step in `_verify/e2e.mjs` | `12 attempts, statuses=200, projects still lists 1` | **PASS** |
| 25 | `readonly_guard` blocks writes | step in `_verify/e2e.mjs` | `400 {"error":{"code":"readonly_guard_violation",...}}` | **PASS** |
| 26 | Unknown ids → 404 not 500 | 10 steps in `_verify/e2e.mjs` | all `404` with the frozen error envelope | **PASS** |
| 27 | Malformed JSON / missing fields | steps in `_verify/e2e.mjs` | `400 {"error":{"code":"bad_request",...}}` | **PASS** |
| 28 | Certificate refused before completion | step in `_verify/e2e.mjs` | `409 conflict` on both gates | **PASS** |
| 29 | No native/C-toolchain dependency | lockfile + manifest audit (raw-output §14) | no `node-gyp`/`prebuild`/`better-sqlite3`/`sharp`/`canvas`/`bcrypt` markers; DB uses built-in `node:sqlite` | **PASS** |
| 30 | Engine capabilities honest | `GET /api/execute/capabilities` | per-engine `available`/`mode`/`reason`, e.g. `"db","mode":"sqlite (node:sqlite)","reason":"AKTIF untuk dialect sqlite memakai node:sqlite bawaan Node — tanpa kompilasi native."` | **PASS** |
| 31 | Input type validation | `node _verify/repro-input-validation.mjs` | object key coerced to `"OBJECTOBJECT"`, NUL persists in `name` — see **D1/D2** | **FAIL (minor)** |
| 32 | ARCHITECTURE.md stack accuracy | `Select-String ARCHITECTURE.md -Pattern "better-sqlite3"` | 3 matches (lines 27, 55, 221) while code uses `node:sqlite` — see **D3** | **FAIL (minor)** |

**Summary: 30 PASS, 2 FAIL (both minor, undocumented-behaviour/doc drift only).**

### 1.1 E2E lifecycle — the single most important check (raw, verbatim)

```
MODULES 21/21 registered
PASS  boot: /api/health ok + db ok
PASS  boot: all 21 declared modules register — 21/21
PASS  engine capabilities endpoint responds honestly
PASS  create project — id=prj_… key=E2E
PASS  create requirement REQ-001 (critical) — id=req_…
PASS  create use case UC-001 (+ auto link to requirement) — id=uc_…
PASS  create scenario SC-001 (happy path) / SC-002 (negative)
PASS  create test case TC-001 (api, regression, critical) — engine=api regression=1 risk=70
PASS  create test case TC-002 (manual, negative)
PASS  matrix: full chain linked ⇒ covered, arithmetic consistent — reqs=1 covered=1 partial=0 gaps=0 coverage_pct=100 cell=covered tc=2
PASS  create cycle → create sprint → add test case to sprint scope
PASS  create environment / API collection / API request → GET /api/mock/products
PASS  execute API test ⇒ REAL pass with evidence — status=passed assertions=2
PASS  create DB connection (dbcn_) → execute DB check (dbc_) ⇒ pass — row_count=1
PASS  id prefixes match ARCHITECTURE.md §5.3 — 10 entity ids conform to §5.3
PASS  AI status reports mode/provider — mode=mock provider=mock configured=false
PASS  AI generate offline ⇒ used_mock:true and real stub data — items=3
PASS  create test run → record manual run result = failed (res_)
PASS  promote failure → defect (traceable link) — bug_… linked_tc=tc_… run_result=res_…
PASS  regression plan selects high-risk case WITH a reason — risk=65/high
PASS  metrics: totals match reality and are internally consistent — tc=2(list=2) defects=1 req_cov=100%
PASS  matrix and metrics agree on requirement coverage — both report 100%
PASS  curriculum seeder runs clean on a scratch DB — 9 courses · 32 modules · 101 lessons · 9 quizzes · 52 questions
PASS  enroll learner in a seeded course — course=qa-introduction enrollment=enr_…
PASS  complete all lessons ⇒ progress reaches 100% — 13/13 lessons, progress_pct=100
PASS  quiz: answer key is NOT exposed by read routes (security)
PASS  pass every quiz in the course — 1/1 quizzes passed; sample score=100 pass_score=70
PASS  issue certificate after completion — code=QAT-2026-… grade=A score=100 hash=58b80419…
PASS  verify certificate with real code ⇒ valid — valid=true learner=Verifier E2E
PASS  certificate renders standalone HTML — HTML 4741 bytes, self-contained
PASS=58 FAIL=0 SKIP=0 TOTAL=58
E2E_RESULT=PASS
```

### 1.2 Adversarial results — every attempted 500-class failure

The sweep issued a legitimate GET to **100 routes** and 14 hostile requests.
**Zero unintended 5xx responses.**

| Attack | Observed | Verdict |
|---|---|---|
| Malformed JSON body | `400 bad_request` | correctly rejected |
| Missing required fields | `400 bad_request` | correctly rejected |
| 10 × unknown ids (`prj_`/`tc_`/`bug_`/`env_`/`run_`/`crs_`/`req_`/`uc_`/`cyc_`/`dbc_`) | all `404` + error envelope | no 500 leakage |
| SQL injection × 12 (`?q=`, `?search=`, `?status=`; `' OR 1=1 --`, `'; DROP TABLE projects; --`, `UNION SELECT … sqlite_master`) | all `200`; projects table intact afterwards | parameterised, safe |
| `readonly_guard` bypass (`DROP TABLE activity_log`) | `400 readonly_guard_violation` | block works |
| Certificate before completion | `409 conflict` (both gates) | gate works |
| Tampered certificate code | `{"valid":false,"reason":"Kode sertifikat tidak ditemukan…"}` | rejected |
| Tampered in-scope field (enrollment email mutated in SQLite) | `valid=false`, hash mismatch message | hash is real, not decorative |
| AI with bogus provider | `200` with `used_mock=true`, `degraded=false` | graceful, no 500 |
| Execute engine with no artifact | `200 {"status":"not_run",…}` | no 500 (see **O1**) |
| Unknown route | `404` + error envelope | conformant |
| Path traversal `..%2F..%2Fetc%2Fpasswd` | `404` | no traversal |
| **`GET /api/mock/flaky` → `500`** | `500 mock_flaky_failure … deterministic:true` | **intentional SUT feature** — `aimock/index.ts:168-183` fails 2 of every 3 calls on purpose so automation lanes can prove retry/healing. Not a defect. |

---

## 2. DEFECTS

Severity legend: **blocker** = platform cannot ship / core flow impossible · **major** = wrong result
on the happy path or a frozen-contract violation · **minor** = hygiene, robustness, or doc drift.

---

### D1 — MINOR — Wrong JSON types are silently coerced instead of rejected
**Status:** OPEN
**Reproduction**
```powershell
node _verify/repro-input-validation.mjs
# or directly:
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:5174/api/projects -ContentType application/json `
  -Body '{"key":{"a":1},"name":[1,2]}'
```
**Observed:** `201 Created`, with `"key":"OBJECTOBJECT"` and `"name":"1,2"` — the object is stringified
to `"[object Object]"` and then reduced by `normaliseKey()`.
**Expected:** `400`/`422` — a JSON object is not a valid project key.
**Responsible:** `apps/api/src/modules/projects/index.ts:50` (`String(body.key ?? '')`) and the
`normaliseKey()` helper at `apps/api/src/modules/projects/index.ts:30`.
**Impact:** low — garbage input creates a garbage-but-harmless row; no 500, no injection, no corruption.

---

### D2 — MINOR — NUL byte removed from `key` but persisted in `name`
**Status:** OPEN
**Reproduction**
```powershell
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:5174/api/projects -ContentType application/json `
  -Body '{"key":"A\u0000B","name":"n\u0000m"}'
```
**Observed:** `201`, `"key":"AB"` but `"name":"n\u0000m"` — the NUL survives in `name`.
**Expected:** reject, or sanitise both fields consistently.
**Responsible:** `apps/api/src/modules/projects/index.ts` — `str()` (used for `name`) has no control-character
filter, whereas `normaliseKey()` strips non-alphanumerics from `key`.
**Impact:** low — inconsistent sanitisation; a NUL byte in a display string is a latent rendering/export
hazard rather than an exploitable one.

---

### D3 — MINOR — `ARCHITECTURE.md` documents `better-sqlite3`, which the code no longer uses
**Status:** OPEN (documentation-only)
**Reproduction**
```powershell
Select-String -Path ARCHITECTURE.md -Pattern "better-sqlite3"
```
**Observed:** 3 matches — line 27 (`Fastify + better-sqlite3`), line 55 (`**DB**: better-sqlite3
(synchronous, native)`), line 221 (`db (better-sqlite3 handle)`).
The implementation uses Node's built-in `node:sqlite`:
`apps/api/src/db/index.ts:11` → `import { DatabaseSync, type StatementSync } from 'node:sqlite';`,
and the file header explicitly states "no native compilation required".
**Expected:** the contract document should describe the stack that is actually shipped.
**Responsible:** `ARCHITECTURE.md` (foundation/lead-owned), lines 27, 55, 221.
**Impact:** low to the runtime, but it is a **binding-contract inaccuracy** — and this specific line is the
one a reader would use to judge the C-toolchain question. I verified that question positively
(§4 below); the doc just names the wrong driver.

---

### D4 — BLOCKER → **FIXED & VERIFIED** — `db.prepare(...).all()` returned an object, not an array
**Status:** FIXED (re-verified)
**Found:** early build. **Every** list endpoint 500'd, including the plain happy path.
**Reproduction (historical, now passes)**
```powershell
node scripts/probe.mjs /api/projects
```
**Observed then:** `500 {"statusCode":500,...,"message":"rows.slice is not a function"}`
Stack: `TypeError: rows.slice is not a function at apps/api/src/modules/projects/index.ts:42:23`
**Root cause:** the `Db.prepare()` façade in `apps/api/src/db/index.ts` passed the whole array returned
by `node:sqlite` through `flatten()`, whose `Object.assign({}, row)` collapsed the array into
`{"0": {...}}`. Minimal proof recorded at the time:
`Array.isArray(all()) = false`, `ctor = Object`, `Object.keys(rows) = ["0"]`.
**Fix verified by me:** `Array.isArray(all()) = true`, `typeof rows.slice = function`,
`GET /api/projects -> 200 {"data":[],"total":0}`; the 12-payload SQL-injection sweep that previously
500'd now returns `200` on all attempts.
**Impact if shipped:** platform-wide — this broke every list route in all five lanes.

---

### D5 — BLOCKER → **FIXED & VERIFIED** — the Lead's demo seeder could not run at all
**Status:** FIXED (re-verified)
**Reproduction (historical, now passes)**
```powershell
$env:QATOOLS_DB="$env:TEMP\vseed-demo.db"
node apps/api/node_modules/tsx/dist/cli.mjs apps/api/src/seed/demo.ts
```
**Observed then:** `ReferenceError: Cannot determine intended module format because both 'require' and
top-level await are present.` → `code: 'ERR_AMBIGUOUS_MODULE_SYNTAX'`, `EXIT=1`, at
`apps/api/src/seed/demo.ts:1681` via `seedDemoProject` (`:1774`) and top-level `await` (`:1897`).
**Root cause:** ESM file mixing four `require()` calls (lines 1681, 1752, 1753, 1754) with top-level
`await`.
**Fix verified by me:** `EXIT=0`, full demo dataset produced (see matrix row 10).

---

### D6 — BLOCKER → **FIXED & VERIFIED** — curriculum seeder failed its own validation
**Status:** FIXED (re-verified)
**Reproduction (historical, now passes)**
```powershell
$env:QATOOLS_DB=<scratch>; node apps/api/node_modules/tsx/dist/cli.mjs apps/api/src/seed/run.ts
```
**Observed then:** `EXIT=1`,
`Error: curriculum content is invalid: - QA-INTRO-M2: expected 3–6 lessons, found 2` (plus
`QA-TECH-M1/M2/M3`, `QA-DB-M2/M3/M4`, `QA-PORT-M1`), thrown at
`apps/api/src/seed/curriculum-seed.ts:69` from `run.ts:29`. Lane E's content did not satisfy Lane E's own
validator, so `pnpm seed` and `docs/RUNNING.md` §5 were both dead, and the certificate chain could not be
reached at all.
**Fix verified by me:** `SEED_RESULT=OK`, `9 courses · 32 modules · 101 lessons (90 labs) · 9 quizzes ·
52 questions`, and **idempotent** — run 2 reports `none (all courses already existed)` with identical
totals.

---

### D7 — MAJOR → **FIXED & VERIFIED** — matrix said 100% coverage, metrics said 0%
**Status:** FIXED (re-verified)
**Reproduction (historical, now passes)**
```powershell
node _verify/repro-coverage.mjs
```
**Observed then** (same project, same `req→uc→sc→tc` chain, consecutive calls):
```
MATRIX summary = {"requirements":1,"covered":1,"partial":0,"gaps":0,"coverage_pct":100,...}
MATRIX cells   = [{"req":"req_01M7","cov":"covered","pct":100,"tc":1}]
METRICS coverage = {"requirement_coverage_pct":0,"test_case_execution_pct":0,"automation_pct":100,...}
>>> matrix coverage_pct = 100  vs  metrics requirement_coverage_pct = 0
```
**Root cause:** link **direction** mismatch across lanes. Lane A wrote the requirement→test-case link as
`from_id = requirement, to_id = testcase`:
```
requirement_to_usecase   requirement -> usecase
usecase_to_scenario      usecase     -> scenario
scenario_to_testcase     scenario    -> testcase
requirement_to_testcase  requirement -> testcase      <-- this direction
```
while `requirementCoverage()` in `apps/api/src/modules/metrics/service.ts` queried
`ml.to_id = r.id AND ml.from_kind = 'testcase'` — i.e. a link pointing **at** the requirement. Measured on
the live DB: *"Does ANY link point at the requirement?"* → `0`. So coverage was permanently 0 for every
project, and release readiness inherited it (my run showed `gate=no_go` on a 100%-covered project).
**Independent corroboration:** lane B's own suite contains
`matrix ↔ metrics agreement (§5.4)` → `metrics requirement_coverage_pct equals the matrix summary
coverage_pct`, which was **red** while the `covered by BOTH` case passed — pinning the defect to the
aggregate computation, exactly as diagnosed.
**Fix verified by me:** `matrix coverage_pct=100` and `metrics requirement_coverage_pct=100` now agree;
the e2e step `matrix and metrics agree on requirement coverage — both report 100%` PASSES, and the two
previously-red lane-b tests now pass (suite went `196/203` → `204/204`).

---

### D8 — MAJOR → **FIXED & VERIFIED** — `db_checks` used the wrong id prefix
**Status:** FIXED (re-verified)
**Reproduction (historical, now passes)**
```powershell
node _verify/repro-prefix.mjs
```
**Observed then:**
```
db_connection id  = dbc_01M7ZFK9TC7KHM6KH    (borrowed dbc_)
db_check      id  = dbk_01M7ZFKMA905Q7T0Y7    (WRONG; ARCHITECTURE.md:121 requires dbc_)
```
**Root cause:** `apps/api/src/modules/dbtester/repo.ts:54` used `'dbc_'` for connections while `:125` used
`'dbk_'` for checks — inverting the frozen §5.3 table, so the entity the spec assigns `dbc_` got an
undocumented prefix.
**Resolution:** the Lead issued an ARCHITECTURE.md v1.1 amendment (`dbc_` = db checks, `dbcn_` =
db connections) and lane-auto implemented it.
**Fix verified by me:** `db_connection id = dbcn_01M7…`, `db_check id = dbc_01M7…`; the e2e step
`id prefixes match ARCHITECTURE.md §5.3 — 10 entity ids conform to §5.3` PASSES.

---

### D9 — OBSERVATION (not a defect) — execute returns 200 with a *different* engine than requested
**Status:** OPEN, informational
**Reproduction**
```powershell
# TC-002 is a manual test case
POST /api/test-cases/<tc_manual>/execute  {"engine":"api"}
```
**Observed:** `200 {"data":{"status":"not_run","engine":"manual", logs:[…"Test case ini ber-engine
\"manual\". Eksekusi manual dicatat melalui Test Runs…"]}}`
**Assessment:** correct behaviour with an honest explanation, and importantly **not** a 500 or a fake
green. The caller requested `api` and received `manual`. A UI could mislead a user here, so a `409`/`400`
would be clearer than `200` with a substituted engine. Recorded as an observation, not a defect — no
wrong data is produced and the log states exactly what happened.

---

### D10 — OBSERVATION (not a defect) — `GET /api/mock/flaky` returns 500 by design
**Status:** EXPECTED
The only 5xx in the entire sweep. `apps/api/src/modules/aimock/index.ts:168-183` fails 2 of every 3 calls
deterministically so automation lanes can prove retry/healing. It is the system under test, not the
platform. Correctly excluded from the defect list.

---

## 3. Scope & process compliance

- **Write scope:** I wrote only inside `docs/verification/` and `_verify/`. I made **no** change to any
  lane's source. Every defect above was reported to the owning lane and the Lead, not patched by me.
- **`git status` (final tree):** all lane module directories present and untracked as expected during the
  build; `_verify/` is my scope. Two stray root-level artifacts exist **outside every declared write
  scope** in ARCHITECTURE.md §3 (the root is foundation/lead-owned) and should be resolved before the
  final commit: `_cmsg.txt` (shows as **deleted**) and `_v.log` (untracked, 3394 bytes).
- **No dependency added by me**, and none was added by any lane that introduces a native build step
  (see §4).
- **Note on my own harness:** my first pass at `_verify/e2e.mjs` encoded several guessed route paths that
  did not exist, producing false FAILs. I corrected this by extracting the **real** route surface from
  the source (`_verify/dump-routes.mjs`, 158 routes) and re-deriving every call site from the handlers.
  The final script asserts only against documented behaviour. Similarly, early "unknown CSS class" and
  "external asset" flags were **my** checker's false positives (template-literal interpolation,
  TypeScript union members, and a legitimate hyperlink); I fixed the checker rather than reporting them
  as defects. The certificate-tamper test was also corrected: `learner_name` is deliberately **not** one
  of the four hash inputs (`code|learner_email|course_id|issued_at`), so I tamper an in-scope field.

---

## 4. Dependency / C-toolchain audit (explicitly requested)

```
Declared dependencies — all pure JS, no native build step:
  root   concurrently, typescript
  api    fastify, @fastify/cors, @fastify/cookie, @fastify/multipart, @qatools/shared
         dev: tsx, typescript, @types/node
  web    react, react-dom, react-router-dom, @qatools/shared
         dev: vite, @vitejs/plugin-react, typescript, @types/react, @types/react-dom
  shared dev: typescript

pnpm-lock.yaml search for node-gyp|prebuild|nan@|bindings@|better-sqlite3|sharp@|canvas@|bcrypt
  -> (none found)

DB driver actually used: apps/api/src/db/index.ts:11  import { DatabaseSync } from 'node:sqlite'
```

**Conclusion: a plain `pnpm install` on a machine with no C toolchain will succeed.** The only
database driver is Node's built-in `node:sqlite`, which I confirmed works with no compilation on the
bundled Node v24 (`node -e "new (require('node:sqlite').DatabaseSync)(':memory:')"` → OK). No `.node`
binary is compiled from source by this project. The two `.node` files present in
`node_modules/.pnpm` belong to `@rollup/rollup-win32-*`, which ship **prebuilt** binaries via optional
dependencies — they are not compiled locally.

One stale artifact, non-blocking: `apps/api/node_modules/better-sqlite3` and
`apps/api/node_modules/@types/better-sqlite3` exist as **dangling junctions** whose `.pnpm` targets no
longer exist (`require.resolve('better-sqlite3')` → `MODULE_NOT_FOUND`, and the directory cannot be
read through). No source file imports it (the only occurrence is a comment noting the façade reads like
better-sqlite3). `pnpm install` resolves them away; they are leftovers from an earlier dependency, not a
live dependency. Combined with **D3**, the doc — not the code — is what names `better-sqlite3`.

---

## 5. NOT VERIFIED

Stated explicitly, with the reason, so no reader mistakes silence for proof.

1. **Browser-rendered UI behaviour.** I verified that all 27 routes resolve to files that exist and
   default-export a component, that the TypeScript compiles, and that the production bundle builds. I did
   **not** render any page in a real browser. Therefore "pages do not crash on empty/partial data" is
   **not** proven at runtime — it is supported only by (a) `ARCHITECTURE.md` §8's loading/error/empty
   requirement existing in code paths I read, and (b) empty-state API responses being handled during the
   sweep. No headless browser is available in this environment and adding one would breach my no-new-
   dependency constraint. **This is the largest remaining gap.**
2. **Web engine (`webtester`) real execution against a live browser.** The engine's selector matcher has
   a lane-c unit test, and its routes respond, but I did not drive a real browser. `GET /api/mock/demo`
   exists as the intended HTML target.
3. **Non-SQLite dialects.** `dbtester` advertises `postgres`/`mysql`, and `execute/capabilities` honestly
   reports availability per dialect. I executed DB checks against **sqlite only** (`node:sqlite`); no
   Postgres/MySQL server is present. The engine's own capability report states the limitation rather than
   overclaiming.
4. **Live AI providers.** I verified offline/mock mode thoroughly (`used_mock:true`, real stub output,
   graceful bogus-provider handling, status honesty at `configured:false`). No provider API key exists in
   this environment, so **live** DeepSeek/OpenAI/Anthropic/Google/Ollama paths are unverified.
5. **`pnpm install` from a clean checkout.** I audited manifests and the lockfile, and confirmed no native
   markers, but I did not delete `node_modules` and re-install: dependencies were pre-installed and doing
   so would destroy the environment other lanes are actively using. The dependency evidence is strong but
   the end-to-end install was not executed.
6. **`pnpm -F @qatools/api test` / `pnpm -r typecheck` as invoked by the package manager.** `pnpm` is not
   on `PATH` in this environment. I ran the **equivalent** commands directly (`tsc --noEmit -p …` and
   `node --test --import … apps/api/test/*.test.ts`), which is what those scripts execute. The npm-script
   wrapper itself is untested.
7. **`docs/` lane documentation quality.** `docs/RUNNING.md` exists and is accurate. I did not review the
   per-lane Bahasa Indonesia feature documentation required by `ARCHITECTURE.md` §9.6 for correctness or
   completeness — checking prose accuracy for five lanes' feature docs was outside the time budget, and
   the requested adversarial targets were all code/contract-level.
8. **Concurrency/load behaviour.** All testing was single-client and sequential. No load, race, or
   multi-user testing was performed; the WAL-mode "single file" design and `db.transaction()` usage were
   read but not stress-tested.
9. **`arena`/ordering flakiness beyond what I observed.** lane-b was order-dependent earlier (passing
   alone, failing in the full-suite invocation); after the metrics fix the full suite is green twice in a
   row. I did not run the suite enough times to characterise residual flakiness statistically.

---

## 6. Verdict

The ordered QA lifecycle — the product's central promise — is **proven working end-to-end over real
HTTP** on an empty scratch database: requirements → use cases → scenarios → test cases → traceability
matrix → cycle/sprint/scope → environment → real API execution against the built-in mock SUT → real DB
check → offline AI → manual run → defect promotion with a traceable link → risk-based regression plan
with written reasons → metrics that reconcile with the list endpoints → enrollment → lesson completion →
quiz → certificate issuance → public verification that genuinely detects tampering.

Both typechecks are clean, the production bundle builds, all 204 lane tests pass, all 21 modules
register, and 100 routes plus 14 hostile requests produced **zero unintended 5xx responses**. Every
blocker raised during the build was fixed and independently re-verified.

The three open defects are real but none blocks release: two are input-validation hygiene issues that
produce no 500 and no corruption (D1, D2), and one is documentation drift naming a database driver the
code no longer uses (D3 — the underlying engineering decision is *sound*, since removing the native
dependency is what makes the C-toolchain-free install possible).

The one gap that keeps this from being an unconditional pass is **§5.1**: no page was rendered in a real
browser, so "pages do not crash on empty/partial data" rests on static analysis plus API-level evidence
rather than an observed render.

**VERDICT: SHIP** — with the caveat that the three minor defects (D1 type coercion, D2 NUL-byte
sanitisation, D3 `better-sqlite3` doc drift) and the two stray root artifacts (`_cmsg.txt`, `_v.log`) be
cleaned up, and that the browser-render gap in §5.1 be closed by a manual UI pass before the platform is
demonstrated to end users. No blocker remains open.
