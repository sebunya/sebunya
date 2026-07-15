import { Hono } from 'hono';
import { authMiddleware } from '../../middleware/auth';
import { requirePermissions } from '../../middleware/permissions';
import { Registry } from '../../../../infrastructure/Registry';
import { CreateAuditLogUseCase } from '../../../../application/use-cases/audit/CreateAuditLogUseCase';
import { ApiResponse, PERMISSIONS } from '@goldplus/shared';

/**
 * Slice 8: loyalty programme administration. Config edits are preparation
 * only — customer-facing activation additionally requires the
 * LOYALTY_PROGRAMME_ENABLED environment flag, which stays off.
 */
const routes = new Hono();
routes.use('*', authMiddleware);

routes.get('/config', requirePermissions([PERMISSIONS.SETTINGS_MANAGE]), async (c) => {
  const registry = Registry.getInstance();
  const config = await registry.getLoyaltyConfigUseCase.execute();
  const envFlag = process.env.LOYALTY_PROGRAMME_ENABLED === 'true';
  return c.json({ success: true, data: { ...config, envFlag, active: envFlag && config.enabled } });
});

routes.put('/config', requirePermissions([PERMISSIONS.SETTINGS_MANAGE]), async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body) {
    return c.json({ success: false, error: { code: 'BAD_JSON', message: 'Body must be JSON.' } } satisfies ApiResponse<never>, 400);
  }
  const registry = Registry.getInstance();
  const result = await registry.saveLoyaltyConfigUseCase.execute(body);
  if (!result.ok) {
    return c.json({ success: false, error: { code: result.code, message: result.message } } satisfies ApiResponse<never>, 400);
  }
  await new CreateAuditLogUseCase(registry.auditRepo).execute({
    actorId: (c.get('user') as any).id,
    action: 'LOYALTY_CONFIG_SAVED',
    entity: 'loyalty_config',
    entityId: 'singleton',
    newState: { ...result.value },
  });
  return c.json({ success: true, data: result.value });
});

routes.post('/entries/:id/reverse', requirePermissions([PERMISSIONS.SETTINGS_MANAGE]), async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const registry = Registry.getInstance();
  const result = await registry.reverseLoyaltyEntryUseCase.execute({
    entryId: String(c.req.param('id') ?? ''),
    reason: String(body?.reason ?? ''),
  });
  if (!result.ok) {
    return c.json({ success: false, error: { code: result.code, message: result.message } } satisfies ApiResponse<never>, result.code === 'NOT_FOUND' ? 404 : 400);
  }
  await new CreateAuditLogUseCase(registry.auditRepo).execute({
    actorId: (c.get('user') as any).id,
    action: 'LOYALTY_ENTRY_REVERSED',
    entity: 'loyalty_ledger_entry',
    entityId: result.value.id,
    newState: { reversedEntryId: result.value.reversedEntryId, points: result.value.points },
  });
  return c.json({ success: true, data: result.value });
});

export default routes;
