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
    const names = await Registry.getInstance().advertising.recipients();
    return c.json({ success: true, data: names }, 200, { 'Cache-Control': 'public, max-age=300' });
  } catch {
    return c.json({ success: false, error: { code: 'UNAVAILABLE', message: 'Recipients could not be read.' } }, 503, { 'Cache-Control': 'no-store' });
  }
});
export default routes;
