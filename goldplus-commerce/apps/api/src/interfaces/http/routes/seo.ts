import { Hono } from 'hono';
import { Registry } from '../../../infrastructure/Registry';
import { ApiResponse } from '@goldplus/shared';
import { buildMerchantFeedXml } from '../../../application/use-cases/seo-growth/MerchantFeedUseCase';
import { SearchBatteryFinderUseCase } from '../../../application/use-cases/seo-growth/BatteryCompatibilityUseCases';
import { fallbackRobotsTxt } from '../../../application/use-cases/seo-growth/RobotsGovernanceUseCases';
import { lifecycleSeoOutcome } from '../../../application/use-cases/seo-growth/ProductLifecycleSeoUseCases';

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

/**
 * The live robots.txt body, for the storefront to serve at /robots.txt.
 *
 * This is PUBLIC on purpose and lives on the public router rather than under
 * /admin: robots.txt is a crawler-facing file by definition, so serving it
 * must never depend on an admin session. Only the published version's text is
 * exposed — never drafts, notes, approvers or version history.
 *
 * When nothing has been published, the committed static content is returned
 * with published:false, so the storefront never serves an empty or
 * accidentally permissive file.
 */
routes.get('/robots-published', async (c) => {
  const base = String(c.req.query('base') ?? 'https://shopgoldplus.com');
  try {
    const row = await Registry.getInstance().seoTechnicalRepo.getPublishedRobots();
    c.header('Cache-Control', 'public, max-age=300');
    if (!row) {
      const res: ApiResponse<unknown> = {
        success: true,
        data: {
          published: false,
          source: 'FALLBACK',
          reason: 'No robots.txt version has been published. The committed static content is authoritative.',
          version: null,
          content: fallbackRobotsTxt(base),
          publishedAt: null,
        },
      };
      return c.json(res);
    }
    const res: ApiResponse<unknown> = {
      success: true,
      data: {
        published: true,
        source: 'DATABASE',
        reason: null,
        version: row.version ?? null,
        content: String(row.content ?? ''),
        publishedAt: row.published_at ?? null,
      },
    };
    return c.json(res);
  } catch (err: any) {
    // The storefront falls back to its committed static content on any
    // failure — robots.txt must never be empty because a query failed.
    const res: ApiResponse<never> = {
      success: false,
      error: { code: 'ROBOTS_READ_FAILED', message: String(err?.message ?? err).slice(0, 200) },
    };
    return c.json(res, 503);
  }
});

/**
 * Google OAuth callback for the Search Integrations Control Plane.
 *
 * This lives on the PUBLIC router because it is a plain browser navigation
 * from Google's consent screen: it carries no Authorization header and could
 * never satisfy the admin auth middleware. Under /admin it was a dead control
 * — the operator granted consent and landed on a 401 while the connection sat
 * at AUTHORIZATION_REQUIRED for ever.
 *
 * It is NOT unauthenticated. The `state` is HMAC-signed, single-use and
 * expires in ten minutes, and it carries the connection and the operator it
 * was issued to; an attacker cannot mint one. On success the operator is
 * redirected back to the provider page rather than shown raw JSON.
 */
routes.get('/oauth/google/callback', async (c) => {
  const code = c.req.query('code') ?? '';
  const state = c.req.query('state') ?? '';
  const registry = Registry.getInstance();
  const { googleOAuthService } = await import('../../../infrastructure/seo/GoogleOAuthService');
  const oauth = googleOAuthService();

  // Consumes the state on ANY outcome below, so a code can never be replayed.
  const record = state ? oauth.consumeState(state) : null;

  /**
   * Send the operator back to the ADMIN UI, which is served by the storefront
   * origin — not by this API origin.
   *
   * A relative redirect here resolves against the API host, so the operator
   * landed on `api.<domain>/admin/seo/integrations`, which is the JSON route
   * and answers 401. That is a dead end after a successful authorization: the
   * same class of defect as the original Bearer-only callback.
   *
   * The storefront origin comes from SEO_ADMIN_RETURN_BASE when set, otherwise
   * the first configured CORS origin (the storefront is the only browser origin
   * allowed to call this API). If neither is available we fall back to a
   * relative path — still wrong-origin, but never a crash.
   */
  const adminBase = (() => {
    const explicit = (process.env.SEO_ADMIN_RETURN_BASE ?? '').trim().replace(/\/+$/, '');
    if (explicit) return explicit;
    const firstCors = (process.env.CORS_ORIGIN ?? '').split(',')[0]?.trim().replace(/\/+$/, '') ?? '';
    return firstCors;
  })();

  const back = (params: string) => {
    const path = `/admin/seo/integrations${record ? `/${record.connectionId}` : ''}?${params}`;
    return c.redirect(adminBase ? `${adminBase}${path}` : path, 303);
  };

  if (c.req.query('error')) {
    if (record) await registry.seoIntegrationRepo.setConnectionStatus(record.connectionId, {
      status: 'AUTHORIZATION_REQUIRED',
      lastError: `Authorization was not granted: ${String(c.req.query('error')).slice(0, 200)}`,
    });
    return back('oauth=denied');
  }
  if (code === '' || !record) return back('oauth=invalid_state');

  const connection = await registry.seoIntegrationRepo.getConnection(record.connectionId);
  if (!connection) return back('oauth=connection_missing');

  const redirectUri = oauth.redirectUri();
  if (!redirectUri) return back('oauth=not_configured');

  try {
    const { IntegrationCredentialVault, maskOf } = await import('../../../infrastructure/seo/IntegrationCredentialVault');
    const vault = IntegrationCredentialVault.fromEnv();
    if (!vault) return back('oauth=vault_unavailable');

    const activeCredential = await registry.seoIntegrationRepo.getActiveCredential(connection.id);
    const existingSecret: Record<string, unknown> | null =
      activeCredential ? (vault.decrypt(activeCredential.ciphertext) as Record<string, unknown>) : null;
    const app = existingSecret?.clientId && existingSecret?.clientSecret
      ? { clientId: String(existingSecret.clientId), clientSecret: String(existingSecret.clientSecret) }
      : oauth.envClientApp();
    if (!app) return back('oauth=no_client_app');

    const tokens = await oauth.exchangeCode({ code, verifier: record.verifier, ...app, redirectUri });
    await registry.seoIntegrationRepo.addCredential({
      connectionId: connection.id,
      authType: 'OAUTH2',
      ciphertext: vault.encrypt({ ...(existingSecret ?? {}), tokens }),
      // Never the token itself — only its mask.
      mask: maskOf(tokens.refreshToken ?? tokens.accessToken),
      createdBy: record.actorId,
      expiresAt: new Date(tokens.expiresAt),
    });
    // Consent granted is not the same as working: the connection becomes
    // CONFIGURING and must still pass a staged test before it is READY.
    await registry.seoIntegrationRepo.setConnectionStatus(connection.id, { status: 'CONFIGURING', lastError: null });
    await registry.seoIntegrationRepo.appendAudit({
      connectionId: connection.id,
      providerId: connection.provider_id,
      actorId: record.actorId,
      action: 'SEO_INTEGRATION_OAUTH_COMPLETED',
      detail: { scope: tokens.scope },
    });
    return back('oauth=authorized');
  } catch {
    await registry.seoIntegrationRepo.setConnectionStatus(connection.id, {
      status: 'AUTHORIZATION_REQUIRED',
      lastError: 'Authorization code exchange failed.',
    });
    return back('oauth=exchange_failed');
  }
});

