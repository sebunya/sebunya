import type { APIRoute } from 'astro';
import { fetchPublishedPosts } from '../lib/blog';
import { SITE_ORIGIN } from '../lib/sitemap';

/**
 * RSS for the guides. Readers, aggregators and several AI crawlers look for a
 * feed at /rss.xml before anything else; without one, new articles are only
 * discovered on the next crawl of /blog.
 *
 * Fail-open like the sitemaps: an empty but valid channel beats a 500, because
 * a feed reader that gets an error backs off for a long time.
 */
export const prerender = false;

const esc = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

const rfc822 = (iso: string | null): string | null => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toUTCString();
};

export const GET: APIRoute = async () => {
  let items: string[] = [];
  let latest: string | null = null;
  try {
    const { posts } = await fetchPublishedPosts(50, 0);
    items = posts.map((post) => {
      const published = rfc822(post.publishedAt);
      if (published && (!latest || new Date(post.publishedAt!) > new Date(latest))) latest = post.publishedAt;
      return [
        '    <item>',
        `      <title>${esc(post.title)}</title>`,
        `      <link>${SITE_ORIGIN}/blog/${esc(post.slug)}</link>`,
        `      <guid isPermaLink="true">${SITE_ORIGIN}/blog/${esc(post.slug)}</guid>`,
        `      <description>${esc(post.excerpt)}</description>`,
        ...(published ? [`      <pubDate>${published}</pubDate>`] : []),
        '    </item>',
      ].join('\n');
    });
  } catch {
    items = [];
  }

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    '  <channel>',
    '    <title>GoldPlus guides and advice</title>',
    `    <link>${SITE_ORIGIN}/blog</link>`,
    '    <description>Guides from GoldPlus on choosing and using phone accessories in Uganda.</description>',
    '    <language>en-UG</language>',
    `    <atom:link href="${SITE_ORIGIN}/rss.xml" rel="self" type="application/rss+xml" />`,
    ...(latest && rfc822(latest) ? [`    <lastBuildDate>${rfc822(latest)}</lastBuildDate>`] : []),
    ...items,
    '  </channel>',
    '</rss>',
    '',
  ].join('\n');

  return new Response(xml, {
    headers: { 'Content-Type': 'application/rss+xml; charset=utf-8', 'Cache-Control': 'public, max-age=1800' },
  });
};
