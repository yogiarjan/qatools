/**
 * Lane D — AI module (routes + `aiService`).
 *
 * Registered by the Lead with prefix `/api`, so every path here is declared WITHOUT
 * the `/api` prefix (`/ai/settings`, `/mock/...`).
 *
 * Exports the FROZEN cross-lane surface from ARCHITECTURE.md §6.1:
 *   aiService.generate<T>(task, input, ctx?): Promise<AiResult<T>>
 *   aiService.status(): Promise<AiStatus>
 *   aiService.crawl(input): Promise<CrawlResult>
 * Lane B dynamically imports `{ aiService }` from `../ai/index.js` for defect triage.
 */

import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  AI_TASKS,
  newId,
  nowIso,
  type AiChatMessage,
  type AiGenerateRequest,
  type AiResult,
  type AiStatus,
  type AiTask,
  type CrawlResult,
} from '@qatools/shared';
import { db, nextCode, parseJson, toJson } from '../../db/index.js';
import { badRequest, fail, list, one } from '../../lib/http.js';
import { callProvider, providerInfo, providerNeedsKey, PROVIDERS, resolveBaseUrl } from './providers.js';
import { buildPrompt, promptCatalogue, TASK_FIELDS, TASK_LABEL } from './prompts.js';
import { extractJsonDetailed } from './json.js';
import { offlineGenerate } from './offline.js';
import { crawlSite } from './crawler.js';
import { persistArtifacts, type PersistContext } from './persist.js';

/* ------------------------------------------------------------------ *
 * Settings access
 * ------------------------------------------------------------------ */

interface SettingsRow {
  id: string;
  provider: string;
  model: string;
  base_url: string | null;
  api_key: string | null;
  api_key_masked: string | null;
  temperature: number;
  max_tokens: number;
  enabled: number;
  fallback_to_mock: number;
  created_at: string;
  updated_at: string;
}

export const DEFAULT_SETTINGS = {
  provider: 'mock',
  model: 'qatools-mock-1',
  base_url: '',
  temperature: 0.3,
  max_tokens: 4096,
  enabled: 1,
  fallback_to_mock: 1,
};

/** Masks a secret as `sk-…abcd`. Never returns the full value. */
export function maskKey(key: string | null | undefined): string | null {
  const k = (key ?? '').trim();
  if (!k) return null;
  if (k.length <= 8) return `${k.slice(0, 1)}…${k.slice(-1)}`;
  return `${k.slice(0, 3)}…${k.slice(-4)}`;
}

/** Reads the singleton settings row, creating it (mock provider) on first use. */
function loadSettingsRow(): SettingsRow {
  const existing = db.prepare(`SELECT * FROM ai_settings ORDER BY created_at LIMIT 1`).get();
  if (existing) return existing as unknown as SettingsRow;
  const now = nowIso();
  const id = newId('ais_');
  db.prepare(
    `INSERT INTO ai_settings (id, provider, model, base_url, api_key, api_key_masked, temperature, max_tokens, enabled, fallback_to_mock, created_at, updated_at)
     VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    DEFAULT_SETTINGS.provider,
    DEFAULT_SETTINGS.model,
    DEFAULT_SETTINGS.base_url,
    DEFAULT_SETTINGS.temperature,
    DEFAULT_SETTINGS.max_tokens,
    DEFAULT_SETTINGS.enabled,
    DEFAULT_SETTINGS.fallback_to_mock,
    now,
    now,
  );
  return db.prepare(`SELECT * FROM ai_settings WHERE id = ?`).get(id) as unknown as SettingsRow;
}

/** Public (safe) shape: the raw api_key is replaced by `api_key_masked`. */
export interface PublicSettings {
  id: string;
  provider: string;
  model: string;
  base_url: string | null;
  api_key_masked: string | null;
  api_key_set: boolean;
  temperature: number;
  max_tokens: number;
  enabled: boolean;
  fallback_to_mock: boolean;
  created_at: string;
  updated_at: string;
}

export function publicSettings(row: SettingsRow): PublicSettings {
  return {
    id: row.id,
    provider: row.provider,
    model: row.model,
    base_url: row.base_url,
    api_key_masked: row.api_key_masked ?? maskKey(row.api_key),
    api_key_set: Boolean(row.api_key),
    temperature: Number(row.temperature ?? DEFAULT_SETTINGS.temperature),
    max_tokens: Number(row.max_tokens ?? DEFAULT_SETTINGS.max_tokens),
    enabled: Boolean(row.enabled),
    fallback_to_mock: Boolean(row.fallback_to_mock),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/**
 * True when the AI layer can talk to a real provider:
 * enabled + a provider that is not `mock` + (no key needed OR a key is present).
 */
export function isLive(row: SettingsRow): boolean {
  if (!row.enabled) return false;
  const provider = row.provider || 'mock';
  if (provider === 'mock') return false;
  if (providerNeedsKey(provider) && !(row.api_key ?? '').trim()) return false;
  return true;
}

/* ------------------------------------------------------------------ *
 * Generation logging (ALWAYS written: success, mock and failure)
 * ------------------------------------------------------------------ */

export interface GenerationLog {
  projectId?: string | null;
  task: string;
  provider: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  latencyMs: number;
  status: 'success' | 'error';
  usedMock: boolean;
  inputRef?: string | null;
  outputRef?: string | null;
  error?: string | null;
}

export function logGeneration(g: GenerationLog): string {
  const id = newId('aig_');
  try {
    db.prepare(
      `INSERT INTO ai_generations
         (id, project_id, task, provider, model, prompt_tokens, completion_tokens, latency_ms, status, used_mock, input_ref, output_ref, error, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      g.projectId ?? null,
      g.task,
      g.provider,
      g.model,
      Math.max(0, Math.round(g.promptTokens || 0)),
      Math.max(0, Math.round(g.completionTokens || 0)),
      Math.max(0, Math.round(g.latencyMs || 0)),
      g.status,
      g.usedMock ? 1 : 0,
      g.inputRef ?? null,
      g.outputRef ?? null,
      g.error ? String(g.error).slice(0, 1000) : null,
      nowIso(),
    );
  } catch {
    /* logging must never break a request */
  }
  return id;
}

/* ------------------------------------------------------------------ *
 * Shape validation / normalisation
 * ------------------------------------------------------------------ */

