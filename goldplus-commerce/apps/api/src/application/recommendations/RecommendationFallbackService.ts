import type { RecommendationPlacement } from "@goldplus/shared";
import type {
  IProductRecommendationReader,
  RecommendationProductRecord,
} from "../ports/IProductRecommendationReader";

export class RecommendationFallbackService {
  constructor(private readonly products: IProductRecommendationReader) {}

  async getFallbackProducts(input: {
    placement: RecommendationPlacement;
    categoryId?: string;
    categorySlug?: string;
    excludeProductIds?: string[];
    limit: number;
  }): Promise<RecommendationProductRecord[]> {
    if (input.placement === "recently_viewed") {
      return [];
    }

    if (input.placement === "complete_setup") {
      // Safer to show empty than bad accessories.
      return [];
    }

    if (input.placement === "category_popular" && (input.categoryId || input.categorySlug)) {
      return this.products.findPublicProducts({
        categoryId: input.categoryId,
        categorySlug: input.categorySlug,
        excludeProductIds: input.excludeProductIds,
        limit: input.limit,
      });
    }

    return this.products.findPublicProducts({
      excludeProductIds: input.excludeProductIds,
      limit: input.limit,
    });
  }
}
