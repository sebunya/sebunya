import { Hono } from 'hono';
import { Registry } from '../../../infrastructure/Registry';
import { HERO_SLIDE_LIBRARY } from '@goldplus/shared';

/**
 * Public hero routes (0107/0108).
 *
 *  GET  /hero          — the slides + settings the storefront renders (SSR).
 *  GET  /hero/signals  — per-visitor ENHANCEMENT signals, resolved from the
 *                        server profile. Fetched after paint; never cached.
 *  POST /hero/events   — per-slide impression/click capture. Fire-and-forget.
 *
 * The content payload is visitor-NEUTRAL and short-cached; signals are private
 * and never cached — that split is what keeps the edge-cached homepage safe.
 */
const routes = new Hono();
const registry = Registry.getInstance();

async function profileFrom(c: any): Promise<string | null> {
  const rawVisit = c.req.header('x-gp-visit');
  if (!rawVisit) return null;
  try {
    const profile = await registry.resolveExperienceProfileUseCase.execute(rawVisit);
    return profile?.id ?? null;
  } catch { return null; }
}

const heroProductSlugs = (): string[] =>
  HERO_SLIDE_LIBRARY
    .map((s) => (s.imageUrl.match(/\/products\/([a-z0-9-]+)\.webp/i) || [])[1])
    .filter(Boolean) as string[];

routes.get('/', async (c) => {
  const payload = await registry.heroContentService.getPublicPayload();
  c.header('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
  return c.json({ success: true, data: payload });
});

// Per-visitor, server-personalised hero (2026-08-07). Selection + enrichment run
// here from the profile — the storefront renders the result and the browser only
// rotates. Personalisation runs for every visitor; there is no consent gate.
// Per-visitor output → MUST NOT be shared-cached.
routes.get('/personalised', async (c) => {
  const profileId = await profileFrom(c);
  const signals = await registry.heroSignalsService.getSignals(profileId, heroProductSlugs());
  const cartItems = Number(c.req.query('cart') ?? '0');
  const referred = c.req.query('ref') === '1';
  const force = c.req.query('force') || null;
  const payload = await registry.heroContentService.buildPersonalisedPayload(signals, {
    cartItems: Number.isFinite(cartItems) ? cartItems : 0,
    referred,
    now: new Date(),
    force,
  });
  c.header('Cache-Control', 'private, no-store');
  return c.json({ success: true, data: payload });
});

// Retained for compatibility; the storefront now personalises server-side via
// /hero/personalised and no longer fetches this after paint.
routes.get('/signals', async (c) => {
  const profileId = await profileFrom(c);
  const signals = await registry.heroSignalsService.getSignals(profileId, heroProductSlugs());
  // Per-visitor: MUST NOT be shared-cached, or one visitor's signals leak.
  c.header('Cache-Control', 'private, no-store');
  return c.json({ success: true, data: signals });
});

routes.post('/events', async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body) return c.json({ success: false, error: { code: 'BAD_JSON', message: 'Invalid body' } }, 400);
  const profileId = await profileFrom(c);
  const result = await registry.heroTelemetryService.capture({
    eventType: String(body.eventType ?? ''),
    slideKey: String(body.slideKey ?? ''),
    position: Number(body.position ?? 0),
    segment: String(body.segment ?? 'unknown'),
    profileId,
  });
  c.header('Cache-Control', 'no-store');
  return c.json({ success: true, data: { recorded: result.recorded } });
});

export default routes;
