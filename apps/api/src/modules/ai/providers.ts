/**
 * Lane D — AI provider adapters. FROZEN contract: see ARCHITECTURE.md §6.1.
 *
 * Every adapter speaks plain HTTP through the global `fetch` (Node >= 20) so the API
 * package needs **zero** extra dependencies (no openai / anthropic / google SDKs).
 *
 * Design rules:
 *  - No adapter may throw. All failures come back as `{ ok: false, error }`.
 *  - The `mock` provider NEVER touches the network. That is what makes the whole
 *    platform usable offline (headline feature of QATools).
 *  - Each adapter maps the vendor response shape into a single normalised result.
 */

import { stableHash } from '@qatools/shared';
import type { AiChatMessage } from '@qatools/shared';

export type ProviderId = 'deepseek' | 'openai' | 'anthropic' | 'google' | 'ollama' | 'custom' | 'mock';

export const PROVIDER_IDS: readonly ProviderId[] = [
  'deepseek',
  'openai',
  'anthropic',
  'google',
  'ollama',
  'custom',
  'mock',
] as const;

export interface CallProviderArgs {
  provider: string;
  model: string;
  baseUrl?: string | null;
  apiKey?: string | null;
  messages: AiChatMessage[];
  temperature?: number;
  maxTokens?: number;
  /** Abort budget for the underlying HTTP request. Defaults to 60s. */
  timeoutMs?: number;
  /** Deterministic seed hint (used by the mock provider only). */
  seed?: string;
}

export interface ProviderCallResult {
  ok: boolean;
  /** Normalised assistant text. Empty string when `ok === false`. */
  text: string;
  promptTokens: number;
  completionTokens: number;
  latencyMs: number;
  error: string | null;
  /** true when the answer was synthesised locally without any HTTP call. */
  used_mock: boolean;
  /** The provider that actually produced the text (may differ from the request on mock). */
  provider: string;
}

/** Public provider catalogue — also surfaced by GET /ai/providers for the UI. */
export interface ProviderInfo {
  id: ProviderId;
  label: string;
  needs_key: boolean;
  default_base_url: string;
  default_model: string;
  docs: string;
}

export const PROVIDERS: readonly ProviderInfo[] = [
  {
    id: 'deepseek',
    label: 'DeepSeek',
    needs_key: true,
    default_base_url: 'https://api.deepseek.com/v1',
    default_model: 'deepseek-chat',
    docs: 'https://platform.deepseek.com/api-docs',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    needs_key: true,
    default_base_url: 'https://api.openai.com/v1',
    default_model: 'gpt-4o-mini',
    docs: 'https://platform.openai.com/docs/api-reference/chat',
  },
  {
    id: 'anthropic',
    label: 'Anthropic Claude',
    needs_key: true,
    default_base_url: 'https://api.anthropic.com/v1',
    default_model: 'claude-3-5-sonnet-latest',
    docs: 'https://docs.anthropic.com/en/api/messages',
  },
  {
    id: 'google',
    label: 'Google Gemini',
    needs_key: true,
    default_base_url: 'https://generativelanguage.googleapis.com/v1beta',
    default_model: 'gemini-1.5-flash',
    docs: 'https://ai.google.dev/api/generate-content',
  },
  {
    id: 'ollama',
    label: 'Ollama (lokal)',
    needs_key: false,
    default_base_url: 'http://127.0.0.1:11434',
    default_model: 'llama3.1',
    docs: 'https://github.com/ollama/ollama/blob/main/docs/api.md',
  },
  {
    id: 'custom',
    label: 'Custom (OpenAI-compatible)',
    needs_key: true,
    default_base_url: 'http://127.0.0.1:8000/v1',
    default_model: 'local-model',
    docs: 'https://platform.openai.com/docs/api-reference/chat',
  },
  {
    id: 'mock',
    label: 'Offline deterministic (mock)',
    needs_key: false,
    default_base_url: '',
    default_model: 'qatools-mock-1',
    docs: 'Tanpa jaringan — generator rule-based internal QATools',
  },
] as const;

export function providerInfo(id: string): ProviderInfo {
  return PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[PROVIDERS.length - 1];
}

/** A provider needs a key before it can be treated as "configured / live". */
export function providerNeedsKey(id: string): boolean {
  return providerInfo(id).needs_key;
}

/** Default model for a provider when the user has not chosen one. */
export function defaultModel(provider: string): string {
  return providerInfo(provider).default_model;
}

/** Default base URL for a provider. */
export function defaultBaseUrl(provider: string): string {
  return providerInfo(provider).default_base_url;
}

/** Normalises a configured base URL: strips the trailing slash, applies the default. */
export function resolveBaseUrl(provider: string, baseUrl?: string | null): string {
  const raw = (baseUrl ?? '').trim() || defaultBaseUrl(provider);
  return raw.replace(/\/+$/, '');
}

