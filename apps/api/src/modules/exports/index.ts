/**
 * Exports module — CSV / Markdown / JSON artefacts for the traceability matrix,
 * the test case catalogue and a single "project pack" bundle.
 *
 * Responses carry the correct Content-Type plus a Content-Disposition attachment
 * header so the browser downloads a named file.
 */

import type { FastifyInstance } from 'fastify';
import { db, logActivity, parseJson } from '../../db/index.js';
import { one, badRequest, notFound } from '../../lib/http.js';
import { COVERAGE_LABEL, type MatrixDocument } from '@qatools/shared';
import { document as buildDocument } from '../matrix/service.js';

/* --------------------------------- helpers -------------------------------- */

/** RFC 4180 field escaping. */
function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(headers: string[], rows: Array<Array<unknown>>): string {
  const lines = [headers.map(csvCell).join(',')];
  for (const row of rows) lines.push(row.map(csvCell).join(','));
  // Excel-friendly: CRLF row endings + UTF-8 BOM added by the caller.
  return `${lines.join('\r\n')}\r\n`;
}

function timestampSlug(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

function sendAttachment(
  reply: import('fastify').FastifyReply,
  body: string | Buffer,
  contentType: string,
  filename: string,
) {
  return reply
    .header('Content-Type', contentType)
    .header('Content-Disposition', `attachment; filename="${filename}"`)
    .send(body);
}

function projectOr404(reply: import('fastify').FastifyReply, projectId: string) {
  const row = db.prepare('SELECT id, key, name FROM projects WHERE id = ?').get(projectId) as
    | { id: string; key: string; name: string }
    | undefined;
  if (!row) {
    notFound(reply, 'Project');
    return null;
  }
  return row;
}

/* ------------------------------ matrix renderers --------------------------- */

function matrixRows(doc: MatrixDocument) {
  return doc.cells.map((cell) => {
    const requirement = cell.requirement_id.startsWith('orphan:')
      ? null
      : (db
          .prepare('SELECT code, title, priority, status FROM requirements WHERE id = ?')
          .get(cell.requirement_id) as
          | { code: string; title: string; priority: string; status: string }
          | undefined);

    const codes = (table: string, ids: string[]) =>
      ids
        .map((id) => {
          const row = db.prepare(`SELECT code FROM ${table} WHERE id = ?`).get(id) as
            | { code: string }
            | undefined;
          return row?.code ?? id;
        })
        .join(' | ');

    return [
      requirement?.code ?? '(orphan)',
      requirement?.title ?? 'Test case tanpa induk requirement',
      requirement?.priority ?? '',
      requirement?.status ?? '',
      cell.use_case_ids.length,
      cell.scenario_ids.length,
      cell.test_case_ids.length,
      cell.defect_ids.length,
      cell.coverage_pct,
      cell.automation_pct,
      COVERAGE_LABEL[cell.coverage],
      codes('use_cases', cell.use_case_ids),
      codes('scenarios', cell.scenario_ids),
      codes('test_cases', cell.test_case_ids),
    ];
  });
}

const MATRIX_HEADERS = [
  'requirement_code',
  'requirement_title',
  'priority',
  'status',
  'use_case_count',
  'scenario_count',
  'test_case_count',
  'defect_count',
  'coverage_pct',
  'automation_pct',
  'coverage_status',
  'use_case_codes',
  'scenario_codes',
  'test_case_codes',
];

function matrixToMarkdown(doc: MatrixDocument, projectName: string): string {
  const rows = matrixRows(doc);
  const s = doc.summary;

  const out: string[] = [];
  out.push(`# Digital Traceability Matrix — ${projectName}`);
  out.push('');
  out.push(`_Dibuat: ${doc.generated_at}_`);
  out.push('');
  out.push('## Ringkasan');
  out.push('');
  out.push('| Metrik | Nilai |');
  out.push('| --- | --- |');
  out.push(`| Total requirement | ${s.requirements} |`);
  out.push(`| Tercakup penuh | ${s.covered} |`);
  out.push(`| Tercakup sebagian | ${s.partial} |`);
  out.push(`| Gap (belum tercakup) | ${s.gaps} |`);
  out.push(`| Orphan (test case tanpa induk) | ${s.orphans} |`);
  out.push(`| Coverage | ${s.coverage_pct}% |`);
  out.push(`| Automation | ${s.automation_pct}% |`);
  out.push('');
  out.push('## Matriks');
  out.push('');
  out.push(`| ${MATRIX_HEADERS.join(' | ')} |`);
  out.push(`| ${MATRIX_HEADERS.map(() => '---').join(' | ')} |`);
  for (const row of rows) {
    out.push(`| ${row.map((v) => String(v).replace(/\|/g, '\\|')).join(' | ')} |`);
  }
  out.push('');
  const gaps = doc.cells.filter((c) => c.coverage === 'gap');
  if (gaps.length) {
    out.push('## Gap yang harus ditutup');
    out.push('');
    for (const g of gaps) {
      const req = db
        .prepare('SELECT code, title FROM requirements WHERE id = ?')
        .get(g.requirement_id) as { code: string; title: string } | undefined;
      out.push(`- **${req?.code ?? g.requirement_id}** — ${req?.title ?? ''}`);
    }
    out.push('');
  }
  return out.join('\n');
}

function testCaseRows(projectId: string) {
  const rows = db
    .prepare(
      `SELECT tc.*, sc.code AS scenario_code, uc.code AS use_case_code
         FROM test_cases tc
         LEFT JOIN scenarios sc ON sc.id = tc.scenario_id
         LEFT JOIN use_cases uc ON uc.id = tc.use_case_id
        WHERE tc.project_id = ?
        ORDER BY tc.code COLLATE NOCASE`,
    )
    .all(projectId) as Array<Record<string, unknown>>;

  const stepStmt = db.prepare(
    'SELECT order_index, action, expected FROM test_steps WHERE test_case_id = ? ORDER BY order_index',
  );

  return rows.map((tc) => {
    const steps = stepStmt.all(tc.id) as Array<{
      order_index: number;
      action: string;
      expected: string | null;
    }>;
    const testData = parseJson<Array<{ field: string; value: string }>>(tc.test_data, []);
    return [
      tc.code,
      tc.title,
      tc.type,
      tc.layer,
      tc.priority,
      tc.severity,
      tc.engine,
      tc.automation_status,
      tc.risk_score,
      Number(tc.is_regression) === 1 ? 'YA' : 'TIDAK',
      tc.status,
      tc.use_case_code ?? '',
      tc.scenario_code ?? '',
      tc.objective ?? '',
      tc.preconditions ?? '',
      steps.map((s, i) => `${i + 1}. ${s.action}${s.expected ? ` → ${s.expected}` : ''}`).join('\n'),
      testData.map((d) => `${d.field}=${d.value}`).join('; '),
      tc.expected_result ?? '',
      tc.estimated_minutes,
      tc.tags ? parseJson<string[]>(tc.tags, []).join('|') : '',
    ];
  });
}

const TESTCASE_HEADERS = [
  'code',
  'title',
  'type',
  'layer',
  'priority',
  'severity',
  'engine',
  'automation_status',
  'risk_score',
  'is_regression',
  'status',
  'use_case_code',
  'scenario_code',
  'objective',
  'preconditions',
  'steps',
  'test_data',
  'expected_result',
  'estimated_minutes',
  'tags',
];

/* ---------------------------------- routes -------------------------------- */

export default async function routes(app: FastifyInstance): Promise<void> {
  /* ----------------------------- matrix export ----------------------------- */
  app.get('/projects/:projectId/export/matrix', async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    const project = projectOr404(reply, projectId);
    if (!project) return reply;

    const format = String((req.query as Record<string, unknown>).format ?? 'csv').toLowerCase();
    const doc = await buildDocument(projectId);

    logActivity({
      project_id: projectId,
      actor: 'lane-docs',
      action: 'export',
      entity_kind: 'matrix',
      entity_id: projectId,
      summary: `Export matrix (${format})`,
    });

    if (format === 'json') {
      return sendAttachment(
        reply,
        JSON.stringify(doc, null, 2),
        'application/json; charset=utf-8',
        `matrix-${project.key}-${timestampSlug()}.json`,
      );
    }
    if (format === 'md' || format === 'markdown') {
      return sendAttachment(
        reply,
        matrixToMarkdown(doc, project.name),
        'text/markdown; charset=utf-8',
        `matrix-${project.key}-${timestampSlug()}.md`,
      );
    }
    if (format !== 'csv') {
      return badRequest(reply, 'Format tidak dikenal. Gunakan csv, json, atau md.');
    }

    const csv = toCsv(MATRIX_HEADERS, matrixRows(doc));
    return sendAttachment(
      reply,
      `\uFEFF${csv}`,
      'text/csv; charset=utf-8',
      `matrix-${project.key}-${timestampSlug()}.csv`,
    );
  });

  /* ---------------------------- test case export --------------------------- */
  app.get('/projects/:projectId/export/testcases', async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    const project = projectOr404(reply, projectId);
    if (!project) return reply;

    const format = String((req.query as Record<string, unknown>).format ?? 'csv').toLowerCase();
    const rows = testCaseRows(projectId);

    if (format === 'json') {
      return sendAttachment(
        reply,
        JSON.stringify(rows.map((r) => Object.fromEntries(r.map((v, i) => [TESTCASE_HEADERS[i], v]))), null, 2),
        'application/json; charset=utf-8',
        `testcases-${project.key}-${timestampSlug()}.json`,
      );
    }
    if (format !== 'csv') {
      return badRequest(reply, 'Format tidak dikenal. Gunakan csv atau json.');
    }

    return sendAttachment(
      reply,
      `\uFEFF${toCsv(TESTCASE_HEADERS, rows)}`,
      'text/csv; charset=utf-8',
      `testcases-${project.key}-${timestampSlug()}.csv`,
    );
  });

  /* ---------------------------- requirements CSV --------------------------- */
  app.get('/projects/:projectId/export/requirements', async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    const project = projectOr404(reply, projectId);
    if (!project) return reply;

    const rows = db
      .prepare(
        `SELECT r.code, r.title, r.description, r.source, r.priority, r.status,
                r.acceptance_criteria,
                (SELECT COUNT(*) FROM matrix_links m
                  WHERE m.link_type = 'requirement_to_usecase' AND m.from_id = r.id) AS use_case_count
           FROM requirements r WHERE r.project_id = ? ORDER BY r.code COLLATE NOCASE`,
      )
      .all(projectId) as Array<Record<string, unknown>>;

    const csv = toCsv(
      [
        'code',
        'title',
        'description',
        'source',
        'priority',
        'status',
        'acceptance_criteria',
        'use_case_count',
      ],
      rows.map((r) => [
        r.code,
        r.title,
        r.description,
        r.source,
        r.priority,
        r.status,
        parseJson<string[]>(r.acceptance_criteria, []).join(' | '),
        r.use_case_count,
      ]),
    );
    return sendAttachment(
      reply,
      `\uFEFF${csv}`,
      'text/csv; charset=utf-8',
      `requirements-${project.key}-${timestampSlug()}.csv`,
    );
  });

  /* ------------------------------- project pack ---------------------------- */
  app.get('/projects/:projectId/export/pack', async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    const project = projectOr404(reply, projectId);
    if (!project) return reply;

    const all = (table: string) =>
      db
        .prepare(`SELECT * FROM ${table} WHERE project_id = ? ORDER BY created_at`)
        .all(projectId) as Array<Record<string, unknown>>;

    const testCases = all('test_cases');
    const stepStmt = db.prepare(
      'SELECT * FROM test_steps WHERE test_case_id = ? ORDER BY order_index',
    );

    const pack = {
      generated_at: new Date().toISOString(),
      generator: 'QATools lane-docs exports module',
      project,
      summary: {
        requirements: all('requirements').length,
        use_cases: all('use_cases').length,
        scenarios: all('scenarios').length,
        test_cases: testCases.length,
        defects: all('defects').length,
        matrix_links: all('matrix_links').length,
      },
      requirements: all('requirements'),
      use_cases: all('use_cases'),
      scenarios: all('scenarios'),
      test_cases: testCases.map((tc) => ({ ...tc, steps: stepStmt.all(tc.id) })),
      defects: all('defects'),
      matrix_links: all('matrix_links'),
      matrix: await buildDocument(projectId),
    };

    const format = String((req.query as Record<string, unknown>).format ?? 'json').toLowerCase();
    if (format === 'json' && String((req.query as Record<string, unknown>).inline ?? '') === 'true') {
      return one(pack);
    }

    logActivity({
      project_id: projectId,
      actor: 'lane-docs',
      action: 'export',
      entity_kind: 'project_pack',
      entity_id: projectId,
      summary: `Export project pack (${pack.summary.test_cases} test case)`,
    });

    return sendAttachment(
      reply,
      JSON.stringify(pack, null, 2),
      'application/json; charset=utf-8',
      `qatools-pack-${project.key}-${timestampSlug()}.json`,
    );
  });
}
