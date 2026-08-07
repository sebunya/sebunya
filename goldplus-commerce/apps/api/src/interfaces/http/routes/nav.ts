import { Hono } from 'hono';
import { Registry } from '../../../infrastructure/Registry';

/**
 * Public header/nav routes (0109/0110).
 *
 *  GET  /nav         — the header content the storefront renders (SSR). Short public cache.
 *  POST /nav/events  — per-interaction telemetry (§10). Fire-and-forget, never cached.
 *
 * The visit token (x-gp-visit) is resolved to a server-side profile id only for
 * segment attribution; no identifier is echoed back.
 */
const routes = new Hono();
const registry = Registry.getInstance();

async function profileFrom(c: any): Promise<string | null> {
  const rawVisit = c.req.header('x-gp-visit');
  if (!rawVisit) return null;
  try {
    const profile = await registry.resolveExperienceProfileUseCase.execute(rawVisit);
    return profile?.id ?? null;
  } catch {
    return null;
  }
}

routes.get('/', async (c) => {
  const config = await registry.navContentService.getPublicConfig();
  c.header('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
  return c.json({ success: true, data: { config } });
});

routes.post('/events', async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body) return c.json({ success: false, error: { code: 'BAD_JSON', message: 'Invalid body' } }, 400);
  const profileId = await profileFrom(c);
  const result = await registry.navTelemetryService.capture({
    eventType: String(body.eventType ?? ''),
    itemKey: String(body.itemKey ?? ''),
    position: Number(body.position ?? 0),
    segment: String(body.segment ?? 'unknown'),
    term: body.term != null ? String(body.term) : null,
    profileId,
  });
  c.header('Cache-Control', 'no-store');
  return c.json({ success: true, data: { recorded: result.recorded } });
});

export default routes;
