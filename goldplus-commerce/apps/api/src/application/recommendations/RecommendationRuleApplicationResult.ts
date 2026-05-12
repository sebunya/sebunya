import type { RecommendationPlacement, RecommendationCandidate } from "../../domain/recommendations/RecommendationTypes";
import type { RuleConflict } from "./RecommendationRuleConflictService";
import type { RecommendationRule } from "../../domain/recommendations/RecommendationRuleTypes";

export { RuleConflict };

export interface ApplyRecommendationRulesInput {
  placement: RecommendationPlacement;
  context: {
    productId?: string;
    categoryId?: string;
    categorySlug?: string;
    cartProductIds?: string[];
  };
  candidates: RecommendationCandidate[];
  now?: Date;
  activeRulesOverride?: RecommendationRule[];
}

export interface ApplyRecommendationRulesResult {
  candidates: RecommendationCandidate[];
  appliedRuleIds: string[];
  suppressedProductIds: string[];
  pinnedProductIds: string[];
  warnings: RuleConflict[];
}
