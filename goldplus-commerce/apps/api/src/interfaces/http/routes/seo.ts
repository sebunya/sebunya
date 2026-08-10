import { Hono } from 'hono';
import { Registry } from '../../../infrastructure/Registry';
import { ApiResponse } from '@goldplus/shared';
import { buildMerchantFeedXml } from '../../../application/use-cases/seo-growth/MerchantFeedUseCase';

/**
 * U6 — public SEO endpoints. Thin routes over Registry.seoRepo:
 *  - GET /resolve-redirect?path=…  → the redirects table (slug-change 301s),
 *    consumed by the storefront's 404 handling before it gives up.
 *  - GET /sitemap/products         → every APPROVED ACTIVE product with its real
 *    updated_at for <lastmod>, consumed by /sitemaps/products.xml.
 */
const routes = new Hono<{ Variables: { requestId: string } }>();

/**
 * The redirects table stores product slug changes under the canonical short
 * path form `/p/<slug>` (see DrizzleSeoRepository.recordSlugChange), while the
 * storefront serves products at `/products/<slug>`. Translate both ways here so
 * the storefront can ask with the URL it actually 404'd on.
 */
const toStoredPath = (p: string) => (p.startsWith('/products/') ? `/p/${p.slice('/products/'.length)}` : p);
const toPublicPath = (p: string) => (p.startsWith('/p/') ? `/products/${p.slice('/p/'.length)}` : p);

routes.get('/resolve-redirect', async (c) => {
  const raw = c.req.query('path') ?? '';
  const path = raw.trim();
  if (!path.startsWith('/') || path.length > 1024) {
    const res: ApiResponse<never> = { success: false, error: { code: 'INVALID_PATH', message: 'path must be an absolute path.' } };
    return c.json(res, 400);
  }
  const registry = Registry.getInstance();
  const now = new Date();
  // Exact match first (manually created redirects), then the stored /p/ form.
  const hit =
    (await registry.seoRepo.resolveRedirect(path, now)) ??
    (toStoredPath(path) !== path ? await registry.seoRepo.resolveRedirect(toStoredPath(path), now) : null);
  if (!hit) {
    const res: ApiResponse<never> = { success: false, error: { code: 'NOT_FOUND', message: 'No redirect for that path.' } };
    return c.json(res, 404);
  }
  const res: ApiResponse<{ to: string; statusCode: number }> = {
    success: true,
    data: { to: toPublicPath(hit.toPath), statusCode: hit.statusCode },
  };
  return c.json(res);
});

routes.get('/sitemap/products', async (c) => {
  const registry = Registry.getInstance();
  const items: Array<{ slug: string; updatedAt: string }> = [];
  const PAGE = 1000;
  // Enumerate the whole approved+active catalogue — the repo paginates, the
  // sitemap wants everything (bounded by the sitemap-spec 50k URL ceiling).
  for (let offset = 0; offset < 50_000; offset += PAGE) {
    const page = await registry.seoRepo.sitemapProducts(offset, PAGE);
    for (const p of page) items.push({ slug: p.slug, updatedAt: p.updatedAt.toISOString() });
    if (page.length < PAGE) break;
  }
  c.header('Cache-Control', 'public, max-age=900');
  const res: ApiResponse<typeof items> = { success: true, data: items };
  return c.json(res);
});

/**
 * Google Merchant Center product feed — live, credential-free (Merchant Center
 * fetches this URL on a schedule). Real catalogue data only; inclusion rules
 * and XML shape live in MerchantFeedUseCase. Cached in-process for 15 minutes.
 */
let feedCache: { xml: string; builtAt: number } | null = null;
const FEED_TTL_MS = 15 * 60 * 1000;

routes.get('/merchant-feed.xml', async (c) => {
  const now = Date.now();
  if (!feedCache || now - feedCache.builtAt > FEED_TTL_MS) {
    const products = await Registry.getInstance().seoGrowthRepo.feedProducts();
    feedCache = { xml: buildMerchantFeedXml(products), builtAt: now };
  }
  c.header('Content-Type', 'application/xml; charset=utf-8');
  c.header('Cache-Control', 'public, max-age=900');
  return c.body(feedCache.xml);
});

/**
 * IndexNow key discovery for the storefront's /{key}.txt verification route.
 * Per the IndexNow protocol the key is NOT a secret — it must be publicly
 * served at https://host/{key}.txt. 404 when the integration is not configured.
 */
routes.get('/indexnow-key', (c) => {
  const key = process.env.INDEXNOW_KEY?.trim();
  if (!key) {
    const res: ApiResponse<never> = { success: false, error: { code: 'NOT_CONFIGURED', message: 'IndexNow is not configured.' } };
    return c.json(res, 404);
  }
  c.header('Cache-Control', 'public, max-age=300');
  const res: ApiResponse<{ key: string }> = { success: true, data: { key } };
  return c.json(res);
});

export default routes;