const PRIORITIES_OK = new Set(['low', 'medium', 'high', 'critical']);
const RISKS_OK = new Set(['low', 'medium', 'high']);
const SEVERITIES_OK = new Set(['cosmetic', 'minor', 'major', 'critical', 'blocker']);
const CASE_TYPES_OK = new Set([
  'functional',
  'negative',
  'boundary',
  'security',
  'performance',
  'usability',
  'compatibility',
  'regression',
]);
const LAYERS_OK = new Set(['web', 'api', 'db', 'mobile', 'unit']);
const SCENARIO_KINDS_OK = new Set(['happy_path', 'alternative', 'negative', 'edge', 'security', 'performance']);
const ASSERTION_SOURCES_OK = new Set([
  'status',
  'body',
  'header',
  'duration',
  'jsonpath',
  'row_count',
  'column',
  'text',
  'element',
]);
const ASSERTION_OPS_OK = new Set([
  'equals',
  'not_equals',
  'contains',
  'not_contains',
  'gt',
  'gte',
  'lt',
  'lte',
  'exists',
  'not_exists',
  'matches',
  'in',
  'length_gte',
  'length_lte',
]);
const WEB_ACTIONS_OK = new Set([
  'goto',
  'click',
  'fill',
  'select',
  'check',
  'uncheck',
  'press',
  'wait',
  'assert_text',
  'assert_visible',
  'assert_url',
  'screenshot',
  'hover',
  'scroll',
]);

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const asText = (v: unknown, fallback = ''): string => {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return fallback;
};
const asTextArray = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => asText(x)).filter((x) => x.length > 0) : [];
const asEnum = (v: unknown, allowed: Set<string>, fallback: string): string =>
  typeof v === 'string' && allowed.has(v) ? v : fallback;

function pickArray(value: unknown, ...keys: string[]): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.filter(isObj);
  if (isObj(value)) {
    for (const k of keys) {
      const inner = value[k];
      if (Array.isArray(inner)) return inner.filter(isObj);
    }
    // single object → treat as a one-element list when it looks like a draft
    if (Object.keys(value).length) return [value];
  }
  return [];
}

function normaliseAssertions(v: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(v)) return [];
  return v.filter(isObj).map((a) => ({
    source: asEnum(a.source, ASSERTION_SOURCES_OK, 'status'),
    ...(typeof a.path === 'string' && a.path ? { path: a.path } : {}),
    operator: asEnum(a.operator, ASSERTION_OPS_OK, 'exists'),
    ...(a.expected === undefined ? {} : { expected: a.expected }),
    ...(typeof a.message === 'string' && a.message ? { message: a.message } : {}),
  }));
}

/**
 * Validates and normalises a model payload into the task's contract shape.
 * Returns `null` when the payload cannot be salvaged — the caller then degrades to
 * the deterministic offline generator instead of failing the request.
 */
