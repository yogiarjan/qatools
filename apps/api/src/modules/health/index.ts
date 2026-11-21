/**
 * Health module — always present, registered first. FROZEN (lead-owned).
 * Proves the API process, DB and shared package are wired correctly.
 */

import type { FastifyInstance } from 'fastify';

export default async function routes(app: FastifyInstance): Promise<void> {
  app.get('/ping', async () => ({ pong: true, at: new Date().toISOString() }));
}
