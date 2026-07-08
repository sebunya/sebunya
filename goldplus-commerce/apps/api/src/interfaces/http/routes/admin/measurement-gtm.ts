import { Hono } from 'hono';
import { Registry } from '../../../../infrastructure/Registry';
import { authMiddleware } from '../../middleware/auth';
import { requirePermissions } from '../../middleware/permissions';
import { PERMISSIONS } from '@goldplus/shared';

const measurementGtmRoutes = new Hono();
const registry = Registry.getInstance();

measurementGtmRoutes.use('*', authMiddleware);

// audit-exempt: Audit will be handled by PlanGtmMeasurementChangesUseCase
measurementGtmRoutes.post('/plan', requirePermissions([PERMISSIONS.REPORTS_READ]), async (c) => {
  const body = await c.req.json();
  const plan = await registry.planGtmMeasurementChangesUseCase.execute(body);
  return c.json({ data: plan }, 201);
});

measurementGtmRoutes.get('/workspaces', requirePermissions([PERMISSIONS.REPORTS_READ]), async (c) => {
  const containerPath = c.req.query('containerPath');
  if (!containerPath) {
    return c.json({ error: 'containerPath is required' }, 400);
  }
  const workspaces = await registry.listGtmWorkspacesUseCase.execute(containerPath);
  return c.json({ data: workspaces });
});

export { measurementGtmRoutes };
