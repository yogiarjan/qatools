/**
 * Matrix service — the digital traceability engine.
 *
 * This module owns the derivation logic for `matrix_links`: every artifact created by
 * lane A (requirements, use cases, scenarios, test cases) calls into here so the trace
 * graph is always up to date without the UI having to do bookkeeping.
 *
 * Cross-lane exports (ARCHITECTURE.md §6.1): `matrixService.impactOf`, `matrixService.document`.
 */

import { db } from '../../db/index.js';
import {
  pct,
  type CoverageStatus,
  type ImpactReport,
  type MatrixCell,
  type MatrixDocument,
  type RiskLevel,
  type TraceLinkType,
} from '@qatools/shared';
import {
  deleteLinksTouching,
  getRequirement,
  getScenario,
  getTestCase,
  getUseCase,
  linksOfTypeForFrom,
  linksOfTypeForTo,
  linksTouching,
  listDefectsOf,
  listRequirementsOf,
  listScenariosOf,
  listTestCasesOf,
  listUseCasesOf,
  listLinks,
  upsertLink,
  type LinkRow,
} from './repo.js';
import { LINK_KINDS, type LinkType, type SyncCounts } from './types.js';

/* ------------------------------------------------------------------ *
 * Link derivation
 * ------------------------------------------------------------------ */

function link(
  linkType: LinkType,
  projectId: string,
  fromId: string,
  toId: string,
  note?: string,
): { id: string; created: boolean } {
  const kinds = LINK_KINDS[linkType];
  return upsertLink({
    project_id: projectId,
    link_type: linkType,
    from_kind: kinds.from,
    from_id: fromId,
    to_kind: kinds.to,
    to_id: toId,
    note: note ?? null,
    created_by: 'lane-docs',
  });
}

/** requirement → use case (called when a use case is created/updated). */
export function linkRequirementToUseCase(
  requirementId: string,
  useCaseId: string,
  note?: string,
): { id: string; created: boolean } | null {
  const req = getRequirement(requirementId);
  const uc = getUseCase(useCaseId);
  if (!req || !uc) return null;
  return link('requirement_to_usecase', uc.project_id, requirementId, useCaseId, note);
}

/** use case → scenario (also re-points the requirement→usecase→scenario chain). */
export function linkUseCaseToScenario(
  useCaseId: string,
  scenarioId: string,
  note?: string,
): { id: string; created: boolean } | null {
  const uc = getUseCase(useCaseId);
  const sc = getScenario(scenarioId);
  if (!uc || !sc) return null;
  return link('usecase_to_scenario', sc.project_id, useCaseId, scenarioId, note);
}

/** scenario → test case. */
export function linkScenarioToTestCase(
  scenarioId: string,
  testCaseId: string,
  note?: string,
): { id: string; created: boolean } | null {
  const sc = getScenario(scenarioId);
  const tc = getTestCase(testCaseId);
  if (!sc || !tc) return null;
  return link('scenario_to_testcase', tc.project_id, scenarioId, testCaseId, note);
}

/** requirement → test case, derived transitively through the use case / scenario chain. */
export function linkRequirementToTestCase(
  requirementId: string,
  testCaseId: string,
  note?: string,
): { id: string; created: boolean } | null {
  const req = getRequirement(requirementId);
  const tc = getTestCase(testCaseId);
  if (!req || !tc) return null;
  return link('requirement_to_testcase', req.project_id, requirementId, testCaseId, note);
}

/**
 * Derives every link a test case implies:
 *  - scenario → testcase (its direct parent)
 *  - usecase → scenario is implied by the scenario row itself
 *  - requirement → testcase for every requirement reaching that scenario
 *  - testcase → automation (the engine/automation artifact it is bound to)
 */
