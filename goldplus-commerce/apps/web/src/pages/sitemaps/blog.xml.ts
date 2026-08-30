import type { APIRoute } from 'astro';
import { urlsetXml, xmlResponse } from '../../lib/sitemap';
import { fetchPublishedPosts } from '../../lib/blog';

/**
 * Published articles, with the article's own updated_at as lastmod. Drafts are
 * never listed — the API only ever returns PUBLISHED posts.
 *
 * Fail-open like the other sitemaps: an empty but valid urlset beats a 500,
 * because crawlers retry sitemaps and do not forgive persistent server errors.
 */
export const GET: APIRoute = async () => {
  // Paged so the sitemap does not silently stop at the first page of articles.
  const urls: Array<{ loc: string; lastmod?: string }> = [];
  const PAGE = 100;
  for (let page = 0; page < 10; page += 1) {
    const { posts } = await fetchPublishedPosts(PAGE, page * PAGE);
    for (const post of posts) {
      urls.push({ loc: `/blog/${post.slug}`, lastmod: post.updatedAt });
    }
    if (posts.length < PAGE) break;
  }
  // The index itself is worth crawling only when it has something on it.
  if (urls.length > 0) urls.unshift({ loc: '/blog' });
  return xmlResponse(urlsetXml(urls));
};
