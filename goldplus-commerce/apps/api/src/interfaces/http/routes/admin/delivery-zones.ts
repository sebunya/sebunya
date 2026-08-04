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

// The intelligence cockpit: every district with its distance band, the model's
// estimate, the median of fees the team actually confirmed, the configured
// zone if any, and which source currently answers the customer. One screen to
// see where reality disagrees with the model.
routes.get('/intelligence', requirePermissions([PERMISSIONS.PRICING_MANAGE]), async (c) => {
  const data = await Registry.getInstance().getDeliveryIntelligenceUseCase.execute();
  return c.json({ success: true, data });
});

routes.put('/policy', requirePermissions([PERMISSIONS.PRICING_MANAGE]), async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body) {
    return c.json({ success: false, error: { code: 'BAD_JSON', message: 'Body must be JSON.' } } satisfies ApiResponse<never>, 400);
  }
  const registry = Registry.getInstance();
  const actorId = (c.get('user') as any).id as string;
  const result = await registry.saveDeliveryPricingPolicyUseCase.execute({
    policy: {
      coreFeeUgx: body.coreFeeUgx,
      cityFeeUgx: body.cityFeeUgx,
      metroFeeUgx: body.metroFeeUgx,
      metroEdgeFeeUgx: body.metroEdgeFeeUgx,
      nearFeeUgx: body.nearFeeUgx,
      midFeeUgx: body.midFeeUgx,
      farFeeUgx: body.farFeeUgx,
      remoteFeeUgx: body.remoteFeeUgx,
      enabled: body.enabled,
    },
    note: body.note ?? null,
    actorId,
  });
  if (!result.ok) {
    return c.json({ success: false, error: { code: result.code, message: result.message } } satisfies ApiResponse<never>, 400);
  }
  await new CreateAuditLogUseCase(registry.auditRepo).execute({
    actorId,
    action: 'DELIVERY_PRICING_POLICY_SAVED',
    entity: 'delivery_pricing_policy',
    entityId: 'policy',
    newState: { ...result.policy, updatedAt: undefined },
  });
  return c.json({ success: true, data: result.policy });
});

// One-click adoption: promote the current effective estimate (or an explicit
// fee) into a CONFIRMED zone. Reuses the audited zone upsert — adoption is not
// a new kind of write, it is the operator making a standing promise.
routes.post('/adopt', requirePermissions([PERMISSIONS.PRICING_MANAGE]), async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body?.district) {
    return c.json({ success: false, error: { code: 'BAD_INPUT', message: 'district is required.' } } satisfies ApiResponse<never>, 400);
  }
  const registry = Registry.getInstance();
  let feeUgx: number | null = Number.isInteger(body.feeUgx) ? body.feeUgx : null;
  if (feeUgx === null) {
    const estimate = await registry.getDeliveryEstimateUseCase.execute({ district: String(body.district) });
    if (!estimate.ok || estimate.estimate.feeUgx === null) {
      return c.json({ success: false, error: { code: 'NO_ESTIMATE', message: 'No estimate exists to adopt — provide feeUgx explicitly.' } } satisfies ApiResponse<never>, 400);
    }
    feeUgx = estimate.estimate.feeUgx;
  }
  const result = await registry.upsertDeliveryZoneUseCase.execute({
    district: body.district,
    feeUgx,
    enabled: true,
  });
  if (!result.ok) {
    return c.json({ success: false, error: { code: result.code, message: result.message } } satisfies ApiResponse<never>, 400);
  }
  const actorId = (c.get('user') as any).id as string;
  await new CreateAuditLogUseCase(registry.auditRepo).execute({
    actorId,
    action: 'DELIVERY_ZONE_ADOPTED_FROM_ESTIMATE',
    entity: 'delivery_zone',
    entityId: result.zone.id,
    newState: { district: result.zone.district, feeUgx: result.zone.feeUgx, enabled: result.zone.enabled },
  });
  return c.json({ success: true, data: result.zone });
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
