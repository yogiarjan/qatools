/**
 * Matrix repository — all SQL against `matrix_links` plus the read-only joins the
 * traceability document needs.
 *
 * Lane A owns the derivation logic for `matrix_links`. Lane D may also INSERT rows
 * for AI-created artifacts; we only ever delete rows we created (created_by='lane-docs'
 * or 'system') and never touch rows another lane inserted by hand.
 */

import { db, newId, nowIso } from '../../db/index.js';
import type { LinkType } from './types.js';

export interface LinkRow {
  id: string;
  project_id: string;
  link_type: string;
  from_kind: string;
  from_id: string;
  to_kind: string;
  to_id: string;
  note: string | null;
  created_at: string;
  created_by: string;
}

export function findLink(
  linkType: LinkType,
  fromId: string,
  toId: string,
): LinkRow | undefined {
  return db
    .prepare('SELECT * FROM matrix_links WHERE link_type = ? AND from_id = ? AND to_id = ?')
    .get(linkType, fromId, toId) as LinkRow | undefined;
}

export function getLink(id: string): LinkRow | undefined {
  return db.prepare('SELECT * FROM matrix_links WHERE id = ?').get(id) as LinkRow | undefined;
}

/** Idempotent insert: returns the existing row id when the link is already present. */
export function upsertLink(input: {
  project_id: string;
  link_type: LinkType;
  from_kind: string;
  from_id: string;
  to_kind: string;
  to_id: string;
  note?: string | null;
  created_by?: string;
}): { id: string; created: boolean } {
  const existing = findLink(input.link_type, input.from_id, input.to_id);
  if (existing) return { id: existing.id, created: false };

  const id = newId('lnk_');
  db.prepare(
    `INSERT INTO matrix_links
       (id, project_id, link_type, from_kind, from_id, to_kind, to_id, note, created_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.project_id,
    input.link_type,
    input.from_kind,
    input.from_id,
    input.to_kind,
    input.to_id,
    input.note ?? null,
    nowIso(),
    input.created_by ?? 'lane-docs',
  );
  return { id, created: true };
}

export function deleteLink(id: string): number {
  return db.prepare('DELETE FROM matrix_links WHERE id = ?').run(id).changes;
}

export function listLinks(projectId: string, linkType?: string): LinkRow[] {
  if (linkType) {
    return db
      .prepare('SELECT * FROM matrix_links WHERE project_id = ? AND link_type = ? ORDER BY created_at')
      .all(projectId, linkType) as unknown as LinkRow[];
  }
  return db
    .prepare('SELECT * FROM matrix_links WHERE project_id = ? ORDER BY created_at')
    .all(projectId) as unknown as LinkRow[];
}

/** Every link touching an artifact, in either direction. */
export function linksTouching(artifactId: string): LinkRow[] {
  return db
    .prepare('SELECT * FROM matrix_links WHERE from_id = ? OR to_id = ?')
    .all(artifactId, artifactId) as unknown as LinkRow[];
}

export function linksOfTypeForFrom(linkType: LinkType, fromId: string): LinkRow[] {
  return db
    .prepare('SELECT * FROM matrix_links WHERE link_type = ? AND from_id = ?')
    .all(linkType, fromId) as unknown as LinkRow[];
}

export function linksOfTypeForTo(linkType: LinkType, toId: string): LinkRow[] {
  return db
    .prepare('SELECT * FROM matrix_links WHERE link_type = ? AND to_id = ?')
    .all(linkType, toId) as unknown as LinkRow[];
}

export function deleteLinksTouching(artifactId: string): number {
  return db
    .prepare('DELETE FROM matrix_links WHERE from_id = ? OR to_id = ?')
    .run(artifactId, artifactId).changes;
}

/* ------------------------------- lookups -------------------------------- */

export interface RequirementRow {
  id: string;
  project_id: string;
  code: string;
  title: string;
  priority: string;
  status: string;
}

export function getRequirement(id: string): RequirementRow | undefined {
  return db
    .prepare('SELECT id, project_id, code, title, priority, status FROM requirements WHERE id = ?')
    .get(id) as RequirementRow | undefined;
}

export interface UseCaseRow {
  id: string;
  project_id: string;
  code: string;
  name: string;
  priority: string;
  risk: string;
  status: string;
}

export function getUseCase(id: string): UseCaseRow | undefined {
  return db
    .prepare('SELECT id, project_id, code, name, priority, risk, status FROM use_cases WHERE id = ?')
    .get(id) as UseCaseRow | undefined;
}

export interface ScenarioRow {
  id: string;
  project_id: string;
  use_case_id: string | null;
  code: string;
  title: string;
  kind: string;
  priority: string;
}

export function getScenario(id: string): ScenarioRow | undefined {
  return db
    .prepare(
      'SELECT id, project_id, use_case_id, code, title, kind, priority FROM scenarios WHERE id = ?',
    )
    .get(id) as ScenarioRow | undefined;
}

export interface TestCaseRow {
  id: string;
  project_id: string;
  scenario_id: string | null;
  use_case_id: string | null;
  code: string;
  title: string;
  automation_status: string;
  engine: string;
  is_regression: number;
  risk_score: number;
  priority: string;
}

export function getTestCase(id: string): TestCaseRow | undefined {
  return db
    .prepare(
      `SELECT id, project_id, scenario_id, use_case_id, code, title, automation_status, engine,
              is_regression, risk_score, priority
         FROM test_cases WHERE id = ?`,
    )
    .get(id) as TestCaseRow | undefined;
}

export function listRequirementsOf(projectId: string): RequirementRow[] {
  return db
    .prepare(
      `SELECT id, project_id, code, title, priority, status FROM requirements
        WHERE project_id = ? ORDER BY code COLLATE NOCASE, created_at`,
    )
    .all(projectId) as unknown as RequirementRow[];
}

export function listUseCasesOf(projectId: string): UseCaseRow[] {
  return db
    .prepare(
      `SELECT id, project_id, code, name, priority, risk, status FROM use_cases
        WHERE project_id = ? ORDER BY code COLLATE NOCASE, created_at`,
    )
    .all(projectId) as unknown as UseCaseRow[];
}

export function listScenariosOf(projectId: string): ScenarioRow[] {
  return db
    .prepare(
      `SELECT id, project_id, use_case_id, code, title, kind, priority FROM scenarios
        WHERE project_id = ? ORDER BY code COLLATE NOCASE, created_at`,
    )
    .all(projectId) as unknown as ScenarioRow[];
}

export function listTestCasesOf(projectId: string): TestCaseRow[] {
  return db
    .prepare(
      `SELECT id, project_id, scenario_id, use_case_id, code, title, automation_status, engine,
              is_regression, risk_score, priority
         FROM test_cases WHERE project_id = ? ORDER BY code COLLATE NOCASE, created_at`,
    )
    .all(projectId) as unknown as TestCaseRow[];
}

export interface DefectRow {
  id: string;
  code: string;
  title: string;
  status: string;
  test_case_id: string | null;
  severity: string;
}

export function listDefectsOf(projectId: string): DefectRow[] {
  return db
    .prepare(
      'SELECT id, code, title, status, test_case_id, severity FROM defects WHERE project_id = ? ORDER BY code',
    )
    .all(projectId) as unknown as DefectRow[];
}

export interface IdCodeTitle {
  id: string;
  code: string;
  title: string | null;
}

export function projectArtifactCounts(projectId: string): {
  requirements: number;
  use_cases: number;
  scenarios: number;
  test_cases: number;
  defects: number;
} {
  const count = (table: string): number => {
    const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE project_id = ?`).get(projectId) as
      | { n: number }
      | undefined;
    return Number(row?.n ?? 0);
  };
  return {
    requirements: count('requirements'),
    use_cases: count('use_cases'),
    scenarios: count('scenarios'),
    test_cases: count('test_cases'),
    defects: count('defects'),
  };
}
