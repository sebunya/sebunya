import { ProductPublicDto } from '@goldplus/shared';
import { IProductRepository } from '../../ports/IProductRepository';
import { IRecommendationReadRepository } from '../../ports/IRecommendationReadRepository';
import { toProductPublicDto } from '../../mappers/toProductPublicDto';

const POOL_LIMIT = 40;

export type PopularStrategy = 'trending' | 'bestseller' | 'new_arrival';

/**
 * Popular-product shelves from real data — trending (recent views/carts),
 * bestsellers (actual units sold from paid orders), and new arrivals
 * (recently created products). Trending and bestseller are DISTINCT signals,
 * never conflated. No fabricated scarcity or fake "best seller" labels.
 */
export class GetTrendingProductsUseCase {
  constructor(
    private readonly recs: IRecommendationReadRepository,
    private readonly products: IProductRepository
  ) {}

  async execute(
    input: { limit?: number; sinceDays?: number; categoryId?: string | null; strategy?: PopularStrategy } = {}
  ): Promise<ProductPublicDto[]> {
    const limit = Math.max(1, Math.min(input.limit ?? 8, 20));
    const sinceDays = Math.max(1, Math.min(input.sinceDays ?? 30, 180));
    const categoryId = input.categoryId ?? undefined;
    const strategy = input.strategy ?? 'trending';

    const popular =
      strategy === 'bestseller'
        ? await this.recs.getBestSellingProducts({ sinceDays, limit: POOL_LIMIT, categoryId })
        : strategy === 'new_arrival'
          ? await this.recs.getNewArrivals({ limit: POOL_LIMIT, categoryId })
          : await this.recs.getTrendingProducts({ sinceDays, limit: POOL_LIMIT, categoryId });
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
