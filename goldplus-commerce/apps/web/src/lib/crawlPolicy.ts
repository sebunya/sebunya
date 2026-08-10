/**
 * U6 AC5 — storefront mirror of the facet/crawl policy in
 * apps/api/src/domain/seo/CrawlPolicy.ts (evaluateCrawlPolicy). The web app
 * cannot import across the apps/api package boundary, so the minimal rule is
 * re-implemented here VERBATIM — if you change one, change both (the domain
 * module and its tests in tests/unit/SeoDomain.test.ts stay the source of
 * truth):
 *  - a category plus ONE content filter is indexable
 *  - TWO or more filters get noindex, follow
 *  - sort / page size / view mode are ALWAYS noindex
 *  - pagination keeps a self-referencing canonical
 *  - an indexable facet URL still needs unique copy to actually be indexed
 */

const NON_INDEXABLE_PARAMS = new Set(['sort', 'page_size', 'pagesize', 'view', 'view_mode']);
const PAGINATION_PARAMS = new Set(['page']);

export interface CrawlDirective {
  index: boolean;
  follow: boolean;
  canonicalParams: Record<string, string>;
  robots: string; // "index,follow" | "noindex,follow" | …
}

export function evaluateCrawlPolicy(input: { params: Record<string, string>; hasUniqueCopy?: boolean }): CrawlDirective {
  const entries = Object.entries(input.params).filter(([, v]) => v !== '' && v != null);
  const contentFilters = entries.filter(([k]) => !NON_INDEXABLE_PARAMS.has(k) && !PAGINATION_PARAMS.has(k));
  const hasNonIndexableParam = entries.some(([k]) => NON_INDEXABLE_PARAMS.has(k));

  const canonicalParams: Record<string, string> = {};
  for (const [k, v] of entries) {
    if (NON_INDEXABLE_PARAMS.has(k)) continue;
    canonicalParams[k] = v;
  }

  let index = true;
  const follow = true;
  if (hasNonIndexableParam) index = false;
  if (contentFilters.length >= 2) index = false;
  if (index && contentFilters.length >= 1 && input.hasUniqueCopy === false) index = false;

  return { index, follow, canonicalParams, robots: `${index ? 'index' : 'noindex'},${follow ? 'follow' : 'nofollow'}` };
}

/**
 * Shop-page directive: applies the domain rule to the shop's query params and
 * yields the robotsMeta + canonical URL for BaseLayout. `robotsMeta` is
 * undefined for a plainly indexable page (no meta emitted — index,follow is
 * the default).
 */
export function shopCrawlDirective(input: {
  params: Record<string, string>;
  hasUniqueCopy?: boolean;
  origin: string;
  pathname?: string;
}): { robotsMeta: string | undefined; canonicalUrl: string } {
  const d = evaluateCrawlPolicy({ params: input.params, hasUniqueCopy: input.hasUniqueCopy });
  const qs = new URLSearchParams(d.canonicalParams).toString();
  const canonicalUrl = `${input.origin}${input.pathname ?? '/shop'}${qs ? `?${qs}` : ''}`;
  return { robotsMeta: d.index ? undefined : d.robots, canonicalUrl };
}
