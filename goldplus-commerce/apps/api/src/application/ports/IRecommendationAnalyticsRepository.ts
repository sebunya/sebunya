import type { RecommendationAnalyticsQuery } from "@goldplus/shared";

export interface AnalyticsSummary {
  totalEvents: number;
  impressions: number;
  clicks: number;
  addToCart: number;
  attributedEvents: number;
  unattributedEvents: number;
  organicEvents: number;
  ruleAssistedEvents: number;
  uniqueAnonymousVisitors: number;
  uniqueBrowserVisitors: number;
  uniqueCarts: number;
}

export interface PlacementPerformanceRecord {
  placement: string;
  impressions: number;
  clicks: number;
  addToCart: number;
  attributedEvents: number;
  organicEvents: number;
  ruleAssistedEvents: number;
}

export interface RulePerformanceRecord {
  ruleId: string | null;
  ruleName: string | null;
  impressions: number;
  clicks: number;
  addToCart: number;
  placementsTouched: string[];
  productsTouched: number;
  reasonCodes: string[];
}

export interface ProductPerformanceRecord {
  productId: string;
  productName: string | null;
  sku: string | null;
  impressions: number;
  clicks: number;
  addToCart: number;
  placements: string[];
  ruleAssistedCount: number;
  organicCount: number;
}

export interface EventHealthMetrics {
  totalEvents: number;
  eventsByType: Record<string, number>;
  missingAttributionId: number;
  missingPlacement: number;
  missingProductId: number;
  missingAnonymousId: number;
  latestEventAt: Date | null;
}

export interface IdentityHealthMetrics {
  eventsWithAnonymousId: number;
  eventsWithBrowserId: number;
  eventsWithCartId: number;
  eventsWithLeadId: number;
  eventsWithCustomerId: number;
  identityLinks: number;
  anonymousToLeadLinks: number;
  anonymousToCustomerLinks: number;
}

export interface IRecommendationAnalyticsRepository {
  getSummaryMetrics(query: Omit<RecommendationAnalyticsQuery, "startDate" | "endDate"> & { startDate: Date; endDate: Date }): Promise<AnalyticsSummary>;
  getPlacementPerformance(query: Omit<RecommendationAnalyticsQuery, "startDate" | "endDate"> & { startDate: Date; endDate: Date }): Promise<PlacementPerformanceRecord[]>;
  getRulePerformance(query: Omit<RecommendationAnalyticsQuery, "startDate" | "endDate"> & { startDate: Date; endDate: Date }): Promise<RulePerformanceRecord[]>;
  getProductPerformance(query: Omit<RecommendationAnalyticsQuery, "startDate" | "endDate"> & { startDate: Date; endDate: Date }): Promise<ProductPerformanceRecord[]>;
  getEventHealth(query: Omit<RecommendationAnalyticsQuery, "startDate" | "endDate"> & { startDate: Date; endDate: Date }): Promise<EventHealthMetrics>;
  getIdentityHealth(query: Omit<RecommendationAnalyticsQuery, "startDate" | "endDate"> & { startDate: Date; endDate: Date }): Promise<IdentityHealthMetrics>;
}

