import type { ApiResponse, ProductPublicDto } from '@goldplus/shared';

/**
 * The whole approved catalogue, not the first page of it.
 *
 * Several surfaces filter the catalogue in the page rather than in the
 * database — the shop and its search, the SEO hub pages, the hub sitemap — so
 * each needs the FULL list. The public endpoint returns at most 100 rows and
 * an unpaged call took the first 60, which is invisible at eight products and
 * silently hides the rest of the shop once the catalogue is loaded: a search
 * would answer "no matching products" for a product that is approved and on
 * sale, and a hub could fail its release gate for want of stock it has.
 *
 * Bounded, so a runaway catalogue can never turn one page render into
 * unbounded work, and a page that fails still leaves the earlier ones usable.
 */
export const CATALOGUE_PAGE_SIZE = 100;
export const CATALOGUE_MAX_PAGES = 8;

export async function fetchApprovedCatalogue(apiBase: string, timeoutMs = 3000): Promise<ProductPublicDto[]> {
  const all: ProductPublicDto[] = [];
  try {
    for (let page = 0; page < CATALOGUE_MAX_PAGES; page += 1) {
      const response = await fetch(
        `${apiBase}/products?limit=${CATALOGUE_PAGE_SIZE}&offset=${page * CATALOGUE_PAGE_SIZE}`,
        { signal: AbortSignal.timeout(timeoutMs) },
      );
      if (!response.ok) break;
      const body = (await response.json()) as ApiResponse<ProductPublicDto[]>;
      if (!body.success || !Array.isArray(body.data) || body.data.length === 0) break;
      all.push(...body.data);
      if (body.data.length < CATALOGUE_PAGE_SIZE) break;
    }
  } catch {
    // Callers treat an empty or partial catalogue honestly; none invent stock.
  }
  return all;
}
