import type { APIRoute } from 'astro';
import { apiBase } from '../../lib/api';
import { urlsetXml, xmlResponse } from '../../lib/sitemap';

type SitemapProduct = { slug?: string; updatedAt?: string };

/**
 * U6 AC1/AC2 — every APPROVED ACTIVE product from the API's SEO repository
 * (GET /seo/sitemap/products), with the product's REAL updated_at as lastmod.
 * Fail-open: on any API failure an empty urlset is served rather than a 500 —
 * crawlers retry sitemaps; they do not forgive persistent server errors.
 */
export const GET: APIRoute = async () => {
  let urls: Array<{ loc: string; lastmod?: string }> = [];
  try {
    const res = await fetch(`${apiBase}/seo/sitemap/products`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) {
      const json = (await res.json()) as { success?: boolean; data?: SitemapProduct[] };
      if (json.success && Array.isArray(json.data)) {
        urls = json.data
          .filter((p): p is { slug: string; updatedAt?: string } => Boolean(p.slug))
          .map((p) => ({ loc: `/products/${p.slug}`, lastmod: p.updatedAt }));
      }
    }
  } catch {
    // fall through with an empty (but valid) sitemap
  }
  return xmlResponse(urlsetXml(urls));
};
