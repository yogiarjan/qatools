/**
 * OpenAPI / Swagger JSON importer.
 *
 * Dependency-free: walks `paths` of an OpenAPI 3.x or Swagger 2.0 document and
 * creates one `api_requests` row per operation, with starter assertions on the
 * declared success status. No `swagger-parser`, no `openapi-types` package.
 */

import type { Assertion } from '@qatools/shared';

export interface ImportedOperation {
  name: string;
  method: string;
  path: string;
  headers: Record<string, string>;
  query: Record<string, string>;
  body: string | null;
  body_type: 'json' | 'form' | 'raw' | 'none';
  assertions: Assertion[];
  summary: string | null;
  tags: string[];
}

export interface OpenApiImportResult {
  title: string;
  version: string;
  base_url: string | null;
  operations: ImportedOperation[];
  skipped: string[];
}

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'] as const;

interface RawOperation {
  operationId?: string;
  summary?: string;
  description?: string;
  tags?: string[];
  parameters?: RawParameter[];
  requestBody?: unknown;
  responses?: Record<string, unknown>;
  consumes?: string[];
}

interface RawParameter {
  name?: string;
  in?: string;
  required?: boolean;
  example?: unknown;
  schema?: { type?: string; example?: unknown; default?: unknown };
  type?: string;
}

interface RawPathItem {
  [method: string]: unknown;
}

/**
 * Parses the pasted document and returns the operations to persist.
 * @throws Error with a user-facing Indonesian message when the document is unusable.
 */
export function parseOpenApi(text: string, fallbackBaseUrl?: string | null): OpenApiImportResult {
  let doc: Record<string, unknown>;
  try {
    doc = JSON.parse(text) as Record<string, unknown>;
  } catch (err) {
    // A YAML document would land here — say so explicitly instead of "Unexpected token".
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Dokumen bukan JSON yang valid (${reason}). QATools mengimpor OpenAPI dalam format JSON; ` +
        'konversi YAML → JSON terlebih dahulu (mis. `npx swagger-cli bundle -o openapi.json openapi.yaml`).',
    );
  }

  if (doc === null || typeof doc !== 'object') {
    throw new Error('Dokumen OpenAPI harus berupa objek JSON.');
  }

  const info = (doc.info ?? {}) as Record<string, unknown>;
  const title = typeof info.title === 'string' ? info.title : 'Imported API';

  // swagger: "2.0"; openapi: "3.x"
  const isSwagger2 = typeof doc.swagger === 'string';
  const version = isSwagger2
    ? `swagger ${String(doc.swagger)}`
    : typeof doc.openapi === 'string'
      ? `openapi ${doc.openapi}`
      : 'unknown';

  const servers = Array.isArray(doc.servers) ? (doc.servers as unknown[]) : [];
  const firstServer = (servers[0] ?? null) as Record<string, unknown> | null;
  const baseUrl =
    (typeof firstServer?.url === 'string' ? (firstServer.url as string) : null) ??
    (typeof doc.host === 'string'
      ? `${Array.isArray(doc.schemes) && doc.schemes.length ? String(doc.schemes[0]) : 'https'}://${String(doc.host)}${typeof doc.basePath === 'string' ? String(doc.basePath) : ''}`
      : null) ??
    fallbackBaseUrl ??
    null;

  const paths = (doc.paths ?? {}) as Record<string, RawPathItem>;
  const operations: ImportedOperation[] = [];
  const skipped: string[] = [];

  for (const [path, item] of Object.entries(paths)) {
    if (!item || typeof item !== 'object') {
      skipped.push(`${path} (path item bukan objek)`);
      continue;
    }
    const sharedParams = Array.isArray(item.parameters) ? (item.parameters as RawParameter[]) : [];

    for (const method of HTTP_METHODS) {
      const op = item[method] as RawOperation | undefined;
      if (!op || typeof op !== 'object') continue;

      const params = [...sharedParams, ...(Array.isArray(op.parameters) ? op.parameters : [])];
      const headers: Record<string, string> = {};
      const query: Record<string, string> = {};

      for (const param of params) {
        if (!param?.name || !param.in) continue;
        const sample = sampleValue(param);
        if (param.in === 'header') headers[param.name] = sample;
        else if (param.in === 'query') query[param.name] = sample;
      }

      const { body, body_type } = buildBody(op, isSwagger2);
      const status = successStatus(op.responses);

      operations.push({
        name: op.summary?.trim() || op.operationId?.trim() || `${method.toUpperCase()} ${path}`,
        method: method.toUpperCase(),
        path,
        headers,
        query,
        body,
        body_type,
        assertions: [
          { source: 'status', operator: 'equals', expected: status, message: `HTTP ${status} diharapkan` },
          { source: 'duration', operator: 'lt', expected: 5000, message: 'Respons di bawah 5 detik' },
        ],
        summary: op.description ?? op.summary ?? null,
        tags: Array.isArray(op.tags) ? op.tags : [],
      });
    }

    const hasOperation = HTTP_METHODS.some((m) => Boolean(item[m]));
    if (!hasOperation) skipped.push(`${path} (tidak ada operasi HTTP)`);
  }

  if (!operations.length) {
    throw new Error('Tidak ada operasi HTTP yang bisa diimpor dari dokumen ini (periksa bagian "paths").');
  }

  return { title, version, base_url: baseUrl, operations, skipped };
}

