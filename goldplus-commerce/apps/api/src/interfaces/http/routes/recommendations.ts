import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import { Registry } from '../../../infrastructure/Registry';
import { ApiResponse } from '@goldplus/shared';

/**
 * Public recommendation endpoints. Personalisation uses the first-party
 * visitor id (gp_vid cookie) and, when signed in, the user id — no
 * third-party data. All results are public product DTOs (dealer pricing
 * and unpublished products are never exposed).
 */
const routes = new Hono();
const VISITOR_COOKIE = 'gp_vid';

routes.get('/products/:id', async (c) => {
  const registry = Registry.getInstance();
  const data = await registry.getProductRecommendationsUseCase.execute({
    productId: c.req.param('id'),
    categoryId: c.req.query('categoryId') ?? null,
    limit: parseLimit(c.req.query('limit')),
  });
  const res: ApiResponse<typeof data> = { success: true, data };
  return c.json(res);
});

routes.get('/for-you', async (c) => {
  const registry = Registry.getInstance();
  const visitorId = (getCookie(c, VISITOR_COOKIE) || c.req.query('visitorId') || '').trim() || null;
  const userId = c.req.query('userId')?.trim() || null; // set server-side by trusted callers only

  const data = await registry.getPersonalizedRecommendationsUseCase.execute({
    identity: { userId, visitorId },
    limit: parseLimit(c.req.query('limit')),
  });
  const res: ApiResponse<typeof data> = { success: true, data };
  return c.json(res);
});

routes.get('/trending', async (c) => {
  const registry = Registry.getInstance();
  const data = await registry.getTrendingProductsUseCase.execute({
    limit: parseLimit(c.req.query('limit')),
    categoryId: c.req.query('categoryId') ?? null,
  });
  const res: ApiResponse<typeof data> = { success: true, data };
  return c.json(res);
});

function parseLimit(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const n = parseInt(raw, 10);
  return Number.isNaN(n) ? undefined : n;
}

export default routes;
