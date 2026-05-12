import type { IRecommendationEventRepository } from "../ports/IRecommendationEventRepository";

export class TrendingScoreService {
  constructor(private readonly events: IRecommendationEventRepository) {}

  async getTrendingScores(now = new Date()): Promise<Map<string, number>> {
    const since = new Date(now.getTime() - 7 * 24 * 60 * 60_000); // 7 days

    const aggregated = await this.events.getTrendingEvents({
      since,
      limit: 1000,
    });

    const rawScores = new Map<string, number>();

    for (const item of aggregated) {
      const weight = this.getEventWeight(item.eventType);
      const recencyFactor = this.getRecencyFactor(item.lastSeenAt, now);
      const value = item.count * weight * recencyFactor;

      const current = rawScores.get(item.productId) ?? 0;
      rawScores.set(item.productId, current + value);
    }

    return rawScores;
  }

  private getEventWeight(type: string): number {
    switch (type) {
      case "PRODUCT_PURCHASED":
        return 10;
      case "PRODUCT_ADDED_TO_CART":
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
    // Simple exponential decay approximate.
    return Math.max(0.1, Math.pow(0.95, Math.min(ageHours / 24, 30)));
  }
}
