import { Hono } from 'hono';
import { authMiddleware } from '../../middleware/auth';
import { requirePermissions } from '../../middleware/permissions';
import { Registry } from '../../../../infrastructure/Registry';
import { CreateAuditLogUseCase } from '../../../../application/use-cases/audit/CreateAuditLogUseCase';
import { ApiResponse, PERMISSIONS } from '@goldplus/shared';

/**
 * Slice 5: admin CRUD for declared product compatibility mappings.
 * Catalogue truth -> products.write; every mutation audited.
 */
const routes = new Hono();
routes.use('*', authMiddleware);

routes.get('/', requirePermissions([PERMISSIONS.PRODUCTS_READ]), async (c) => {
  const data = await Registry.getInstance().listCompatibilityMappingsUseCase.execute();
  const res: ApiResponse<typeof data> = { success: true, data };
  return c.json(res);
});

routes.put('/', requirePermissions([PERMISSIONS.PRODUCTS_WRITE]), async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body) {
    return c.json({ success: false, error: { code: 'BAD_JSON', message: 'Body must be JSON.' } } satisfies ApiResponse<never>, 400);
  }
  const registry = Registry.getInstance();
  const result = await registry.upsertCompatibilityMappingUseCase.execute(body);
  if (!result.ok) {
    return c.json({ success: false, error: { code: result.code, message: result.message } } satisfies ApiResponse<never>, 400);
  }
  await new CreateAuditLogUseCase(registry.auditRepo).execute({
    actorId: (c.get('user') as any).id,
    action: 'COMPATIBILITY_MAPPING_UPSERTED',
    entity: 'product_compatibility',
    entityId: result.mapping.id,
    newState: {
      productId: result.mapping.productId,
      targetProductId: result.mapping.targetProductId,
      verdict: result.mapping.verdict,
      enabled: result.mapping.enabled,
    },
  });
  const res: ApiResponse<typeof result.mapping> = { success: true, data: result.mapping };
  return c.json(res);
});

routes.delete('/:id', requirePermissions([PERMISSIONS.PRODUCTS_WRITE]), async (c) => {
  const id = String(c.req.param('id') ?? '');
  const registry = Registry.getInstance();
  const result = await registry.deleteCompatibilityMappingUseCase.execute(id);
  if (!result.ok) {
    return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Mapping not found.' } } satisfies ApiResponse<never>, 404);
  }
  await new CreateAuditLogUseCase(registry.auditRepo).execute({
    actorId: (c.get('user') as any).id,
    action: 'COMPATIBILITY_MAPPING_DELETED',
    entity: 'product_compatibility',
    entityId: id,
  });
  return c.json({ success: true, data: { deleted: true } });
});

export default routes;