/**
 * The recorded lifecycle decision for a product, so the storefront can HONOUR
 * it. Without this the admin screen wrote a row and nothing happened — an
 * operator would record a 301 and believe an SEO action had shipped.
 *
 * Returns only the derived outcome (status, successor slug, indexability,
 * notice) — never the rationale, the decider or the evidence snapshot, which
 * are internal.
 */
routes.get('/product-lifecycle', async (c) => {
  const productId = (c.req.query('productId') ?? '').trim();
  if (!productId) {
    const res: ApiResponse<never> = { success: false, error: { code: 'BAD_INPUT', message: 'productId is required.' } };
    return c.json(res, 400);
  }
  try {
    const row = await Registry.getInstance().seoCatalogueRepo.getLifecycleForProduct(productId);
    c.header('Cache-Control', 'public, max-age=120');
    if (!row) {
      // No decision recorded means the page behaves exactly as before. The
      // absence of a decision never triggers an action.
      const res: ApiResponse<unknown> = { success: true, data: { decided: false, outcome: null } };
      return c.json(res);
    }
    const outcome = lifecycleSeoOutcome({
      state: row.state,
      disposition: row.disposition,
      successorProductId: row.successor_product_id ?? null,
    });
    const res: ApiResponse<unknown> = {
      success: true,
      data: {
        decided: row.disposition !== 'UNDECIDED',
        state: row.state,
        disposition: row.disposition,
        successorSlug: row.successor_slug ?? null,
        outcome,
      },
    };
    return c.json(res);
  } catch {
    // A lookup failure must never change how a live product page behaves.
    const res: ApiResponse<unknown> = { success: true, data: { decided: false, outcome: null } };
    return c.json(res);
  }
});

/**
 * Public battery finder. Returns ONLY compatibility facts an operator recorded
 * and verified (VERIFIED/PROVISIONAL) — never a guess, and never an
 * UNVERIFIED or REJECTED combination. `indexable` tells the storefront whether
 * the finder page has enough verified facts to be worth indexing; below the
 * threshold it stays noindex rather than becoming a thin page.
 */
routes.get('/battery-finder', async (c) => {
  const query = (c.req.query('q') ?? '').trim();
  const repo = Registry.getInstance().seoCatalogueRepo;
  const useCase = new SearchBatteryFinderUseCase({
    searchRows: async (tokens) =>
      (await repo.searchBatteryCompat(tokens)).map((r: any) => ({
        id: String(r.id),
        phoneBrand: String(r.phone_brand),
        phoneModel: String(r.phone_model),
        modelNumber: r.model_number ?? null,
        variant: r.variant ?? null,
        batteryReference: String(r.battery_reference),
        status: String(r.status),
        product: r.product_id
          ? {
              id: String(r.product_id),
              name: String(r.product_name),
              slug: String(r.product_slug),
              priceUgx: Number(r.product_price ?? 0),
              imageUrl: r.product_image_url ?? null,
            }
          : null,
      })),
    countVerified: () => repo.countVerifiedBatteryCompat(),
    recordEvent: (e) => repo.recordFinderEvent(e),
  });
  const result = await useCase.execute(query);
  const res: ApiResponse<typeof result> = { success: true, data: result };
  return c.json(res);
});

export default routes;
