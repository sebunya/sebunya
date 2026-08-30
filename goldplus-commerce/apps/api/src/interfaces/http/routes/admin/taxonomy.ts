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
    const registry = Registry.getInstance();
    const result = await registry.taxonomyService.updateConfig(body.config, actorId);

    // A category the shop browses by that no product can be FILED into is a
    // dead end: the storefront reads this taxonomy, but the product form can
    // only offer categories that exist as rows. Saving the taxonomy therefore
    // creates the missing rows, so the two lists cannot drift apart again.
    // Additive only — it never renames or removes a row products point at.
    let categoriesCreated: string[] = [];
    try {
      const { config } = await registry.taxonomyService.getAdminConfig();
      categoriesCreated = await registry.productRepo.ensureCategories(
        config.map((category) => ({ name: category.name, slug: category.slug })),
      );
    } catch {
      // The taxonomy itself saved; a filing row can be added later. Never fail
      // the operator's save over this.
    }
    await registry.createAuditLogUseCase.execute({
      actorId,
      action: 'TAXONOMY_UPDATED',
      entity: 'taxonomy_config',
      entityId: 'global',
      previousState: null,
      newState: { version: result.version, categoriesCreated },
    });
    return c.json({ success: true, data: { version: result.version, categoriesCreated } });
  } catch (e) {
    return c.json({ success: false, error: { code: 'INVALID_TAXONOMY', message: e instanceof Error ? e.message : 'Invalid taxonomy.' } }, 400);
  }
});

export default routes;
