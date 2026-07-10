import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { PERMISSIONS } from '@goldplus/shared';

const mockGetSummaryUseCase = { execute: vi.fn() };

vi.mock('../../src/infrastructure/Registry', () => {
  return {
    Registry: {
      getInstance: vi.fn().mockReturnValue({
        getMeasurementControlTowerSummaryUseCase: { execute: vi.fn() },
        getMeasurementControlTowerSectionUseCase: { execute: vi.fn() },
        listMeasurementControlTowerWarningsUseCase: { execute: vi.fn() },
        listRecentMeasurementEventsUseCase: { execute: vi.fn() },
        recordMeasurementControlTowerViewUseCase: { execute: vi.fn() },
      })
    }
  };
});

vi.mock('../../src/interfaces/http/middleware/auth', () => ({
  authMiddleware: async (c: any, next: any) => {
    // Basic mock of auth behavior based on headers for testing
    const authHeader = c.req.header('Authorization');
    if (!authHeader) {
      return c.json({ error: 'UNAUTHORIZED' }, 401);
    }
    if (authHeader === 'Bearer CUSTOMER') {
      c.set('user', { id: 'cust123', permissions: [] }); // Customers don't have admin permissions
    } else if (authHeader === 'Bearer ADMIN_NO_PERMS') {
      c.set('user', { id: 'admin123', permissions: [] });
    } else if (authHeader === 'Bearer ADMIN_VALID') {
      c.set('user', { id: 'admin123', permissions: [PERMISSIONS.REPORTS_READ] });
    } else if (authHeader === 'Bearer UNDEFINED_USER') {
      c.set('user', undefined);
    }
    await next();
  },
  requirePermissions: (required: string[]) => async (c: any, next: any) => {
    const user = c.get('user');
    if (!user) return c.json({ error: 'UNAUTHORIZED' }, 401);
    const hasPerm = required.some(p => user.permissions.includes(p));
    if (!hasPerm) return c.json({ error: 'FORBIDDEN' }, 403);
    await next();
  },
}));

import adminMeasurementControlTowerRoutes from '../../src/interfaces/http/routes/admin/measurement-control-tower';

describe('MeasurementControlTowerRoutes RBAC', () => {
  let app: Hono;

  beforeEach(() => {
    app = new Hono();
    app.route('/admin/measurement-control-tower', adminMeasurementControlTowerRoutes);
    vi.clearAllMocks();
  });

  it('rejects unauthenticated requests', async () => {
    const res = await app.request('/admin/measurement-control-tower/summary');
    expect(res.status).toBe(401);
  });

  it('rejects customer/non-admin requests', async () => {
    const res = await app.request('/admin/measurement-control-tower/summary', {
      headers: { Authorization: 'Bearer CUSTOMER' },
    });
    expect(res.status).toBe(403);
  });

  it('rejects admin missing REPORTS_READ permission', async () => {
    const res = await app.request('/admin/measurement-control-tower/summary', {
      headers: { Authorization: 'Bearer ADMIN_NO_PERMS' },
    });
    expect(res.status).toBe(403);
  });

  it('allows admin with proper permission', async () => {
    // Need to get the mocked execute function from Registry
    const { Registry } = await import('../../src/infrastructure/Registry');
    const instance = Registry.getInstance();
    (instance.getMeasurementControlTowerSummaryUseCase.execute as any).mockResolvedValue({ status: 'DASHBOARD_READY' });

    const res = await app.request('/admin/measurement-control-tower/summary', {
      headers: { Authorization: 'Bearer ADMIN_VALID' },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it('handles undefined adminUser safely', async () => {
    const res = await app.request('/admin/measurement-control-tower/summary', {
      headers: { Authorization: 'Bearer UNDEFINED_USER' },
    });
    // With requirePermissions middleware, this actually hits the 401 path
    expect(res.status).toBe(401);
  });
});

