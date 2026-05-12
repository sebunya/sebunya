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
  save(event: RecommendationEvent): Promise<void>;
  existsRecentSimilarEvent(query: RecentEventQuery): Promise<boolean>;
  findRecentlyViewed(input: {
    anonymousId?: string;
    customerId?: string;
    limit: number;
  }): Promise<Array<{ productId: string; viewedAt: Date }>>;
  getTrendingEvents(input: {
    since: Date;
    limit?: number;
  }): Promise<TrendingEventAggregate[]>;
}
