import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PERMISSIONS } from '../../packages/shared/src/permissions';

const operations = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock('../../apps/api/src/infrastructure/Registry', () => ({
  Registry: {
    getInstance: () => ({
      getLoyaltyOperationsUseCase: operations,
      getLoyaltyConfigUseCase: { execute: vi.fn() },
    }),
  },
}));
vi.mock('../../apps/api/src/interfaces/http/middleware/auth', () => ({
  authMiddleware: async (c: any, next: any) => {
    const token = c.req.header('Authorization')?.replace('Bearer ', '');
    if (!token) return c.json({ success: false }, 401);
    c.set('user', {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      permissions: token === 'settings' ? [PERMISSIONS.SETTINGS_MANAGE] : [],
    });
    await next();
  },
}));

import app from '../../apps/api/src/interfaces/http/app';

describe('Loyalty protected operations API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    operations.execute.mockResolvedValue({
      accountCount: 0,
      entryCount: 0,
      signedBalance: 0,
      pendingExpiry: 0,
      byType: { earn: 0, redeem: 0, reversal: 0, expiry: 0, adjustment: 0 },
      recentEntries: [],
    });
  });

  it('requires authentication and settings management permission', async () => {
    expect((await app.request('/admin/loyalty/operations')).status).toBe(401);
    expect((await app.request('/admin/loyalty/operations', { headers: { Authorization: 'Bearer forbidden' } })).status).toBe(403);
    expect((await app.request('/admin/loyalty/operations', { headers: { Authorization: 'Bearer settings' } })).status).toBe(200);
    expect(operations.execute).toHaveBeenCalledOnce();
  });

  it('returns a read-only reconciled empty state', async () => {
    const response = await app.request('/admin/loyalty/operations?limit=25', { headers: { Authorization: 'Bearer settings' } });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, data: { entryCount: 0, signedBalance: 0, recentEntries: [] } });
    expect(operations.execute).toHaveBeenCalledWith({ limit: 25 });
  });
});
