import { ProductPublicDto } from '@goldplus/shared';
import { IProductRepository } from '../../ports/IProductRepository';
import { IRecommendationReadRepository } from '../../ports/IRecommendationReadRepository';
import { toProductPublicDto } from '../../mappers/toProductPublicDto';

const POOL_LIMIT = 40;

/**
 * Trending products from real recent activity — the homepage / cold-start
 * surface. Popularity is derived from genuine PRODUCT_VIEW / ADD_TO_CART
 * events, never fabricated scarcity or fake "best seller" labels.
 */
export class GetTrendingProductsUseCase {
  constructor(
    private readonly recs: IRecommendationReadRepository,
    private readonly products: IProductRepository
  ) {}

  async execute(input: { limit?: number; sinceDays?: number; categoryId?: string | null } = {}): Promise<ProductPublicDto[]> {
    const limit = Math.max(1, Math.min(input.limit ?? 8, 20));
    const sinceDays = Math.max(1, Math.min(input.sinceDays ?? 30, 90));

    const popular = await this.recs.getPopularProducts({ sinceDays, limit: POOL_LIMIT, categoryId: input.categoryId ?? undefined });
    if (popular.length === 0) return [];

    const rankById = new Map(popular.map((p, i) => [p.productId, i]));
    const rows = await this.products.findPublicViewList({ ids: popular.map((p) => p.productId), limit: POOL_LIMIT });

    return rows
      .map((row) => toProductPublicDto(row))
      .filter((dto) => rankById.has(dto.id))
      .sort((a, b) => (rankById.get(a.id)! - rankById.get(b.id)!))
      .slice(0, limit);
  }
}
