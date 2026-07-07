import { describe, it, expect, vi, beforeEach } from 'vitest';
import app from '../../apps/api/src/interfaces/http/app';
import { Registry } from '../../apps/api/src/infrastructure/Registry';

vi.mock('../../apps/api/src/interfaces/http/middleware/auth', () => ({
  authMiddleware: async (c: any, next: any) => {
    const auth = c.req.header('Authorization');
    if (!auth || !auth.startsWith('Bearer ')) {
      return c.json({ success: false, error: { code: 'UNAUTHENTICATED', message: 'Unauthorized' } }, 401);
    }

    c.set('user', { id: 'user-admin', email: 'admin@goldplus.com', permissions: ['*'] });
    await next();
  },
}));

vi.mock('../../apps/api/src/interfaces/http/middleware/permissions', () => ({
  requirePermissions: (perms: string[]) => async (c: any, next: any) => {
    const auth = c.req.header('Authorization');
    if (auth === 'Bearer forbidden') {
      return c.json({
        success: false,
        error: { code: 'FORBIDDEN', message: `Missing ${perms.join(',')}` },
      }, 403);
    }

    await next();
  },
}));

describe('Governance admin read protection', () => {
  let registry: Registry;

  beforeEach(() => {
    registry = Registry.getInstance();

    vi.spyOn(registry, 'productRepo', 'get').mockReturnValue({
      findAll: vi.fn().mockResolvedValue([{ id: 'product-1', name: 'Protected product' }]),
    } as any);

    vi.spyOn(registry, 'dealerRepo', 'get').mockReturnValue({
      findAll: vi.fn().mockResolvedValue([{ id: 'dealer-1', businessName: 'Protected dealer', status: 'pending' }]),
    } as any);

    vi.spyOn(registry, 'auditRepo', 'get').mockReturnValue({
      findAll: vi.fn().mockResolvedValue([{ id: 'audit-1' }]),
    } as any);

    vi.spyOn(registry, 'supportRepo', 'get').mockReturnValue({
      findAll: vi.fn().mockResolvedValue([{ id: 'support-1', status: 'open' }]),
    } as any);

    vi.spyOn(registry, 'paymentRepo', 'get').mockReturnValue({
      findAll: vi.fn().mockResolvedValue([{ id: 'payment-1', status: 'SUCCESS' }]),
    } as any);

    vi.spyOn(registry, 'quoteRepo', 'get').mockReturnValue({
      findAll: vi.fn().mockResolvedValue([{ id: 'quote-1', status: 'new' }]),
    } as any);
  });

  it.each([
    '/governance/admin/stats',
    '/governance/admin/products',
    '/governance/admin/payments',
    '/governance/admin/quotes',
    '/governance/admin/support',
    '/governance/admin/dealers',
    '/governance/admin/orders',
    '/governance/admin/orders/order-1',
  ])('rejects unauthenticated GET %s', async (path) => {
    const res = await app.request(path);
    expect(res.status).toBe(401);
  });

  it.each([
    '/governance/admin/stats',
    '/governance/admin/products',
    '/governance/admin/payments',
    '/governance/admin/quotes',
    '/governance/admin/support',
    '/governance/admin/dealers',
  ])('rejects insufficient permissions for GET %s', async (path) => {
    const res = await app.request(path, {
      headers: { Authorization: 'Bearer forbidden' },
    });

    expect(res.status).toBe(403);
  });

  it('allows authorized product admin reads', async () => {
    const res = await app.request('/governance/admin/products', {
      headers: { Authorization: 'Bearer valid-token' },
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data).toEqual([{ id: 'product-1', name: 'Protected product' }]);
  });

  it('allows authorized dashboard stats reads', async () => {
    const res = await app.request('/governance/admin/stats', {
      headers: { Authorization: 'Bearer valid-token' },
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.pendingProducts).toBe(0);
    expect(json.data.pendingDealers).toBe(1);
    expect(json.data.supportIssues).toBe(1);
  });
});
