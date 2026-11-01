import { Hono } from 'hono';
import { authMiddleware } from '../../middleware/auth';
import { requirePermissions } from '../../middleware/permissions';
import { Registry } from '../../../../infrastructure/Registry';
import { PERMISSIONS } from '@goldplus/shared';
import { logger } from '../../../../infrastructure/logging/logger';

/**
 * Homepage marketing content admin (0114). GET returns the document + version;
 * PUT sanitises and replaces it. Guarded by settings.manage — operator config.
 */
const routes = new Hono();
routes.use('*', authMiddleware);

routes.get('/', requirePermissions([PERMISSIONS.SETTINGS_MANAGE]), async (c) => {
  const data = await Registry.getInstance().homepageContentService.getAdminConfig();
  return c.json({ success: true, data });
});

routes.put('/', requirePermissions([PERMISSIONS.SETTINGS_MANAGE]), async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body.config !== 'object') {
    return c.json({ success: false, error: { code: 'INVALID_JSON', message: 'A config object is required.' } }, 400);
  }
  const actorId = (c.get('user') as { id: string }).id;
  const result = await Registry.getInstance().homepageContentService.updateConfig(body.config, actorId);
  await Registry.getInstance().createAuditLogUseCase.execute({
    actorId,
    action: 'HOMEPAGE_CONTENT_UPDATED',
    entity: 'homepage_content',
    entityId: 'global',
    previousState: null,
    newState: { version: result.version },
  });
  return c.json({ success: true, data: { version: result.version } });
});

/**
 * Ambassadors & models section. GET returns every entry (drafts included) for the
 * editor; PUT replaces only this section and answers 422 with per-field messages
 * when anything is wrong — nothing is half-saved.
 */
routes.get('/ambassadors', requirePermissions([PERMISSIONS.SETTINGS_MANAGE]), async (c) => {
  const data = await Registry.getInstance().homepageContentService.getAmbassadorsAdmin();
  return c.json({ success: true, data });
});

routes.put('/ambassadors', requirePermissions([PERMISSIONS.SETTINGS_MANAGE]), async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body.ambassadors !== 'object' || body.ambassadors === null || Array.isArray(body.ambassadors)) {
    return c.json({ success: false, error: { code: 'INVALID_JSON', message: 'An ambassadors object is required.' } }, 400);
  }
  const actorId = (c.get('user') as { id: string }).id;
  // Required by the service: without it nothing is replaced (answered as a 409 carrying the current revision).
  const expectedRevision = typeof body.expectedRevision === 'string' ? body.expectedRevision : undefined;
  const result = await Registry.getInstance().homepageContentService.updateAmbassadors(body.ambassadors, actorId, expectedRevision);
  if (!result.ok && 'conflict' in result) {
    return c.json({ success: false, error: { code: 'STALE_REVISION', message: 'Someone else saved this section after you opened it.', currentRevision: result.currentRevision } }, 409);
  }
  if (!result.ok) {
    return c.json({ success: false, error: { code: 'AMBASSADORS_INVALID', message: 'Some entries need attention.', fields: result.errors } }, 422);
  }
  if (result.usagesPending) {
    logger.warn({ version: result.version }, '[homepage] ambassadors saved; stale media usages not yet removed (they only over-protect)');
  }
  try {
    await Registry.getInstance().createAuditLogUseCase.execute({
      actorId,
      action: 'HOMEPAGE_AMBASSADORS_UPDATED',
      entity: 'homepage_content',
      entityId: 'global',
      // Consent evidence, by NAME as well as id: the document keeps no history, so this
      // row is where "who was on the page, with which release record" survives removal.
      previousState: { people: result.previous },
      newState: { version: result.version, ...result.changes },
    });
  } catch (err) {
    // The section is already live; failing the request would tell the editor "nothing
    // was saved" and its retry would meet a false conflict. Log loudly instead.
    logger.error({ err: (err as Error).message, version: result.version }, '[homepage] ambassadors saved but the audit row could not be written');
  }
  return c.json({ success: true, data: { version: result.version } });
});

export default routes;
