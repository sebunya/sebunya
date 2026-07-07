import { ProductPublicDto } from '@goldplus/shared';
import { IProductRepository } from '../../ports/IProductRepository';
import { IRecommendationReadRepository } from '../../ports/IRecommendationReadRepository';
import { toProductPublicDto } from '../../mappers/toProductPublicDto';
import {
  scoreCoOccurrences,
  finalizeRecommendations,
  blendWithFallback,
  ScoredProduct,
} from '../../../domain/recommendation/Recommendation';

const POOL_LIMIT = 40;
const MAX_PER_CATEGORY = 3;

export interface ProductRecommendations {
  boughtTogether: ProductPublicDto[];
  alsoViewed: ProductPublicDto[];
}

/**
 * Recommendations shown on a product page: "frequently bought together"
 * and "customers who viewed this also viewed", each normalised, filtered
 * to publicly-available products, and topped up from category best-sellers
 * when a brand-new product has thin signal (cold start).
 */
export class GetProductRecommendationsUseCase {
  constructor(
    private readonly recs: IRecommendationReadRepository,
    private readonly products: IProductRepository
  ) {}

  async execute(input: { productId: string; categoryId?: string | null; limit?: number }): Promise<ProductRecommendations> {
    const limit = Math.max(1, Math.min(input.limit ?? 8, 20));
    const exclude = new Set<string>([input.productId]);

    const [coPurchased, coViewed, popular] = await Promise.all([
      this.recs.getCoPurchased(input.productId, POOL_LIMIT),
      this.recs.getCoViewed(input.productId, POOL_LIMIT),
      this.recs.getPopularProducts({ sinceDays: 30, limit: POOL_LIMIT, categoryId: input.categoryId ?? undefined }),
    ]);

    const boughtScored = scoreCoOccurrences(coPurchased.anchorSupport, coPurchased.candidates);
    const viewedScored = scoreCoOccurrences(coViewed.anchorSupport, coViewed.candidates);
    const fallback: ScoredProduct[] = popular.map((p) => ({ productId: p.productId, score: p.score }));

    const boughtBlend = blendWithFallback(boughtScored, fallback, { limit: POOL_LIMIT, excludeIds: exclude });
    const viewedBlend = blendWithFallback(viewedScored, fallback, { limit: POOL_LIMIT, excludeIds: exclude });

    const [boughtTogether, alsoViewed] = await Promise.all([
      this.resolve(boughtBlend, limit, exclude),
      this.resolve(viewedBlend, limit, exclude),
    ]);

    return { boughtTogether, alsoViewed };
  }

  private async resolve(scored: ScoredProduct[], limit: number, exclude: Set<string>): Promise<ProductPublicDto[]> {
    if (scored.length === 0) return [];
    const poolIds = scored.slice(0, POOL_LIMIT).map((s) => s.productId);
    const rows = await this.products.findPublicViewList({ ids: poolIds, limit: POOL_LIMIT });

    const dtoById = new Map<string, ProductPublicDto>();
    const categoryById = new Map<string, string | null>();
    for (const row of rows) {
      const dto = toProductPublicDto(row);
      dtoById.set(dto.id, dto);
      categoryById.set(dto.id, row.categoryName ?? null);
    }

    // Keep only products that actually resolved as public/available; this
    // naturally drops unpublished, removed, or out-of-scope items.
    const resolvable = scored.filter((s) => dtoById.has(s.productId));
    const final = finalizeRecommendations(resolvable, {
      limit,
      excludeIds: exclude,
      categoryOf: (id) => categoryById.get(id) ?? null,
      maxPerCategory: MAX_PER_CATEGORY,
    });
    return final.map((s) => dtoById.get(s.productId)!).filter(Boolean);
  }
}
