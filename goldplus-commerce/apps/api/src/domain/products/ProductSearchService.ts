/**
 * Product search domain rules (Slice 4). Pure — no Hono, Drizzle, or adapters.
 * The repository performs the SQL matching; this service owns query
 * normalisation, suggestion ranking, and search-demand status rules.
 */

export const MAX_QUERY_LENGTH = 120;
export const MIN_SEARCH_INSIGHT_VOLUME = 3;
export const MAX_SEARCH_RESULT_PRODUCTS = 50;

/** Canonical form used for matching, telemetry, and demand aggregation. */
export function normalizeSearchQuery(raw: string): string {
  // Strip control characters without a control-char regex (lint-safe).
  const printable = Array.from(raw)
    .map((ch) => (ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127 ? ' ' : ch))
    .join('');
  return printable
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .slice(0, MAX_QUERY_LENGTH);
}

/**
 * The words of a query, in the form both the SQL and the ranking use. Matching
 * every word in any order is what lets "bank power" find the power bank; the
 * cap keeps a pasted paragraph from becoming a hundred ANDed LIKEs.
 */
export const MAX_SEARCH_TERMS = 6;

export function searchTerms(raw: string): string[] {
  const normalized = normalizeSearchQuery(raw);
  return normalized ? normalized.split(' ').filter(Boolean).slice(0, MAX_SEARCH_TERMS) : [];
}

/** Queries below two characters are noise and are never recorded or suggested on. */
export function isMeaningfulQuery(normalized: string): boolean {
  return normalized.length >= 2;
}

export interface SuggestionCandidate {
  id: string;
  name: string;
  sku?: string | null;
  modelNumber?: string | null;
  /** Matched by the results page too, so the dropdown must see it as well. */
  categoryName?: string | null;
  subcategory?: string | null;
}

/**
 * Deterministic suggestion ranking: name prefix > word prefix > SKU/model
 * match > name substring > matched on category or subcategory. Ties break
 * alphabetically so results are stable.
 *
 * The last tier exists because the repository matches five fields; scoring
 * only three silently threw away rows it had deliberately returned, so typing
 * a category name offered nothing while the results page listed products.
 */
export function rankSuggestions<T extends SuggestionCandidate>(query: string, candidates: T[]): T[] {
  const q = normalizeSearchQuery(query);
  const terms = searchTerms(query);
  const scored = candidates.map((c) => {
    const name = c.name.toLowerCase();
    const identifiers = `${(c.sku ?? '').toLowerCase()} ${(c.modelNumber ?? '').toLowerCase()}`;
    const haystack = `${name} ${identifiers} ${(c.categoryName ?? '').toLowerCase()} ${(c.subcategory ?? '').toLowerCase()}`;
    let score = 0;
    if (name.startsWith(q)) score = 5;
    else if (name.split(/\s+/).some((w) => w.startsWith(q))) score = 4;
    else if (identifiers.includes(q)) score = 3;
    else if (name.includes(q)) score = 2;
    // Every word present somewhere: the multi-word and category matches that
    // the whole-phrase tiers above cannot see.
    else if (terms.length > 0 && terms.every((t) => haystack.includes(t))) score = 1;
    return { c, score };
  });
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.c.name.localeCompare(b.c.name))
    .map((s) => s.c);
}

// ---------------- Search demand (zero-result capture) ----------------

export const SEARCH_DEMAND_STATUSES = ['open', 'reviewing', 'sourced', 'dismissed'] as const;
export type SearchDemandStatus = (typeof SEARCH_DEMAND_STATUSES)[number];

export function isValidDemandStatus(value: string): value is SearchDemandStatus {
  return (SEARCH_DEMAND_STATUSES as readonly string[]).includes(value);
}

export interface SearchDemandSignal {
  id: string;
  query: string; // normalized, anonymous — never joined to contact details
  searchCount: number;
  zeroResultCount: number;
  lastResultCount: number;
  status: SearchDemandStatus;
  firstSearchedAt: Date;
  lastSearchedAt: Date;
}

export const SEARCH_INTERACTION_TYPES = ['click', 'add_to_cart'] as const;
export type SearchInteractionType = (typeof SEARCH_INTERACTION_TYPES)[number];

export interface SearchProductInsight {
  query: string;
  productId: string;
  productName: string;
  impressions: number;
  clicks: number;
  addToCartConversions: number;
  averageObservedRank: number;
  lastObservedRank: number;
  clickThroughRate: number;
  addToCartRate: number;
}

export interface SearchSynonymCandidate {
  query: string;
  candidate: string;
  sharedProductName: string;
  evidenceClicks: number;
  status: 'EVIDENCE_ONLY';
}

export interface SearchInsightsOverview {
  minimumReportedSearches: number;
  totalSearches: number;
  zeroResultSearches: number;
  zeroResultRate: number;
  impressions: number;
  clicks: number;
  addToCartConversions: number;
  clickThroughRate: number;
  addToCartRate: number;
  demand: SearchDemandSignal[];
  ranking: SearchProductInsight[];
  synonymCandidates: SearchSynonymCandidate[];
}

export function boundedRate(numerator: number, denominator: number): number {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return 0;
  return Math.round(Math.min(1, Math.max(0, numerator / denominator)) * 10_000) / 10_000;
}

export function isSearchInteractionType(value: string): value is SearchInteractionType {
  return (SEARCH_INTERACTION_TYPES as readonly string[]).includes(value);
}

/** Kept for backwards compatibility with the original service shape. */
export class ProductSearchService {
  search(query: string): never[] {
    if (!query) throw new Error('Query required');
    // Matching happens in the repository with the normalized query;
    // rankSuggestions orders the results.
    return [];
  }
}
