import { Hono } from 'hono';
import { authMiddleware } from '../../middleware/auth';
import { requirePermissions } from '../../middleware/permissions';
import { Registry } from '../../../../infrastructure/Registry';
import { PERMISSIONS } from '@goldplus/shared';

/**
 * Product discovery taxonomy admin (0113). GET returns the document + version;
 * PUT validates and replaces the whole tree. Guarded by settings.manage — it is
 * operator config, not customer data.
 */
const routes = new Hono();
routes.use('*', authMiddleware);

routes.get('/', requirePermissions([PERMISSIONS.SETTINGS_MANAGE]), async (c) => {
  const data = await Registry.getInstance().taxonomyService.getAdminConfig();
  return c.json({ success: true, data });
});

routes.put('/', requirePermissions([PERMISSIONS.SETTINGS_MANAGE]), async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body || !Array.isArray(body.config)) {
    return c.json({ success: false, error: { code: 'INVALID_JSON', message: 'A config array is required.' } }, 400);
  }
  const actorId = (c.get('user') as { id: string }).id;
  try {
    const result = await Registry.getInstance().taxonomyService.updateConfig(body.config, actorId);
    await Registry.getInstance().createAuditLogUseCase.execute({
      actorId,
      action: 'TAXONOMY_UPDATED',
      entity: 'taxonomy_config',
      entityId: 'global',
      previousState: null,
      newState: { version: result.version },
    });
    return c.json({ success: true, data: { version: result.version } });
  } catch (e) {
    return c.json({ success: false, error: { code: 'INVALID_TAXONOMY', message: e instanceof Error ? e.message : 'Invalid taxonomy.' } }, 400);
  }
});

export default routes;