export function deriveForTestCase(testCaseId: string): { created: number; total: number } {
  const tc = getTestCase(testCaseId);
  if (!tc) return { created: 0, total: 0 };

  let created = 0;
  let total = 0;
  const touched: Array<{ id: string; created: boolean } | null> = [];

  if (tc.scenario_id) {
    touched.push(linkScenarioToTestCase(tc.scenario_id, tc.id));
  } else if (tc.use_case_id) {
    // Orphan-by-design: a test case may hang directly off a use case.
    touched.push(link('usecase_to_testcase', tc.project_id, tc.use_case_id, tc.id));
  }

  for (const reqId of requirementsForTestCase(tc.id)) {
    touched.push(linkRequirementToTestCase(reqId, tc.id));
  }

  // testcase → automation: which engine artifact the case is bound to.
  touched.push(
    link('testcase_to_automation', tc.project_id, tc.id, tc.id, `engine:${tc.engine}`),
  );

  for (const t of touched) {
    if (!t) continue;
    total += 1;
    if (t.created) created += 1;
  }
  return { created, total };
}

/** Walks requirement → usecase → scenario and returns requirement ids reaching a test case. */
export function requirementsForTestCase(testCaseId: string): string[] {
  const tc = getTestCase(testCaseId);
  if (!tc) return [];

  const useCaseIds = new Set<string>();
  if (tc.use_case_id) useCaseIds.add(tc.use_case_id);

  if (tc.scenario_id) {
    const sc = getScenario(tc.scenario_id);
    if (sc?.use_case_id) useCaseIds.add(sc.use_case_id);
  }

  // Also honour explicitly linked use cases (manual matrix edits).
  for (const l of linksOfTypeForTo('scenario_to_testcase', testCaseId)) {
    const sc = getScenario(l.from_id);
    if (sc?.use_case_id) useCaseIds.add(sc.use_case_id);
  }

  const requirementIds = new Set<string>();
  for (const ucId of useCaseIds) {
    for (const l of linksOfTypeForTo('requirement_to_usecase', ucId)) {
      requirementIds.add(l.from_id);
    }
  }
  return [...requirementIds];
}

/* ------------------------------------------------------------------ *
 * Delete helpers — keep the graph free of dangling edges
 * ------------------------------------------------------------------ */

/**
 * Removes the derived edges that point at an artifact that no longer exists.
 * Manual links created by other lanes are only dropped when they reference the
 * deleted artifact itself (they would otherwise dangle).
 */
export function unlinkArtifact(artifactId: string): number {
  return deleteLinksTouching(artifactId);
}

/** Re-points the derived edges when a test case changes parent. */
export function retargetTestCaseParents(
  testCaseId: string,
  scenarioId: string | null,
  useCaseId: string | null,
): void {
  // Drop the old parent edge(s); the new one is recreated below.
  for (const l of linksOfTypeForTo('scenario_to_testcase', testCaseId)) {
    if (l.from_id !== scenarioId) db.prepare('DELETE FROM matrix_links WHERE id = ?').run(l.id);
  }
  for (const l of linksOfTypeForTo('usecase_to_testcase', testCaseId)) {
    if (l.from_id !== useCaseId) db.prepare('DELETE FROM matrix_links WHERE id = ?').run(l.id);
  }
  // Transitive requirement edges are recomputed from scratch.
  db.prepare(`DELETE FROM matrix_links WHERE link_type = 'requirement_to_testcase' AND to_id = ?`).run(
    testCaseId,
  );

  if (scenarioId) linkScenarioToTestCase(scenarioId, testCaseId);
  if (useCaseId) link('usecase_to_testcase', getTestCase(testCaseId)?.project_id ?? '', useCaseId, testCaseId);
  deriveForTestCase(testCaseId);
}

/** Re-points the usecase→scenario edge when a scenario moves to another use case. */
export function retargetScenarioParent(scenarioId: string, useCaseId: string | null): void {
  const old = linksOfTypeForTo('usecase_to_scenario', scenarioId);
  for (const l of old) {
    if (l.from_id !== useCaseId) db.prepare('DELETE FROM matrix_links WHERE id = ?').run(l.id);
  }
  if (useCaseId) linkUseCaseToScenario(useCaseId, scenarioId);

  // Rebuild requirement→testcase for the children of this scenario.
  for (const l of linksOfTypeForFrom('scenario_to_testcase', scenarioId)) {
    db.prepare(
      `DELETE FROM matrix_links WHERE link_type = 'requirement_to_testcase' AND to_id = ?`,
    ).run(l.to_id);
    deriveForTestCase(l.to_id);
  }
}

