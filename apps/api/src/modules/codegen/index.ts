/**
 * codegen — framework code generation. Mounted at /api (ARCHITECTURE.md §11.5).
 *
 *   GET    /codegen/frameworks                 -> FrameworkMeta[]         (§11.2 service)
 *   POST   /projects/:projectId/codegen       -> GeneratedProject        (body: CodegenRequest)
 *   GET    /projects/:projectId/codegen       -> GeneratedProjectMeta[]
 *   GET    /codegen/:id                       -> GeneratedProject
 *   GET    /codegen/:id/file?path=...         -> text/plain raw file
 *   GET    /codegen/:id/download              -> application/zip (hand-rolled, no dep)
 *   DELETE /codegen/:id
 *
 * The in-process surface other lanes consume is `codegenService`:
 *   codegenService.generate(req, projectId): Promise<GeneratedProject>
 *   codegenService.frameworks(): FrameworkMeta[]
 *
 * Everything here is **string generation**. The QATools repo depends on no automation
 * framework; the generated *code* references Playwright/Robot/k6, the server never does.
 */

import type { FastifyInstance, FastifyReply } from 'fastify';
import type {
  CodegenFramework,
  CodegenRequest,
  FrameworkMeta,
  GeneratedFile,
  GeneratedProject,
  GeneratedProjectMeta,
} from '@qatools/shared';
import { badRequest, fail, list, notFound, one, paging } from '../../lib/http.js';
import { logCodegen } from './gather.js';
import { allFrameworks, frameworkInfo, generatorFor, isSupported, languageFor } from './frameworks.js';
import { buildContext, getProject, isCodegenFramework } from './gather.js';
import { buildReadme } from './readme.js';
import * as repo from './repo.js';
import { createZip, normaliseEntryPath } from './zip.js';
import { clampInt, safeFilename, textOf } from './util.js';

/* ------------------------------------------------------------------ *
 * Request normalisation
 * ------------------------------------------------------------------ */

/** Coerces an untrusted body into a `CodegenRequest`, rejecting what cannot work. */
export function normaliseRequest(body: unknown): { ok: true; value: CodegenRequest } | { ok: false; message: string } {
  if (!body || typeof body !== 'object') {
    return { ok: false, message: 'Body harus berupa objek JSON dengan field "framework".' };
  }
  const raw = body as Record<string, unknown>;
  const framework = raw.framework;
  if (!isSupported(textOf(framework, ''))) {
    return {
      ok: false,
      message: `Field "framework" wajib diisi dengan salah satu dari: ${allFrameworks()
        .map((f) => f.id)
        .join(', ')}.`,
    };
  }

  const testCaseIds = Array.isArray(raw.test_case_ids)
    ? raw.test_case_ids.map((v) => textOf(v, '')).filter(Boolean)
    : undefined;
  const layers = Array.isArray(raw.layers)
    ? raw.layers.map((v) => textOf(v, '').toLowerCase()).filter(Boolean)
    : undefined;

  const value: CodegenRequest = { framework: framework as CodegenFramework };
  if (testCaseIds) value.test_case_ids = testCaseIds;
  if (layers) value.layers = layers;
  if (typeof raw.base_url === 'string' && raw.base_url.trim()) value.base_url = raw.base_url.trim();
  if (raw.parallel !== undefined) value.parallel = raw.parallel === true;
  if (raw.workers !== undefined) value.workers = clampInt(raw.workers, 1, 16);
  if (raw.use_ai !== undefined) value.use_ai = raw.use_ai === true;
  if (raw.persist !== undefined) value.persist = raw.persist === true;
  return { ok: true, value };
}

/* ------------------------------------------------------------------ *
 * Generation core
 * ------------------------------------------------------------------ */

export interface GenerateOptions {
  /** Always write the row, regardless of `CodegenRequest.persist`. */
  forcePersist?: boolean;
}

/**
 * Generates a project for `projectId`.
 *
 * Refuses only when the project itself is unknown — an empty project is a valid input
 * and produces a runnable skeleton plus a warning (ARCHITECTURE.md §11.7).
 */