export function normaliseForTask(task: string, raw: unknown): unknown {
  if (raw === null || raw === undefined) return null;
  switch (task) {
    case 'generate_usecases': {
      const list = pickArray(raw, 'use_cases', 'usecases', 'items', 'data');
      if (!list.length) return null;
      return list.map((u) => ({
        name: asText(u.name ?? u.title, 'Use Case'),
        goal: asText(u.goal ?? u.objective),
        actors: asTextArray(u.actors).length ? asTextArray(u.actors) : ['Pengguna'],
        preconditions: asTextArray(u.preconditions),
        postconditions: asTextArray(u.postconditions),
        main_flow: asTextArray(u.main_flow ?? u.mainFlow ?? u.steps),
        alternate_flows: Array.isArray(u.alternate_flows)
          ? (u.alternate_flows as unknown[]).filter(isObj).map((a) => ({
              name: asText(a.name, 'Alur alternatif'),
              steps: asTextArray(a.steps),
            }))
          : [],
        business_rules: asTextArray(u.business_rules ?? u.businessRules),
        priority: asEnum(u.priority, PRIORITIES_OK, 'medium'),
        risk: asEnum(u.risk, RISKS_OK, 'medium'),
      }));
    }
    case 'generate_scenarios': {
      const list = pickArray(raw, 'scenarios', 'items', 'data');
      if (!list.length) return null;
      return list.map((s0) => ({
        title: asText(s0.title ?? s0.name, 'Skenario'),
        kind: asEnum(s0.kind, SCENARIO_KINDS_OK, 'happy_path'),
        given_text: asText(s0.given_text ?? s0.given),
        when_text: asText(s0.when_text ?? s0.when),
        then_text: asText(s0.then_text ?? s0.then),
        priority: asEnum(s0.priority, PRIORITIES_OK, 'medium'),
      }));
    }
    case 'generate_testcases': {
      const list = pickArray(raw, 'test_cases', 'testcases', 'items', 'data');
      if (!list.length) return null;
      return list.map((t) => {
        const steps = Array.isArray(t.steps)
          ? (t.steps as unknown[]).filter(isObj).map((st) => ({
              action: asText(st.action ?? st.step, 'Langkah uji'),
              expected: asText(st.expected ?? st.expected_result),
              ...(typeof st.data === 'string' && st.data ? { data: st.data } : {}),
            }))
          : [];
        return {
          title: asText(t.title ?? t.name, 'Test Case'),
          objective: asText(t.objective),
          preconditions: asText(t.preconditions),
          type: asEnum(t.type, CASE_TYPES_OK, 'functional'),
          layer: asEnum(t.layer, LAYERS_OK, 'web'),
          priority: asEnum(t.priority, PRIORITIES_OK, 'medium'),
          severity: asEnum(t.severity, SEVERITIES_OK, 'major'),
          estimated_minutes: Math.max(1, Math.round(Number(t.estimated_minutes ?? t.estimatedMinutes ?? 10) || 10)),
          tags: asTextArray(t.tags),
          test_data: Array.isArray(t.test_data)
            ? (t.test_data as unknown[]).filter(isObj).map((d) => ({
                field: asText(d.field ?? d.name, 'field'),
                value: asText(d.value, ''),
              }))
            : [],
          expected_result: asText(t.expected_result ?? t.expected),
          steps: steps.length ? steps : [{ action: 'Jalankan skenario uji.', expected: asText(t.expected_result) }],
        };
      });
    }
    case 'generate_test_data': {
      const o = pickArray(raw, 'rows', 'data')[0] ?? (isObj(raw) ? raw : null);
      if (!o) return null;
      const rows = Array.isArray((raw as Record<string, unknown>)?.rows)
        ? ((raw as Record<string, unknown>).rows as unknown[]).filter(isObj)
        : [];
      const columns = Array.isArray((raw as Record<string, unknown>)?.columns)
        ? asTextArray((raw as Record<string, unknown>).columns)
        : Object.keys(rows[0] ?? {});
      return {
        columns,
        rows,
        notes: asText((raw as Record<string, unknown>)?.notes, 'Data uji hasil AI.'),
      };
    }
    case 'generate_api_tests': {
      const list = pickArray(raw, 'requests', 'api_requests', 'items', 'data');
      if (!list.length) return null;
      return list.map((r) => ({
        name: asText(r.name ?? r.title, 'API Request'),
        method: asText(r.method, 'GET').toUpperCase(),
        path: asText(r.path ?? r.url, '/'),
        headers: isObj(r.headers) ? (r.headers as Record<string, string>) : {},
        query: isObj(r.query) ? (r.query as Record<string, string>) : {},
        body: r.body === undefined || r.body === null ? null : typeof r.body === 'string' ? r.body : JSON.stringify(r.body),
        body_type: asEnum(r.body_type, new Set(['json', 'form', 'raw', 'none']), 'none'),
        assertions: normaliseAssertions(r.assertions),
      }));
    }
    case 'generate_db_checks': {
      const list = pickArray(raw, 'checks', 'db_checks', 'items', 'data');
      if (!list.length) return null;
      return list.map((c) => ({
        name: asText(c.name ?? c.title, 'DB Check'),
        sql: asText(c.sql ?? c.query, 'SELECT 1 AS ok;'),
        assertions: normaliseAssertions(c.assertions),
        rationale: asText(c.rationale ?? c.reason),
      }));
    }
    case 'generate_web_flow': {
      const o = pickArray(raw, 'steps', 'flow')[0] ?? (isObj(raw) ? raw : null);
      if (!o) return null;
      const stepsRaw = Array.isArray((raw as Record<string, unknown>)?.steps)
        ? ((raw as Record<string, unknown>).steps as unknown[])
        : Array.isArray(o.steps)
          ? (o.steps as unknown[])
          : [];
      const steps = stepsRaw.filter(isObj).map((st) => ({
        action: asEnum(st.action, WEB_ACTIONS_OK, 'click'),
        ...(typeof st.selector === 'string' && st.selector ? { selector: st.selector } : {}),
        ...(st.value === undefined ? {} : { value: asText(st.value) }),
        ...(st.expected === undefined ? {} : { expected: asText(st.expected) }),
        ...(st.timeout_ms === undefined ? {} : { timeout_ms: Math.max(0, Number(st.timeout_ms) || 0) }),
        ...(typeof st.description === 'string' && st.description ? { description: st.description } : {}),
      }));
      if (!steps.length) return null;
      return {
        name: asText((raw as Record<string, unknown>)?.name, 'Web Flow'),
        start_url: asText(
          (raw as Record<string, unknown>)?.start_url ?? (raw as Record<string, unknown>)?.url,
          steps.find((x) => x.action === 'goto')?.value ?? '',
        ),
        steps,
      };
    }
    case 'generate_sql': {
      const o = isObj(raw) ? raw : null;
      if (!o) return null;
      const sql = asText(o.sql ?? o.query);
      if (!sql) return null;
      return {
        sql,
        explanation: asText(o.explanation ?? o.rationale),
        tables_used: asTextArray(o.tables_used ?? o.tables),
        dialect: asText(o.dialect, 'sqlite'),
        cautions: asTextArray(o.cautions ?? o.warnings),
      };
    }
    case 'review_coverage': {
      const o = isObj(raw) ? raw : null;
      if (!o) return null;
      const findings = Array.isArray(o.findings)
        ? (o.findings as unknown[]).filter(isObj).map((f) => ({
            requirement_id: asText(f.requirement_id ?? f.requirementId, 'REQ-?'),
            severity: asEnum(f.severity, SEVERITIES_OK, 'minor'),
            issue: asText(f.issue, 'Temuan coverage'),
            recommendation: asText(f.recommendation),
          }))
        : [];
      const suggested = normaliseForTask('generate_testcases', o.suggested_test_cases);
      return {
        findings,
        suggested_test_cases: Array.isArray(suggested) ? suggested : [],
        overall_assessment: asText(o.overall_assessment ?? o.assessment, 'Tinjauan coverage selesai.'),
      };
    }
    case 'triage_defect': {
      const o = isObj(raw) ? raw : null;
      if (!o) return null;
      return {
        severity: asEnum(o.severity, SEVERITIES_OK, 'major'),
        priority: asEnum(o.priority, PRIORITIES_OK, 'medium'),
        component: asText(o.component, 'General'),
        likely_root_cause: asText(o.likely_root_cause ?? o.root_cause, 'Perlu investigasi lanjutan.'),
        reproduction_hint: asText(o.reproduction_hint ?? o.reproduction, 'Ulangi langkah pada environment yang sama.'),
        suggested_owner_role: asText(o.suggested_owner_role ?? o.owner, 'Full-stack Engineer'),
        duplicate_risk: asEnum(o.duplicate_risk, RISKS_OK, 'low'),
        rationale: asText(o.rationale, 'Ditriase otomatis oleh lapisan AI.'),
      };
    }
    case 'predict_risk': {
      const items = pickArray(raw, 'items', 'test_cases', 'data');
      if (!items.length) return null;
      const normalised = items.map((it) => {
        const score = Math.max(0, Math.min(100, Math.round(Number(it.score ?? 0) || 0)));
        return {
          test_case_id: asText(it.test_case_id ?? it.id, 'tc_unknown'),
          ...(typeof it.code === 'string' ? { code: it.code } : {}),
          ...(typeof it.title === 'string' ? { title: it.title } : {}),
          score,
          level: asEnum(it.level, RISKS_OK, score >= 65 ? 'high' : score >= 35 ? 'medium' : 'low'),
          factors: asTextArray(it.factors),
          should_be_in_regression: Boolean(it.should_be_in_regression ?? score >= 50),
          recommended_order: Math.max(1, Math.round(Number(it.recommended_order ?? 0) || 1)),
        };
      });
      return { items: normalised };
    }
    case 'summarize_test_plan': {
      const o = isObj(raw) ? raw : null;
      if (!o) return null;
      const arrOfObj = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? (v as unknown[]).filter(isObj) : []);
      return {
        title: asText(o.title, 'Rencana Pengujian'),
        summary: asText(o.summary),
        scope: asTextArray(o.scope),
        out_of_scope: asTextArray(o.out_of_scope),
        approach: arrOfObj(o.approach).map((a) => ({
          phase: asText(a.phase, 'Fase'),
          activities: asTextArray(a.activities),
          exit_criteria: asText(a.exit_criteria),
        })),
        environments: arrOfObj(o.environments).map((e) => ({ name: asText(e.name, 'Env'), purpose: asText(e.purpose) })),
        test_data: asTextArray(o.test_data),
        risks: arrOfObj(o.risks).map((r) => ({
          risk: asText(r.risk, 'Risiko'),
          likelihood: asEnum(r.likelihood, RISKS_OK, 'medium'),
          impact: asEnum(r.impact, RISKS_OK, 'medium'),
          mitigation: asText(r.mitigation),
        })),
        schedule: arrOfObj(o.schedule).map((d) => ({
          day: asText(d.day, 'Hari'),
          focus: asText(d.focus),
          owner: asText(d.owner),
        })),
        entry_criteria: asTextArray(o.entry_criteria),
        exit_criteria: asTextArray(o.exit_criteria),
        metrics: asTextArray(o.metrics),
      };
    }
    case 'chat': {
      if (typeof raw === 'string') return { reply: raw, suggestions: [] };
      const o = isObj(raw) ? raw : null;
      if (!o) return null;
      return {
        reply: asText(o.reply ?? o.message ?? o.content, ''),
        suggestions: asTextArray(o.suggestions),
      };
    }
    case 'crawl_site':
      return isObj(raw) || Array.isArray(raw) ? raw : null;
    default:
      // Unknown task: keep whatever came back rather than inventing a shape.
      return raw;
  }
}

