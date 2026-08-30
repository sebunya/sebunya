import type { APIRoute } from 'astro';
import { urlsetXml, xmlResponse } from '../../lib/sitemap';
import { apiBase } from '../../lib/api';
import { getTaxonomy } from '../../lib/taxonomy';
import { getBusinessInfo } from '../../lib/businessInfo';
import { getCleanCatalog } from '../../lib/catalog/catalog';
import { dedupeProductsById, isApprovedDiscoveryProduct } from '../../lib/product-discovery';
import { gatePassingHubPaths, localPagePaths } from '../../lib/categoryHubs';
import type { ApiResponse, ProductPublicDto } from '@goldplus/shared';
import { fetchApprovedCatalogue } from '../../lib/catalogue';

/**
 * CATEGORY AUTHORITY ENGINE — gate-aware sitemap for hub pages and the two
 * local pages. Inclusion is computed live against the real catalogue: a hub
 * whose release gate fails (too few in-stock, photographed products) renders
 * noindex and is omitted here; the local pages appear only when business-info
 * returns an address + phone. If the catalogue is unreachable, hubs are
 * simply omitted (fail closed) — never listed on stale guesses.
 * No lastmod: hub copy carries no honest timestamp.
 */
export const GET: APIRoute = async () => {
  // fail closed: no hub URLs. Paged, or hubs whose products sit past the first
  // page of the catalogue would be left out of the sitemap entirely.
  const rawProducts: ProductPublicDto[] = await fetchApprovedCatalogue(apiBase);
  const taxonomy = await getTaxonomy();
  const biz = await getBusinessInfo();
  const catalogue = dedupeProductsById(getCleanCatalog(rawProducts, taxonomy)).filter((p) => isApprovedDiscoveryProduct(p, taxonomy));
  const paths = [...gatePassingHubPaths(catalogue, taxonomy), ...localPagePaths(biz)];
  return xmlResponse(urlsetXml(paths.map((loc) => ({ loc }))));
};
