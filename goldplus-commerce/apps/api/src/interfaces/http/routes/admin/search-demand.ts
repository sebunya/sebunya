import { Hono } from 'hono';
import { authMiddleware } from '../../middleware/auth';
import { requirePermissions } from '../../middleware/permissions';
import { Registry } from '../../../../infrastructure/Registry';
import { CreateAuditLogUseCase } from '../../../../application/use-cases/audit/CreateAuditLogUseCase';
import { ApiResponse, PERMISSIONS } from '@goldplus/shared';

/**
 * Slice 4: admin demand queue for zero-result searches.
 * Read requires reports.read; status changes require leads.assign and are audited.
 */
const routes = new Hono();
routes.use('*', authMiddleware);

routes.get('/', requirePermissions([PERMISSIONS.REPORTS_READ]), async (c) => {
  const status = c.req.query('status');
  const data = await Registry.getInstance().listSearchDemandUseCase.execute({
    status: status as any,
    limit: 200,
  });
  const res: ApiResponse<typeof data> = { success: true, data };
  return c.json(res);
});

routes.patch('/:id', requirePermissions([PERMISSIONS.LEADS_ASSIGN]), async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body) {
    return c.json({ success: false, error: { code: 'BAD_JSON', message: 'Body must be JSON.' } } satisfies ApiResponse<never>, 400);
  }
  const registry = Registry.getInstance();
  const id = String(c.req.param('id') ?? '');
  const result = await registry.updateSearchDemandStatusUseCase.execute(id, String(body.status ?? ''));
  if (!result.ok) {
    return c.json({ success: false, error: { code: result.code, message: result.message } } satisfies ApiResponse<never>, result.code === 'NOT_FOUND' ? 404 : 400);
  }
  await new CreateAuditLogUseCase(registry.auditRepo).execute({
    actorId: (c.get('user') as any).id,
    action: 'SEARCH_DEMAND_STATUS_CHANGED',
    entity: 'search_demand',
    entityId: id,
    newState: { query: result.signal.query, status: result.signal.status },
  });
  const res: ApiResponse<typeof result.signal> = { success: true, data: result.signal };
  return c.json(res);
});

export default routes;
