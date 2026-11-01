import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PERMISSIONS } from '../../packages/shared/src/permissions';
import { classifyPublicEndpoint } from '../../apps/api/src/domain/security/PublicEndpointPolicy';

/**
 * The bulk quote HTTP surface, driven through the REAL Hono app (mounts,
 * ordering, middleware) with only the Registry and the auth middleware
 * substituted.
 */
const calls: Record<string, unknown[]> = {};
const audit: unknown[] = [];
let submitResult: unknown = null;
let lookupResult: unknown = null;

const record = (name: string, value: unknown) => { (calls[name] ??= []).push(value); };

vi.mock('../../apps/api/src/infrastructure/Registry', () => ({
  Registry: {
    getInstance: () =>
      new Proxy(
        {},
        {
          get: (_t, prop) => {
            if (prop === 'submitBulkQuoteUseCase') return { execute: async (b: unknown) => { record('submit', b); return submitResult; } };
            if (prop === 'lookupBulkQuoteUseCase') return { execute: async (b: unknown) => { record('lookup', b); return lookupResult; } };
            if (prop === 'createAuditLogUseCase') return { execute: async (a: unknown) => { audit.push(a); return { ok: true, id: 'x' }; } };
            if (prop === 'listQuoteRequestsUseCase') return { execute: async () => [] };
            if (prop === 'getQuoteRequestUseCase') return { execute: async () => null };
            if (prop === 'updateQuoteRequestStatusUseCase') return { execute: async (b: unknown) => { record('status', b); return { ok: true, id: 'q1', from: 'new', to: 'quoted' }; } };
            return { execute: async () => ({ ok: true }) };
          },
        },
      ),
  },
}));

vi.mock('../../apps/api/src/interfaces/http/middleware/auth', () => ({
  authMiddleware: async (c: any, next: any) => {
    const auth = c.req.header('Authorization');
    if (!auth) return c.json({ success: false, error: { code: 'UNAUTHENTICATED' } }, 401);
    c.set('user', {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      email: 'admin@example.com',
      permissions: auth.includes('admin') ? [PERMISSIONS.QUOTES_MANAGE] : [],
    });
    await next();
  },
}));

const { default: app, MOUNTED_API_PREFIXES } = await import('../../apps/api/src/interfaces/http/app');

const J = { 'Content-Type': 'application/json' };
const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  app.request(path, { method: 'POST', headers: { ...J, ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });

const view = { reference: 'BQ-7K3M9P', totals: { lineCount: 2, totalUnits: 125 }, lines: [] };

beforeEach(() => {
  for (const k of Object.keys(calls)) delete calls[k];
  audit.length = 0;
});

describe('POST /quotes/bulk', () => {
  it('201 with the reference on a new request, and audits it', async () => {
    submitResult = { ok: true, replayed: false, quoteId: 'q1', request: view };
    const res = await post('/quotes/bulk', { idempotencyKey: 'k', lines: [] });
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json).toMatchObject({ success: true, data: { quoteId: 'q1', replayed: false, request: { reference: 'BQ-7K3M9P' } } });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: 'QUOTE_REQUESTED', entity: 'quote', entityId: 'q1', actorId: null });
  });

  it('200 on a replay, and audits nothing new', async () => {
    submitResult = { ok: true, replayed: true, quoteId: 'q1', request: view };
    const res = await post('/quotes/bulk', { idempotencyKey: 'k' });
    expect(res.status).toBe(200);
    expect(audit).toHaveLength(0);
  });

  it('maps refusals: 422 unavailable with ids, 409 key conflict, 400 bad input with field', async () => {
    submitResult = { ok: false, code: 'PRODUCTS_UNAVAILABLE', message: 'm', productIds: ['p1'] };
    let res = await post('/quotes/bulk', {});
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ error: { code: 'PRODUCTS_UNAVAILABLE', details: { productIds: ['p1'] } } });

    submitResult = { ok: false, code: 'IDEMPOTENCY_CONFLICT', message: 'm' };
    res = await post('/quotes/bulk', {});
    expect(res.status).toBe(409);

    submitResult = { ok: false, code: 'BAD_INPUT', message: 'm', field: 'phone' };
    res = await post('/quotes/bulk', {});
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'BAD_INPUT', details: { field: 'phone' } } });
  });

  it('refuses a body that is not a JSON object before the use case runs', async () => {
    for (const body of ['nope', '[1,2]', JSON.stringify('x')]) {
      const res = await post('/quotes/bulk', body);
      expect(res.status).toBe(400);
    }
    const huge = await post('/quotes/bulk', JSON.stringify({ notes: 'x'.repeat(70 * 1024) }));
    expect(huge.status).toBe(400);
    expect(calls.submit).toBeUndefined();
  });
});

