import { Hono } from 'hono';
import { Registry } from '../../../../infrastructure/Registry';
import { authMiddleware } from '../../middleware/auth';
import { requirePermissions } from '../../middleware/permissions';
import { PERMISSIONS } from '@goldplus/shared';

type Variables = {
  adminUserId: string;
  adminPermissions: string[];
};

export const releaseReadinessAdminRouter = new Hono<{ Variables: Variables }>();

releaseReadinessAdminRouter.use('*', authMiddleware);
// Floor gate on the REAL vocabulary. The original guard required the phantom
// string 'RELEASE_READINESS_VIEW', which exists in no permission table — the
// whole module was structurally forbidden to every account including Owner.
// reports.read is the read floor; the access policy holds the per-action bar.
releaseReadinessAdminRouter.use('*', requirePermissions([PERMISSIONS.REPORTS_READ]));
// Handlers read adminUserId/adminPermissions; authMiddleware sets `user`.
// Without this mapping every handler saw undefined and denied or 500'd.
releaseReadinessAdminRouter.use('*', async (c, next) => {
  const user = c.get('user' as never) as unknown as { id: string; permissions: string[] } | undefined;
  if (user) {
    c.set('adminUserId', user.id);
    c.set('adminPermissions', user.permissions);
  }
  await next();
});

releaseReadinessAdminRouter.get('/summary', async (c) => {
  const adminUserId = c.get('adminUserId');
  const adminPermissions = c.get('adminPermissions') || [];
  
  const registry = Registry.getInstance();
  try {
    const summary = await registry.getReleaseReadinessSummaryUseCase.execute(adminUserId, adminPermissions);
    return c.json(summary);
  } catch (error: any) {
    if (error.message === 'Unauthorized to view release readiness') {
      return c.json({ error: 'Unauthorized' }, 403);
    }
    console.error('Error fetching release readiness summary:', error);
    return c.json({ error: 'Internal Server Error' }, 500);
  }
});

releaseReadinessAdminRouter.post('/runs', async (c) => {
  const adminUserId = c.get('adminUserId');
  const adminPermissions = c.get('adminPermissions') || [];
  
  const registry = Registry.getInstance();
  try {
    const runId = await registry.runReleaseReadinessChecksUseCase.execute(adminUserId, adminPermissions);
    return c.json({ runId }, 202);
  } catch (error: any) {
    if (error.message === 'Unauthorized to run release checks') {
      return c.json({ error: 'Unauthorized' }, 403);
    }
    console.error('Error starting release readiness run:', error);
    return c.json({ error: 'Internal Server Error' }, 500);
  }
});

releaseReadinessAdminRouter.get('/runs', async (c) => {
  const adminUserId = c.get('adminUserId');
  const adminPermissions = c.get('adminPermissions') || [];
  const limit = parseInt(c.req.query('limit') || '50', 10);
  const offset = parseInt(c.req.query('offset') || '0', 10);
  
  const registry = Registry.getInstance();
  try {
    const runs = await registry.listReleaseReadinessRunsUseCase.execute(limit, offset, adminUserId, adminPermissions);
    return c.json(runs);
  } catch (error: any) {
    if (error.message === 'Unauthorized to view release readiness runs') {
      return c.json({ error: 'Unauthorized' }, 403);
    }
    console.error('Error listing release readiness runs:', error);
    return c.json({ error: 'Internal Server Error' }, 500);
  }
});

releaseReadinessAdminRouter.get('/runs/:runId', async (c) => {
  const adminUserId = c.get('adminUserId');
  const adminPermissions = c.get('adminPermissions') || [];
  const runId = c.req.param('runId');
  
  const registry = Registry.getInstance();
  try {
    const result = await registry.getReleaseReadinessRunUseCase.execute(runId, adminUserId, adminPermissions);
    return c.json(result);
  } catch (error: any) {
    if (error.message === 'Unauthorized to view release readiness run') {
      return c.json({ error: 'Unauthorized' }, 403);
    }
    if (error.message === 'Run not found') {
      return c.json({ error: 'Run not found' }, 404);
    }
    console.error(`Error fetching run ${runId}:`, error);
    return c.json({ error: 'Internal Server Error' }, 500);
  }
});

releaseReadinessAdminRouter.post('/decisions', async (c) => {
  const adminUserId = c.get('adminUserId');
  const adminPermissions = c.get('adminPermissions') || [];
  const body = await c.req.json();
  const { runId, status, notes } = body;
  
  const registry = Registry.getInstance();
  try {
    const decision = await registry.recordReleaseDecisionUseCase.execute(runId, status, notes, adminUserId, adminPermissions);
    return c.json(decision);
  } catch (error: any) {
    if (error.message === 'Unauthorized to record release decision') {
      return c.json({ error: 'Unauthorized' }, 403);
    }
    if (error.message === 'Run not found') {
      return c.json({ error: 'Run not found' }, 404);
    }
    if (error.message.includes('unacknowledged critical failures')) {
      return c.json({ error: error.message }, 400);
    }
    console.error('Error recording release decision:', error);
    return c.json({ error: 'Internal Server Error' }, 500);
  }
});

releaseReadinessAdminRouter.post('/gates/:gateId/acknowledge', async (c) => {
  const adminUserId = c.get('adminUserId');
  const adminPermissions = c.get('adminPermissions') || [];
  const gateId = c.req.param('gateId');
  const body = await c.req.json();
  const { runId, reason } = body;
  
  const registry = Registry.getInstance();
  try {
    await registry.acknowledgeReleaseGateUseCase.execute(gateId, runId, reason, adminUserId, adminPermissions);
    return c.json({ success: true });
  } catch (error: any) {
    if (error.message === 'Unauthorized to acknowledge release gates') {
      return c.json({ error: 'Unauthorized' }, 403);
    }
    if (error.message === 'Gate result not found') {
      return c.json({ error: 'Gate not found' }, 404);
    }
    console.error(`Error acknowledging gate ${gateId}:`, error);
    return c.json({ error: 'Internal Server Error' }, 500);
  }
});
