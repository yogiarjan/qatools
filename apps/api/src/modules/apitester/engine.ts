/**
 * apitester engine — executes a real HTTP request with the global `fetch`
 * (Node 22+, no axios/node-fetch dependency) and evaluates the frozen
 * Assertion DSL through the shared evaluator.
 *
 * Used both by the apitester routes and by the `execute` module when a test
 * case has `engine = 'api'`.
 */

import type { ApiCollection, ApiRequest, Assertion, EngineResult, ExecuteOptions, StepLog } from '@qatools/shared';
import { evaluateAssertions } from '../execute/assertions.js';
import { EngineError, statusFromOutcome, truncate, emptyEngineResult } from '../execute/engine-utils.js';
import {
  applyAuth,
  hasUnresolved,
  interpolate,
  interpolateObject,
  normalizeAssertions,
  runScript,
} from '../execute/scripting.js';
import { displayValue } from '../execute/jsonpath.js';
import { parseJson } from '../../db/index.js';
import {
  collectionAuthConfig,
  collectionVariables,
  findRequestForCase,
  getCollection,
  getRequest,
  touchRequestRun,
} from './repo.js';

export interface ApiRunOutcome extends EngineResult {
  /** Final status code observed, for the request editor's "last run" chip. */
  http_status: number | null;
  request_id: string;
  url: string;
}

/** Extra variables layered on top of collection variables + environment. */
export interface ApiRunInput {
  request: ApiRequest;
  collection: ApiCollection | undefined;
  vars: Record<string, unknown>;
  opts?: ExecuteOptions;
  /** When true the request is compiled and validated but never sent. */
  dryRun?: boolean;
}

/** Builds the final URL from base_url + path + query map. */
export function buildUrl(
  req: ApiRequest,
  coll: ApiCollection | undefined,
  path: string,
  query: Record<string, unknown>,
  overrideBase?: string,
): string {
  const rawPath = path.trim();
  const absolute = /^https?:\/\//i.test(rawPath);
  const base = (overrideBase ?? coll?.base_url ?? '').trim().replace(/\/+$/, '');
  let url = absolute ? rawPath : `${base}${rawPath.startsWith('/') ? '' : '/'}${rawPath}`;

  if (!/^https?:\/\//i.test(url)) {
    throw EngineError.badRequest(
      `URL request belum absolut: "${url}". Isi base_url pada collection atau tulis path lengkap http(s)://…`,
    );
  }

  const entries = Object.entries(query).filter(([, v]) => v !== null && v !== undefined && v !== '');
  if (entries.length) {
    const search = new URLSearchParams();
    for (const [k, v] of entries) search.append(k, String(v));
    url += (url.includes('?') ? '&' : '?') + search.toString();
  }
  return url;
}

/**
 * Runs one ApiRequest end to end.
 * Never throws for assertion failures; throws EngineError only when the run
 * cannot start (bad URL) — the caller decides whether that is `blocked`.
 */
