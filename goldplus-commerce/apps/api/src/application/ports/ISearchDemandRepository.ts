import { SearchDemandSignal, SearchDemandStatus } from '../../domain/products/ProductSearchService';

export interface ISearchDemandRepository {
  /**
   * Upsert by normalized query: increments searchCount (and zeroResultCount
   * when resultCount is 0) and refreshes lastSearchedAt/lastResultCount.
   */
  recordSearch(normalizedQuery: string, resultCount: number): Promise<void>;

  list(opts?: { status?: SearchDemandStatus; limit?: number }): Promise<SearchDemandSignal[]>;

  updateStatus(id: string, status: SearchDemandStatus): Promise<SearchDemandSignal | null>;
}
