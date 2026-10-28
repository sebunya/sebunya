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
import { publicBattery } from '../../lib/batteries';
import { phoneBatteryPath } from '../../lib/phoneBatteryPage';
import type { FinderFitIndexDto } from '@goldplus/shared';

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
  // The per-phone battery pages, and the finder itself when it is indexable: the same
  // fit index the hub renders, so a phone is listed here only while it has a battery to buy
  // (the page renders noindex otherwise). Finder away: omitted, like a failed hub gate.
  const [fitIndex, finderConfig] = await Promise.all([
    publicBattery<FinderFitIndexDto>('/finder/fit-index'),
    publicBattery<{ indexable: boolean }>('/finder/config'),
  ]);
  const phonePaths = fitIndex.ok ? fitIndex.data.brands.flatMap((b) => b.devices.map((d) => phoneBatteryPath(d.slug))) : [];
  const finderPath = finderConfig.ok && finderConfig.data.indexable ? ['/battery-finder'] : [];
  const paths = [...gatePassingHubPaths(catalogue, taxonomy), ...localPagePaths(biz), ...finderPath, ...phonePaths];
  return xmlResponse(urlsetXml(paths.map((loc) => ({ loc }))));
};
