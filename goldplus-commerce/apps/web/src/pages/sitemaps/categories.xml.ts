import type { APIRoute } from 'astro';
import { getTaxonomy } from '../../lib/taxonomy';
import { urlsetXml, xmlResponse } from '../../lib/sitemap';

/**
 * U6 — category landing URLs from the public taxonomy (/commerce/taxonomy).
 * There are no dedicated /categories/* pages; the public category URL is the
 * shop filtered to one category, which the crawl policy treats as indexable
 * (one content filter). The taxonomy document does not expose per-category
 * product counts, so all categories are listed (documented trade-off).
 * No lastmod: taxonomy edits carry no timestamp we could honestly report.
 */
export const GET: APIRoute = async () => {
  const taxonomy = await getTaxonomy();
  const urls = taxonomy.map((cat) => ({ loc: `/shop?category=${encodeURIComponent(cat.slug)}` }));
  return xmlResponse(urlsetXml(urls));
};