/* ------------------------------------------------------------------ *
 * Impact analysis
 * ------------------------------------------------------------------ */

type Kind = 'requirement' | 'usecase' | 'scenario' | 'testcase' | 'defect';

/**
 * Resolves an artifact id to its kind. Prefixes are only a fast path — the row must
 * actually exist, otherwise an unknown id such as `req_does_not_exist` would be
 * treated as a real requirement and `impactOf` would report an empty blast radius
 * instead of letting the caller 404.
 */
function kindOf(id: string): Kind | null {
  const prefix = id.slice(0, 4);
  if (prefix.startsWith('req') && getRequirement(id)) return 'requirement';
  if (prefix.startsWith('uc_') && getUseCase(id)) return 'usecase';
  if (prefix.startsWith('sc_') && getScenario(id)) return 'scenario';
  if (prefix.startsWith('tc_') && getTestCase(id)) return 'testcase';
  if (prefix.startsWith('bug') && db.prepare('SELECT id FROM defects WHERE id = ?').get(id)) {
    return 'defect';
  }
  // Fall back to a lookup — ids from other lanes may use different prefixes.
  if (getRequirement(id)) return 'requirement';
  if (getUseCase(id)) return 'usecase';
  if (getScenario(id)) return 'scenario';
  if (getTestCase(id)) return 'testcase';
  if (db.prepare('SELECT id FROM defects WHERE id = ?').get(id)) return 'defect';
  return null;
}

/**
 * Blast radius of an artifact: walk the graph in both directions until closure.
 * Used by lane B (regression selection) and lane C (execution impact).
 */
export async function impactOf(artifactId: string): Promise<ImpactReport> {
  const empty: ImpactReport = {
    artifact_kind: 'unknown',
    artifact_id: artifactId,
    artifact_code: null,
    artifact_title: null,
    affected_requirements: [],
    affected_use_cases: [],
    affected_scenarios: [],
    affected_test_cases: [],
    affected_defects: [],
    recommended_regression_suite: [],
    blast_radius: 0,
  };

  const startKind = kindOf(artifactId);
  if (!startKind) return empty;

  const seen = new Set<string>([artifactId]);
  const queue: string[] = [artifactId];
  const found: Record<Kind, Set<string>> = {
    requirement: new Set(),
    usecase: new Set(),
    scenario: new Set(),
    testcase: new Set(),
    defect: new Set(),
  };

  while (queue.length) {
    const current = queue.shift() as string;
    for (const l of linksTouching(current)) {
      for (const neighbor of [l.from_id, l.to_id]) {
        if (neighbor === current || seen.has(neighbor)) continue;
        seen.add(neighbor);
        const k = kindOf(neighbor);
        if (k) found[k].add(neighbor);
        queue.push(neighbor);
      }
    }
  }

  // The artifact itself belongs to its own bucket.
  found[startKind].delete(artifactId);

  const artifactCodeTitle = describe(startKind, artifactId);

  const affected_test_cases = [...found.testcase].map((id) => {
    const tc = getTestCase(id);
    return {
      id,
      code: tc?.code ?? id,
      title: tc?.title ?? '',
      is_regression: Number(tc?.is_regression ?? 0),
      risk_score: Number(tc?.risk_score ?? 0),
    };
  });
  affected_test_cases.sort((a, b) => b.risk_score - a.risk_score);

  const defectIds = new Set(found.defect);
  for (const tc of affected_test_cases) {
    const rows = db
      .prepare('SELECT id FROM defects WHERE test_case_id = ?')
      .all(tc.id) as Array<{ id: string }>;
    for (const r of rows) defectIds.add(r.id);
  }

  const affected_defects = [...defectIds].map((id) => {
    const row = db
      .prepare('SELECT id, code, title, status FROM defects WHERE id = ?')
      .get(id) as { id: string; code: string; title: string; status: string } | undefined;
    return row ?? { id, code: id, title: '', status: 'unknown' };
  });

  const report: ImpactReport = {
    artifact_kind: startKind,
    artifact_id: artifactId,
    artifact_code: artifactCodeTitle.code,
    artifact_title: artifactCodeTitle.title,
    affected_requirements: [...found.requirement].map((id) => {
      const r = getRequirement(id);
      return { id, code: r?.code ?? id, title: r?.title ?? '' };
    }),
    affected_use_cases: [...found.usecase].map((id) => {
      const u = getUseCase(id);
      return { id, code: u?.code ?? id, name: u?.name ?? '' };
    }),
    affected_scenarios: [...found.scenario].map((id) => {
      const s = getScenario(id);
      return { id, code: s?.code ?? id, title: s?.title ?? '' };
    }),
    affected_test_cases,
    affected_defects,
    recommended_regression_suite: [],
    blast_radius: 0,
  };

  report.recommended_regression_suite = affected_test_cases
    .filter((tc) => tc.is_regression === 1 || tc.risk_score >= 50)
    .map((tc) => tc.id);

  report.blast_radius =
    report.affected_requirements.length +
    report.affected_use_cases.length +
    report.affected_scenarios.length +
    report.affected_test_cases.length +
    report.affected_defects.length;

  return report;
}

