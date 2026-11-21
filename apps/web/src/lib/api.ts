/**
 * Typed fetch wrapper. FROZEN (lead-owned).
 *
 *   import { api } from '../lib/api';
 *   const { data } = await api.get<Project[]>('/projects');
 */

const BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? '/api';

export class ApiError extends Error {
  code: string;
  status: number;
  details?: unknown;
  constructor(message: string, code = 'error', status = 0, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export interface ListEnvelope<T> {
  data: T[];
  total: number;
}
export interface OneEnvelope<T> {
  data: T;
}

type Query = Record<string, string | number | boolean | undefined | null>;

function qs(query?: Query): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
  }
  const s = params.toString();
  return s ? `?${s}` : '';
}

async function request<T>(method: string, path: string, body?: unknown, query?: Query): Promise<T> {
  const url = `${BASE}${path}${qs(query)}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (err) {
    throw new ApiError(
      `Tidak dapat menghubungi server API (${BASE}). Pastikan backend berjalan.`,
      'network_error',
      0,
      err,
    );
  }

  const text = await res.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }

  if (!res.ok) {
    const errObj = (payload as { error?: { code?: string; message?: string; details?: unknown } })?.error;
    throw new ApiError(
      errObj?.message ?? `Permintaan gagal (HTTP ${res.status})`,
      errObj?.code ?? 'http_error',
      res.status,
      errObj?.details,
    );
  }

  return payload as T;
}

export const api = {
  get: <T>(path: string, query?: Query) => request<T>('GET', path, undefined, query),
  post: <T>(path: string, body?: unknown, query?: Query) => request<T>('POST', path, body, query),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  del: <T>(path: string) => request<T>('DELETE', path),
};

/** Convenience for list endpoints. */
export async function listOf<T>(path: string, query?: Query): Promise<T[]> {
  const res = await api.get<ListEnvelope<T>>(path, query);
  return res?.data ?? [];
}

/** Convenience for single-entity endpoints. */
export async function oneOf<T>(path: string, query?: Query): Promise<T> {
  const res = await api.get<OneEnvelope<T>>(path, query);
  return res.data;
}

/** Build a URL usable in an <a download> for export endpoints. */
export function exportUrl(path: string, query?: Query): string {
  return `${BASE}${path}${qs(query)}`;
}
