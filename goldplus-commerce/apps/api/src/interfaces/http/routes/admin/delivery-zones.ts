import { Hono } from 'hono';
import { authMiddleware } from '../../middleware/auth';
import { requirePermissions } from '../../middleware/permissions';
import { Registry } from '../../../../infrastructure/Registry';
import { CreateAuditLogUseCase } from '../../../../application/use-cases/audit/CreateAuditLogUseCase';
import { ApiResponse, PERMISSIONS } from '@goldplus/shared';

/**
 * Slice 3B: admin-configured delivery fee zones (per Ugandan district).
 * All mutations require pricing.manage and are audit-logged.
 */
const routes = new Hono();
routes.use('*', authMiddleware);

routes.get('/', requirePermissions([PERMISSIONS.PRICING_MANAGE]), async (c) => {
  const zones = await Registry.getInstance().listDeliveryZonesUseCase.execute();
  const res: ApiResponse<typeof zones> = { success: true, data: zones };
  return c.json(res);
});

routes.put('/', requirePermissions([PERMISSIONS.PRICING_MANAGE]), async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body) {
    return c.json({ success: false, error: { code: 'BAD_JSON', message: 'Body must be JSON.' } } satisfies ApiResponse<never>, 400);
  }
  const registry = Registry.getInstance();
  const result = await registry.upsertDeliveryZoneUseCase.execute({
    district: body.district,
    feeUgx: body.feeUgx,
    enabled: body.enabled,
  });
  if (!result.ok) {
    return c.json({ success: false, error: { code: result.code, message: result.message } } satisfies ApiResponse<never>, 400);
  }
  await new CreateAuditLogUseCase(registry.auditRepo).execute({
    actorId: (c.get('user') as any).id,
    action: 'DELIVERY_ZONE_UPSERTED',
    entity: 'delivery_zone',
    entityId: result.zone.id,
    newState: { district: result.zone.district, feeUgx: result.zone.feeUgx, enabled: result.zone.enabled },
  });
  const res: ApiResponse<typeof result.zone> = { success: true, data: result.zone };
  return c.json(res);
});

routes.delete('/:id', requirePermissions([PERMISSIONS.PRICING_MANAGE]), async (c) => {
  const id = String(c.req.param('id') ?? '');
  const registry = Registry.getInstance();
  const result = await registry.deleteDeliveryZoneUseCase.execute(id);
  if (!result.ok) {
    return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Delivery zone not found.' } } satisfies ApiResponse<never>, 404);
  }
  await new CreateAuditLogUseCase(registry.auditRepo).execute({
    actorId: (c.get('user') as any).id,
    action: 'DELIVERY_ZONE_DELETED',
    entity: 'delivery_zone',
    entityId: id,
  });
  return c.json({ success: true, data: { deleted: true } });
});

export default routes;
