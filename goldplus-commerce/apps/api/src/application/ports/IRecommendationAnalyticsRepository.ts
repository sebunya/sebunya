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


export interface DepthMetricsRaw {
  totalEvents: number;
  distinctRecommendedProducts: number;
  activeProducts: number;
  nullPlacementEvents: number;
  invalidPlacementEvents: number;
  topProducts: Array<{ productId: string; events: number }>;
  sourceBreakdown: Array<{ source: string; events: number }>;
}

export interface IRecommendationAnalyticsRepository {
  /** Evidence for the five commercial outcome metrics over a date window. */
  getCommercialAttribution(startDate: Date, endDate: Date): Promise<CommercialAttributionEvidence>;

  getServingHealth(sinceDays: number): Promise<{
    windowDays: number;
    placements: Array<{
      placement: string;
      responses: number;
      empty: number;
      fallbackServed: number;
      lastResponseAt: Date | null;
    }>;
    totalResponses: number;
  }>;

  getLineageReport(sinceDays: number): Promise<{
    windowDays: number;
    total: number;
    historicPreContract: number;
    contractV2: number;
    identityUnavailable: number;
    railEventsMissingPlacement: number;
    orphanClicks: number;
    attributedAtcWithoutExposure: number;
    profileStamped: number;
    totalClicks: number;
    clientContractV2: number;
    clientProfileStamped: number;
  }>;

  /** Raw counts for §19 depth metrics over a window; percentages are computed (and gated) in the service. */
  depthMetricsRaw(windowDays: number): Promise<DepthMetricsRaw>;
  getSummaryMetrics(query: Omit<RecommendationAnalyticsQuery, "startDate" | "endDate"> & { startDate: Date; endDate: Date }): Promise<AnalyticsSummary>;
  getPlacementPerformance(query: Omit<RecommendationAnalyticsQuery, "startDate" | "endDate"> & { startDate: Date; endDate: Date }): Promise<PlacementPerformanceRecord[]>;
  getRulePerformance(query: Omit<RecommendationAnalyticsQuery, "startDate" | "endDate"> & { startDate: Date; endDate: Date }): Promise<RulePerformanceRecord[]>;
  getProductPerformance(query: Omit<RecommendationAnalyticsQuery, "startDate" | "endDate"> & { startDate: Date; endDate: Date }): Promise<ProductPerformanceRecord[]>;
  getEventHealth(query: Omit<RecommendationAnalyticsQuery, "startDate" | "endDate"> & { startDate: Date; endDate: Date }): Promise<EventHealthMetrics>;
  getIdentityHealth(query: Omit<RecommendationAnalyticsQuery, "startDate" | "endDate"> & { startDate: Date; endDate: Date }): Promise<IdentityHealthMetrics>;
}

/**
 * Commercial attribution evidence for the recommendation dashboard.
 *
 * The join is deliberately explicit about what counts: an attributed line only
 * becomes revenue when its order was actually paid and not cancelled. Carts and
 * started checkouts reach this query but are marked, not counted.
 */
export interface CommercialAttributionEvidence {
  attributedLines: Array<{
    orderId: string;
    productId: string;
    lineTotalUgx: number;
    cogsUgx: number | null;
    paid: boolean;
    cancelled: boolean;
    refundedUgx: number;
    customerId: string | null;
    currency: string;
  }>;
  attributedCompletedOrders: number;
  /** Null when NO media spend record exists — never coerced to zero. */
  mediaSpendUgx: number | null;
  customerOrderTotals: Array<{ customerId: string; completedOrders: number; totalPaidUgx: number }>;
}
