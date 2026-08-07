import { Hono } from 'hono';
import { Registry } from '../../../infrastructure/Registry';

/**
 * Public hero content (0107). The storefront reads this server-side to render
 * the slider. No auth: it is the homepage. It never returns zero slides and
 * never returns a dead CTA — the service applies those guard rails — so the
 * caller can render whatever comes back without defending against it.
 *
 * Cache-safe by construction: the response is identical for every visitor
 * (the full enabled library + neutral config). Personalisation happens in the
 * browser after paint, so an edge cache can never leak one visitor's variant.
 */
const routes = new Hono();

routes.get('/', async (c) => {
  const payload = await Registry.getInstance().heroContentService.getPublicPayload();
  // Short shared cache is safe precisely because the payload is visitor-neutral.
  c.header('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
  return c.json({ success: true, data: payload });
});

export default routes;