/* ------------------------------------------------------------------ *
 * Prompt/message assembly for the offline synthesizer
 * ------------------------------------------------------------------ */

/**
 * The offline "model". Deterministic, network-free, and honest: it never pretends to
 * have understood free text. The *real* intelligence in offline mode lives in
 * `offline.ts`; this only serves `Chat` requests that reach the provider layer.
 */
function mockSynth(messages: AiChatMessage[], seed: string): string {
  const lastUser = [...messages].reverse().find((m) => m.role === 'user')?.content ?? '';
  const sys = messages.find((m) => m.role === 'system')?.content ?? '';
  const h = stableHash(`${seed}|${lastUser}|${sys}`);
  const n = h % 5;
  const intro = [
    'Mode offline QATools aktif (tanpa jaringan).',
    'Tidak ada API key yang dikonfigurasi, jadi jawaban ini dihasilkan generator rule-based lokal.',
    'Provider sedang dalam mode mock deterministik.',
    'Offline mode: jawaban di bawah disusun oleh mesin aturan QATools, bukan oleh LLM.',
    'Fallback deterministik dipakai karena provider tidak dapat dihubungi.',
  ][n] as string;
  const wantsJson = /json/i.test(lastUser);
  if (wantsJson) {
    return `${intro}\n${JSON.stringify(
      { offline: true, note: 'Generator tugas spesifik berjalan di jalur offlineGenerate()', echo: lastUser.slice(0, 400) },
      null,
      2,
    )}`;
  }
  return [
    intro,
    '',
    'Yang bisa saya bantu sekarang:',
    '- Susun use case dari deskripsi kebutuhan (Generate Use Cases).',
    '- Turunkan skenario positif/negatif/edge dari use case (Generate Scenarios).',
    '- Rancang test case lengkap dengan langkah & data uji (Generate Test Cases).',
    '- Tinjau celah coverage traceability matrix (Review Coverage).',
    '- Triase defect (severity/priority/root cause) dan prediksi risiko regresi.',
    '',
    'Konfigurasikan provider + API key di AI Settings bila Anda ingin jawaban dari LLM sungguhan.',
  ].join('\n');
}

/* ------------------------------------------------------------------ *
 * HTTP plumbing
 * ------------------------------------------------------------------ */

function clamp(numbers: number[], fallback: number): number {
  const v = numbers.find((x) => typeof x === 'number' && Number.isFinite(x) && x >= 0);
  return v === undefined ? fallback : Math.round(v);
}

async function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  timeoutMs: number,
): Promise<{ ok: boolean; status: number; json: unknown; text: string; error: string | null }> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!res.ok) {
      const detail =
        (json as { error?: { message?: string } } | null)?.error?.message ??
        (json as { message?: string } | null)?.message ??
        (text || '').slice(0, 300);
      return { ok: false, status: res.status, json, text, error: `HTTP ${res.status}: ${detail || 'tanpa pesan'}` };
    }
    return { ok: true, status: res.status, json, text, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const friendly = /timeout|aborted|abort/i.test(message)
      ? `Timeout setelah ${Math.round(timeoutMs / 1000)}s (${message})`
      : message;
    return { ok: false, status: 0, json: null, text: '', error: friendly };
  }
}

/** Best-effort token estimate when a provider does not report usage. Never throws. */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.max(1, Math.round(text.length / 4));
}

/* ------------------------------------------------------------------ *
 * The uniform adapter
 * ------------------------------------------------------------------ */

