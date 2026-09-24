import type { APIRoute } from 'astro';
import { getTaxonomy } from '../../lib/taxonomy';
import { urlsetXml, xmlResponse } from '../../lib/sitemap';
import { categoryHasUniqueCopy } from '../../lib/crawlPolicy';

/**
 * U6 — category landing URLs from the public taxonomy (/commerce/taxonomy).
 * There are no dedicated /categories/* pages; the public category URL is the
 * shop filtered to one category. The shop serves that page noindex until the
 * operator writes the category's description, so ONLY described categories are
 * listed here (the same rule, categoryHasUniqueCopy). Listing all of them had
 * Search Console report every one as "Submitted URL marked noindex". A
 * category joins the sitemap the moment its description is written in
 * /admin/categories. An empty urlset is valid.
 * No lastmod: taxonomy edits carry no timestamp we could honestly report.
 */
export const GET: APIRoute = async () => {
  const taxonomy = await getTaxonomy();
  const urls = taxonomy
    .filter(categoryHasUniqueCopy)
    .map((cat) => ({ loc: `/shop?category=${encodeURIComponent(cat.slug)}` }));
  return xmlResponse(urlsetXml(urls));
};
