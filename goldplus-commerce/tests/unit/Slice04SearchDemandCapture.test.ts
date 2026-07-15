import { describe, it, expect } from 'vitest';
import {
  normalizeSearchQuery,
  isMeaningfulQuery,
  rankSuggestions,
  isValidDemandStatus,
  SearchDemandSignal,
  SearchDemandStatus,
} from '../../apps/api/src/domain/products/ProductSearchService';
import {
  SuggestProductsUseCase,
  RecordSearchEventUseCase,
  UpdateSearchDemandStatusUseCase,
} from '../../apps/api/src/application/use-cases/products/SearchUseCases';
import { ISearchDemandRepository } from '../../apps/api/src/application/ports/ISearchDemandRepository';
import { IProductRepository, ProductWithPrice } from '../../apps/api/src/application/ports/IProductRepository';

// ---------- fakes ----------

function fakeDemand(): ISearchDemandRepository & { rows: Map<string, SearchDemandSignal> } {
  const rows = new Map<string, SearchDemandSignal>();
  return {
    rows,
    async recordSearch(query, resultCount) {
      const existing = rows.get(query);
      const now = new Date();
      if (existing) {
        existing.searchCount += 1;
        if (resultCount === 0) existing.zeroResultCount += 1;
        existing.lastResultCount = resultCount;
        existing.lastSearchedAt = now;
      } else {
        rows.set(query, {
          id: `d-${rows.size + 1}`,
          query,
          searchCount: 1,
          zeroResultCount: resultCount === 0 ? 1 : 0,
          lastResultCount: resultCount,
          status: 'open',
          firstSearchedAt: now,
          lastSearchedAt: now,
        });
      }
    },
    async list() {
      return [...rows.values()];
    },
    async updateStatus(id, status: SearchDemandStatus) {
      const row = [...rows.values()].find((r) => r.id === id);
      if (!row) return null;
      row.status = status;
      return row;
    },
  };
}

function product(id: string, name: string, sku = `SKU-${id}`, model = `M-${id}`): ProductWithPrice {
  return {
    entity: { id, name, sku, modelNumber: model, slug: `slug-${id}` } as any,
    retailPriceUgx: 10_000,
    categoryName: 'Chargers',
    images: [],
    attributeValues: [],
  };
}

function fakeProducts(rows: ProductWithPrice[]): IProductRepository {
  return {
    async findPublicViewBySlug() {
      return null;
    },
    async findPublicViewList() {
      return rows;
    },
  };
}

// ---------- domain ----------

describe('Search domain (Slice 4)', () => {
  it('normalizes queries to a canonical, bounded form', () => {
    expect(normalizeSearchQuery('  Power   BANK  ')).toBe('power bank');
    expect(normalizeSearchQuery('a'.repeat(500)).length).toBe(120);
  });

  it('treats sub-2-character queries as noise', () => {
    expect(isMeaningfulQuery(normalizeSearchQuery(' x '))).toBe(false);
    expect(isMeaningfulQuery(normalizeSearchQuery('tv'))).toBe(true);
  });

  it('ranks name prefix above word prefix above SKU/model above substring, stably', () => {
    const items = [
      { id: '1', name: 'Ultra Power Bank' }, // word prefix for "power"
      { id: '2', name: 'Power Bank 20000mAh' }, // name prefix
      { id: '3', name: 'Wall Charger', sku: 'POWER-01' }, // sku match
      { id: '4', name: 'Superpower Cable' }, // substring only
      { id: '5', name: 'Earbuds' }, // no match
    ];
    const ranked = rankSuggestions('Power', items);
    expect(ranked.map((r) => r.id)).toEqual(['2', '1', '3', '4']);
  });

  it('accepts only the four demand statuses', () => {
    expect(isValidDemandStatus('sourced')).toBe(true);
    expect(isValidDemandStatus('deleted')).toBe(false);
  });
});

// ---------- use cases ----------

describe('Search use cases (Slice 4)', () => {
  it('records searches anonymously and aggregates zero-result counts', async () => {
    const repo = fakeDemand();
    const uc = new RecordSearchEventUseCase(repo);
    await uc.execute({ query: '  Solar   Panel ', resultCount: 0 });
    await uc.execute({ query: 'solar panel', resultCount: 0 });
    await uc.execute({ query: 'solar panel', resultCount: 3 });
    const row = repo.rows.get('solar panel')!;
    expect(row.searchCount).toBe(3);
    expect(row.zeroResultCount).toBe(2);
    expect(row.lastResultCount).toBe(3);
    // Nothing but the query/counters is stored — no identifiers exist on the signal.
    expect(Object.keys(row).sort()).toEqual(
      ['firstSearchedAt', 'id', 'lastResultCount', 'lastSearchedAt', 'query', 'searchCount', 'status', 'zeroResultCount'].sort()
    );
  });

  it('drops meaningless queries instead of recording them', async () => {
    const repo = fakeDemand();
    const result = await new RecordSearchEventUseCase(repo).execute({ query: ' x ', resultCount: 0 });
    expect(result.recorded).toBe(false);
    expect(repo.rows.size).toBe(0);
  });

  it('suggests ranked public products with retail price only', async () => {
    const uc = new SuggestProductsUseCase(
      fakeProducts([product('1', 'Ultra Power Bank'), product('2', 'Power Bank 20000mAh')])
    );
    const out = await uc.execute({ query: 'power', limit: 8 });
    expect(out.map((o) => o.name)).toEqual(['Power Bank 20000mAh', 'Ultra Power Bank']);
    expect(Object.keys(out[0]).sort()).toEqual(['categoryName', 'id', 'name', 'priceUgx', 'slug']);
  });

  it('returns nothing for noise queries without touching the catalogue', async () => {
    const uc = new SuggestProductsUseCase(fakeProducts([product('1', 'Power Bank')]));
    expect(await uc.execute({ query: 'p' })).toEqual([]);
  });

  it('rejects invalid demand status transitions', async () => {
    const repo = fakeDemand();
    await new RecordSearchEventUseCase(repo).execute({ query: 'solar panel', resultCount: 0 });
    const uc = new UpdateSearchDemandStatusUseCase(repo);
    const bad = await uc.execute('d-1', 'archived');
    expect(bad.ok).toBe(false);
    const good = await uc.execute('d-1', 'reviewing');
    expect(good.ok).toBe(true);
    if (good.ok) expect(good.signal.status).toBe('reviewing');
    const missing = await uc.execute('nope', 'sourced');
    expect(missing.ok).toBe(false);
  });
});