export async function executeApiRequest(input: ApiRunInput): Promise<ApiRunOutcome> {
  const { request, collection, opts } = input;
  const started = Date.now();
  const logs: StepLog[] = [];
  let logIndex = 0;

  const vars: Record<string, unknown> = {
    ...collectionVariables(collection),
    ...(input.vars ?? {}),
  };

  const overrides = (opts?.overrides ?? {}) as Record<string, unknown>;
  const overrideBase = typeof overrides.base_url === 'string' ? overrides.base_url : undefined;

  /* ---------------------------- pre-script ---------------------------- */
  let preHeaders: Record<string, string> = {};
  if (request.pre_script?.trim()) {
    try {
      const effect = runScript(request.pre_script, { vars });
      Object.assign(vars, effect.sets);
      preHeaders = effect.headers;
      logs.push({
        index: logIndex++,
        action: 'pre-script',
        status: 'ok',
        message: effect.logs.length ? effect.logs.join('; ') : 'skrip pre tidak menghasilkan efek',
        duration_ms: 0,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logs.push({ index: logIndex++, action: 'pre-script', status: 'fail', message, duration_ms: 0 });
      return {
        ...emptyEngineResult('api', 'failed', message),
        logs,
        duration_ms: Date.now() - started,
        http_status: null,
        request_id: request.id,
        url: '',
      };
    }
  }

  /* --------------------------- prepare call --------------------------- */
  const headersRaw = parseJson<Record<string, unknown>>(request.headers, {}) ?? {};
  const queryRaw = parseJson<Record<string, unknown>>(request.query, {}) ?? {};

  const h = interpolateObject(headersRaw, vars);
  const q = interpolateObject(queryRaw, vars);
  const p = interpolate(request.path, vars);
  const bodyInterp = interpolate(request.body ?? '', vars);

  const unresolved = [...h.missing, ...q.missing, ...p.missing, ...bodyInterp.missing];
  if (unresolved.length) {
    logs.push({
      index: logIndex++,
      action: 'interpolate',
      status: 'info',
      message: `variabel belum terdefinisi: ${[...new Set(unresolved)].join(', ')}`,
      duration_ms: 0,
    });
  }

  const auth = applyAuth(collection?.auth_type, collectionAuthConfig(collection), vars);
  const method = request.method.toUpperCase();
  const bodyType = request.body_type ?? 'none';

  const finalHeaders: Record<string, string> = {
    Accept: 'application/json, text/plain, */*',
    ...Object.fromEntries(Object.entries(h.value).map(([k, v]) => [k, String(v)])),
    ...auth.headers,
    ...preHeaders,
  };

  const sendBody = bodyType === 'none' ? undefined : bodyInterp.text;
  // fetch() rejects a body on GET/HEAD — drop it rather than throwing at runtime.
  const methodAllowsBody = method !== 'GET' && method !== 'HEAD';
  const effectiveBody = methodAllowsBody ? sendBody : undefined;
  if (effectiveBody !== undefined && effectiveBody !== '') {
    if (bodyType === 'json' && !Object.keys(finalHeaders).some((k) => k.toLowerCase() === 'content-type')) {
      finalHeaders['Content-Type'] = 'application/json';
    }
    if (bodyType === 'form' && !Object.keys(finalHeaders).some((k) => k.toLowerCase() === 'content-type')) {
      finalHeaders['Content-Type'] = 'application/x-www-form-urlencoded';
    }
  }
  if (sendBody !== undefined && sendBody !== '' && !methodAllowsBody) {
    logs.push({
      index: logIndex++,
      action: 'request',
      status: 'info',
      message: `Body diabaikan karena metode ${method} tidak mengizinkannya.`,
      duration_ms: 0,
    });
  }

  const url = buildUrl(request, collection, p.text, q.value as Record<string, unknown>, overrideBase);

  logs.push({
    index: logIndex++,
    action: 'request',
    target: url,
    status: 'ok',
    message: `${method} ${url} (${auth.describe})`,
    duration_ms: 0,
  });

  /* ----------------------------- dry run ------------------------------ */
  if (input.dryRun || opts?.dry_run) {
    logs.push({
      index: logIndex++,
      action: 'dry-run',
      status: 'info',
      message: 'Dry-run: request divalidasi dan dikompilasi, target tidak dihubungi.',
      duration_ms: 0,
    });
    if (unresolved.length) {
      const message = `Dry-run menemukan variabel belum terdefinisi: ${[...new Set(unresolved)].join(', ')}`;
      logs.push({ index: logIndex++, action: 'validate', status: 'fail', message, duration_ms: 0 });
      return {
        ...emptyEngineResult('api', 'failed', message),
        logs,
        duration_ms: Date.now() - started,
        http_status: null,
        request_id: request.id,
        url,
      };
    }
    return {
      status: 'skipped',
      engine: 'api',
      duration_ms: Date.now() - started,
      logs,
      assertions: [],
      evidence: { mode: 'dry-run', method, url, headers: redactHeaders(finalHeaders), body: sendBody ?? null },
      error: null,
      used_ai: false,
      http_status: null,
      request_id: request.id,
      url,
    };
  }

  /* ------------------------------- send ------------------------------- */
  const timeout = opts?.timeout_ms ?? 15000;
  let res: Response;
  const sendStarted = Date.now();
  try {
    res = await fetch(url, {
      method,
      headers: finalHeaders,
      body: effectiveBody,
      signal: AbortSignal.timeout(timeout),
      redirect: 'follow',
    });
  } catch (err) {
    const duration = Date.now() - sendStarted;
    const reason = err instanceof Error ? err.message : String(err);
    const message = `Tidak dapat menghubungi ${url}: ${reason}`;
    logs.push({ index: logIndex++, action: 'response', status: 'fail', message, duration_ms: duration });
    return {
      ...emptyEngineResult('api', 'blocked', message),
      logs,
      duration_ms: Date.now() - started,
      http_status: null,
      request_id: request.id,
      url,
    };
  }

  const rawBody = await res.text();
  const duration = Date.now() - sendStarted;

  const responseHeaders: Record<string, string> = {};
  res.headers.forEach((value, key) => {
    responseHeaders[key] = value;
  });

  logs.push({
    index: logIndex++,
    action: 'response',
    status: res.ok ? 'ok' : 'info',
    message: `HTTP ${res.status} ${res.statusText} — ${rawBody.length} byte dalam ${duration} ms`,
    duration_ms: duration,
    observed: res.status,
  });

  /* ---------------------------- post-script --------------------------- */
  let parsedJson: unknown = undefined;
  const contentType = responseHeaders['content-type'] ?? '';
  if (contentType.includes('json') || /^\s*[[{]/.test(rawBody)) {
    try {
      parsedJson = JSON.parse(rawBody);
    } catch {
      parsedJson = undefined;
    }
  }

  if (request.post_script?.trim()) {
    try {
      const effect = runScript(request.post_script, {
        json: parsedJson,
        body: rawBody,
        status: res.status,
        headers: responseHeaders,
        vars,
      });
      Object.assign(vars, effect.sets);
      logs.push({
        index: logIndex++,
        action: 'post-script',
        status: 'ok',
        message: effect.logs.length ? effect.logs.join('; ') : 'skrip post tidak menghasilkan efek',
        duration_ms: 0,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logs.push({ index: logIndex++, action: 'post-script', status: 'fail', message, duration_ms: 0 });
      return {
        ...emptyEngineResult('api', 'failed', message),
        logs,
        duration_ms: Date.now() - started,
        http_status: res.status,
        request_id: request.id,
        url,
      };
    }
  }

  /* ---------------------------- assertions ---------------------------- */
  const assertions = normalizeAssertions(request.assertions);
  const report = evaluateAssertions(assertions, {
    status: res.status,
    body: rawBody,
    headers: responseHeaders,
    duration_ms: duration,
    json: parsedJson,
    vars,
  });

  if (assertions.length) {
    logs.push({
      index: logIndex++,
      action: 'assertions',
      status: report.passed ? 'ok' : 'fail',
      message: `${report.passed_count}/${assertions.length} assertion lulus`,
      duration_ms: 0,
    });
    for (const outcome of report.results) {
      logs.push({
        index: logIndex++,
        action: 'assert',
        status: outcome.passed ? 'ok' : 'fail',
        message: outcome.message,
        duration_ms: 0,
        observed: outcome.observed,
      });
    }
  } else {
    logs.push({
      index: logIndex++,
      action: 'assertions',
      status: 'info',
      message: 'Tidak ada assertion; status ditentukan oleh keberhasilan panggilan HTTP saja.',
      duration_ms: 0,
    });
  }

  const error = assertions.length && !report.passed
    ? report.results.filter((r) => !r.passed).map((r) => r.message).join(' | ')
    : null;

  const status = statusFromOutcome(report.results, null);

  try {
    touchRequestRun(request.id, res.status, duration);
  } catch {
    /* persisting last-run metadata must never fail the execution */
  }

  return {
    status,
    engine: 'api',
    duration_ms: Date.now() - started,
    logs,
    assertions: report.results,
    evidence: {
      mode: 'http',
      method,
      url,
      request_headers: redactHeaders(finalHeaders),
      request_body: sendBody ?? null,
      status: res.status,
      response_headers: responseHeaders,
      response_body: truncate(rawBody, 20000),
      response_json: parsedJson ?? null,
      variables_after: vars,
    },
    error,
    used_ai: false,
    http_status: res.status,
    request_id: request.id,
    url,
  };
}

/** Runs the request bound to a test case (used by the execute module). */
export async function runApiRequestById(
  requestId: string,
  opts: ExecuteOptions = {},
  extraVars: Record<string, unknown> = {},
): Promise<ApiRunOutcome> {
  const request = getRequest(requestId);
  if (!request) throw EngineError.notFound('API request');
  const collection = getCollection(request.collection_id);
  return executeApiRequest({ request, collection, vars: extraVars, opts });
}

export async function runApiForCase(
  testCaseId: string,
  opts: ExecuteOptions = {},
  extraVars: Record<string, unknown> = {},
): Promise<ApiRunOutcome> {
  const request = findRequestForCase(testCaseId);
  if (!request) {
    throw new EngineError(
      400,
      'no_api_request',
      `Test case ${testCaseId} ber-engine "api" tetapi belum punya API request yang tertaut. ` +
        'Tautkan lewat test_case_id pada request di API Automation.',
    );
  }
  return runApiRequestById(request.id, opts, extraVars);
}

/* -------------------------------------------------------------------- *
 * Hides Authorization / api-key values in the stored evidence.
 * -------------------------------------------------------------------- */
function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const SECRET = /^(authorization|proxy-authorization|cookie|x-api-key|api-key|x-auth-token)$/i;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k] = SECRET.test(k) ? '***' : v;
  }
  return out;
}