/* ------------------------------------------------------------------ *
 * Generate context
 * ------------------------------------------------------------------ */

export interface GenerateContext {
  projectId?: string | null;
  persist?: boolean;
  inputRef?: string | null;
  /** Force offline generation (used by status probing / tests). */
  forceOffline?: boolean;
  /** Override provider settings for a single call. */
  overrides?: Partial<Pick<SettingsRow, 'provider' | 'model' | 'base_url' | 'api_key' | 'temperature' | 'max_tokens'>>;
}

/* ------------------------------------------------------------------ *
 * aiService — the FROZEN cross-lane surface
 * ------------------------------------------------------------------ */

export const aiService = {
  /** Current AI configuration as seen by the UI. */
  async status(): Promise<AiStatus> {
    const row = loadSettingsRow();
    const live = isLive(row);
    const provider = row.provider || 'mock';
    const info = providerInfo(provider);
    const message = live
      ? `Provider ${info.label} aktif (${row.model}). Permintaan dikirim ke ${resolveBaseUrl(provider, row.base_url)}.`
      : provider === 'mock'
        ? 'Mode offline deterministik: seluruh task AI dijawab generator rule-based lokal tanpa jaringan.'
        : !row.enabled
          ? 'AI dinonaktifkan — seluruh task dilayani generator offline.'
          : info.needs_key && !(row.api_key ?? '').trim()
            ? `API key ${info.label} belum diisi — seluruh task dilayani generator offline.`
            : 'Provider belum siap — seluruh task dilayani generator offline.';
    return {
      configured: live,
      provider,
      model: row.model,
      mode: live ? 'live' : 'mock',
      fallback_to_mock: Boolean(row.fallback_to_mock),
      message,
    };
  },

  /** Crawl a site (or parse inline HTML) into a frozen `CrawlResult`. */
  async crawl(input: { url: string; html?: string; max_pages?: number; depth?: number; include_links?: boolean }): Promise<CrawlResult> {
    const started = Date.now();
    const result = await crawlSite(input ?? { url: '' });
    logGeneration({
      task: 'crawl_site',
      provider: 'crawler',
      model: 'qatools-crawler-1',
      promptTokens: 0,
      completionTokens: 0,
      latencyMs: Date.now() - started,
      status: result.fetched ? 'success' : 'error',
      usedMock: result.used_mock,
      error: result.fetched ? null : 'Fetch gagal — fitur diturunkan dari segmen URL.',
    });
    return result;
  },

  /**
   * THE core entry point. Loads settings → calls the provider → extracts JSON →
   * normalises to the task contract → persists (optional) → ALWAYS logs to
   * `ai_generations` → degrades to the deterministic offline generator on any failure.
   * It never throws for provider/parse problems: it returns `ok: true` with `used_mock`
   * whenever a fallback produced usable data.
   */
  async generate<T = unknown>(
    task: AiTask | string,
    input: Record<string, unknown> = {},
    ctx: GenerateContext = {},
  ): Promise<AiResult<T>> {
    const started = Date.now();
    const row = loadSettingsRow();
    const provider = ctx.overrides?.provider ?? row.provider ?? 'mock';
    const model = ctx.overrides?.model ?? row.model ?? 'qatools-mock-1';
    const apiKey = ctx.overrides?.api_key !== undefined ? ctx.overrides.api_key : row.api_key;
    const baseUrl = ctx.overrides?.base_url !== undefined ? ctx.overrides.base_url : row.base_url;
    const temperature = ctx.overrides?.temperature ?? Number(row.temperature ?? 0.3);
    const maxTokens = ctx.overrides?.max_tokens ?? Number(row.max_tokens ?? 4096);
    const projectId = ctx.projectId ?? null;
    const forceOffline = ctx.forceOffline === true;
    // `live` means "we will actually attempt an HTTP call to a real provider".
    // The `mock` provider is never a network attempt, even though `isLive()` reports
    // `configured: true` for a prepared real provider — see `isLive` above.
    const live =
      !forceOffline &&
      provider !== 'mock' &&
      isLive({ ...row, provider, api_key: apiKey ?? null, enabled: row.enabled });

    const meta = (patch: Partial<AiResult<T>['meta']>): AiResult<T>['meta'] => ({
      provider,
      model,
      task,
      used_mock: false,
      latency_ms: Date.now() - started,
      prompt_tokens: 0,
      completion_tokens: 0,
      generation_id: null,
      degraded: false,
      ...patch,
    });

    // An unrecognised task key gets a fast, explicit error instead of a meaningless
    // fallback payload — a lane typo must be loud, not silent.
    if (!(AI_TASKS as readonly string[]).includes(task)) {
      const generationId = logGeneration({
        projectId,
        task: String(task),
        provider,
        model,
        promptTokens: 0,
        completionTokens: 0,
        latencyMs: Date.now() - started,
        status: 'error',
        usedMock: false,
        error: `Task AI "${task}" tidak dikenal.`,
      });
      return {
        ok: false,
        data: null,
        error: `Task AI "${task}" tidak dikenal. Pilihan: ${AI_TASKS.join(', ')}.`,
        meta: meta({ generation_id: generationId }),
      };
    }

    let providerError: string | null = null;
    let promptTokens = 0;
    let completionTokens = 0;
    let data: unknown = null;
    let usedMock = false;
    let degraded = false;
    let rawReply = '';

    if (live) {
      const prompt = buildPrompt(task, input);
      const result = await callProvider({
        provider,
        model,
        baseUrl,
        apiKey,
        messages: [
          { role: 'system', content: prompt.system },
          { role: 'user', content: prompt.user },
        ],
        temperature,
        maxTokens,
        seed: `${task}:${JSON.stringify(input).slice(0, 200)}`,
      });
      promptTokens = result.promptTokens;
      completionTokens = result.completionTokens;

      if (result.ok) {
        rawReply = result.text;
        const extracted = extractJsonDetailed(result.text);
        if (extracted.value === null) {
          providerError = `Balasan model bukan JSON yang dapat dibaca (via=${extracted.via ?? 'none'}).`;
        } else {
          const normalised = normaliseForTask(task, extracted.value);
          if (normalised === null) {
            providerError = 'Balasan model tidak sesuai skema task; memakai generator offline.';
          } else {
            data = normalised;
          }
        }
      } else {
        providerError = result.error ?? 'Provider gagal tanpa pesan.';
      }
    } else if (provider === 'mock' || forceOffline) {
      providerError = null;
    } else {      // Provider configured but unusable → the message must be actionable.
      const info = providerInfo(provider);
      providerError = !row.enabled
        ? 'AI dinonaktifkan pada pengaturan.'
        : info.needs_key && !(apiKey ?? '').trim()
          ? `API key ${info.label} belum diisi.`
          : 'Provider belum siap.';
    }

    // Fallback (also the happy path in offline mode).
    if (data === null) {
      const allowFallback = Boolean(row.fallback_to_mock) || !live || forceOffline || provider === 'mock';
      if (allowFallback) {
        data = offlineGenerate(task, input);
        usedMock = true;
        // We only *degrade* when we genuinely tried a live provider and it failed.
        degraded = live && providerError !== null;
      }
    }

    if (data === null) {
      // Only reachable when a live provider failed AND fallback_to_mock is off.
      const generationId = logGeneration({
        projectId,
        task,
        provider,
        model,
        promptTokens,
        completionTokens,
        latencyMs: Date.now() - started,
        status: 'error',
        usedMock: false,
        inputRef: ctx.inputRef ?? null,
        error: providerError ?? 'Gagal menghasilkan data.',
      });
      return {
        ok: false,
        data: null,
        error: providerError ?? 'Gagal menghasilkan data dan fallback dinonaktifkan.',
        meta: meta({ generation_id: generationId, prompt_tokens: promptTokens, completion_tokens: completionTokens }),
      };
    }

    // Persistence (additive INSERTs only) + generation log.
    const persistCtx: PersistContext = {
      projectId: projectId ?? '',
      generationId: null,
      requirementIds: Array.isArray(input.requirement_ids) ? (input.requirement_ids as string[]) : [],
      useCaseIds: Array.isArray(input.use_case_ids) ? (input.use_case_ids as string[]) : [],
      scenarioIds: Array.isArray(input.scenario_ids) ? (input.scenario_ids as string[]) : [],
      collectionId: typeof input.collection_id === 'string' ? input.collection_id : null,
      connectionId: typeof input.connection_id === 'string' ? input.connection_id : null,
    };

    const generationId = logGeneration({
      projectId,
      task,
      provider,
      model,
      promptTokens,
      completionTokens,
      latencyMs: Date.now() - started,
      status: 'success',
      usedMock,
      inputRef: ctx.inputRef ?? null,
      outputRef: null,
      error: degraded ? providerError : null,
    });
    persistCtx.generationId = generationId;

    let persisted: ReturnType<typeof persistArtifacts> | null = null;
    if (ctx.persist && projectId) {
      try {
        persisted = persistArtifacts(task, data, persistCtx);
      } catch (err) {
        persisted = {
          created: {
            use_cases: [],
            scenarios: [],
            test_cases: [],
            test_steps: [],
            api_requests: [],
            db_checks: [],
            web_flows: [],
            requirements: [],
            matrix_links: [],
          },
          labels: [],
          skipped: [`Gagal menyimpan artifact: ${err instanceof Error ? err.message : String(err)}`],
        };
      }
    } else if (ctx.persist && !projectId) {
      persisted = {
        created: {
          use_cases: [],
          scenarios: [],
          test_cases: [],
          test_steps: [],
          api_requests: [],
          db_checks: [],
          web_flows: [],
          requirements: [],
          matrix_links: [],
        },
        labels: [],
        skipped: ['project_id wajib diisi untuk menyimpan artifact.'],
      };
    }

    const resultMeta: AiResult<T>['meta'] & Record<string, unknown> = {
      ...meta({
        used_mock: usedMock,
        degraded,
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        generation_id: generationId,
      }),
      ...(persisted
        ? {
            created: persisted.created,
            created_labels: persisted.labels,
            persist_skipped: persisted.skipped,
          }
        : {}),
      ...(degraded && providerError ? { degraded_reason: providerError } : {}),
      // Diagnostic: what the layer decided to do with this request.
      offline_mode: !live,
      provider_attempted: live,
    };

    return {
      ok: true,
      data: data as T,
      // Honest: an offline answer is not an error, but we do surface the provider problem.
      error: degraded ? providerError : null,
      meta: resultMeta,
    };
  },
};

