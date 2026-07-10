import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { releaseReadinessAdminRouter } from '../../../src/interfaces/http/routes/admin/release-readiness';
import { Registry } from '../../../src/infrastructure/Registry';

vi.mock('../../../src/interfaces/http/middleware/auth', () => ({
  authMiddleware: async (c: any, next: any) => await next()
}));

vi.mock('../../../src/interfaces/http/middleware/permissions', () => ({
  requirePermissions: () => async (c: any, next: any) => await next()
}));

vi.mock('../../../src/infrastructure/Registry', () => {
  return {
    Registry: {
      getInstance: vi.fn().mockReturnValue({
        runReleaseReadinessChecksUseCase: {
          execute: vi.fn().mockResolvedValue('run-1')
        },
        getReleaseReadinessSummaryUseCase: {
          execute: vi.fn().mockResolvedValue({ latestRun: null, gates: [], decision: null })
        },
        recordReleaseDecisionUseCase: {
          execute: vi.fn().mockResolvedValue({ id: 'dec-1' })
        },
        acknowledgeReleaseGateUseCase: {
          execute: vi.fn().mockResolvedValue(undefined)
        }
      })
    }
  };
});

describe('ReleaseReadinessRoutes', () => {
  // Use a wrapper app to bypass authMiddleware for unit testing
  const app = new Hono<{ Variables: { adminUserId: string; adminPermissions: string[] } }>();
  app.use('*', async (c, next) => {
    c.set('adminUserId', 'admin-1');
    c.set('adminPermissions', ['RELEASE_READINESS_VIEW', 'RELEASE_READINESS_RUN', 'RELEASE_READINESS_DECIDE', 'RELEASE_READINESS_ACKNOWLEDGE']);
    await next();
  });
  app.route('/admin/release-readiness', releaseReadinessAdminRouter);

  it('GET /admin/release-readiness/summary', async () => {
    const res = await app.request('/admin/release-readiness/summary');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ latestRun: null, gates: [], decision: null });
  });

  it('POST /admin/release-readiness/runs', async () => {
    const res = await app.request('/admin/release-readiness/runs', {
      method: 'POST'
    });
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.runId).toBe('run-1');
  });

  it('POST /admin/release-readiness/decisions', async () => {
    const res = await app.request('/admin/release-readiness/decisions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runId: 'run-1', status: 'APPROVED', notes: 'Looks good' })
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe('dec-1');
  });

  it('POST /admin/release-readiness/gates/:gateId/acknowledge', async () => {
    const res = await app.request('/admin/release-readiness/gates/gate-1/acknowledge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runId: 'run-1', reason: 'False positive' })
    });
    expect(res.status).toBe(200);
  });
});
