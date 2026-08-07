import { Hono } from 'hono';
import { authMiddleware } from '../../middleware/auth';
import { requirePermissions } from '../../middleware/permissions';
import { Registry } from '../../../../infrastructure/Registry';
import { PERMISSIONS } from '@goldplus/shared';

/**
 * Header/nav CMS admin (0109). READ returns the whole config with its validation
 * state + the telemetry report; MANAGE replaces the document. The save is REFUSED
 * (422) if the WHOLE config would be invalid — the guard rails run here,
 * server-side, so a broken header cannot ship from the editor.
 */
const routes = new Hono();
routes.use('*', authMiddleware);

routes.get('/', requirePermissions([PERMISSIONS.NAV_READ]), async (c) => {
  const data = await Registry.getInstance().navContentService.getAdminConfig();
  return c.json({ success: true, data });
});

routes.put('/', requirePermissions([PERMISSIONS.NAV_MANAGE]), async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body.config !== 'object') {
    return c.json({ success: false, error: { code: 'INVALID_JSON', message: 'A config object is required.' } }, 400);
  }
  const actorId = (c.get('user') as { id: string }).id;
  const result = await Registry.getInstance().navContentService.updateConfig(body.config, actorId);
  if (!result.ok) {
    return c.json({ success: false, error: { code: 'INVALID_CONFIG', message: 'The header would break.', details: result.errors } }, 422);
  }
  await Registry.getInstance().createAuditLogUseCase.execute({
    actorId, action: 'NAV_CONFIG_UPDATED', entity: 'nav_config', entityId: 'global',
    previousState: null, newState: { version: result.version },
  });
  return c.json({ success: true, data: { version: result.version } });
});

routes.get('/report', requirePermissions([PERMISSIONS.NAV_READ]), async (c) => {
  const windowDays = Math.min(365, Math.max(1, Number(c.req.query('windowDays')) || 30));
  const report = await Registry.getInstance().navTelemetryService.report(windowDays);
  return c.json({ success: true, data: report });
});

export default routes;