export function generateProject(
  projectId: string,
  request: CodegenRequest,
  options: GenerateOptions = {},
): GeneratedProject {
  const project = getProject(projectId);
  if (!project) {
    throw new CodegenError(404, 'project_not_found', `Proyek ${projectId} tidak ditemukan`);
  }

  if (!isCodegenFramework(request.framework)) {
    throw new CodegenError(400, 'bad_request', `Framework "${textOf(request.framework, '')}" tidak dikenal`);
  }

  const ctx = buildContext(projectId, request, project);

  let files: GeneratedFile[];
  try {
    files = generatorFor(request.framework)(ctx);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new CodegenError(500, 'generator_failed', `Generator ${request.framework} gagal: ${message}`);
  }

  // Defensive: a generator may not emit a file with an empty body or a bad path.
  // A generator that also emits its own README.md must not collide with the one the
  // builder always adds — the framework-specific README wins the path, and the
  // generated index keeps the canonical content under `README.QATools.md`.
  const cleaned = files
    .filter((f) => f && typeof f.path === 'string' && f.path.trim() !== '')
    .map((f) => ({ ...f, path: normaliseEntryPath(f.path) }));

  const hasOwnReadme = cleaned.some((f) => f.path.toLowerCase() === 'readme.md');
  const deduped = hasOwnReadme
    ? cleaned.map((f) =>
        f.path.toLowerCase() === 'readme.md' ? { ...f, path: 'README.FRAMEWORK.md' } : f,
      )
    : cleaned;

  const meta = frameworkInfo(request.framework);
  const readme = buildReadme(ctx, meta, deduped);
  const allFiles: GeneratedFile[] = [
    { path: 'README.md', language: 'yaml', content: readme, lines: readme.split('\n').length, purpose: 'Petunjuk instalasi & menjalankan proyek yang digenerate.' },
    ...deduped,
  ];

  const totalLines = allFiles.reduce((sum, f) => sum + f.lines, 0);
  const summary: GeneratedProject['summary'] = {
    test_cases: ctx.cases.length,
    web_flows: ctx.flows.length,
    api_requests: ctx.requests.length,
    db_checks: ctx.db_checks.length,
    total_files: allFiles.length,
    total_lines: totalLines,
  };

  const generated: GeneratedProject = {
    id: null,
    project_id: projectId,
    framework: request.framework,
    language: languageFor(request.framework),
    name: `${project.name} — ${meta.label}`,
    files: allFiles,
    readme,
    summary,
    warnings: dedupe(ctx.warnings),
    generated_by: ctx.ai_enriched ? 'ai' : 'template',
    created_at: new Date().toISOString(),
  };

  if (request.persist === true || options.forcePersist === true) {
    const saved = repo.save({
      project_id: projectId,
      framework: request.framework,
      language: generated.language,
      name: generated.name,
      files: generated.files,
      readme: generated.readme,
      summary: generated.summary,
      warnings: generated.warnings,
      generated_by: generated.generated_by,
    });
    generated.id = saved.id;
    generated.created_at = saved.created_at;
  }

  logCodegen(projectId, request.framework, allFiles.length);
  return generated;
}

/** Warnings are user-facing prose; duplicates add noise, not information. */
function dedupe(values: string[]): string[] {
  return [...new Set(values.map((v) => textOf(v, '').trim()).filter(Boolean))];
}

export class CodegenError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'CodegenError';
    this.status = status;
    this.code = code;
  }
}

/** The in-process service surface (ARCHITECTURE.md §11.2). */
export const codegenService = {
  async generate(req: CodegenRequest, projectId: string): Promise<GeneratedProject> {
    return generateProject(projectId, req);
  },
  frameworks(): FrameworkMeta[] {
    return allFrameworks();
  },
  /** Convenience for callers that want the README without generating a whole project. */
  readmeFor(files: GeneratedFile[]): string {
    return files.find((f) => f.path === 'README.md')?.content ?? '';
  },
};

/* ------------------------------------------------------------------ *
 * ZIP payload
 * ------------------------------------------------------------------ */

