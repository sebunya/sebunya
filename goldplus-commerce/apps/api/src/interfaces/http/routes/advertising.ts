import { Hono } from 'hono';
import { Registry } from '../../../infrastructure/Registry';

/**
 * Public: the names of advertising platforms currently RECEIVING data, so the
 * privacy page states exactly what is true today. Names only; nothing else.
 */
const routes = new Hono();
routes.get('/recipients', async (c) => {
  const names = await Registry.getInstance().advertising.recipients().catch(() => [] as string[]);
  return c.json({ success: true, data: names }, 200, { 'Cache-Control': 'public, max-age=300' });
});
export default routes;
