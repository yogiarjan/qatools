/**
 * codegen repository — SQL for the `generated_projects` table (JSON columns).
 * Only the codegen module writes to this table.
 */

import type { GeneratedFile, GeneratedProject, GeneratedProjectMeta } from '@qatools/shared';
import { db, findById, newId, nowIso, parseJson, toJson } from '../../db/index.js';

/** The raw row shape of `generated_projects`. */
interface GeneratedProjectRow {
  id: string;
  project_id: string;
  framework: string;
  language: string;
  name: string;
  files: string;
  readme: string | null;
  summary: string | null;
  warnings: string | null;
  generated_by: string;
  created_at: string;
}

export interface SaveInput {
  project_id: string;
  framework: string;
  language: string;
  name: string;
  files: GeneratedFile[];
  readme: string;
  summary: GeneratedProject['summary'];
  warnings: string[];
  generated_by: 'ai' | 'template';
}

export function save(input: SaveInput): GeneratedProject {
  const id = newId('gen_');
  const createdAt = nowIso();
  db.prepare(
    `INSERT INTO generated_projects
       (id, project_id, framework, language, name, files, readme, summary, warnings, generated_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.project_id,
    input.framework,
    input.language,
    input.name,
    toJson(input.files) ?? '[]',
    input.readme,
    toJson(input.summary),
    toJson(input.warnings),
    input.generated_by,
    createdAt,
  );
  return findByPk(id) as GeneratedProject;
}

/** Rehydrates a full `GeneratedProject` (used by GET /codegen/:id and the download route). */
export function findByPk(id: string): GeneratedProject | undefined {
  const row = findById<GeneratedProjectRow>('generated_projects', id);
  if (!row) return undefined;
  return hydrate(row);
}

export function hydrate(row: GeneratedProjectRow): GeneratedProject {
  return {
    id: row.id,
    project_id: row.project_id,
    framework: row.framework as GeneratedProject['framework'],
    language: row.language as GeneratedProject['language'],
    name: row.name,
    files: parseJson<GeneratedFile[]>(row.files, []),
    readme: row.readme ?? '',
    summary: parseJson<GeneratedProject['summary']>(row.summary, {
      test_cases: 0,
      web_flows: 0,
      api_requests: 0,
      db_checks: 0,
      total_files: 0,
      total_lines: 0,
    }),
    warnings: parseJson<string[]>(row.warnings, []),
    generated_by: row.generated_by === 'ai' ? 'ai' : 'template',
    created_at: row.created_at,
  };
}

/** Lightweight list rows for the history panel — never ships the file bodies. */
export function listByProject(projectId: string, limit = 100): GeneratedProjectMeta[] {
  const rows = db
    .prepare(
      `SELECT id, project_id, framework, name, files, summary, warnings, generated_by, created_at
         FROM generated_projects
        WHERE project_id = ?
        ORDER BY created_at DESC
        LIMIT ?`,
    )
    .all(projectId, limit) as unknown as Array<
    Omit<GeneratedProjectRow, 'readme' | 'language'> & { language?: string }
  >;

  return rows.map((row) => {
    const files = parseJson<GeneratedFile[]>(row.files, []);
    const warnings = parseJson<string[]>(row.warnings, []);
    return {
      id: row.id,
      project_id: row.project_id,
      framework: row.framework as GeneratedProjectMeta['framework'],
      name: row.name,
      file_count: files.length,
      total_lines: files.reduce((sum, f) => sum + (Number.isFinite(f.lines) ? f.lines : 0), 0),
      summary: summaryText(row.summary, files.length, warnings.length),
      generated_by: row.generated_by,
      created_at: row.created_at,
    } satisfies GeneratedProjectMeta;
  });
}

function summaryText(summary: string | null, fileCount: number, warningCount: number): string | null {
  const parsed = parseJson<GeneratedProject['summary'] | null>(summary, null);
  if (!parsed) return `${fileCount} file`;
  const parts = [`${fileCount} file`];
  if (parsed.test_cases) parts.push(`${parsed.test_cases} test case`);
  if (parsed.web_flows) parts.push(`${parsed.web_flows} web flow`);
  if (parsed.api_requests) parts.push(`${parsed.api_requests} API request`);
  if (parsed.db_checks) parts.push(`${parsed.db_checks} DB check`);
  if (warningCount) parts.push(`${warningCount} peringatan`);
  return parts.join(' · ');
}

export function remove(id: string): number {
  return db.prepare('DELETE FROM generated_projects WHERE id = ?').run(id).changes;
}

export function exists(id: string): boolean {
  const row = db.prepare('SELECT 1 AS ok FROM generated_projects WHERE id = ?').get(id);
  return row !== undefined;
}
