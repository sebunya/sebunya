import type { APIRoute } from 'astro';

export const GET: APIRoute = ({ site }) => {
  const base = (site?.toString() ?? 'http://localhost:4321').replace(/\/$/, '');

  const body =
    `User-agent: *\n` +
    `Allow: /\n` +
    `Disallow: /admin\n` +
    `Disallow: /admin/\n` +
    `Disallow: /checkout\n` +
    `Disallow: /cart\n` +
    `Disallow: /dealers/dashboard\n` +
    `Disallow: /account\n` +
    `Disallow: /api/\n` +
    `\n` +
    `Sitemap: ${base}/sitemap.xml\n`;

  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
};
