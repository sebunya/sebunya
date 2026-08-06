/**
 * The governed search→recommendation interface (R4, 2026-08-06; prompt §10).
 *
 * Search's canonical tables are DELIBERATELY identity-free aggregates
 * (search_demand_signals / search_product_insights — their own design note).
 * This port is the only bridge: recommendations may read search EVIDENCE
 * through it, never write search truth, and never join search rows to a
 * person. The profile's own recent search INTENT comes from its event stream
 * (PRODUCT_SEARCHED), not from these tables — the two meet only inside the
 * engine, per request, in memory.
 */
export interface SearchAffinityProduct {
  productId: string;
  clickCount: number;
  conversionCount: number;
  impressionCount: number;
}

export interface SearchIntelligence {
  /** Highest-demand normalized queries in the window. */
  topQueries: Array<{ query: string; searchCount: number; lastResultCount: number }>;
  /** Queries that returned nothing — each a catalogue gap wearing a customer's words. */
  zeroResultQueries: Array<{ query: string; searchCount: number; zeroResultCount: number }>;
  /** Clicked but never converted — interest the catalogue is not closing. */
  clickedNeverConverted: Array<{ query: string; clickCount: number; productId: string }>;
}

export interface ISearchAffinityReader {
  /**
   * Products with real click/conversion evidence for a normalized query,
   * ranked conversions desc, clicks desc, product asc. Empty = no evidence —
   * the caller reports INSUFFICIENT_SAMPLE, never fabricates affinity.
   */
  topProductsForQuery(normalizedQuery: string, limit: number): Promise<SearchAffinityProduct[]>;

  /** The operator's search intelligence panel (bounded, aggregate-only). */
  searchIntelligence(limit: number): Promise<SearchIntelligence>;
}
