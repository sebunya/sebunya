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
  /** Pin positions to re-apply as the FINAL ordering step (R9). */
  pins: Array<{ productId: string; position: number }>;
  warnings: RuleConflict[];
}
