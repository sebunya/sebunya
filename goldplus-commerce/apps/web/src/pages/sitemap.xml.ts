import type { APIRoute } from 'astro';
import { apiBase } from '../lib/api';

type ApiProduct = { slug?: string };

const STATIC_PATHS: string[] = [
  '/',
  '/shop',
  '/verification',
  '/support',
  '/support/issue',
  '/support/fake',
  '/dealers/apply',
  '/quote-request',
];

function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]!));
}

export const GET: APIRoute = async ({ site }) => {
  const base = (site?.toString() ?? 'http://localhost:4321').replace(/\/$/, '');

  const urls: string[] = [...STATIC_PATHS];

  try {
    const res = await fetch(`${apiBase}/products`, { headers: { Accept: 'application/json' } });
    if (res.ok) {
      const json = (await res.json()) as { success?: boolean; data?: ApiProduct[] };
      if (json.success && Array.isArray(json.data)) {
        for (const p of json.data) {
          if (p.slug) urls.push(`/products/${p.slug}`);
        }
      }
    }
  } catch {
    // Fall through with static-only sitemap. Never throw — empty sitemap is worse than partial.
  }

  const now = new Date().toISOString();
  const body =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls
      .map(
        (p) =>
          `  <url>\n    <loc>${escapeXml(base + p)}</loc>\n    <lastmod>${now}</lastmod>\n    <changefreq>weekly</changefreq>\n  </url>`,
      )
      .join('\n') +
    `\n</urlset>\n`;

  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=900',
    },
  });
};
