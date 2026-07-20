import { Hono } from 'hono';
import { authMiddleware } from '../../middleware/auth';
import { requirePermissions } from '../../middleware/permissions';
import { Registry } from '../../../../infrastructure/Registry';
import { CreateAuditLogUseCase } from '../../../../application/use-cases/audit/CreateAuditLogUseCase';
import { ApiResponse, PERMISSIONS } from '@goldplus/shared';

// Audit entity ids are uuids; the loyalty config is a singleton, so it gets a
// fixed, well-known uuid rather than a free-text marker.
const LOYALTY_CONFIG_AUDIT_ID = '00000000-0000-4000-8000-00000000106a';

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

routes.get('/operations', requirePermissions([PERMISSIONS.SETTINGS_MANAGE]), async (c) => {
  const limit = Number(c.req.query('limit') ?? 50);
  const data = await Registry.getInstance().getLoyaltyOperationsUseCase.execute({
    limit: Number.isInteger(limit) ? limit : 50,
  });
  return c.json({ success: true, data });
});

routes.post('/accounts/:id/expire', requirePermissions([PERMISSIONS.SETTINGS_MANAGE]), async (c) => {
  const registry = Registry.getInstance();
  const accountId = String(c.req.param('id') ?? '');
  const entries = await registry.expireLoyaltyPointsUseCase.execute({ accountId });
  for (const entry of entries) {
    await new CreateAuditLogUseCase(registry.auditRepo).execute({
      actorId: (c.get('user') as any).id,
      action: 'LOYALTY_POINTS_EXPIRED',
      entity: 'loyalty_ledger_entry',
      entityId: entry.id,
      newState: { accountId: entry.accountId, points: entry.points, sourceEntryId: entry.reversedEntryId },
    });
  }
  return c.json({ success: true, data: { expiredCount: entries.length, entries } });
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
    entityId: LOYALTY_CONFIG_AUDIT_ID,
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