describe('POST /quotes/lookup', () => {
  it('passes only the reference and phone, and answers 404 for a miss', async () => {
    lookupResult = { ok: false, code: 'NOT_FOUND', message: 'not found' };
    const res = await post('/quotes/lookup', { reference: 'BQ-7K3M9P', phone: '0772123456', extra: 'ignored' });
    expect(res.status).toBe(404);
    expect(calls.lookup).toEqual([{ reference: 'BQ-7K3M9P', phone: '0772123456' }]);
    lookupResult = { ok: true, request: view };
    const hit = await post('/quotes/lookup', { reference: 'BQ-7K3M9P', phone: '0772123456' });
    expect(hit.status).toBe(200);
  });
});

describe('admin quote requests', () => {
  it('requires a session and quotes.manage on every endpoint', async () => {
    for (const [path, init] of [
      ['/admin/quote-requests', { method: 'GET' }],
      ['/admin/quote-requests/lines.csv', { method: 'GET' }],
      ['/admin/quote-requests/q1', { method: 'GET' }],
      ['/admin/quote-requests/q1/status', { method: 'PATCH', headers: J, body: JSON.stringify({ status: 'quoted' }) }],
    ] as Array<[string, RequestInit]>) {
      expect((await app.request(path, init)).status, `${path} without credentials`).toBe(401);
      const noPerm = await app.request(path, { ...init, headers: { ...(init.headers as Record<string, string>), Authorization: 'Bearer none' } });
      expect(noPerm.status, `${path} without quotes.manage`).toBe(403);
    }
    expect(calls.status).toBeUndefined();
  });

  it('streams the CSV header and audits a status change as the session admin', async () => {
    const csv = await app.request('/admin/quote-requests/lines.csv', { headers: { Authorization: 'Bearer admin' } });
    expect(csv.status).toBe(200);
    expect(csv.headers.get('content-type')).toContain('text/csv');
    expect((await csv.text()).split('\r\n')[0]).toContain('reference,submitted_at,status');

    const res = await app.request('/admin/quote-requests/q1/status', {
      method: 'PATCH',
      headers: { ...J, Authorization: 'Bearer admin' },
      body: JSON.stringify({ status: 'quoted', actorId: 'spoofed' }),
    });
    expect(res.status).toBe(200);
    expect(audit[0]).toMatchObject({ action: 'QUOTE_REQUEST_STATUS_CHANGED', actorId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', previousState: { status: 'new' }, newState: { status: 'quoted' } });
  });

  it('a missing request is 404', async () => {
    const res = await app.request('/admin/quote-requests/q404', { headers: { Authorization: 'Bearer admin' } });
    expect(res.status).toBe(404);
  });
});

describe('abuse control and mounting', () => {
  it('rides the existing public-form and lookup budgets', () => {
    expect(classifyPublicEndpoint('POST', '/quotes/bulk')).toBe('quote-request');
    expect(classifyPublicEndpoint('POST', '/quotes/bulk/')).toBe('quote-request');
    expect(classifyPublicEndpoint('POST', '/quotes/lookup')).toBe('order-lookup');
  });

  it('declares both prefixes as mounted', () => {
    expect(MOUNTED_API_PREFIXES).toContain('/quotes');
    expect(MOUNTED_API_PREFIXES).toContain('/admin/quote-requests');
  });
});