/** Builds the downloadable archive: every file, under a single project folder. */
export function buildZip(project: GeneratedProject): { bytes: Uint8Array; filename: string } {
  const root = safeFilename(
    `${project.framework}-${safeFilename(textOf(project.name, 'qatools'), 'qatools')}`,
    'qatools-automation',
  );
  const entries = project.files.map((f) => ({
    path: `${root}/${normaliseEntryPath(f.path)}`,
    content: typeof f.content === 'string' ? f.content : '',
  }));
  return { bytes: createZip(entries), filename: `${root}.zip` };
}

/* ------------------------------------------------------------------ *
 * Routes
 * ------------------------------------------------------------------ */

export default async function routes(app: FastifyInstance): Promise<void> {
  /* ------------------------------ frameworks ---------------------------- */

  app.get('/codegen/frameworks', async () => {
    const frameworks = codegenService.frameworks();
    return list(frameworks, frameworks.length);
  });

  /* ------------------------------- generate ----------------------------- */

  app.post('/projects/:projectId/codegen', async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    const parsed = normaliseRequest(req.body);
    if (!parsed.ok) return badRequest(reply, parsed.message);

    try {
      const project = generateProject(projectId, parsed.value);
      return reply.code(201).send(one(project));
    } catch (err) {
      return codegenFail(reply, err);
    }
  });

  app.get('/projects/:projectId/codegen', async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    if (!getProject(projectId)) return notFound(reply, 'Project');
    const q = req.query as Record<string, unknown>;
    const { limit, offset } = paging(q);
    const rows = repo.listByProject(projectId, 200);
    return list(rows.slice(offset, offset + limit), rows.length);
  });

  /* -------------------------------- detail ------------------------------ */

  app.get('/codegen/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const project = repo.findByPk(id);
    if (!project) return notFound(reply, 'Generated project');
    return one(project);
  });

  app.get('/codegen/:id/file', async (req, reply) => {
    const { id } = req.params as { id: string };
    const q = req.query as Record<string, unknown>;
    const wanted = normaliseEntryPath(textOf(q.path, ''));
    if (!wanted) return badRequest(reply, 'Query parameter "path" wajib diisi, mis. ?path=tests/web.spec.ts');

    const project = repo.findByPk(id);
    if (!project) return notFound(reply, 'Generated project');

    const file = project.files.find((f) => normaliseEntryPath(f.path) === wanted);
    if (!file) {
      return fail(reply, 404, 'file_not_found', `File "${wanted}" tidak ada di dalam project ini`, {
        available: project.files.map((f) => f.path),
      });
    }

    return reply
      .header('Content-Type', 'text/plain; charset=utf-8')
      .header('X-Qatools-File-Purpose', encodeURIComponent(file.purpose))
      .header('X-Qatools-File-Language', file.language)
      .send(file.content);
  });

  app.get('/codegen/:id/download', async (req, reply) => {
    const { id } = req.params as { id: string };
    const project = repo.findByPk(id);
    if (!project) return notFound(reply, 'Generated project');

    const { bytes, filename } = buildZip(project);
    return reply
      .header('Content-Type', 'application/zip')
      .header('Content-Disposition', `attachment; filename="${filename}"`)
      .header('Content-Length', String(bytes.byteLength))
      .header('X-Qatools-Filename', filename)
      .send(Buffer.from(bytes));
  });

  app.delete('/codegen/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!repo.exists(id)) return notFound(reply, 'Generated project');
    repo.remove(id);
    return one({ deleted: true, id });
  });
}

/** Maps a `CodegenError` onto the frozen error envelope; anything else is a 500. */
function codegenFail(reply: FastifyReply, err: unknown) {
  if (err instanceof CodegenError) {
    return fail(reply, err.status, err.code, err.message);
  }
  const message = err instanceof Error ? err.message : String(err);
  return fail(reply, 500, 'codegen_error', message);
}

export { allFrameworks, frameworkInfo, isCodegenFramework, isSupported, createZip };
export type { GeneratedFile, GeneratedProject, GeneratedProjectMeta };
