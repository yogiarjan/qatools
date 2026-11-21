/**
 * Requirements module — CRUD + bulk create (CSV paste import).
 * Requirements are the first stage of the ordered QA lifecycle.
 */

import type { FastifyInstance } from 'fastify';
import { db, logActivity, parseJson, toJson } from '../../db/index.js';
import { list, one, badRequest, notFound } from '../../lib/http.js';
import { withTransaction } from '../matrix/tx.js';
import { PRIORITIES, type Priority } from '@qatools/shared';
import {
  listRequirements,
  getRequirement,
  createRequirement,
  updateRequirement,
  deleteRequirement,
  existingCodes,
} from './repo.js';

const REQ_STATUSES = ['draft', 'approved', 'changed', 'deprecated'] as const;

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

function asArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x)).filter((x) => x.trim() !== '');
  if (typeof v === 'string' && v.trim()) {
    return v
      .split(/\r?\n|;/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

function priority(v: unknown, fallback: Priority = 'medium'): Priority {
  return PRIORITIES.includes(v as never) ? (v as Priority) : fallback;
}

function projectExists(projectId: string): boolean {
  return Boolean(db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId));
}

/**
 * Allocates the next free `REQ-nnn` for a project, skipping codes that already exist
 * (needed for bulk import where codes may be supplied explicitly).
 */
function allocateCode(projectId: string, used: Set<string>): string {
  const row = db
    .prepare('SELECT COUNT(*) AS n FROM requirements WHERE project_id = ?')
    .get(projectId) as { n: number } | undefined;
  let n = Number(row?.n ?? 0) + 1;
  for (;;) {
    const code = `REQ-${String(n).padStart(3, '0')}`;
    if (!used.has(code)) {
      used.add(code);
      return code;
    }
    n += 1;
  }
}

export default async function routes(app: FastifyInstance): Promise<void> {
  /* ------------------------- list under a project ------------------------- */
  app.get('/projects/:projectId/requirements', async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    if (!projectExists(projectId)) return notFound(reply, 'Project');
    const query = req.query as Record<string, unknown>;
    const rows = listRequirements(projectId, {
      priority: typeof query.priority === 'string' ? query.priority : undefined,
      status: typeof query.status === 'string' ? query.status : undefined,
      q: typeof query.q === 'string' ? query.q : undefined,
    });
    return list(
      rows.map((r) => ({
        ...r,
        acceptance_criteria_list: parseJson<string[]>(r.acceptance_criteria, []),
        use_case_count: Number(
          (
            db
              .prepare(
                `SELECT COUNT(*) AS n FROM matrix_links
                  WHERE link_type = 'requirement_to_usecase' AND from_id = ?`,
              )
              .get(r.id) as { n: number } | undefined
          )?.n ?? 0,
        ),
      })),
      rows.length,
    );
  });

  /* --------------------------------- create -------------------------------- */
  app.post('/projects/:projectId/requirements', async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    if (!projectExists(projectId)) return notFound(reply, 'Project');

    const body = (req.body ?? {}) as Record<string, unknown>;
    const title = str(body.title);
    if (!title) return badRequest(reply, 'Judul kebutuhan wajib diisi.');

    const used = existingCodes(projectId);
    let code = str(body.code) ?? '';
    if (code && used.has(code)) return badRequest(reply, `Kode "${code}" sudah dipakai di project ini.`);
    if (!code) code = allocateCode(projectId, used);

    const id = createRequirement({
      project_id: projectId,
      code,
      title,
      description: str(body.description),
      source: str(body.source) ?? 'manual',
      priority: priority(body.priority),
      status: REQ_STATUSES.includes(body.status as never) ? String(body.status) : 'draft',
      acceptance_criteria: toJson(asArray(body.acceptance_criteria ?? body.acceptance_criteria_list)),
    });

    logActivity({
      project_id: projectId,
      actor: 'lane-docs',
      action: 'create',
      entity_kind: 'requirement',
      entity_id: id,
      summary: `${code} dibuat`,
    });

    return reply.code(201).send(one(getRequirement(id)));
  });

  /* ------------------------------ bulk create ------------------------------ */
  app.post('/projects/:projectId/requirements/bulk', async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    if (!projectExists(projectId)) return notFound(reply, 'Project');

    const body = (req.body ?? {}) as Record<string, unknown>;
    let items: Array<Record<string, unknown>> = [];

    if (Array.isArray(body.items)) {
      items = body.items as Array<Record<string, unknown>>;
    } else if (typeof body.text === 'string') {
      items = parsePastedText(body.text);
    }

    if (!items.length) return badRequest(reply, 'Tidak ada baris yang bisa diimpor.');

    const used = existingCodes(projectId);
    const created: string[] = [];
    const skipped: string[] = [];

    withTransaction(() => {
      for (const raw of items) {
        const title = str(raw.title ?? raw.name);
        if (!title) {
          skipped.push('(baris tanpa judul)');
          continue;
        }
        let code = str(raw.code) ?? '';
        if (code && used.has(code)) {
          skipped.push(code);
          continue;
        }
        if (!code) code = allocateCode(projectId, used);
        else used.add(code);

        const id = createRequirement({
          project_id: projectId,
          code,
          title,
          description: str(raw.description),
          source: str(raw.source) ?? 'import',
          priority: priority(raw.priority),
          status: REQ_STATUSES.includes(raw.status as never) ? String(raw.status) : 'draft',
          acceptance_criteria: toJson(asArray(raw.acceptance_criteria)),
        });
        created.push(id);
      }
    });

    logActivity({
      project_id: projectId,
      actor: 'lane-docs',
      action: 'bulk_create',
      entity_kind: 'requirement',
      summary: `${created.length} kebutuhan diimpor`,
    });

    const rows = created
      .map((id) => getRequirement(id))
      .filter((r): r is NonNullable<typeof r> => Boolean(r));
    return reply.code(201).send({ data: rows, total: rows.length, skipped });
  });

  /* ---------------------------------- read --------------------------------- */
  app.get('/requirements/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = getRequirement(id);
    if (!row) return notFound(reply, 'Kebutuhan');
    const links = db
      .prepare(
        `SELECT m.*, uc.code AS use_case_code, uc.name AS use_case_name
           FROM matrix_links m
           LEFT JOIN use_cases uc ON uc.id = m.to_id
          WHERE m.link_type = 'requirement_to_usecase' AND m.from_id = ?`,
      )
      .all(id);
    return one({
      ...row,
      acceptance_criteria_list: parseJson<string[]>(row.acceptance_criteria, []),
      use_cases: links,
    });
  });

  /* --------------------------------- update -------------------------------- */
  app.patch('/requirements/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = getRequirement(id);
    if (!row) return notFound(reply, 'Kebutuhan');

    const body = (req.body ?? {}) as Record<string, unknown>;
    const patch: Record<string, unknown> = {};

    if (body.title !== undefined) {
      const title = str(body.title);
      if (!title) return badRequest(reply, 'Judul kebutuhan tidak boleh kosong.');
      patch.title = title;
    }
    if (body.code !== undefined) {
      const code = str(body.code);
      if (!code) return badRequest(reply, 'Kode tidak boleh kosong.');
      const clash = db
        .prepare('SELECT id FROM requirements WHERE project_id = ? AND code = ? AND id <> ?')
        .get(row.project_id, code, id);
      if (clash) return badRequest(reply, `Kode "${code}" sudah dipakai.`);
      patch.code = code;
    }
    for (const f of ['description', 'source', 'acceptance_criteria'] as const) {
      if (body[f] !== undefined) patch[f] = str(body[f]);
    }
    if (body.acceptance_criteria_list !== undefined) {
      patch.acceptance_criteria = toJson(asArray(body.acceptance_criteria_list));
    }
    if (body.priority !== undefined) {
      if (!PRIORITIES.includes(body.priority as never)) {
        return badRequest(reply, `Priority tidak valid. Pilihan: ${PRIORITIES.join(', ')}.`);
      }
      patch.priority = String(body.priority);
    }
    if (body.status !== undefined) {
      if (!REQ_STATUSES.includes(body.status as never)) {
        return badRequest(reply, `Status tidak valid. Pilihan: ${REQ_STATUSES.join(', ')}.`);
      }
      patch.status = String(body.status);
    }

    if (Object.keys(patch).length) updateRequirement(id, patch);
    return one(getRequirement(id));
  });

  /* --------------------------------- delete -------------------------------- */
  app.delete('/requirements/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = getRequirement(id);
    if (!row) return notFound(reply, 'Kebutuhan');

    withTransaction(() => {
      db.prepare(
        `DELETE FROM matrix_links
          WHERE (from_kind = 'requirement' AND from_id = ?) OR (to_kind = 'requirement' AND to_id = ?)`,
      ).run(id, id);
      deleteRequirement(id);
    });

    logActivity({
      project_id: row.project_id,
      actor: 'lane-docs',
      action: 'delete',
      entity_kind: 'requirement',
      entity_id: id,
      summary: `${row.code} dihapus`,
    });
    return one({ id, deleted: true });
  });
}

/**
 * Parses the "paste CSV" textarea. Accepted per line:
 *   REQ-001, Judul, deskripsi, priority, status
 *   Judul
 * A header line starting with `code`/`title` is ignored.
 */
export function parsePastedText(text: string): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const cells = splitCsvLine(line);
    const looksLikeHeader =
      /^(code|kode)$/i.test(cells[0] ?? '') || /^(title|judul)$/i.test(cells[0] ?? '');
    if (looksLikeHeader) continue;

    // Single column: the whole line is the title.
    if (cells.length === 1) {
      out.push({ title: cells[0] });
      continue;
    }

    const [first, second, third, fourth, fifth] = cells;
    const firstIsCode = /^REQ[-\s]?\d+$/i.test(first ?? '');
    out.push({
      code: firstIsCode ? first : undefined,
      title: firstIsCode ? second : first,
      description: firstIsCode ? third : second,
      priority: firstIsCode ? fourth : third,
      status: firstIsCode ? fifth : fourth,
      source: 'import',
    });
  }
  return out;
}

/** Minimal CSV line splitter that respects double quotes. */
function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      cells.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  cells.push(current.trim());
  return cells;
}
