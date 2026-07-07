import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import { Registry } from '../../../infrastructure/Registry';
import { ApiResponse } from '@goldplus/shared';

/**
 * Public recommendation endpoints.
 *
 * Identity rules (privacy-safe):
 *  - userId is NEVER taken from a query param. It is derived only from a
 *    verified session token (Authorization: Bearer <session jwt>).
 *  - The anonymous visitor id comes only from the first-party gp_vid cookie.
 *  - Personalisation consent is honoured (gp_consent cookie / GPC / DNT).
 * All results are public product DTOs — dealer pricing and unpublished
 * products never leak.
 */
const routes = new Hono();
const VISITOR_COOKIE = 'gp_vid';
const CONSENT_COOKIE = 'gp_consent';

function parseLimit(raw: string | undefined, fallback: number, max: number): number {
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.max(1, Math.min(n, max));
}

/** userId strictly from a verified session token — never from the query. */
async function resolveUserId(c: any): Promise<string | null> {
  const header = c.req.header('authorization') || c.req.header('Authorization');
  const token = header && header.startsWith('Bearer ') ? header.slice(7).trim() : null;
  if (!token) return null;
  const verified = await Registry.getInstance().tokenSigner.verify(token);
  if (!verified || verified.scope !== 'session') return null;
  return verified.subject;
}

function personalizationConsent(c: any): boolean {
  // Explicit opt-out signals win.
  if ((c.req.header('sec-gpc') || '').trim() === '1') return false;
  if ((c.req.header('dnt') || '').trim() === '1') return false;
  const cookie = (getCookie(c, CONSENT_COOKIE) || '').toLowerCase();
  if (cookie === 'deny' || cookie === 'reject' || cookie === 'off') return false;
  return true;
}

routes.get('/products/:id', async (c) => {
  const data = await Registry.getInstance().getProductRecommendationsUseCase.execute({
    productId: c.req.param('id'),
    categoryId: c.req.query('categoryId') ?? null,
    limit: parseLimit(c.req.query('limit'), 8, 20),
  });
  const res: ApiResponse<typeof data> = { success: true, data };
  return c.json(res);
});

routes.get('/for-you', async (c) => {
  const registry = Registry.getInstance();
  const userId = await resolveUserId(c);
  const visitorId = (getCookie(c, VISITOR_COOKIE) || '').trim() || null;

  const data = await registry.getPersonalizedRecommendationsUseCase.execute({
    identity: { userId, visitorId },
    limit: parseLimit(c.req.query('limit'), 12, 30),
    consent: { personalization: personalizationConsent(c) },
  });
  const res: ApiResponse<typeof data> = { success: true, data };
  return c.json(res);
});

routes.get('/trending', async (c) => {
  const data = await Registry.getInstance().getTrendingProductsUseCase.execute({
    strategy: 'trending',
    limit: parseLimit(c.req.query('limit'), 8, 20),
    categoryId: c.req.query('categoryId') ?? null,
  });
  const res: ApiResponse<typeof data> = { success: true, data };
  return c.json(res);
});

routes.get('/bestsellers', async (c) => {
  const data = await Registry.getInstance().getTrendingProductsUseCase.execute({
    strategy: 'bestseller',
    limit: parseLimit(c.req.query('limit'), 8, 20),
    categoryId: c.req.query('categoryId') ?? null,
  });
  const res: ApiResponse<typeof data> = { success: true, data };
  return c.json(res);
});

routes.get('/new-arrivals', async (c) => {
  const data = await Registry.getInstance().getTrendingProductsUseCase.execute({
    strategy: 'new_arrival',
    limit: parseLimit(c.req.query('limit'), 8, 20),
    categoryId: c.req.query('categoryId') ?? null,
  });
  const res: ApiResponse<typeof data> = { success: true, data };
  return c.json(res);
});

export default routes;
