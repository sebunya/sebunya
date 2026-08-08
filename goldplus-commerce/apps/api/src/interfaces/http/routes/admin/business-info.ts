import { Hono } from 'hono';
import { authMiddleware } from '../../middleware/auth';
import { requirePermissions } from '../../middleware/permissions';
import { Registry } from '../../../../infrastructure/Registry';
import { PERMISSIONS } from '@goldplus/shared';

/**
 * Business/contact info admin (0112). GET returns the document + version; PUT
 * merges the submitted fields over the current document, sanitises and persists.
 * Guarded by settings.manage — it is operator config, not customer data.
 */
const routes = new Hono();
routes.use('*', authMiddleware);

routes.get('/', requirePermissions([PERMISSIONS.SETTINGS_MANAGE]), async (c) => {
  const data = await Registry.getInstance().businessInfoService.getAdminConfig();
  return c.json({ success: true, data });
});

routes.put('/', requirePermissions([PERMISSIONS.SETTINGS_MANAGE]), async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body.config !== 'object') {
    return c.json({ success: false, error: { code: 'INVALID_JSON', message: 'A config object is required.' } }, 400);
  }
  const actorId = (c.get('user') as { id: string }).id;
  const result = await Registry.getInstance().businessInfoService.updateConfig(body.config, actorId);
  await Registry.getInstance().createAuditLogUseCase.execute({
    actorId,
    action: 'BUSINESS_INFO_UPDATED',
    entity: 'business_info',
    entityId: 'global',
    previousState: null,
    newState: { version: result.version },
  });
  return c.json({ success: true, data: { version: result.version } });
});

export default routes;
