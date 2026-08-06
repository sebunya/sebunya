import type { IRecommendationEventRepository } from "../ports/IRecommendationEventRepository";

export interface TrendingSignal {
  /** 1 = the most-engaged product in the window. */
  rank: number;
  weightedEngagement: number;
  distinctEventGroups: number;
}

/**
 * Engagement velocity over the last 7 days, expressed as RANKS (R3).
 *
 * The old service returned raw weighted sums that scoring then treated AS a
 * rank (`min(rank*2, 100)`), so one purchase-weight event saturated the cap
 * and every popular product scored identically. Ranks are what scoring
 * actually wants: deterministic (ties broken by product id) and bounded by
 * construction.
 *
 * `sampleSize` is the total weighted engagement across the window — the
 * caller uses it to report INSUFFICIENT_SAMPLE honestly instead of ranking
 * noise (§16: every rate has a minimum denominator; so does a trend).
 */
export class TrendingScoreService {
  constructor(private readonly events: IRecommendationEventRepository) {}

  async getTrendingSignals(now = new Date()): Promise<{
    byProduct: Map<string, TrendingSignal>;
    sampleSize: number;
  }> {
    const since = new Date(now.getTime() - 7 * 24 * 60 * 60_000);

    const aggregated = await this.events.getTrendingEvents({ since, limit: 1000 });

    const raw = new Map<string, { weighted: number; groups: number }>();
    for (const item of aggregated) {
      const weight = this.getEventWeight(item.eventType);
      const recency = this.getRecencyFactor(item.lastSeenAt, now);
      const current = raw.get(item.productId) ?? { weighted: 0, groups: 0 };
      raw.set(item.productId, {
        weighted: current.weighted + item.count * weight * recency,
        groups: current.groups + 1,
      });
    }

    const ordered = [...raw.entries()].sort(
      (a, b) => b[1].weighted - a[1].weighted || a[0].localeCompare(b[0]),
    );

    const byProduct = new Map<string, TrendingSignal>();
    let sampleSize = 0;
    ordered.forEach(([productId, { weighted, groups }], index) => {
      sampleSize += weighted;
      byProduct.set(productId, {
        rank: index + 1,
        weightedEngagement: weighted,
        distinctEventGroups: groups,
      });
    });

    return { byProduct, sampleSize };
  }

  /**
   * Retained for the transition: the shape the scorer historically consumed.
   * New callers use getTrendingSignals.
   */
  async getTrendingScores(now = new Date()): Promise<Map<string, number>> {
    const { byProduct } = await this.getTrendingSignals(now);
    return new Map([...byProduct.entries()].map(([id, s]) => [id, s.weightedEngagement]));
  }

  private getEventWeight(type: string): number {
    switch (type) {
      case "PRODUCT_PURCHASED":
        return 10;
      case "PRODUCT_ADDED_TO_CART":
      case "RECOMMENDATION_ADD_TO_CART":
        return 5;
      case "RECOMMENDATION_CLICKED":
        return 2;
      case "PRODUCT_VIEWED":
        return 1;
      default:
        return 0.1;
    }
  }

  private getRecencyFactor(lastSeen: Date, now: Date): number {
    const ageHours = (now.getTime() - lastSeen.getTime()) / (1000 * 60 * 60);
    return Math.max(0.1, Math.pow(0.95, Math.min(ageHours / 24, 30)));
  }
}
