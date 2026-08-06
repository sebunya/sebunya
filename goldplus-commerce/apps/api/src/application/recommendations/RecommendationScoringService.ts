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
  /** Deterministic engagement RANKS (1 = hottest), from TrendingScoreService (R3). */
  trendingRanks?: Map<string, { rank: number }>;
  /** Total weighted engagement in the window — below threshold, popularity contributes nothing and claims nothing. */
  trendingSampleSize?: number;
  /** Units-sold ranks from PAID orders, when the bestseller source has evidence. */
  bestsellerRanks?: Map<string, { rank: number }>;
}

/**
 * The minimum weighted engagement before "popular" means anything (R3). Below
 * this, the trend component is OFF and POPULAR_NOW is never claimed — one
 * visit by one person is not a trend (§5.3: never fake popularity).
 */
export const TRENDING_MIN_SAMPLE = 30;

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

    // R3: the FEATURED component was removed — `isFeatured` is hard-coded
    // false at the reader (no such catalogue column), so the +50 was dead
    // weight pretending to be a lever. It returns if the catalogue ever
    // carries a real featured flag.

    // R3: popularity is a bounded function of RANK, not of raw event volume —
    // the old code fed a weighted SUM into `min(sum*2, 100)`, saturating after
    // a single purchase-weight event. And it only speaks with a real sample.
    const sufficientTrend = (context.trendingSampleSize ?? 0) >= TRENDING_MIN_SAMPLE;
    const trend = sufficientTrend ? context.trendingRanks?.get(candidate.productId) : undefined;
    if (trend) {
      score += Math.max(0, 60 - (trend.rank - 1) * 10);
      if (trend.rank <= 5) reasonCodes.push("POPULAR_NOW");
    }

    const bestseller = context.bestsellerRanks?.get(candidate.productId);
    if (bestseller) {
      score += Math.max(0, 80 - (bestseller.rank - 1) * 15);
      reasonCodes.push("POPULAR_NOW");
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
