import { Hono } from 'hono';
import { authMiddleware } from '../../middleware/auth';
import { requirePermissions } from '../../middleware/permissions';
import { Registry } from '../../../../infrastructure/Registry';
import { PERMISSIONS } from '@goldplus/shared';

/**
 * Storefront copy admin (0115). GET returns the document + version; PUT sanitises
 * and replaces it. Guarded by settings.manage — operator config.
 */
const routes = new Hono();
routes.use('*', authMiddleware);

routes.get('/', requirePermissions([PERMISSIONS.SETTINGS_MANAGE]), async (c) => {
  const data = await Registry.getInstance().storefrontCopyService.getAdminConfig();
  return c.json({ success: true, data });
});

routes.put('/', requirePermissions([PERMISSIONS.SETTINGS_MANAGE]), async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body.config !== 'object') {
    return c.json({ success: false, error: { code: 'INVALID_JSON', message: 'A config object is required.' } }, 400);
  }
  const actorId = (c.get('user') as { id: string }).id;
  const result = await Registry.getInstance().storefrontCopyService.updateConfig(body.config, actorId);
  await Registry.getInstance().createAuditLogUseCase.execute({
    actorId,
    action: 'STOREFRONT_COPY_UPDATED',
    entity: 'storefront_copy',
    entityId: 'global',
    previousState: null,
    newState: { version: result.version },
  });
  return c.json({ success: true, data: { version: result.version } });
});

export default routes;
