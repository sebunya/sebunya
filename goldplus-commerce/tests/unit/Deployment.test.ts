import { expect, test, describe, afterAll, beforeEach, vi } from 'vitest';
import app from '../../apps/api/src/interfaces/http/app';
import { deploymentService } from '../../apps/api/src/infrastructure/deployment/DeploymentService';

vi.mock("../../apps/api/src/interfaces/http/middleware/auth", () => ({
  authMiddleware: async (c: any, next: any) => {
    const auth = c.req.header('Authorization');
    if (!auth || !auth.startsWith('Bearer ')) {
      return c.json({ success: false, error: { code: 'UNAUTHENTICATED', message: 'Unauthorized' } }, 401);
    }

    c.set("user", {
      id: "user-admin",
      email: "admin@goldplus.com",
      permissions: auth === 'Bearer forbidden' ? [] : ['settings.manage'],
    });
    await next();
  },
}));

const adminHeaders = { Authorization: 'Bearer admin' };
const jsonAdminHeaders = { ...adminHeaders, 'Content-Type': 'application/json' };

/**
 * These exercise the real Hono app, so each request boots the registry and the
 * middleware chain. Under a full parallel run that occasionally passes the
 * default 5s budget and the file fails while passing on its own — a flaky gate
 * teaches people to ignore red. The work is the same; only the budget changes.
 */
describe('Deployment & Maintenance Middleware API', { timeout: 30_000 }, () => {
  const resetDeploymentState = () => {
    deploymentService.setMaintenanceMode(false);
    deploymentService.setShadowTrafficRatio(0);
    deploymentService.setShadowUrl(null);
    deploymentService.updateHealthScore(100);
  };

  beforeEach(resetDeploymentState);
  afterAll(resetDeploymentState);

  test('admin deployment routes reject missing or insufficient admin access', async () => {
    const unauthenticated = await app.request('/admin/deployment/status');
    expect(unauthenticated.status).toBe(401);

    const forbidden = await app.request('/admin/deployment/status', {
      headers: { Authorization: 'Bearer forbidden' },
    });
    expect(forbidden.status).toBe(403);
  });

  test('GET /admin/deployment/status returns deployment settings', async () => {
    const res = await app.request('/admin/deployment/status', { headers: adminHeaders });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.success).toBe(true);
    expect(body.data).toHaveProperty('maintenanceMode');
    expect(body.data).toHaveProperty('healthScore');
    expect(body.data).toHaveProperty('shadowRatio');
    expect(body.data).toHaveProperty('shadowConfigured');
  });

  test('POST /admin/deployment/maintenance changes maintenance state', async () => {
    // 1. Enable maintenance mode
    const enableRes = await app.request('/admin/deployment/maintenance', {
      method: 'POST',
      headers: jsonAdminHeaders,
      body: JSON.stringify({ enabled: true }),
    });
    expect(enableRes.status).toBe(200);
    const enableBody = await enableRes.json() as any;
    expect(enableBody.data.maintenanceMode).toBe(true);
    expect(deploymentService.getMaintenanceMode()).toBe(true);

    // 2. Try POSTing to a non-exempt endpoint, should be blocked with 503
    const blockedRes = await app.request('/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-correlation-id': 'deploy-test-request' },
      body: JSON.stringify({ email: 'test@example.com', password: 'password' }),
    });
    expect(blockedRes.status).toBe(503);
    const blockedBody = await blockedRes.json() as any;
    expect(blockedBody.success).toBe(false);
    expect(blockedBody.error.code).toBe('SYSTEM_UNDER_MAINTENANCE');
    expect(blockedBody.meta.requestId).toBe('deploy-test-request');

    // 3. Disable maintenance mode
    const disableRes = await app.request('/admin/deployment/maintenance', {
      method: 'POST',
      headers: jsonAdminHeaders,
      body: JSON.stringify({ enabled: false }),
    });
    expect(disableRes.status).toBe(200);
    const disableBody = await disableRes.json() as any;
    expect(disableBody.data.maintenanceMode).toBe(false);
    expect(deploymentService.getMaintenanceMode()).toBe(false);

    // 4. Try POSTing again, should pass through maintenance check
    const allowedRes = await app.request('/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'test@example.com', password: 'password' }),
    });
    expect(allowedRes.status).not.toBe(503);
  });

  test('POST /admin/deployment/health-score updates release health', async () => {
    const res = await app.request('/admin/deployment/health-score', {
      method: 'POST',
      headers: jsonAdminHeaders,
      body: JSON.stringify({ score: 85 }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data.healthScore).toBe(85);
    expect(deploymentService.getReleaseHealthScore()).toBe(85);
  });

  test('POST /admin/deployment/shadow-traffic requires a target before enabling mirroring', async () => {
    const res = await app.request('/admin/deployment/shadow-traffic', {
      method: 'POST',
      headers: jsonAdminHeaders,
      body: JSON.stringify({ ratio: 0.15 }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error.code).toBe('SHADOW_TARGET_REQUIRED');
    expect(deploymentService.getShadowTrafficRatio()).toBe(0);
  });

  test('POST /admin/deployment/shadow-traffic updates target and traffic ratio', async () => {
    const res = await app.request('/admin/deployment/shadow-traffic', {
      method: 'POST',
      headers: jsonAdminHeaders,
      body: JSON.stringify({ ratio: 0.15, shadowUrl: 'http://shadow-api:3000' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data.shadowRatio).toBe(0.15);
    expect(body.data.shadowUrl).toBe('http://shadow-api:3000');
    expect(body.data.shadowConfigured).toBe(true);
    expect(deploymentService.getShadowTrafficRatio()).toBe(0.15);
  });
});
