import { Hono } from 'hono';
import { Registry } from '../../../infrastructure/Registry';
import { ApiResponse } from '@goldplus/shared';

/** Public read-only CMS content. Only PUBLISHED pages inside their
 *  publish/expire window are returned; everything else is a 404. */
const routes = new Hono();

routes.get('/sitemap', async (c) => {
  const data = await Registry.getInstance().listPublishedCmsSlugsUseCase.execute();
  const res: ApiResponse<typeof data> = { success: true, data };
  return c.json(res);
});

routes.get('/pages/:slug', async (c) => {
  const page = await Registry.getInstance().getPublishedCmsPageUseCase.execute(c.req.param('slug'));
  if (!page) {
    const res: ApiResponse<never> = { success: false, error: { code: 'NOT_FOUND', message: 'Page not found.' } };
    return c.json(res, 404);
  }
  const res: ApiResponse<typeof page> = { success: true, data: page };
  return c.json(res);
});

export default routes;
