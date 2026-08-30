import { Hono } from 'hono';
import { Registry } from '../../../infrastructure/Registry';
import { ApiResponse } from '@goldplus/shared';

/**
 * Public blog (0126). Read-only and unauthenticated: only PUBLISHED articles
 * are reachable, enforced in the repository rather than by a caller remembering
 * to pass a flag.
 */
const routes = new Hono();

routes.get('/', async (c) => {
  const limit = Number.parseInt(c.req.query('limit') ?? '20', 10);
  const offset = Number.parseInt(c.req.query('offset') ?? '0', 10);
  const data = await Registry.getInstance().listPublishedPostsUseCase.execute({
    limit: Number.isFinite(limit) ? limit : 20,
    offset: Number.isFinite(offset) ? offset : 0,
  });
  const res: ApiResponse<typeof data> = { success: true, data };
  return c.json(res);
});

routes.get('/:slug', async (c) => {
  const post = await Registry.getInstance().getPublishedPostUseCase.execute(c.req.param('slug') ?? '');
  if (!post) {
    const res: ApiResponse<never> = { success: false, error: { code: 'NOT_FOUND', message: 'Article not found.' } };
    return c.json(res, 404);
  }
  const res: ApiResponse<typeof post> = { success: true, data: post };
  return c.json(res);
});

export default routes;