function describe(kind: Kind, id: string): { code: string | null; title: string | null } {
  switch (kind) {
    case 'requirement': {
      const r = getRequirement(id);
      return { code: r?.code ?? null, title: r?.title ?? null };
    }
    case 'usecase': {
      const u = getUseCase(id);
      return { code: u?.code ?? null, title: u?.name ?? null };
    }
    case 'scenario': {
      const s = getScenario(id);
      return { code: s?.code ?? null, title: s?.title ?? null };
    }
    case 'testcase': {
      const t = getTestCase(id);
      return { code: t?.code ?? null, title: t?.title ?? null };
    }
    default: {
      const d = db.prepare('SELECT code, title FROM defects WHERE id = ?').get(id) as
        | { code: string; title: string }
        | undefined;
      return { code: d?.code ?? null, title: d?.title ?? null };
    }
  }
}

/* ------------------------------------------------------------------ *
 * The traceability document
 * ------------------------------------------------------------------ */

function severity(low: number, high: number): RiskLevel {
  if (high <= 2 && low === 0) return 'low';
  if (high >= 6) return 'high';
  return 'medium';
}

/**
 * Builds the full digital traceability matrix for a project:
 * one row per requirement (plus a synthetic row for unreachable test cases),
 * with the use cases / scenarios / test cases / defects it reaches.
 */
