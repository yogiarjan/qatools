/**
 * Lane D — `aimock`: a tiny, self-contained "system under test".
 *
 * The whole point is that QATools automation (API/Web/DB engines and the AI layer) has
 * something REAL to exercise with zero internet access. Deterministic wherever possible.
 *
 * Routes (registered with prefix `/api`, hence `/mock/...`):
 *   GET  /mock/health
 *   GET  /mock/products
 *   POST /mock/login            admin/secret -> token, wrong -> 401
 *   POST /mock/orders
 *   GET  /mock/orders/:id
 *   GET  /mock/flaky            fails ~30% deterministically by counter
 *   GET  /mock/slow?ms=800      sleeps for a bounded time
 *   GET  /mock/echo             echoes method/headers/query/body
 *   GET  /mock/state            inspect/reset the deterministic counter
 *   POST /mock/reset
 *   GET  /mock/demo             HTML page used as a crawl/UI-automation target
 */

import type { FastifyInstance } from 'fastify';
import { stableHash } from '@qatools/shared';
import { badRequest, fail, list, one } from '../../lib/http.js';

/** Deterministic state — no randomness anywhere. */
const state = {
  /** Monotonic request counter, drives `/mock/flaky`. */
  counter: 0,
  startedAt: new Date().toISOString(),
  orders: new Map<string, MockOrder>(),
};

interface MockOrder {
  id: string;
  code: string;
  product_id: string;
  quantity: number;
  status: 'created' | 'paid' | 'cancelled';
  total: number;
  created_at: string;
}

const PRODUCTS = [
  { id: 'prod_001', sku: 'SKU-001', name: 'Keyboard Mekanik QA', price: 850000, stock: 12, category: 'peripheral' },
  { id: 'prod_002', sku: 'SKU-002', name: 'Mouse Ergonomis Tester', price: 320000, stock: 30, category: 'peripheral' },
  { id: 'prod_003', sku: 'SKU-003', name: 'Monitor 27" 144Hz', price: 3750000, stock: 4, category: 'display' },
  { id: 'prod_004', sku: 'SKU-004', name: 'Docking Station USB-C', price: 1250000, stock: 0, category: 'accessory' },
  { id: 'prod_005', sku: 'SKU-005', name: 'Headset Noise Cancelling', price: 1980000, stock: 7, category: 'audio' },
] as const;

const USERS = [{ username: 'admin', password: 'secret', role: 'admin', name: 'Admin QA' }] as const;

/** Deterministic pseudo-token: stable for a given username + minute bucket. */
function makeToken(username: string): string {
  const bucket = Math.floor(Date.now() / 60000);
  return `mock.${username}.${stableHash(`${username}:${bucket}`).toString(36)}`;
}

/** `/mock/flaky` fails when the counter is NOT divisible by 3 — i.e. ~2 of every 3 calls. */
function flakyFails(n: number): boolean {
  return n % 3 !== 0;
}

