import { IProductRepository } from '../../ports/IProductRepository';
import { ISearchDemandRepository } from '../../ports/ISearchDemandRepository';
import {
  normalizeSearchQuery,
  isMeaningfulQuery,
  rankSuggestions,
  isValidDemandStatus,
  SearchDemandSignal,
  SearchDemandStatus,
} from '../../../domain/products/ProductSearchService';

export interface ProductSuggestionDto {
  id: string;
  name: string;
  slug: string;
  priceUgx: number | null;
  categoryName: string | null;
}

/** Slice 4: public autocomplete — public catalogue data only, retail price only. */
export class SuggestProductsUseCase {
  constructor(private readonly products: IProductRepository) {}

  async execute(input: { query: string; limit?: number }): Promise<ProductSuggestionDto[]> {
    const q = normalizeSearchQuery(input.query ?? '');
    if (!isMeaningfulQuery(q)) return [];
    const limit = Math.max(1, Math.min(input.limit ?? 8, 12));

    const rows = await this.products.findPublicViewList({ search: q, limit: 24 });
    const ranked = rankSuggestions(
      q,
      rows.map((r) => ({
        id: r.entity.id,
        name: r.entity.name,
        sku: r.entity.sku,
        modelNumber: r.entity.modelNumber,
        row: r,
      }))
    );
    return ranked.slice(0, limit).map((c) => ({
      id: c.row.entity.id,
      name: c.row.entity.name,
      slug: c.row.entity.slug,
      priceUgx: c.row.retailPriceUgx,
      categoryName: c.row.categoryName,
    }));
  }
}

/**
 * Slice 4: anonymous search telemetry -> aggregated demand. No identifiers
 * are accepted or stored; meaningless queries are dropped.
 */
export class RecordSearchEventUseCase {
  constructor(private readonly demand: ISearchDemandRepository) {}

  async execute(input: { query: string; resultCount: number }): Promise<{ recorded: boolean }> {
    const q = normalizeSearchQuery(input.query ?? '');
    if (!isMeaningfulQuery(q)) return { recorded: false };
    const resultCount = Number.isInteger(input.resultCount) && input.resultCount >= 0 ? Math.min(input.resultCount, 100_000) : 0;
    await this.demand.recordSearch(q, resultCount);
    return { recorded: true };
  }
}

export class ListSearchDemandUseCase {
  constructor(private readonly demand: ISearchDemandRepository) {}
  async execute(opts?: { status?: SearchDemandStatus; limit?: number }): Promise<SearchDemandSignal[]> {
    return this.demand.list(opts);
  }
}

export type UpdateDemandResult =
  | { ok: true; signal: SearchDemandSignal }
  | { ok: false; code: string; message: string };

export class UpdateSearchDemandStatusUseCase {
  constructor(private readonly demand: ISearchDemandRepository) {}

  async execute(id: string, status: string): Promise<UpdateDemandResult> {
    if (!id) return { ok: false, code: 'MISSING_ID', message: 'A demand signal id is required.' };
    if (!isValidDemandStatus(status)) {
      return { ok: false, code: 'INVALID_STATUS', message: 'Status must be one of open, reviewing, sourced, dismissed.' };
    }
    const signal = await this.demand.updateStatus(id, status);
    if (!signal) return { ok: false, code: 'NOT_FOUND', message: 'Demand signal not found.' };
    return { ok: true, signal };
  }
}