/** Picks the first 2xx response code declared, defaulting to 200. */
function successStatus(responses: Record<string, unknown> | undefined): number {
  if (!responses) return 200;
  const codes = Object.keys(responses)
    .map((c) => Number(c))
    .filter((n) => Number.isInteger(n) && n >= 200 && n < 300)
    .sort((a, b) => a - b);
  return codes[0] ?? 200;
}

/** Builds a sample JSON body from a JSON Schema `example`/`properties`. */
function buildBody(
  op: RawOperation,
  isSwagger2: boolean,
): { body: string | null; body_type: 'json' | 'form' | 'raw' | 'none' } {
  // OpenAPI 3
  const requestBody = op.requestBody as
    | { content?: Record<string, { example?: unknown; schema?: unknown }> }
    | undefined;
  if (requestBody?.content) {
    const json = requestBody.content['application/json'];
    if (json) {
      const sample = json.example ?? schemaSample(json.schema);
      return { body: JSON.stringify(sample ?? {}, null, 2), body_type: 'json' };
    }
    const form = requestBody.content['application/x-www-form-urlencoded'];
    if (form) {
      const sample = (schemaSample(form.schema) ?? {}) as Record<string, unknown>;
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(sample)) params.append(k, String(v));
      return { body: params.toString(), body_type: 'form' };
    }
  }

  // Swagger 2 — body parameter
  if (isSwagger2) {
    const bodyParam = (op.parameters ?? []).find((p) => p.in === 'body') as
      | (RawParameter & { schema?: unknown })
      | undefined;
    if (bodyParam?.schema) {
      return { body: JSON.stringify(schemaSample(bodyParam.schema) ?? {}, null, 2), body_type: 'json' };
    }
  }

  return { body: null, body_type: 'none' };
}

/** Deterministic placeholder value for a parameter, used in the starter request. */
function sampleValue(param: RawParameter): string {
  const explicit = param.example ?? param.schema?.example ?? param.schema?.default;
  if (explicit !== undefined && explicit !== null) return String(explicit);

  const type = param.schema?.type ?? param.type ?? 'string';
  switch (type) {
    case 'integer':
    case 'number':
      return '1';
    case 'boolean':
      return 'true';
    default:
      return `{{${param.name}}}`;
  }
}

/** Recursively derives an example object from a JSON Schema. */
function schemaSample(schema: unknown, depth = 0): unknown {
  if (!schema || typeof schema !== 'object' || depth > 6) return undefined;
  const s = schema as Record<string, unknown>;

  if (s.example !== undefined) return s.example;
  if (s.default !== undefined) return s.default;

  const type = typeof s.type === 'string' ? s.type : undefined;
  if (type === 'array') return [schemaSample(s.items, depth + 1) ?? null];
  if (type === 'object' || s.properties) {
    const props = (s.properties ?? {}) as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [key, sub] of Object.entries(props)) out[key] = schemaSample(sub, depth + 1) ?? null;
    return out;
  }
  if (type === 'integer' || type === 'number') return 0;
  if (type === 'boolean') return true;
  if (type === 'string') return '';
  return undefined;
}
