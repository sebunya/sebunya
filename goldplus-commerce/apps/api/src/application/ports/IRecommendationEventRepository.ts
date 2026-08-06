import { RecommendationEvent } from "../../domain/recommendations/RecommendationEvent";
import type { RecommendationEventType } from "@goldplus/shared";

export interface RecentEventQuery {
  anonymousId?: string;
  customerId?: string;
  eventType?: RecommendationEventType;
  productId?: string;
  recommendationProductId?: string;
  placement?: string;
  withinMinutes?: number;
  limit?: number;
}

export interface TrendingEventAggregate {
  productId: string;
  eventType: RecommendationEventType;
  count: number;
  lastSeenAt: Date;
}

export interface IRecommendationEventRepository {
  /** Returns true when the row was written, false when the database absorbed it as a duplicate (dedupe_key conflict). */
  save(event: RecommendationEvent): Promise<boolean>;
  existsRecentSimilarEvent(query: RecentEventQuery): Promise<boolean>;
  findRecentlyViewed(input: {
    anonymousId?: string;
    customerId?: string;
    limit: number;
  }): Promise<Array<{ productId: string; viewedAt: Date }>>;
  /**
   * Product ids this profile actually SAW recently (view-verified impressions
   * and clicks) — the input to the recency penalty (§5A.9). Server-side, so a
   * cleared cookie resets continuity, not the cap logic.
   */
  findRecentlyShownProductIds(input: {
    profileId: string;
    withinHours: number;
    limit: number;
  }): Promise<string[]>;

  getTrendingEvents(input: {
    since: Date;
    limit?: number;
  }): Promise<TrendingEventAggregate[]>;
}
