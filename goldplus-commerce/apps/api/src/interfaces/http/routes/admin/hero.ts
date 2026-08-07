import { Hono } from 'hono';
import { authMiddleware } from '../../middleware/auth';
import { requirePermissions } from '../../middleware/permissions';
import { Registry } from '../../../../infrastructure/Registry';
import { PERMISSIONS } from '@goldplus/shared';
import { validateHeroSlide } from '../../../../domain/hero/HeroSlideValidation';
import type { HeroSlideSeed } from '../../../../domain/hero/HeroSlideLibrary';

/**
 * Hero slider admin (0107). READ shows the whole library with its validation
 * state; MANAGE edits a slide or the global settings. A save is REFUSED if it
 * would leave the slide invalid — the guard rails run here, server-side, so a
 * broken homepage cannot be shipped from the editor.
 *
 * slide_key is never accepted from the body: the key is locked.
 */
const routes = new Hono();
routes.use('*', authMiddleware);

routes.get('/', requirePermissions([PERMISSIONS.HERO_READ]), async (c) => {
  const data = await Registry.getInstance().heroContentService.getAdminPayload();
  return c.json({ success: true, data });
});

const SLIDE_FIELDS: Array<keyof HeroSlideSeed> = [
  'enabled', 'theme', 'tint', 'media', 'position', 'priority',
  'kicker', 'headline', 'subcopy', 'ctaLabel', 'ctaUrl', 'finePrint', 'imageUrl', 'imageAlt', 'extras',
];

routes.put('/slides/:key', requirePermissions([PERMISSIONS.HERO_MANAGE]), async (c) => {
  const key = String(c.req.param('key'));
  const body = await c.req.json().catch(() => null);
  if (!body) return c.json({ success: false, error: { code: 'INVALID_JSON', message: 'Invalid body' } }, 400);

  // Take only known fields; slide_key is locked and ignored if sent.
  const patch: Partial<HeroSlideSeed> = {};
  for (const f of SLIDE_FIELDS) if (body[f] !== undefined) (patch as any)[f] = body[f];

  // Validate the MERGED slide, not the patch alone — an edit that clears the
  // headline on an enabled slide must fail even though the patch looks small.
  const current = (await Registry.getInstance().heroContentService.getAdminPayload()).slides.find((s) => s.slideKey === key);
  if (!current) return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'No slide with that key.' } }, 404);
  const merged = { ...current, ...patch, slideKey: key } as HeroSlideSeed;
  const errors = validateHeroSlide(merged);
  if (errors.length > 0) {
    return c.json({ success: false, error: { code: 'INVALID_SLIDE', message: 'The slide would break the homepage.', details: errors } }, 422);
  }

  const updated = await Registry.getInstance().heroRepo.updateSlide(key, patch, (c.get('user') as { id: string }).id);
  await Registry.getInstance().createAuditLogUseCase.execute({
    actorId: (c.get('user') as { id: string }).id,
    action: 'HERO_SLIDE_UPDATED',
    entity: 'hero_slide',
    entityId: key,
    previousState: { enabled: current.enabled, headline: current.headline, ctaUrl: current.ctaUrl },
    newState: { fields: Object.keys(patch) },
  });
  return c.json({ success: true, data: { slide: updated } });
});

routes.put('/settings', requirePermissions([PERMISSIONS.HERO_MANAGE]), async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body) return c.json({ success: false, error: { code: 'INVALID_JSON', message: 'Invalid body' } }, 400);

  const patch: { slidesShown?: number; dwellMs?: number; autoplay?: boolean } = {};
  if (body.slidesShown !== undefined) {
    const n = Number(body.slidesShown);
    if (!Number.isInteger(n) || n < 1 || n > 8) return c.json({ success: false, error: { code: 'INVALID', message: 'slidesShown must be 1–8.' } }, 400);
    patch.slidesShown = n;
  }
  if (body.dwellMs !== undefined) {
    const n = Number(body.dwellMs);
    if (!Number.isInteger(n) || n < 2000 || n > 20000) return c.json({ success: false, error: { code: 'INVALID', message: 'dwellMs must be 2000–20000.' } }, 400);
    patch.dwellMs = n;
  }
  if (body.autoplay !== undefined) patch.autoplay = Boolean(body.autoplay);

  const settings = await Registry.getInstance().heroRepo.updateSettings(patch, (c.get('user') as { id: string }).id);
  await Registry.getInstance().createAuditLogUseCase.execute({
    actorId: (c.get('user') as { id: string }).id,
    action: 'HERO_SETTINGS_UPDATED', entity: 'hero_settings', entityId: 'global',
    previousState: null, newState: patch,
  });
  return c.json({ success: true, data: { settings } });
});

export default routes;
