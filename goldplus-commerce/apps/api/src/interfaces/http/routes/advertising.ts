import { Hono } from 'hono';
import { Registry } from '../../../infrastructure/Registry';

/**
 * Public: the names of advertising platforms currently RECEIVING data, so the
 * privacy page states exactly what is true today. Names only; nothing else.
 */
const routes = new Hono();
routes.get('/recipients', async (c) => {
  // A failed lookup is an error, never an empty list: "none" would be a false
  // statement on the privacy page (and cacheable at the edge).
  try {
    const r = Registry.getInstance();
    // Conversions (0138) plus customer lists and offline sales (0154).
    const names = [...new Set([...(await r.advertising.recipients()), ...(await r.advertisingOps.recipients())])];
    return c.json({ success: true, data: names }, 200, { 'Cache-Control': 'public, max-age=300' });
  } catch {
    return c.json({ success: false, error: { code: 'UNAVAILABLE', message: 'Recipients could not be read.' } }, 503, { 'Cache-Control': 'no-store' });
  }
});
/**
 * Product catalogue feeds (0154) for Meta Commerce Manager and TikTok
 * Catalogs: public, credential-free (the platform fetches the URL on the
 * schedule the owner sets), built from the same public catalogue and rules as
 * the Google Merchant feed. Never a dealer price, cost or stock count.
 */
const feed = (build: () => Promise<string>, name: string) => async (c: import('hono').Context) => {
  try {
    const body = await build();
    return c.body(body, 200, { 'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'public, max-age=900', 'Content-Disposition': `inline; filename="${name}"` });
  } catch {
    return c.json({ success: false, error: { code: 'UNAVAILABLE', message: 'The catalogue could not be read.' } }, 503, { 'Cache-Control': 'no-store' });
  }
};
routes.get('/feeds/meta-catalogue.csv', feed(() => Registry.getInstance().advertisingOps.feeds.meta(), 'goldplus-meta-catalogue.csv'));
routes.get('/feeds/tiktok-catalogue.csv', feed(() => Registry.getInstance().advertisingOps.feeds.tiktok(), 'goldplus-tiktok-catalogue.csv'));

export default routes;
