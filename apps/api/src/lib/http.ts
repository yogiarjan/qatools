/**
 * Shared HTTP helpers for API modules. FROZEN (lead-owned).
 *
 * Keeps list/error envelopes consistent with ARCHITECTURE.md §6.
 */

import type { FastifyReply } from 'fastify';

export interface ListEnvelope<T> {
  data: T[];
  total: number;
}

export function list<T>(data: T[], total?: number): ListEnvelope<T> {
  return { data, total: total ?? data.length };
}

export function one<T>(data: T): { data: T } {
  return { data };
}

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}

export function fail(
  reply: FastifyReply,
  status: number,
  code: string,
  message: string,
  details?: unknown,
): FastifyReply {
  const body: ApiErrorBody = { error: { code, message } };
  if (details !== undefined) body.error.details = details;
  return reply.code(status).send(body);
}

export const notFound = (reply: FastifyReply, what: string) =>
  fail(reply, 404, 'not_found', `${what} tidak ditemukan`);

export const badRequest = (reply: FastifyReply, message: string, details?: unknown) =>
  fail(reply, 400, 'bad_request', message, details);

export const conflict = (reply: FastifyReply, message: string) =>
  fail(reply, 409, 'conflict', message);

/** Parse `?limit=&offset=` safely. */
export function paging(query: Record<string, unknown>, defLimit = 200): { limit: number; offset: number } {
  const limit = Math.min(2000, Math.max(1, Number(query.limit ?? defLimit) || defLimit));
  const offset = Math.max(0, Number(query.offset ?? 0) || 0);
  return { limit, offset };
}
