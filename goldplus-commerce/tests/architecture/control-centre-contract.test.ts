/**
 * Control Centre readiness API contract, driven through the REAL Hono app.
 *
 * Static analysis cannot prove that a route is mounted, authenticated and
 * permissioned in the right order, or that its response actually carries the three
 * status axes. This drives `app.request()` so the router graph, mount paths, mount
 * ordering and per-route middleware are the real ones.
 */
import { describe, expect, it, vi } from 'vitest';
import { PERMISSIONS } from '../../packages/shared/src/permissions';

vi.mock('../../apps/api/src/infrastructure/Registry', () => ({
  Registry: {
    getInstance: () =>
      new Proxy({}, { get: () => ({ execute: async () => ({ ok: true, id: 'stub' }) }) }),
  },
}));

// The readiness route must not need a live database to answer: a probe failure is
// a DEGRADED module, not a 500. These doubles make dependency state explicit.
vi.mock('../../apps/api/src/infrastructure/control-centre/DrizzleControlCentreProbes', () => ({
  drizzleDependencyProbe: { isUp: async () => true },
  drizzleApprovalProbe: { isApproved: async () => false },
  envProviderConfigProbe: { isConfigured: () => false },
  createRouteMountProbe: (prefixes: readonly string[]) => ({
    isMounted: (m: string) =>
      prefixes.includes(m) || prefixes.some((p) => p.startsWith(`${m}/`)),
  }),
  drizzleModuleApprovalRepository: {
    list: async () => [],
    findLive: async () => null,
    approve: async () => ({ id: 'a1' }),
    revoke: async () => null,
  },
}));

