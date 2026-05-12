import type {
  ProductSignals,
  RecommendationCandidate,
  RecommendationPlacement,
  RecommendationReasonCode,
} from "../../domain/recommendations/RecommendationTypes";
import type { CompatibilityRuleService } from "./CompatibilityRuleService";

export interface ScoringContext {
  placement: RecommendationPlacement;
  sourceSignals?: ProductSignals;
  cartSignals?: ProductSignals[];
  trendingScores?: Map<string, number>;
}

export class RecommendationScoringService {
  constructor(private readonly compatibility: CompatibilityRuleService) {}

  scoreCandidates(
    candidates: RecommendationCandidate[],
    context: ScoringContext,
  ): RecommendationCandidate[] {
    return candidates.map((candidate) => this.scoreSingle(candidate, context));
  }

  private scoreSingle(
    candidate: RecommendationCandidate,
    context: ScoringContext,
  ): RecommendationCandidate {
    let score = 0;
    const reasonCodes: RecommendationReasonCode[] = [];

    if (candidate.signals.isFeatured) {
      score += 50;
      reasonCodes.push("FEATURED");
    }

    if (context.trendingScores?.has(candidate.productId)) {
      const rank = context.trendingScores.get(candidate.productId) ?? 0;
      score += Math.min(rank * 2, 100);
      if (rank > 5) reasonCodes.push("POPULAR_NOW");
    }

    if (context.placement === "complete_setup" && context.sourceSignals) {
      const compat = this.compatibility.evaluate(context.sourceSignals, candidate.signals);
      if (!compat.compatible) {
        // Hard negative filtering for complete setup
        return { ...candidate, score: -9999, reasonCodes: [] };
      }

      score += compat.confidence === "HIGH" ? 200 : 100;
      reasonCodes.push("COMPATIBLE_ACCESSORY");

      if (compat.reasons.includes("MATCHING_CONNECTOR")) {
        score += 50;
        reasonCodes.push("MATCHING_CONNECTOR");
      }
    }

    if (
      (context.placement === "product_related" || context.placement === "category_popular") &&
      context.sourceSignals
    ) {
      if (candidate.signals.categoryId === context.sourceSignals.categoryId) {
        score += 40;
        reasonCodes.push("SAME_CATEGORY");
      }

      if (
        candidate.signals.productFamily &&
        candidate.signals.productFamily === context.sourceSignals.productFamily
      ) {
        score += 60;
      }

      const setA = new Set(context.sourceSignals.connectorTypes.filter((t) => t !== "unknown"));
      const hasSharedConnector = candidate.signals.connectorTypes.some(
        (t) => t !== "unknown" && setA.has(t),
      );
      if (hasSharedConnector) {
        score += 30;
        reasonCodes.push("MATCHING_CONNECTOR");
      }
    }

    if (context.placement === "cart_addon") {
      if (["cable", "adapter", "screen_protector"].includes(candidate.signals.productType ?? "")) {
        score += 40;
        reasonCodes.push("CART_ADDON");
      }
      if (candidate.signals.priceBand === "low" || candidate.signals.priceBand === "mid") {
        score += 20;
      }
    }

    const uniqueReasons = Array.from(new Set(reasonCodes));

    this.ensureReasonCodes(candidate, context, uniqueReasons);

    return {
      ...candidate,
      score,
      reasonCodes: uniqueReasons,
      displayReason: this.resolveDisplayReason(context.placement, uniqueReasons),
    };
  }

  private ensureReasonCodes(
    candidate: RecommendationCandidate,
    context: ScoringContext,
    reasonCodes: RecommendationReasonCode[],
  ): void {
    if (reasonCodes.length > 0) return;

    if (context.placement === "home_trending") {
      reasonCodes.push("POPULAR_NOW");
    } else if (context.placement === "category_popular") {
      reasonCodes.push("SAME_CATEGORY");
    } else if (context.placement === "product_related") {
      if (context.sourceSignals && candidate.signals.categoryId === context.sourceSignals.categoryId) {
        reasonCodes.push("SAME_CATEGORY");
      } else {
        reasonCodes.push("POPULAR_NOW");
      }
    } else if (context.placement === "complete_setup") {
      reasonCodes.push("COMPATIBLE_ACCESSORY");
    } else if (context.placement === "cart_addon") {
      reasonCodes.push("CART_ADDON");
    } else if (context.placement === "recently_viewed") {
      reasonCodes.push("RECENTLY_VIEWED");
    } else {
      reasonCodes.push("POPULAR_NOW"); // Safe fallback
    }
  }

  private resolveDisplayReason(
    placement: RecommendationPlacement,
    reasons: RecommendationReasonCode[],
  ): string | undefined {
    if (reasons.includes("COMPATIBLE_ACCESSORY")) return "Compatible Accessory";
    if (reasons.includes("MATCHING_CONNECTOR")) return "Fits your Device";
    if (reasons.includes("POPULAR_NOW")) return "Popular Now";
    if (reasons.includes("SAME_CATEGORY")) return "You May Also Like";
    if (reasons.includes("CART_ADDON")) return "Useful Add-on";
    if (placement === "complete_setup") return "Best Fit";
    return undefined;
  }
}
