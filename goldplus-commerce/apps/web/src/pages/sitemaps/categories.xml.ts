import type { APIRoute } from 'astro';
import { getTaxonomy } from '../../lib/taxonomy';
import { urlsetXml, xmlResponse } from '../../lib/sitemap';
import { categoryHasUniqueCopy } from '../../lib/crawlPolicy';
import { indexableHubForCategory } from '../../lib/categoryHubs';
import { apiBase } from '../../lib/api';
import { fetchApprovedCatalogue } from '../../lib/catalogue';
import { getCleanCatalog } from '../../lib/catalog/catalog';
import { dedupeProductsById, isApprovedDiscoveryProduct } from '../../lib/product-discovery';

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
  // The same catalogue the hubs sitemap gates on, so a category is listed here exactly when its hub is not there.
  const rawProducts = await fetchApprovedCatalogue(apiBase);
  const catalogue = dedupeProductsById(getCleanCatalog(rawProducts, taxonomy)).filter((p) => isApprovedDiscoveryProduct(p, taxonomy));
  const urls = taxonomy
    .filter(categoryHasUniqueCopy)
    // A category with its own hub (/power, /audio …) is listed ONCE, as the hub (hubs sitemap): the shop view of it
    // names the hub as canonical, so two indexable URLs no longer compete for the same searches (2026-10-22).
    // An empty catalogue keeps the static hub mapping (fail closed: nothing new is submitted during an outage).
    .filter((cat) => !indexableHubForCategory(cat.slug, catalogue, taxonomy))
    .map((cat) => ({ loc: `/shop?category=${encodeURIComponent(cat.slug)}` }));
  return xmlResponse(urlsetXml(urls));
};