vi.mock('../../apps/api/src/interfaces/http/middleware/auth', () => ({
  authMiddleware: async (c: any, next: any) => {
    const auth = c.req.header('Authorization');
    if (!auth) return c.json({ success: false, error: { code: 'UNAUTHENTICATED' } }, 401);
    const permissions = auth.includes('admin')
      ? Object.values(PERMISSIONS)
      : auth.includes('reader')
        ? [PERMISSIONS.REPORTS_READ]
        : [];
    c.set('user', { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', email: 'a@b.c', permissions });
    await next();
  },
}));

import app from '../../apps/api/src/interfaces/http/app';

const MODULES = '/admin/control-centre/modules';
const J = { 'Content-Type': 'application/json' };

describe('GET /admin/control-centre/modules', () => {
  it('is mounted — it does not 404', async () => {
    const res = await app.request(MODULES, { headers: { Authorization: 'Bearer admin' } });
    expect(res.status).not.toBe(404);
  });

  it('returns 401 without credentials', async () => {
    const res = await app.request(MODULES);
    expect(res.status).toBe(401);
  });

  it('returns 403 when authenticated but not authorised', async () => {
    const res = await app.request(MODULES, { headers: { Authorization: 'Bearer none' } });
    expect(res.status).toBe(403);
  });

  it('returns 200 for reports.read', async () => {
    const res = await app.request(MODULES, { headers: { Authorization: 'Bearer reader' } });
    expect(res.status).toBe(200);
  });

  it('carries all three status axes on every module', async () => {
    const res = await app.request(MODULES, { headers: { Authorization: 'Bearer admin' } });
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.modules.length).toBeGreaterThan(20);
    const service = ['LIVE', 'DEGRADED', 'BLOCKED', 'UNAVAILABLE'];
    const access = ['OPEN', 'AUTHENTICATED', 'PROTECTED', 'APPROVAL_REQUIRED'];
    const activation = ['ACTIVE', 'DORMANT', 'READ_ONLY', 'DRY_RUN', 'NOT_CONFIGURED'];
    for (const m of body.data.modules) {
      expect(service, m.moduleKey).toContain(m.serviceStatus);
      expect(access, m.moduleKey).toContain(m.accessStatus);
      expect(activation, m.moduleKey).toContain(m.activationStatus);
      expect(typeof m.latencyMs).toBe('number');
      expect(m.deepLink.startsWith('/admin')).toBe(true);
    }
  });

  it('echoes the caller correlation id as the trace id', async () => {
    const res = await app.request(MODULES, {
      headers: { Authorization: 'Bearer admin', 'x-correlation-id': 'trace-under-test' },
    });
    const body = await res.json();
    expect(body.data.traceId).toBe('trace-under-test');
    expect(body.data.modules.every((m: any) => m.traceId === 'trace-under-test')).toBe(true);
  });

  it('reports no module as UNAVAILABLE — every registry mount really exists', async () => {
    const res = await app.request(MODULES, { headers: { Authorization: 'Bearer admin' } });
    const body = await res.json();
    const unavailable = body.data.modules.filter((m: any) => m.serviceStatus === 'UNAVAILABLE');
    expect(unavailable.map((m: any) => m.moduleKey)).toEqual([]);
  });

  it('filters by category', async () => {
    const res = await app.request(`${MODULES}?category=COMMERCE_OS`, {
      headers: { Authorization: 'Bearer admin' },
    });
    const body = await res.json();
    expect(body.data.modules.length).toBe(14);
    expect(body.data.modules.every((m: any) => m.category === 'COMMERCE_OS')).toBe(true);
  });

  it('rejects an unknown category rather than silently returning everything', async () => {
    const res = await app.request(`${MODULES}?category=NOPE`, {
      headers: { Authorization: 'Bearer admin' },
    });
    expect(res.status).toBe(400);
  });

  it('leaks no credential value even when providers are configured', async () => {
    process.env.WHATSAPP_ACCESS_TOKEN = 'secret-should-not-appear';
    const res = await app.request(MODULES, { headers: { Authorization: 'Bearer admin' } });
    const text = await res.text();
    expect(text).not.toContain('secret-should-not-appear');
    expect(text).not.toContain('WHATSAPP_ACCESS_TOKEN');
    delete process.env.WHATSAPP_ACCESS_TOKEN;
  });
});

describe('module activation approval routes', () => {
  it('requires authentication to list approvals', async () => {
    expect((await app.request('/admin/control-centre/approvals')).status).toBe(401);
  });

  it('lets reports.read read the ledger', async () => {
    const res = await app.request('/admin/control-centre/approvals', {
      headers: { Authorization: 'Bearer reader' },
    });
    expect(res.status).toBe(200);
  });

  it('refuses to APPROVE with only reports.read — reading cannot change activation', async () => {
    const res = await app.request('/admin/control-centre/approvals', {
      method: 'POST',
      headers: { ...J, Authorization: 'Bearer reader' },
      body: JSON.stringify({ moduleKey: 'loyalty', reason: 'r', approvalReference: 'REF' }),
    });
    expect(res.status).toBe(403);
  });

  it('refuses to REVOKE with only reports.read', async () => {
    const res = await app.request('/admin/control-centre/approvals/revoke', {
      method: 'POST',
      headers: { ...J, Authorization: 'Bearer reader' },
      body: JSON.stringify({ moduleKey: 'loyalty', revocationReason: 'r' }),
    });
    expect(res.status).toBe(403);
  });

  it('rejects approving a module the registry does not gate by approval', async () => {
    const res = await app.request('/admin/control-centre/approvals', {
      method: 'POST',
      headers: { ...J, Authorization: 'Bearer admin' },
      body: JSON.stringify({ moduleKey: 'products', reason: 'r', approvalReference: 'REF' }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('MODULE_NOT_APPROVAL_GATED');
  });

  it('rejects an unknown module with 404', async () => {
    const res = await app.request('/admin/control-centre/approvals', {
      method: 'POST',
      headers: { ...J, Authorization: 'Bearer admin' },
      body: JSON.stringify({ moduleKey: 'nope', reason: 'r', approvalReference: 'REF' }),
    });
    expect(res.status).toBe(404);
  });

  it('rejects a blank reason with 400', async () => {
    const res = await app.request('/admin/control-centre/approvals', {
      method: 'POST',
      headers: { ...J, Authorization: 'Bearer admin' },
      body: JSON.stringify({ moduleKey: 'loyalty', reason: '   ', approvalReference: 'REF' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('GET /admin/control-centre/registry', () => {
  it('exposes the declaration with no runtime status attached', async () => {
    const res = await app.request('/admin/control-centre/registry', {
      headers: { Authorization: 'Bearer admin' },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.modules.length).toBeGreaterThan(20);
    for (const m of body.data.modules) {
      expect(m.serviceStatus).toBeUndefined();
      expect(m.activationStatus).toBeUndefined();
    }
  });
});