export async function document(projectId: string): Promise<MatrixDocument> {
  const requirements = listRequirementsOf(projectId);
  const allUseCases = listUseCasesOf(projectId);
  const allScenarios = listScenariosOf(projectId);
  const allTestCases = listTestCasesOf(projectId);
  const allDefects = listDefectsOf(projectId);
  const links = listLinks(projectId);

  const ucById = new Map(allUseCases.map((u) => [u.id, u]));
  const scById = new Map(allScenarios.map((s) => [s.id, s]));
  const tcById = new Map(allTestCases.map((t) => [t.id, t]));
  const defectByTestCase = new Map<string, string[]>();
  for (const d of allDefects) {
    if (!d.test_case_id) continue;
    const list = defectByTestCase.get(d.test_case_id) ?? [];
    list.push(d.id);
    defectByTestCase.set(d.test_case_id, list);
  }

  // Adjacency from the link table (authoritative, includes manual links).
  const reqToUc = new Map<string, Set<string>>();
  const ucToSc = new Map<string, Set<string>>();
  const scToTc = new Map<string, Set<string>>();
  const reqToTc = new Map<string, Set<string>>();
  const tcToDefect = new Map<string, Set<string>>();

  const push = (map: Map<string, Set<string>>, key: string, value: string) => {
    const set = map.get(key) ?? new Set<string>();
    set.add(value);
    map.set(key, set);
  };

  for (const l of links) {
    switch (l.link_type as TraceLinkType) {
      case 'requirement_to_usecase':
        push(reqToUc, l.from_id, l.to_id);
        break;
      case 'usecase_to_scenario':
        push(ucToSc, l.from_id, l.to_id);
        break;
      case 'scenario_to_testcase':
        push(scToTc, l.from_id, l.to_id);
        break;
      case 'requirement_to_testcase':
        push(reqToTc, l.from_id, l.to_id);
        break;
      case 'testcase_to_defect':
        push(tcToDefect, l.from_id, l.to_id);
        break;
      default:
        break;
    }
  }

  // FK columns are the safety net: if a link row is missing we still resolve the chain.
  for (const s of allScenarios) {
    if (s.use_case_id) push(ucToSc, s.use_case_id, s.id);
  }
  for (const t of allTestCases) {
    if (t.scenario_id) push(scToTc, t.scenario_id, t.id);
  }

  const reachableTestCases = new Set<string>();
  const cells: MatrixCell[] = requirements.map((req) => {
    const useCaseIds = new Set(reqToUc.get(req.id) ?? []);
    const scenarioIds = new Set<string>();
    const testCaseIds = new Set<string>(reqToTc.get(req.id) ?? []);
    const defectIds = new Set<string>();

    for (const ucId of useCaseIds) {
      for (const scId of ucToSc.get(ucId) ?? []) {
        scenarioIds.add(scId);
        for (const tcId of scToTc.get(scId) ?? []) testCaseIds.add(tcId);
      }
    }
    // Scenario-level links may also point straight at a test case.
    for (const scId of scenarioIds) {
      for (const tcId of scToTc.get(scId) ?? []) testCaseIds.add(tcId);
    }

    for (const tcId of testCaseIds) {
      reachableTestCases.add(tcId);
      for (const d of defectByTestCase.get(tcId) ?? []) defectIds.add(d);
      for (const d of tcToDefect.get(tcId) ?? []) defectIds.add(d);
    }

    const testCases = [...testCaseIds]
      .map((id) => tcById.get(id))
      .filter((t): t is NonNullable<typeof t> => Boolean(t));
    const automated = testCases.filter((t) => t.automation_status === 'automated').length;
    const coverage = coverageOf(useCaseIds.size, scenarioIds.size, testCaseIds.size);

    return {
      requirement_id: req.id,
      use_case_ids: [...useCaseIds],
      scenario_ids: [...scenarioIds],
      test_case_ids: [...testCaseIds],
      defect_ids: [...defectIds],
      coverage,
      coverage_pct: coveragePct(useCaseIds.size, scenarioIds.size, testCaseIds.size),
      automation_pct: pct(automated, testCases.length),
      risk: severity(0, testCases.length - automated),
    };
  });

  // Orphans: test cases reachable from no requirement at all.
  const orphanTestCases = allTestCases.filter((t) => !reachableTestCases.has(t.id));
  for (const orphan of orphanTestCases) {
    cells.push({
      requirement_id: `orphan:${orphan.id}`,
      use_case_ids: orphan.use_case_id ? [orphan.use_case_id] : [],
      scenario_ids: orphan.scenario_id ? [orphan.scenario_id] : [],
      test_case_ids: [orphan.id],
      defect_ids: defectByTestCase.get(orphan.id) ?? [],
      coverage: 'orphan',
      coverage_pct: 0,
      automation_pct: orphan.automation_status === 'automated' ? 100 : 0,
      risk: Number(orphan.risk_score) >= 65 ? 'high' : Number(orphan.risk_score) >= 35 ? 'medium' : 'low',
    });
  }

  const covered = cells.filter((c) => c.coverage === 'covered').length;
  const partial = cells.filter((c) => c.coverage === 'partial').length;
  const gaps = cells.filter((c) => c.coverage === 'gap').length;
  const orphans = cells.filter((c) => c.coverage === 'orphan').length;
  const allTestCasesInProject = allTestCases.length;
  const automatedAll = allTestCases.filter((t) => t.automation_status === 'automated').length;

  void scById;

  return {
    project_id: projectId,
    generated_at: new Date().toISOString(),
    cells,
    summary: {
      requirements: requirements.length,
      covered,
      partial,
      gaps,
      orphans,
      coverage_pct: pct(covered + partial, requirements.length),
      automation_pct: pct(automatedAll, allTestCasesInProject),
    },
  };
}