export async function callProvider(args: CallProviderArgs): Promise<ProviderCallResult> {
  const started = Date.now();
  const provider = String(args.provider || 'mock');
  const model = String(args.model || defaultModel(provider));
  const timeoutMs = args.timeoutMs ?? 60_000;
  const done = (patch: Partial<ProviderCallResult>): ProviderCallResult => ({
    ok: false,
    text: '',
    promptTokens: 0,
    completionTokens: 0,
    latencyMs: Date.now() - started,
    error: null,
    used_mock: false,
    provider,
    ...patch,
  });

  // The mock provider is intentionally first: zero network, zero key.
  if (provider === 'mock') {
    const text = mockSynth(args.messages, args.seed ?? 'qatools');
    const promptText = args.messages.map((m) => m.content).join('\n');
    return done({
      ok: true,
      text,
      promptTokens: estimateTokens(promptText),
      completionTokens: estimateTokens(text),
      used_mock: true,
    });
  }

  if (!PROVIDER_IDS.includes(provider as ProviderId)) {
    return done({ error: `Provider "${provider}" tidak dikenal. Pilihan: ${PROVIDER_IDS.join(', ')}.` });
  }

  const info = providerInfo(provider);
  if (info.needs_key && !args.apiKey) {
    return done({ error: `API key untuk provider "${provider}" belum diisi.` });
  }

  const base = resolveBaseUrl(provider, args.baseUrl);
  const temperature = typeof args.temperature === 'number' ? args.temperature : 0.3;
  const maxTokens = args.maxTokens && args.maxTokens > 0 ? args.maxTokens : 4096;

  try {
    if (provider === 'anthropic') {
      const system = args.messages
        .filter((m) => m.role === 'system')
        .map((m) => m.content)
        .join('\n\n');
      const rest = args.messages.filter((m) => m.role !== 'system');
      const res = await postJson(
        `${base}/messages`,
        { 'x-api-key': args.apiKey as string, 'anthropic-version': '2023-06-01' },
        {
          model,
          max_tokens: maxTokens,
          temperature,
          ...(system ? { system } : {}),
          messages: rest.map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content })),
        },
        timeoutMs,
      );
      if (!res.ok) return done({ error: res.error });
      const body = res.json as {
        content?: Array<{ type?: string; text?: string }>;
        usage?: { input_tokens?: number; output_tokens?: number };
      };
      const text = (body?.content ?? [])
        .filter((c) => c?.type === 'text' && typeof c.text === 'string')
        .map((c) => c.text as string)
        .join('\n');
      if (!text) return done({ error: 'Respons Anthropic tidak memuat blok teks.' });
      return done({
        ok: true,
        text,
        promptTokens: clamp([body?.usage?.input_tokens ?? -1], estimateTokens(args.messages.map((m) => m.content).join('\n'))),
        completionTokens: clamp([body?.usage?.output_tokens ?? -1], estimateTokens(text)),
      });
    }

    if (provider === 'google') {
      const system = args.messages
        .filter((m) => m.role === 'system')
        .map((m) => m.content)
        .join('\n\n');
      const rest = args.messages.filter((m) => m.role !== 'system');
      const url = `${base}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(
        args.apiKey as string,
      )}`;
      const res = await postJson(
        url,
        {},
        {
          ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
          contents: rest.map((m) => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }],
          })),
          generationConfig: { temperature, maxOutputTokens: maxTokens },
        },
        timeoutMs,
      );
      if (!res.ok) return done({ error: res.error });
      const body = res.json as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
        usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
      };
      const text = (body?.candidates?.[0]?.content?.parts ?? [])
        .map((p) => p?.text ?? '')
        .join('');
      if (!text) return done({ error: 'Respons Gemini tidak memuat kandidat teks.' });
      return done({
        ok: true,
        text,
        promptTokens: clamp([body?.usageMetadata?.promptTokenCount ?? -1], estimateTokens(args.messages.map((m) => m.content).join('\n'))),
        completionTokens: clamp([body?.usageMetadata?.candidatesTokenCount ?? -1], estimateTokens(text)),
      });
    }

    if (provider === 'ollama') {
      const res = await postJson(
        `${base}/api/chat`,
        {},
        {
          model,
          stream: false,
          options: { temperature, num_predict: maxTokens },
          messages: args.messages.map((m) => ({ role: m.role, content: m.content })),
        },
        timeoutMs,
      );
      if (!res.ok) return done({ error: res.error });
      const body = res.json as {
        message?: { content?: string };
        prompt_eval_count?: number;
        eval_count?: number;
      };
      const text = body?.message?.content ?? '';
      if (!text) return done({ error: 'Respons Ollama tidak memuat message.content.' });
      return done({
        ok: true,
        text,
        promptTokens: clamp([body?.prompt_eval_count ?? -1], estimateTokens(args.messages.map((m) => m.content).join('\n'))),
        completionTokens: clamp([body?.eval_count ?? -1], estimateTokens(text)),
      });
    }

    // deepseek | openai | custom — all OpenAI-compatible `/chat/completions`.
    const res = await postJson(
      `${base}/chat/completions`,
      { Authorization: `Bearer ${args.apiKey as string}` },
      {
        model,
        temperature,
        max_tokens: maxTokens,
        messages: args.messages.map((m) => ({ role: m.role, content: m.content })),
      },
      timeoutMs,
    );
    if (!res.ok) return done({ error: res.error });
    const body = res.json as {
      choices?: Array<{ message?: { content?: string }; text?: string }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const text = body?.choices?.[0]?.message?.content ?? body?.choices?.[0]?.text ?? '';
    if (!text) return done({ error: `Respons ${provider} tidak memuat choices[0].message.content.` });
    return done({
      ok: true,
      text,
      promptTokens: clamp([body?.usage?.prompt_tokens ?? -1], estimateTokens(args.messages.map((m) => m.content).join('\n'))),
      completionTokens: clamp([body?.usage?.completion_tokens ?? -1], estimateTokens(text)),
    });
  } catch (err) {
    // Belt and braces: nothing may escape the adapter boundary.
    return done({ error: err instanceof Error ? err.message : String(err) });
  }
}
