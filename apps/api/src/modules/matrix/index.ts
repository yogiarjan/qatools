/**
 * Matrix module — the digital traceability matrix API.
 *
 * Exposes the cross-lane service surface `matrixService` (ARCHITECTURE.md §6.1)
 * consumed by lane B (regression) and lane C (execution).
 */

import type { FastifyInstance } from 'fastify';
import { db, logActivity } from '../../db/index.js';
import { list, one, badRequest, notFound } from '../../lib/http.js';
import {
  document as buildDocument,
  impactOf,
  matrixService,
  sync as syncMatrix,
} from './service.js';
import { deleteLink, getLink, listLinks, upsertLink } from './repo.js';
import { LINK_KINDS, PUBLIC_LINK_TYPES, isLinkType } from './types.js';

export { matrixService };
export default async function routes(app: FastifyInstance): Promise<void> {
  const projectExists = (id: string) =>
    Boolean(db.prepare('SELECT id FROM projects WHERE id = ?').get(id));

  /* ------------------------- the traceability document ------------------------- */
  app.get('/projects/:projectId/matrix', async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    if (!projectExists(projectId)) return notFound(reply, 'Project');
    return one(await buildDocument(projectId));
  });

  /* ---------------------------------- links ---------------------------------- */
  app.get('/projects/:projectId/matrix/links', async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    if (!projectExists(projectId)) return notFound(reply, 'Project');
    const linkType = (req.query as Record<string, unknown>).link_type;
    const rows = listLinks(projectId, typeof linkType === 'string' ? linkType : undefined);
    return list(rows, rows.length);
  });

  app.post('/matrix/links', async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const linkType = body.link_type;
    if (!isLinkType(linkType)) {
      return badRequest(reply, `link_type wajib salah satu dari: ${PUBLIC_LINK_TYPES.join(', ')}.`);
    }
    const fromId = String(body.from_id ?? '');
    const toId = String(body.to_id ?? '');
    if (!fromId || !toId) return badRequest(reply, 'from_id dan to_id wajib diisi.');

    const kinds = LINK_KINDS[linkType];
    // Resolve the project from either endpoint when the caller did not send one.
    let projectId = typeof body.project_id === 'string' ? body.project_id : '';
    if (!projectId) {
      const row = db
        .prepare(
          `SELECT project_id FROM (
             SELECT project_id FROM requirements WHERE id = ?
             UNION ALL SELECT project_id FROM use_cases WHERE id = ?
             UNION ALL SELECT project_id FROM scenarios WHERE id = ?
             UNION ALL SELECT project_id FROM test_cases WHERE id = ?
             UNION ALL SELECT project_id FROM defects WHERE id = ?
           ) LIMIT 1`,
        )
        .get(fromId, fromId, fromId, fromId, fromId) as { project_id: string } | undefined;
      projectId = row?.project_id ?? '';
    }
    if (!projectId || !projectExists(projectId)) {
      return badRequest(reply, 'Project tidak dapat ditentukan dari artefak yang dikirim.');
    }

    const result = upsertLink({
      project_id: projectId,
      link_type: linkType,
      from_kind: String(body.from_kind ?? kinds.from),
      from_id: fromId,
      to_kind: String(body.to_kind ?? kinds.to),
      to_id: toId,
      note: body.note === undefined ? null : String(body.note),
      created_by: 'manual',
    });

    logActivity({
      project_id: projectId,
      actor: 'lane-docs',
      action: 'link',
      entity_kind: 'matrix_link',
      entity_id: result.id,
      summary: `${linkType}: ${fromId} → ${toId}`,
    });

    return reply.code(result.created ? 201 : 200).send(
      one({
        ...getLink(result.id),
        created: result.created,
        // Manual links that only join two existing artifacts have no FK to derive from.
        derived: false,
      }),
    );
  });

  app.delete('/matrix/links/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const link = getLink(id);
    if (!link) return notFound(reply, 'Link matrix');
    deleteLink(id);
    return one({ id, deleted: true });
  });

  /* ---------------------------------- impact --------------------------------- */
  app.get('/projects/:projectId/matrix/impact/:artifactId', async (req, reply) => {
    const { projectId, artifactId } = req.params as { projectId: string; artifactId: string };
    if (!projectExists(projectId)) return notFound(reply, 'Project');
    const report = await impactOf(artifactId);
    if (report.artifact_kind === 'unknown') return notFound(reply, 'Artefak');
    return one(report);
  });

  app.post('/matrix/impact/:artifactId', async (req, reply) => {
    const { artifactId } = req.params as { artifactId: string };
    const report = await impactOf(artifactId);
    if (report.artifact_kind === 'unknown') return notFound(reply, 'Artefak');
    return one(report);
  });

  /* ----------------------------------- sync ---------------------------------- */
  app.post('/projects/:projectId/matrix/sync', async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    if (!projectExists(projectId)) return notFound(reply, 'Project');
    const counts = syncMatrix(projectId);
    logActivity({
      project_id: projectId,
      actor: 'lane-docs',
      action: 'sync',
      entity_kind: 'matrix',
      entity_id: projectId,
      summary: `Matrix disinkronkan (${counts.total} link)`,
    });
    return one({ project_id: projectId, counts, document: await buildDocument(projectId) });
  });

  /* -------------------------------- orphans list ------------------------------ */
  app.get('/projects/:projectId/matrix/orphans', async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    if (!projectExists(projectId)) return notFound(reply, 'Project');
    const rows = db
      .prepare(
        `SELECT tc.*, sc.code AS scenario_code, uc.code AS use_case_code
           FROM test_cases tc
           LEFT JOIN scenarios sc ON sc.id = tc.scenario_id
           LEFT JOIN use_cases uc ON uc.id = tc.use_case_id
          WHERE tc.project_id = ?
            AND NOT EXISTS (SELECT 1 FROM matrix_links m
                             WHERE m.link_type = 'requirement_to_testcase' AND m.to_id = tc.id)
          ORDER BY tc.code`,
      )
      .all(projectId);
    const scenariosWithoutCase = db
      .prepare(
        `SELECT sc.* FROM scenarios sc
          WHERE sc.project_id = ?
            AND NOT EXISTS (SELECT 1 FROM test_cases tc WHERE tc.scenario_id = sc.id)
          ORDER BY sc.code`,
      )
      .all(projectId);
    return one({ test_cases: rows, scenarios_without_test_case: scenariosWithoutCase });
  });
}