/* ------------------------------------------------------------------ *
 * Routes
 * ------------------------------------------------------------------ */

function pickSettingsPatch(body: Record<string, unknown>): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (typeof body.provider === 'string' && PROVIDERS.some((p) => p.id === body.provider)) patch.provider = body.provider;
  if (typeof body.model === 'string' && body.model.trim()) patch.model = body.model.trim();
  if (typeof body.base_url === 'string') patch.base_url = body.base_url.trim();
  if (typeof body.temperature === 'number' || typeof body.temperature === 'string') {
    const t = Number(body.temperature);
    if (Number.isFinite(t)) patch.temperature = Math.max(0, Math.min(2, t));
  }
  if (typeof body.max_tokens === 'number' || typeof body.max_tokens === 'string') {
    const m = Number(body.max_tokens);
    if (Number.isFinite(m)) patch.max_tokens = Math.max(1, Math.min(200_000, Math.round(m)));
  }
  if (typeof body.enabled === 'boolean') patch.enabled = body.enabled ? 1 : 0;
  if (typeof body.fallback_to_mock === 'boolean') patch.fallback_to_mock = body.fallback_to_mock ? 1 : 0;
  return patch;
}

/** Writes the key columns, applying provider defaults for model/base_url when blank. */
export function applySettings(
  row: SettingsRow,
  body: Record<string, unknown>,
): { row: SettingsRow; apiKeyChanged: boolean; cleared: boolean } {
  const patch = pickSettingsPatch(body);
  const provider = (patch.provider as string | undefined) ?? row.provider;
  let apiKeyChanged = false;
  let cleared = false;

  // `clear_api_key: true` removes the stored secret; `api_key: ""` is treated as "unchanged".
  if (body.clear_api_key === true) {
    patch.api_key = null;
    patch.api_key_masked = null;
    cleared = true;
    apiKeyChanged = true;
  } else if (typeof body.api_key === 'string' && body.api_key.trim()) {
    patch.api_key = body.api_key.trim();
    patch.api_key_masked = maskKey(body.api_key.trim());
    apiKeyChanged = true;
  }

  // Switching provider without an explicit model → adopt the provider's default.
  if (patch.provider && patch.provider !== row.provider && !patch.model) {
    patch.model = providerInfo(provider).default_model;
    patch.base_url = '';
  }
  if (provider === 'mock') {
    patch.model = (patch.model as string) ?? 'qatools-mock-1';
  }

  const keys = Object.keys(patch).filter((k) => patch[k] !== undefined);
  if (keys.length) {
    db.prepare(`UPDATE ai_settings SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`).run(
      ...keys.map((k) => patch[k] as never),
      nowIso(),
      row.id,
    );
  }
  const next = db.prepare(`SELECT * FROM ai_settings WHERE id = ?`).get(row.id) as unknown as SettingsRow;
  return { row: next, apiKeyChanged, cleared };
}