export default async function routes(app: FastifyInstance): Promise<void> {
  app.get('/mock', async () =>
    one({
      name: 'QATools Mock System Under Test',
      version: '1.0.0',
      offline: true,
      endpoints: [
        'GET /mock/health',
        'GET /mock/products',
        'POST /mock/login',
        'POST /mock/orders',
        'GET /mock/orders/:id',
        'GET /mock/flaky',
        'GET /mock/slow?ms=800',
        'GET /mock/echo',
        'GET /mock/state',
        'POST /mock/reset',
        'GET /mock/demo',
      ],
    }),
  );

  app.get('/mock/health', async () => ({
    status: 'ok',
    service: 'qatools-mock',
    version: '1.0.0',
    offline: true,
    uptime_s: Math.round((Date.now() - Date.parse(state.startedAt)) / 1000),
    counter: state.counter,
    time: new Date().toISOString(),
  }));

  app.get('/mock/products', async (req) => {
    const query = (req.query ?? {}) as Record<string, unknown>;
    const keyword = typeof query.q === 'string' ? query.q.toLowerCase() : '';
    const rows = PRODUCTS.filter((p) => !keyword || p.name.toLowerCase().includes(keyword) || p.sku.toLowerCase().includes(keyword));
    return list(rows.map((p) => ({ ...p })), rows.length);
  });

  app.get<{ Params: { id: string } }>('/mock/products/:id', async (req, reply) => {
    const product = PRODUCTS.find((p) => p.id === req.params.id);
    if (!product) return fail(reply, 404, 'not_found', `Produk ${req.params.id} tidak ditemukan`);
    return one({ ...product });
  });

  app.post('/mock/login', async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const username = typeof body.username === 'string' ? body.username.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    if (!username || !password) return badRequest(reply, 'username dan password wajib diisi.');

    const user = USERS.find((u) => u.username === username && u.password === password);
    if (!user) {
      return fail(reply, 401, 'unauthorized', 'Kombinasi username/password salah', { hint: 'Gunakan admin/secret pada mock.' });
    }
    return one({
      token: makeToken(user.username),
      token_type: 'Bearer',
      expires_in: 3600,
      user: { username: user.username, name: user.name, role: user.role },
    });
  });

  app.post('/mock/orders', async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const productId = typeof body.product_id === 'string' ? body.product_id : '';
    const quantityRaw = Number(body.quantity ?? 1);
    const product = PRODUCTS.find((p) => p.id === productId);
    if (!product) return badRequest(reply, `product_id "${productId}" tidak dikenal.`, { available: PRODUCTS.map((p) => p.id) });
    if (!Number.isFinite(quantityRaw) || quantityRaw <= 0) return badRequest(reply, 'quantity harus bilangan bulat > 0.');
    const quantity = Math.floor(quantityRaw);

    if (product.stock <= 0) {
      return fail(reply, 409, 'out_of_stock', `Stok ${product.name} habis`, { stock: product.stock });
    }
    if (quantity > product.stock) {
      return fail(reply, 409, 'insufficient_stock', `Stok tidak cukup: tersedia ${product.stock}, diminta ${quantity}`, {
        stock: product.stock,
      });
    }

    state.counter += 1;
    const seq = String(state.orders.size + 1).padStart(4, '0');
    const id = `ord_${stableHash(`${productId}:${quantity}:${state.counter}`).toString(36)}`;
    const order: MockOrder = {
      id,
      code: `ORD-${seq}`,
      product_id: productId,
      quantity,
      status: 'created',
      total: product.price * quantity,
      created_at: new Date().toISOString(),
    };
    state.orders.set(id, order);
    return reply.code(201).send(one(order));
  });

  app.get<{ Params: { id: string } }>('/mock/orders/:id', async (req, reply) => {
    const order = state.orders.get(req.params.id);
    if (!order) return fail(reply, 404, 'not_found', `Order ${req.params.id} tidak ditemukan`);
    return one(order);
  });

  /**
   * Order history. Needed so "riwayat pesanan" style cases have a real list endpoint;
   * without it the demo seed's GET /orders request 404s.
   * Returns a `{ data, total }` envelope like every other QATools list route.
   */
  app.get('/mock/orders', async (req) => {
    const query = (req.query ?? {}) as Record<string, unknown>;
    const status = typeof query.status === 'string' ? query.status : '';
    const all = [...state.orders.values()].sort((a, b) => a.created_at.localeCompare(b.created_at));
    const rows = status ? all.filter((o) => o.status === status) : all;
    return list(rows, rows.length);
  });

  /**
   * Admin-only report endpoint. The mock has no real authorization layer, but it DOES
   * model the auth boundary honestly so security test cases behave correctly:
   *   - no Authorization header            -> 401
   *   - Bearer token for a non-admin role  -> 403
   *   - Bearer token for the admin role    -> 200
   * Role comes from the `X-Role` header (defaults to admin when a valid token is present).
   */
  app.get('/mock/admin/reports', async (req, reply) => {
    const auth = String((req.headers['authorization'] ?? '') as string);
    if (!auth.toLowerCase().startsWith('bearer ') || !auth.slice(7).trim()) {
      return fail(reply, 401, 'unauthorized', 'Token tidak ditemukan. Sertakan header Authorization: Bearer <token>.');
    }
    const role = String((req.headers['x-role'] ?? 'admin') as string).toLowerCase();
    if (role !== 'admin') {
      return fail(reply, 403, 'forbidden', `Peran "${role}" tidak berhak mengakses laporan penjualan.`);
    }
    const orders = [...state.orders.values()];
    return one({
      generated_at: new Date().toISOString(),
      currency: 'IDR',
      orders_total: orders.length,
      revenue_total: orders.reduce((sum, o) => sum + o.total, 0),
      by_status: orders.reduce<Record<string, number>>((acc, o) => {
        acc[o.status] = (acc[o.status] ?? 0) + 1;
        return acc;
      }, {}),
    });
  });

  /**
   * Deterministic flakiness: every 1st and 2nd call of a cycle of 3 returns 500.
   * Automation lanes can therefore prove retry/healing logic reproducibly.
   */
  app.get('/mock/flaky', async (req, reply) => {
    state.counter += 1;
    const n = state.counter;
    const shouldFail = flakyFails(n);
    if (shouldFail) {
      return reply.code(500).send({
        error: { code: 'mock_flaky_failure', message: `Kegagalan disengaja pada pemanggilan ke-${n} (pola deterministik 2 dari 3).` },
        counter: n,
        deterministic: true,
      });
    }
    return { status: 'ok', counter: n, message: `Pemanggilan ke-${n} berhasil (pola deterministik: n % 3 == 0).` };
  });

  app.get('/mock/slow', async (req) => {
    const query = (req.query ?? {}) as Record<string, unknown>;
    const requested = Number(query.ms ?? 500);
    const ms = Math.max(0, Math.min(10_000, Number.isFinite(requested) ? Math.round(requested) : 500));
    await new Promise((resolve) => setTimeout(resolve, ms));
    return { status: 'ok', slept_ms: ms, note: 'Endpoint lambat untuk menguji timeout & performa.' };
  });

  app.all('/mock/echo', async (req) => {
    state.counter += 1;
    return {
      method: req.method,
      url: req.url,
      query: req.query ?? {},
      headers: req.headers,
      body: req.body ?? null,
      counter: state.counter,
    };
  });

  app.get('/mock/state', async () => ({
    counter: state.counter,
    flaky_pattern: 'gagal bila counter % 3 != 0',
    next_flaky_result: flakyFails(state.counter + 1) ? 'fail (500)' : 'ok (200)',
    orders: [...state.orders.values()],
    started_at: state.startedAt,
  }));

  app.post('/mock/reset', async () => {
    state.counter = 0;
    state.orders.clear();
    return one({ reset: true, at: new Date().toISOString() });
  });

  /** A real HTML page so the crawler / web automation have a UI target offline. */
  app.get('/mock/demo', async (_req, reply) => {
    reply.type('text/html; charset=utf-8');
    return `<!doctype html>
<html lang="id">
<head>
  <meta charset="utf-8">
  <meta property="og:title" content="Toko Demo QA — Mock System Under Test">
  <title>Toko Demo QA</title>
</head>
<body>
  <h1>Katalog Produk</h1>
  <h2>Masuk ke akun Anda</h2>
  <form action="/api/mock/login" method="post">
    <label for="username">Username</label>
    <input id="username" name="username" type="text" placeholder="admin" required>
    <label for="password">Kata Sandi</label>
    <input id="password" name="password" type="password" required>
    <button type="submit">Masuk</button>
  </form>
  <h2>Cari produk</h2>
  <form action="/api/mock/products" method="get">
    <label for="q">Kata kunci</label>
    <input id="q" name="q" type="search" placeholder="cari produk">
    <button type="submit">Cari</button>
  </form>
  <h2>Daftar Produk</h2>
  <table>
    <thead><tr><th>SKU</th><th>Nama</th><th>Harga</th><th>Stok</th></tr></thead>
    <tbody>
      ${PRODUCTS.map((p) => `<tr><td>${p.sku}</td><td>${p.name}</td><td>${p.price}</td><td>${p.stock}</td></tr>`).join('\n      ')}
    </tbody>
  </table>
  <a href="/api/mock/products">Produk</a>
  <a href="/api/mock/health">Health</a>
  <a href="/api/mock/demo">Beranda</a>
  <button type="button">Tambah ke Keranjang</button>
  <button type="button">Checkout</button>
</body>
</html>`;
  });

  app.get('/mock/products/:id/stock', async (req, reply) => {
    const { id } = req.params as { id: string };
    const product = PRODUCTS.find((p) => p.id === id);
    if (!product) return fail(reply, 404, 'not_found', `Produk ${id} tidak ditemukan`);
    return one({ product_id: id, stock: product.stock, in_stock: product.stock > 0 });
  });
}
