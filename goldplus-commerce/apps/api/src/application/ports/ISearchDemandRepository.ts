import {
  SearchDemandSignal,
  SearchDemandStatus,
  SearchInsightsOverview,
  SearchInteractionType,
} from '../../domain/products/ProductSearchService';

export interface ISearchDemandRepository {
  /**
   * Upsert by normalized query: increments searchCount (and zeroResultCount
   * when resultCount is 0) and refreshes lastSearchedAt/lastResultCount.
   */
  recordSearch(normalizedQuery: string, resultCount: number, rankedProductIds?: string[]): Promise<void>;

  recordInteraction(input: {
    normalizedQuery: string;
    productId: string;
    rank: number;
    type: SearchInteractionType;
  }): Promise<{ recorded: boolean }>;

  list(opts?: { status?: SearchDemandStatus; limit?: number }): Promise<SearchDemandSignal[]>;

  updateStatus(id: string, status: SearchDemandStatus): Promise<SearchDemandSignal | null>;

  getInsights(limit?: number): Promise<SearchInsightsOverview>;
}