export default async function routes(app: FastifyInstance): Promise<void> {
  // The mock system-under-test is registered as a sub-plugin so `/mock/*` works even
  // though `server.ts` only lists the `ai` module.
  const aimock = (await import('../aimock/index.js')).default;
  await app.register(aimock);

  /* ----------------------------- meta ----------------------------- */

  app.get('/ai/tasks', async () =>
    list(
      AI_TASKS.map((task) => ({
        task,
        label: TASK_LABEL[task] ?? task,
        fields: TASK_FIELDS[task] ?? [{ key: 'input', label: 'Input (JSON)', kind: 'json' as const }],
        supports_persist: ['generate_usecases', 'generate_scenarios', 'generate_testcases', 'generate_api_tests', 'generate_db_checks', 'generate_web_flow', 'generate_test_data', 'crawl_site'].includes(task),
      })),
    ),
  );

  app.get('/ai/providers', async () => list(PROVIDERS.map((p) => ({ ...p }))));

  app.get('/ai/prompts', async () => list(promptCatalogue()));

  app.get('/ai/status', async () => one(await aiService.status()));

  /* --------------------------- settings --------------------------- */

  app.get('/ai/settings', async () => {
    const row = loadSettingsRow();
    const publicRow = publicSettings(row);
    const status = await aiService.status();
    return one({ ...publicRow, status });
  });

  app.put('/ai/settings', async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const row = loadSettingsRow();
    const { row: next, apiKeyChanged, cleared } = applySettings(row, body);
    const status = await aiService.status();
    const applied = providerInfo(next.provider);
    return one({
      ...publicSettings(next),
      status,
      notice: cleared
        ? 'API key dihapus. Seluruh task AI kini dilayani generator offline deterministik.'
        : apiKeyChanged
          ? `API key tersimpan (${maskKey(next.api_key)}). Kunci asli tidak pernah dikembalikan oleh API.`
          : status.configured
            ? `Provider ${applied.label} siap digunakan.`
            : 'Pengaturan tersimpan; AI tetap berjalan pada mode offline sampai provider siap.',
    });
  });

  /**
   * Real connection test: performs a tiny live 'chat' call against the CURRENT settings
   * and reports the truth (ok / latency / real vendor error message).
   */
  app.post('/ai/settings/test', async (req) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const row = loadSettingsRow();
    // Allow testing unsaved values without persisting them.
    const provider = typeof body.provider === 'string' ? body.provider : row.provider;
    const model = typeof body.model === 'string' && body.model.trim() ? body.model.trim() : row.model;
    const baseUrl = typeof body.base_url === 'string' ? body.base_url : row.base_url;
    const apiKey = typeof body.api_key === 'string' && body.api_key.trim() ? body.api_key.trim() : row.api_key;
    const started = Date.now();

    if (provider === 'mock') {
      return one({
        ok: true,
        live: false,
        provider,
        model,
        latency_ms: Date.now() - started,
        message:
          'Provider mock selalu berhasil dan tidak menyentuh jaringan. Seluruh task AI dijawab generator offline deterministik.',
        mode: 'mock' as const,
      });
    }

    const info = providerInfo(provider);
    if (info.needs_key && !(apiKey ?? '').trim()) {
      return one({
        ok: false,
        live: false,
        provider,
        model,
        latency_ms: 0,
        message: `API key ${info.label} belum diisi.`,
        mode: 'mock' as const,
      });
    }

    const result = await callProvider({
      provider,
      model,
      baseUrl,
      apiKey,
      messages: [
        { role: 'system', content: 'Anda asisten QA. Balas sangat singkat.' },
        { role: 'user', content: 'Balas dengan satu kata: OK' },
      ],
      temperature: 0,
      maxTokens: 16,
      timeoutMs: 15_000,
    });

    logGeneration({
      task: 'chat',
      provider,
      model,
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
      latencyMs: result.latencyMs,
      status: result.ok ? 'success' : 'error',
      usedMock: false,
      error: result.ok ? null : result.error,
    });

    return one({
      ok: result.ok,
      live: result.ok,
      provider,
      model,
      latency_ms: result.latencyMs,
      endpoint: provider === 'anthropic' ? `${resolveBaseUrl(provider, baseUrl)}/messages` : provider === 'google' ? `${resolveBaseUrl(provider, baseUrl)}/models/${model}:generateContent` : provider === 'ollama' ? `${resolveBaseUrl(provider, baseUrl)}/api/chat` : `${resolveBaseUrl(provider, baseUrl)}/chat/completions`,
      message: result.ok
        ? `Koneksi berhasil dalam ${result.latencyMs} ms. Balasan: "${result.text.slice(0, 80).trim()}"`
        : `Koneksi gagal: ${result.error}`,
      error: result.error,
      sample: result.ok ? result.text.slice(0, 200) : null,
      mode: result.ok ? ('live' as const) : ('mock' as const),
    });
  });

  /* --------------------------- generate --------------------------- */

  async function handleGenerate(
    body: Record<string, unknown>,
    projectIdFromPath?: string,
    reply?: FastifyReply,
  ): Promise<unknown> {
    const task = typeof body.task === 'string' ? body.task : '';
    if (!task) {
      return reply ? badRequest(reply, 'Field "task" wajib diisi.', { tasks: AI_TASKS }) : null;
    }
    const input = (typeof body.input === 'object' && body.input !== null ? body.input : {}) as Record<string, unknown>;
    const projectId =
      projectIdFromPath ?? (typeof body.project_id === 'string' && body.project_id ? body.project_id : null);

    // Unknown task → honest 400 instead of a meaningless 200.
    if (!(AI_TASKS as readonly string[]).includes(task)) {
      return reply
        ? badRequest(reply, `Task AI "${task}" tidak dikenal.`, { tasks: AI_TASKS })
        : { ok: false, data: null, error: `Task AI "${task}" tidak dikenal.`, meta: null };
    }

    const persist = body.persist === true || body.persist === 1 || body.persist === 'true';
    const previewOnly = body.preview_only === true;

    const result = await aiService.generate(task, input, {
      projectId,
      persist: persist && !previewOnly,
      inputRef: typeof body.input_ref === 'string' ? body.input_ref : null,
    });
    return result;
  }

  app.post('/ai/generate', async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    return handleGenerate(body, undefined, reply);
  });

  app.post<{ Params: { projectId: string } }>('/projects/:projectId/ai/generate', async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const projectId = req.params?.projectId;
    if (!projectId) return badRequest(reply, 'projectId wajib diisi pada path.');
    return handleGenerate(body, projectId, reply);
  });

  /**
   * `POST /ai/crawl` is the primary verb (it takes a body). `GET /ai/crawl` is aliased so
   * the boot probe and quick manual checks work without a body; without a `url` query the
   * crawler reports a description of itself rather than inventing a target.
   */
  async function handleCrawl(body: Record<string, unknown>, reply: FastifyReply): Promise<unknown> {
    const url = typeof body.url === 'string' ? body.url : '';
    const html = typeof body.html === 'string' ? body.html : undefined;
    if (!url && !html) {
      return {
        url: '',
        fetched: false,
        pages: [],
        features: [],
        suggested_use_cases: [],
        used_mock: true,
        hint: 'Kirim {"url":"https://…"} atau {"html":"<html>…"} untuk menganalisis halaman. Endpoint ini juga tersedia via GET dengan ?url=',
      };
    }
    return aiService.crawl({
      url,
      html,
      max_pages: Number(body.max_pages) || undefined,
      depth: Number(body.depth) || undefined,
      include_links: body.include_links === undefined ? undefined : Boolean(body.include_links),
    });
  }

  app.post('/ai/crawl', async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const url = typeof body.url === 'string' ? body.url : '';
    const html = typeof body.html === 'string' ? body.html : undefined;
    if (!url && !html) return badRequest(reply, 'Field "url" atau "html" wajib diisi.');
    return handleCrawl(body, reply);
  });

  app.get('/ai/crawl', async (req, reply) => {
    const query = (req.query ?? {}) as Record<string, unknown>;
    return handleCrawl(query, reply);
  });

  /* ----------------------------- chat ----------------------------- */

  app.post('/ai/chat', async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const rawMessages = Array.isArray(body.messages) ? (body.messages as unknown[]) : [];
    const messages: AiChatMessage[] = rawMessages
      .filter((m): m is Record<string, unknown> => typeof m === 'object' && m !== null)
      .map((m) => ({
        role: (['system', 'user', 'assistant'].includes(String(m.role)) ? String(m.role) : 'user') as AiChatMessage['role'],
        content: typeof m.content === 'string' ? m.content : String(m.content ?? ''),
      }))
      .filter((m) => m.content.length > 0);

    if (!messages.length) {
      const single = typeof body.message === 'string' ? body.message : '';
      if (!single) return badRequest(reply, 'Field "messages" atau "message" wajib diisi.');
      messages.push({ role: 'user', content: single });
    }

    const row = loadSettingsRow();
    const started = Date.now();
    const systemMsg =
      'Anda asisten QA QATools. Jawab ringkas, praktis, dalam Bahasa Indonesia. Bila diminta JSON, balas JSON valid tanpa markdown.';

    if (isLive(row)) {
      const result = await callProvider({
        provider: row.provider,
        model: row.model,
        baseUrl: row.base_url,
        apiKey: row.api_key,
        messages: [{ role: 'system', content: systemMsg }, ...messages],
        temperature: Number(row.temperature ?? 0.3),
        maxTokens: Number(row.max_tokens ?? 4096),
        seed: messages.map((m) => m.content).join('|').slice(0, 200),
      });
      if (result.ok && result.text.trim()) {
        const generationId = logGeneration({
          projectId: typeof body.project_id === 'string' ? body.project_id : null,
          task: 'chat',
          provider: row.provider,
          model: row.model,
          promptTokens: result.promptTokens,
          completionTokens: result.completionTokens,
          latencyMs: result.latencyMs,
          status: 'success',
          usedMock: false,
        });
        return {
          reply: result.text,
          used_mock: false,
          degraded: false,
          error: null,
          suggestions: [],
          meta: {
            provider: row.provider,
            model: row.model,
            task: 'chat',
            used_mock: false,
            latency_ms: result.latencyMs,
            prompt_tokens: result.promptTokens,
            completion_tokens: result.completionTokens,
            generation_id: generationId,
            degraded: false,
          },
        };
      }
      // Live chat failed → fall through to the deterministic offline answer, but log it.
      logGeneration({
        projectId: typeof body.project_id === 'string' ? body.project_id : null,
        task: 'chat',
        provider: row.provider,
        model: row.model,
        promptTokens: result.promptTokens,
        completionTokens: result.completionTokens,
        latencyMs: result.latencyMs,
        status: 'error',
        usedMock: true,
        error: result.error,
      });
    }

    const lastUser = [...messages].reverse().find((m) => m.role === 'user')?.content ?? '';
    const offline = offlineGenerate('chat', { messages, message: lastUser }) as {
      reply: string;
      suggestions: string[];
    };
    const generationId = logGeneration({
      projectId: typeof body.project_id === 'string' ? body.project_id : null,
      task: 'chat',
      provider: 'mock',
      model: 'qatools-mock-1',
      promptTokens: Math.round(messages.map((m) => m.content).join(' ').length / 4),
      completionTokens: Math.round(offline.reply.length / 4),
      latencyMs: Date.now() - started,
      status: 'success',
      usedMock: true,
    });
    return {
      reply: offline.reply,
      used_mock: true,
      degraded: isLive(row),
      error: null,
      suggestions: offline.suggestions,
      meta: {
        provider: isLive(row) ? row.provider : 'mock',
        model: isLive(row) ? row.model : 'qatools-mock-1',
        task: 'chat',
        used_mock: true,
        latency_ms: Date.now() - started,
        prompt_tokens: 0,
        completion_tokens: 0,
        generation_id: generationId,
        degraded: isLive(row),
      },
    };
  });

  /* ------------------------ task shortcuts ------------------------ */

  const shortcuts: Array<{ path: string; task: AiTask }> = [
    { path: '/ai/tasks/generate-usecases', task: 'generate_usecases' },
    { path: '/ai/tasks/generate-scenarios', task: 'generate_scenarios' },
    { path: '/ai/tasks/generate-testcases', task: 'generate_testcases' },
    { path: '/ai/tasks/generate-test-data', task: 'generate_test_data' },
    { path: '/ai/tasks/generate-api-tests', task: 'generate_api_tests' },
    { path: '/ai/tasks/generate-db-checks', task: 'generate_db_checks' },
    { path: '/ai/tasks/generate-web-flow', task: 'generate_web_flow' },
    { path: '/ai/tasks/generate-sql', task: 'generate_sql' },
    { path: '/ai/tasks/review-coverage', task: 'review_coverage' },
    { path: '/ai/tasks/triage-defect', task: 'triage_defect' },
    { path: '/ai/tasks/predict-risk', task: 'predict_risk' },
    { path: '/ai/tasks/summarize-test-plan', task: 'summarize_test_plan' },
  ];

  for (const sc of shortcuts) {
    app.post(sc.path, async (req) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const projectId = typeof body.project_id === 'string' && body.project_id ? body.project_id : null;
      return aiService.generate(sc.task, body, {
        projectId,
        persist: body.persist === true,
        inputRef: typeof body.input_ref === 'string' ? body.input_ref : null,
      });
    });
  }

  /* ------------------------- generations -------------------------- */

  app.get('/ai/generations', async (req) => {
    const query = (req.query ?? {}) as Record<string, unknown>;
    const limit = Math.min(500, Math.max(1, Number(query.limit ?? 50) || 50));
    const offset = Math.max(0, Number(query.offset ?? 0) || 0);
    const projectId = typeof query.project_id === 'string' ? query.project_id : '';
    const task = typeof query.task === 'string' ? query.task : '';

    const where: string[] = [];
    const params: unknown[] = [];
    if (projectId) {
      where.push('project_id = ?');
      params.push(projectId);
    }
    if (task) {
      where.push('task = ?');
      params.push(task);
    }
    const sql = `SELECT * FROM ai_generations ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`;
    const rows = db.prepare(sql).all(...params, limit, offset);
    const countRow = db
      .prepare(`SELECT COUNT(*) AS n FROM ai_generations ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`)
      .get(...params) as { n?: number } | undefined;
    return list(rows, Number(countRow?.n ?? rows.length));
  });

  app.get<{ Params: { id: string } }>('/ai/generations/:id', async (req, reply) => {
    const row = db.prepare(`SELECT * FROM ai_generations WHERE id = ?`).get(req.params.id);
    if (!row) return fail(reply, 404, 'not_found', 'Riwayat generasi tidak ditemukan');
    return one(row);
  });

  /* --------------------------- diagnostics ------------------------ */

  app.get('/ai/health', async () => {
    const status = await aiService.status();
    const settings = publicSettings(loadSettingsRow());
    return one({
      status,
      settings,
      tasks: AI_TASKS.length,
      providers: PROVIDERS.length,
      persist_tables: ['requirements', 'use_cases', 'scenarios', 'test_cases', 'test_steps', 'api_requests', 'db_checks', 'web_flows', 'matrix_links'],
      offline_capable: true,
    });
  });

  /* --------------------- settings-dependent probes ----------------- */

  app.get('/ai/mask-preview', async (req) => {
    const query = (req.query ?? {}) as Record<string, unknown>;
    return one({ masked: maskKey(typeof query.key === 'string' ? query.key : '') });
  });

  /** Utility used by tests/docs: next code for a table in a project. */
  app.get<{ Params: { table: string } }>('/ai/next-code/:table', async (req) => {
    const table = req.params.table;
    const allowed = new Set(['requirements', 'use_cases', 'scenarios', 'test_cases']);
    if (!allowed.has(table)) return { error: 'table tidak diizinkan' };
    const projectId = String((req.query as Record<string, unknown>)?.project_id ?? '');
    const prefix = { requirements: 'REQ', use_cases: 'UC', scenarios: 'SC', test_cases: 'TC' }[table] as string;
    return one({ table, code: projectId ? nextCode(table, prefix, projectId) : null });
  });

  void parseJson;
}
