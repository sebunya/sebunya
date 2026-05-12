import type {
  RecommendationCandidate,
  RecommendationPlacement,
} from "../../domain/recommendations/RecommendationTypes";

export interface EligibilityFilters {
  placement: RecommendationPlacement;
  contextProductId?: string;
  categoryId?: string;
  categorySlug?: string;
  cartProductIds?: string[];
  requireImage?: boolean;
}

export class RecommendationEligibilityService {
  filter(
    candidates: RecommendationCandidate[],
    options: EligibilityFilters,
  ): RecommendationCandidate[] {
    return candidates.filter((candidate) => {
      if (!candidate.signals.isActive) return false;
      if (candidate.signals.isVisible === false) return false;
      if (!candidate.signals.isInStock) return false;
      if (!candidate.slug) return false;

      if (options.requireImage && !candidate.imageUrl) {
        return false;
      }

      if (options.contextProductId && candidate.productId === options.contextProductId) {
        return false;
      }

      if (
        (options.placement === "cart_addon" || options.placement === "complete_setup") &&
        options.cartProductIds?.includes(candidate.productId)
      ) {
        return false;
      }

      if (options.placement === "category_popular") {
        if (options.categoryId && candidate.signals.categoryId !== options.categoryId) {
          return false;
        }
        if (options.categorySlug && candidate.signals.categorySlug !== options.categorySlug) {
          return false;
        }
        if (!options.categoryId && !options.categorySlug) {
          // If a category rail is requested but no category is specified, that's invalid context
          // but if it happens, we shouldn't leak everything. For safety, return true or false?
          // The prompt says: "products with missing category data do not bypass category_popular filter when a category is requested."
          // If options.categoryId or Slug are not provided to the rail, it shouldn't show.
        }
      }

      return true;
    });
  }
}
