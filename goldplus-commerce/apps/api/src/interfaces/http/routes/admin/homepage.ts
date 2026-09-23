import { Hono } from 'hono';
import { authMiddleware } from '../../middleware/auth';
import { requirePermissions } from '../../middleware/permissions';
import { Registry } from '../../../../infrastructure/Registry';
import { PERMISSIONS } from '@goldplus/shared';

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
  if (!body || typeof body.ambassadors !== 'object' || body.ambassadors === null) {
    return c.json({ success: false, error: { code: 'INVALID_JSON', message: 'An ambassadors object is required.' } }, 400);
  }
  const actorId = (c.get('user') as { id: string }).id;
  const expectedRevision = typeof body.expectedRevision === 'string' ? body.expectedRevision : undefined;
  const result = await Registry.getInstance().homepageContentService.updateAmbassadors(body.ambassadors, actorId, expectedRevision);
  if (!result.ok && 'conflict' in result) {
    return c.json({ success: false, error: { code: 'STALE_REVISION', message: 'Someone else saved this section after you opened it.', currentRevision: result.currentRevision } }, 409);
  }
  if (!result.ok) {
    return c.json({ success: false, error: { code: 'AMBASSADORS_INVALID', message: 'Some entries need attention.', fields: result.errors } }, 422);
  }
  const people = Array.isArray(body.ambassadors.people) ? body.ambassadors.people : [];
  await Registry.getInstance().createAuditLogUseCase.execute({
    actorId,
    action: 'HOMEPAGE_AMBASSADORS_UPDATED',
    entity: 'homepage_content',
    entityId: 'global',
    previousState: null,
    // Consent evidence: which people had a signed photo release confirmed or withdrawn, by this actor, now.
    newState: { version: result.version, people: people.length, published: people.filter((p: any) => p?.published === true).length, releasesConfirmed: result.releasesConfirmed, releasesWithdrawn: result.releasesWithdrawn },
  });
  return c.json({ success: true, data: { version: result.version } });
});

export default routes;
