import type { APIRoute } from 'astro';
import { urlsetXml, xmlResponse } from '../../lib/sitemap';
import { fetchPublishedPosts } from '../../lib/blog';

/**
 * Published articles, with the article's own updated_at as lastmod. Drafts are
 * never listed — the API only ever returns PUBLISHED posts.
 *
 * When the blog service cannot be asked, the answer is a temporary 503 with
 * Retry-After, not an empty urlset: an empty sitemap (cached for 15 minutes)
 * tells a crawler every article is gone. It is never a 500.
 */
export const GET: APIRoute = async () => {
  // Paged so the sitemap does not silently stop at the first page of articles.
  const urls: Array<{ loc: string; lastmod?: string }> = [];
  const PAGE = 100;
  for (let page = 0; page < 10; page += 1) {
    const { posts, error } = await fetchPublishedPosts(PAGE, page * PAGE);
    if (error) {
      return new Response('Blog sitemap temporarily unavailable', {
        status: 503,
        headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Retry-After': '300', 'Cache-Control': 'no-store' },
      });
    }
    for (const post of posts) {
      urls.push({ loc: `/blog/${post.slug}`, lastmod: post.updatedAt });
    }
    if (posts.length < PAGE) break;
  }
  // The index itself is worth crawling only when it has something on it.
  if (urls.length > 0) urls.unshift({ loc: '/blog' });
  return xmlResponse(urlsetXml(urls));
};
