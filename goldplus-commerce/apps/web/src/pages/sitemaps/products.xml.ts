import type { APIRoute } from 'astro';
import { apiBase } from '../../lib/api';
import { urlsetXml, xmlResponse } from '../../lib/sitemap';

type SitemapProduct = { slug?: string; updatedAt?: string };

/**
 * U6 AC1/AC2 — every APPROVED ACTIVE product from the API's SEO repository
 * (GET /seo/sitemap/products), with the product's REAL updated_at as lastmod.
 *
 * When the API cannot be asked, the answer is a temporary 503 with Retry-After, not an empty urlset: an empty
 * sitemap (cached for 15 minutes) tells a crawler every product is gone. Same rule as blog.xml. Never a 500.
 */
export const unavailable = () =>
  new Response('Product sitemap temporarily unavailable', {
    status: 503,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Retry-After': '300', 'Cache-Control': 'no-store' },
  });

export const GET: APIRoute = async () => {
  try {
    const res = await fetch(`${apiBase}/seo/sitemap/products`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return unavailable();
    const json = (await res.json()) as { success?: boolean; data?: SitemapProduct[] };
    if (!json.success || !Array.isArray(json.data)) return unavailable();
    const urls = json.data
      .filter((p): p is { slug: string; updatedAt?: string } => Boolean(p.slug))
      .map((p) => ({ loc: `/products/${p.slug}`, lastmod: p.updatedAt }));
    return xmlResponse(urlsetXml(urls));
  } catch {
    return unavailable();
  }
};