function coverageOf(useCases: number, scenarios: number, testCases: number): CoverageStatus {
  if (!useCases) return 'gap';
  if (!scenarios || !testCases) return 'partial';
  return 'covered';
}

function coveragePct(useCases: number, scenarios: number, testCases: number): number {
  if (!useCases) return 0;
  let score = 50; // having a use case already covers half the row
  if (scenarios) score += 25;
  if (testCases) score += 25;
  return score;
}

/* ------------------------------------------------------------------ *
 * Sync — rebuild every derived link from the FK columns
 * ------------------------------------------------------------------ */

export function sync(projectId: string): SyncCounts {
  const counts: SyncCounts = {
    requirement_to_usecase: 0,
    usecase_to_scenario: 0,
    scenario_to_testcase: 0,
    requirement_to_testcase: 0,
    testcase_to_automation: 0,
    removed: 0,
    total: 0,
  };

  const before = listLinks(projectId).length;

  const scenarios = listScenariosOf(projectId);
  const testCases = listTestCasesOf(projectId);

  // 1. usecase → scenario, straight from the FK column.
  for (const sc of scenarios) {
    if (!sc.use_case_id) continue;
    const r = linkUseCaseToScenario(sc.use_case_id, sc.id);
    if (r?.created) counts.usecase_to_scenario += 1;
  }

  // 2. scenario → testcase, straight from the FK column.
  for (const tc of testCases) {
    if (!tc.scenario_id) continue;
    const r = linkScenarioToTestCase(tc.scenario_id, tc.id);
    if (r?.created) counts.scenario_to_testcase += 1;
  }

  // 3. Transitive edges: requirement → usecase → testcase → automation.
  for (const tc of testCases) {
    const requirementIds = requirementsForTestCase(tc.id);
    const useCaseIds = useCaseIdsForTestCase(tc.id);

    for (const reqId of requirementIds) {
      for (const ucId of useCaseIds) {
        const r = linkRequirementToUseCase(reqId, ucId);
        if (r?.created) counts.requirement_to_usecase += 1;
      }
      const r = linkRequirementToTestCase(reqId, tc.id);
      if (r?.created) counts.requirement_to_testcase += 1;
    }

    const auto = link('testcase_to_automation', projectId, tc.id, tc.id, `engine:${tc.engine}`);
    if (auto.created) counts.testcase_to_automation += 1;
  }

  counts.total = listLinks(projectId).length;
  counts.removed = Math.max(0, before - counts.total);
  return counts;
}

/** Use case ids directly or transitively feeding a test case. */
function useCaseIdsForTestCase(testCaseId: string): string[] {
  const tc = getTestCase(testCaseId);
  if (!tc) return [];
  const ids = new Set<string>();
  if (tc.use_case_id) ids.add(tc.use_case_id);
  if (tc.scenario_id) {
    const sc = getScenario(tc.scenario_id);
    if (sc?.use_case_id) ids.add(sc.use_case_id);
  }
  return [...ids];
}

/* ------------------------------------------------------------------ *
 * Public service surface
 * ------------------------------------------------------------------ */

export const matrixService = {
  linkRequirementToUseCase,
  linkUseCaseToScenario,
  linkScenarioToTestCase,
  linkRequirementToTestCase,
  deriveForTestCase,
  requirementsForTestCase,
  retargetTestCaseParents,
  retargetScenarioParent,
  unlinkArtifact,
  impactOf,
  document,
  sync,
};

export default matrixService;
