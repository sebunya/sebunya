import { describe, expect, it } from 'vitest';
import { GetPersonalizedRecommendationsUseCase } from '../../apps/api/src/application/use-cases/recommendation/GetPersonalizedRecommendationsUseCase';
import { ProductEntity } from '../../apps/api/src/domain/products/ProductEntity';
import { ProductWithPrice, IProductRepository } from '../../apps/api/src/application/ports/IProductRepository';
import {
  IRecommendationReadRepository,
  CoOccurrenceResult,
  RecentInteraction,
  PopularProduct,
  RecommendationProductContext,
} from '../../apps/api/src/application/ports/IRecommendationReadRepository';

function makeProduct(id: string, name: string, category = 'Power banks'): ProductWithPrice {
  const entity = new ProductEntity(
    id, `SKU-${id}`, `MODEL-${id}`, name, `slug-${id}`, category, undefined,
    'short', 'long', 0, undefined, 'in_stock', undefined, [], '1 Year',
    true, true, 'approved', false, true, true, 10, {}
  );
  return { entity, retailPriceUgx: 50000, categoryName: category, images: [], attributeValues: [] };
}

class FakeProductRepo implements IProductRepository {
  constructor(private readonly catalog: Record<string, ProductWithPrice>) {}
  async findPublicViewBySlug(): Promise<ProductWithPrice | null> {
    return null;
  }
  async findPublicViewList(opts?: { ids?: string[] }): Promise<ProductWithPrice[]> {
    const ids = opts?.ids ?? Object.keys(this.catalog);
    return ids.map((id) => this.catalog[id]).filter(Boolean);
  }
}

class FakeRecsRepo implements IRecommendationReadRepository {
  public recentInteractionsCalled = 0;
  constructor(
    private readonly opts: {
      interactions?: RecentInteraction[];
      similar?: Record<string, CoOccurrenceResult>;
      bestsellers?: PopularProduct[];
      trending?: PopularProduct[];
    } = {}
  ) {}
  async getCoViewed(): Promise<CoOccurrenceResult> {
    return { anchorSupport: 0, candidates: [] };
  }
  async getCoCarted(): Promise<CoOccurrenceResult> {
    return { anchorSupport: 0, candidates: [] };
  }
  async getCoPurchased(): Promise<CoOccurrenceResult> {
    return { anchorSupport: 0, candidates: [] };
  }
  async getSimilarForAnchor(productId: string): Promise<CoOccurrenceResult> {
    return this.opts.similar?.[productId] ?? { anchorSupport: 0, candidates: [] };
  }
  async getPopularProducts(): Promise<PopularProduct[]> {
    return this.opts.trending ?? [];
  }
  async getTrendingProducts(): Promise<PopularProduct[]> {
    return this.opts.trending ?? [];
  }
  async getBestSellingProducts(): Promise<PopularProduct[]> {
    return this.opts.bestsellers ?? [];
  }
  async getMostCartedProducts(): Promise<PopularProduct[]> {
    return [];
  }
  async getNewArrivals(): Promise<PopularProduct[]> {
    return [];
  }
  async getRecentInteractions(): Promise<RecentInteraction[]> {
    this.recentInteractionsCalled++;
    return this.opts.interactions ?? [];
  }
  async getPurchasedProductIds(): Promise<string[]> {
    return [];
  }
  async getCartProductIds(): Promise<string[]> {
    return [];
  }
  async getProductContext(ids: string[]): Promise<RecommendationProductContext[]> {
    return ids.map((productId) => ({
      productId,
      categoryId: null,
      categoryName: 'Power banks',
      price: 50000,
      stockStatus: 'in_stock',
      stockQty: 10,
      isNewArrival: false,
      isClearance: false,
      isPublished: true,
    }));
  }
}

const catalog = {
  p1: makeProduct('p1', 'GoldPlus 20,000mAh Power Bank'),
  rec1: makeProduct('rec1', 'USB-C Fast Charge Cable', 'Cables'),
  best1: makeProduct('best1', 'Bestselling Charger', 'Chargers'),
  trend1: makeProduct('trend1', 'Trending Earbuds', 'Personal audio'),
};

describe('GetPersonalizedRecommendationsUseCase — consent & privacy', () => {
  it('does NOT personalise (or read history) without personalization consent', async () => {
    const recs = new FakeRecsRepo({ bestsellers: [{ productId: 'best1', score: 5 }], trending: [{ productId: 'trend1', score: 3 }] });
    const uc = new GetPersonalizedRecommendationsUseCase(recs, new FakeProductRepo(catalog));

    const out = await uc.execute({ identity: { userId: 'u1', visitorId: 'v1' }, consent: { personalization: false } });

    expect(recs.recentInteractionsCalled).toBe(0); // never touched personal history
    expect(out.map((r) => r.product.id)).toContain('best1');
    expect(out.every((r) => r.reasonCode === 'fallback_popular' || r.reasonCode === 'trending_now')).toBe(true);
  });

  it('falls back to popular for an anonymous request with no identity', async () => {
    const recs = new FakeRecsRepo({ bestsellers: [{ productId: 'best1', score: 5 }] });
    const uc = new GetPersonalizedRecommendationsUseCase(recs, new FakeProductRepo(catalog));

    const out = await uc.execute({ identity: { userId: null, visitorId: null }, consent: { personalization: true } });
    expect(recs.recentInteractionsCalled).toBe(0);
    expect(out.map((r) => r.product.id)).toContain('best1');
  });

  it('seeds personalisation from a purchase and names it in the reason', async () => {
    const recs = new FakeRecsRepo({
      interactions: [{ productId: 'p1', productName: 'GoldPlus 20,000mAh Power Bank', kind: 'purchase', ageDays: 1 }],
      similar: { p1: { anchorSupport: 50, candidates: [{ productId: 'rec1', coCount: 20, candidateSupport: 30 }] } },
      trending: [],
    });
    const uc = new GetPersonalizedRecommendationsUseCase(recs, new FakeProductRepo(catalog));

    const out = await uc.execute({ identity: { userId: 'u1', visitorId: 'v1' }, consent: { personalization: true } });

    expect(recs.recentInteractionsCalled).toBe(1);
    const rec = out.find((r) => r.product.id === 'rec1');
    expect(rec).toBeTruthy();
    expect(rec!.reason).toContain('GoldPlus 20,000mAh Power Bank');
    expect(rec!.reasonCode).toBe('because_purchased');
  });
});
