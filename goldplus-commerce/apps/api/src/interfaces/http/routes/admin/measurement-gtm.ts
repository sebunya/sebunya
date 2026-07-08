import { Hono } from 'hono';
import { Registry } from '../../../../infrastructure/Registry';
import { authMiddleware } from '../../middleware/auth';
import { requirePermissions } from '../../middleware/permissions';
import { PERMISSIONS } from '@goldplus/shared';

const measurementGtmRoutes = new Hono();
const registry = Registry.getInstance();

measurementGtmRoutes.use('*', authMiddleware);

measurementGtmRoutes.get('/status', requirePermissions([PERMISSIONS.REPORTS_READ]), async (c) => {
  const status = await registry.gtmRepo.getCredentialStatus();
  return c.json({ success: true, status: 'OK', data: status });
});

// audit-exempt: Audit will be handled by PlanGtmMeasurementChangesUseCase
measurementGtmRoutes.post('/plan', requirePermissions([PERMISSIONS.REPORTS_READ]), async (c) => {
  const body = await c.req.json();
  const result = await registry.planGtmMeasurementChangesUseCase.execute(body.containerType || 'web');
  return c.json({ success: true, status: result.status, data: result.data, error: result.error });
});

measurementGtmRoutes.post('/validate', requirePermissions([PERMISSIONS.REPORTS_READ]), async (c) => {
  const body = await c.req.json();
  const result = await registry.validateGtmMeasurementPlanUseCase.execute(body.containerPath, body.containerType || 'web');
  return c.json({ success: true, status: result.status, data: result.data, error: result.error });
});

measurementGtmRoutes.post('/diff', requirePermissions([PERMISSIONS.REPORTS_READ]), async (c) => {
  const body = await c.req.json();
  const result = await registry.validateGtmMeasurementPlanUseCase.execute(body.containerPath, body.containerType || 'web');
  return c.json({ success: true, status: result.status, data: result.data, error: result.error });
});

// audit-exempt: CreateGtmWorkspaceUseCase handles its own safe operations
measurementGtmRoutes.post('/workspace', requirePermissions([PERMISSIONS.REPORTS_READ]), async (c) => {
  const body = await c.req.json();
  const result = await registry.createGtmWorkspaceUseCase.execute(body.containerPath, body.name);
  return c.json({ success: true, status: result.status, data: result.data, error: result.error });
});

// audit-exempt: CreateGtmVersionDraftUseCase handles its own safe operations
measurementGtmRoutes.post('/version-draft', requirePermissions([PERMISSIONS.REPORTS_READ]), async (c) => {
  const body = await c.req.json();
  const result = await registry.createGtmVersionDraftUseCase.execute(body.workspacePath, body.name, body.notes);
  return c.json({ success: true, status: result.status, data: result.data, error: result.error });
});

measurementGtmRoutes.get('/sync-logs', requirePermissions([PERMISSIONS.REPORTS_READ]), async (c) => {
  const result = await registry.listGtmSyncLogsUseCase.execute(50);
  return c.json({ success: true, status: result.status, data: result.data });
});

export { measurementGtmRoutes };
