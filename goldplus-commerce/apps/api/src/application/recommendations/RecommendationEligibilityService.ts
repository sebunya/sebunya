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
          // R9: this block was an empty if holding an unanswered question,
          // which in practice meant "pass everything". Decided: a category
          // rail asked without a category has no answerable question — it
          // serves nothing rather than leaking the whole catalogue.
          return false;
        }
      }

      return true;
    });
  }
}
