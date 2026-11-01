/**
 * U6 — facet and crawl policy (AC5). Pure domain, one shared helper so the rule
 * lives in exactly one place rather than per page.
 *
 * Rules:
 *  - a category plus ONE content filter is indexable
 *  - TWO or more filters get noindex, follow
 *  - sort, page size and view mode are ALWAYS noindex
 *  - pagination uses a self-referencing canonical
 *  - an indexable facet URL still needs unique copy to actually be indexed
 */

// Parameters that never contribute to indexable content.
const NON_INDEXABLE_PARAMS = new Set(['sort', 'page_size', 'pagesize', 'view', 'view_mode']);
// Parameters that are pure pagination (self-canonical, still indexable as a page).
const PAGINATION_PARAMS = new Set(['page']);

export interface CrawlDirective {
  index: boolean;
  follow: boolean;
  /** The canonical URL path+query the page should self-reference. */
  canonicalParams: Record<string, string>;
  robots: string; // e.g. "index,follow" | "noindex,follow"
}

export interface CrawlPolicyInput {
  /** Query params on the facet/category URL (already parsed). */
  params: Record<string, string>;
  /** Whether this indexable URL has unique editorial copy. */
  hasUniqueCopy?: boolean;
}

export function evaluateCrawlPolicy(input: CrawlPolicyInput): CrawlDirective {
  const entries = Object.entries(input.params).filter(([, v]) => v !== '' && v != null);
  const contentFilters = entries.filter(([k]) => !NON_INDEXABLE_PARAMS.has(k) && !PAGINATION_PARAMS.has(k));
  const hasNonIndexableParam = entries.some(([k]) => NON_INDEXABLE_PARAMS.has(k));
  const pageParam = input.params['page'];

  // Canonical strips sort/page-size/view; pagination keeps its own page number
  // (self-referencing canonical for the paginated page).
  const canonicalParams: Record<string, string> = {};
  for (const [k, v] of entries) {
    if (NON_INDEXABLE_PARAMS.has(k)) continue;
    canonicalParams[k] = v;
  }

  let index = true;
  let follow = true;

  if (hasNonIndexableParam) {
    // sort / page size / view mode are always noindex.
    index = false;
  }
  if (contentFilters.length >= 2) {
    // Two or more filters: noindex, follow.
    index = false;
    follow = true;
  }
  if (index && contentFilters.length >= 1 && input.hasUniqueCopy === false) {
    // An indexable facet without unique copy is not actually indexable.
    index = false;
  }
  // Pagination alone does not remove indexability; it self-canonicalises.
  void pageParam;

  return {
    index,
    follow,
    canonicalParams,
    robots: `${index ? 'index' : 'noindex'},${follow ? 'follow' : 'nofollow'}`,
  };
}
