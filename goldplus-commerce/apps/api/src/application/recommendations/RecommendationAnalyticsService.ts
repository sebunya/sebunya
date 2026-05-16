import type { 
  RecommendationAnalyticsQuery, 
  RecommendationAnalyticsResponse,
  AnalyticsTrackingStatus,
  UnavailableMetric
} from "@goldplus/shared";
import type { IRecommendationAnalyticsRepository } from "../ports/IRecommendationAnalyticsRepository";

export class RecommendationAnalyticsService {
  constructor(private readonly repo: IRecommendationAnalyticsRepository) {}

  async getAnalytics(query: RecommendationAnalyticsQuery): Promise<RecommendationAnalyticsResponse> {
    const { startDate, endDate } = this.parseDateRange(query);

    // Omit the string-based dates from the query so we can override them with Date objects
    const { startDate: _, endDate: __, ...rest } = query;
    const fullQuery = { ...rest, startDate, endDate };

    const [
      summary,
      placements,
      rules,
      products,
      health,
      identity
    ] = await Promise.all([
      this.repo.getSummaryMetrics(fullQuery),
      this.repo.getPlacementPerformance(fullQuery),
      this.repo.getRulePerformance(fullQuery),
      this.repo.getProductPerformance(fullQuery),
      this.repo.getEventHealth(fullQuery),
      this.repo.getIdentityHealth(fullQuery)
    ]);

    return {
      range: {
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        timezone: "UTC"
      },
      filters: {
        placement: query.placement,
        ruleId: query.ruleId,
        productId: query.productId,
        eventType: query.eventType
      },
      summary: {
        ...summary,
        ctr: this.ratio(summary.clicks, summary.impressions),
        addToCartRate: this.ratio(summary.addToCart, summary.impressions),
        clickToCartRate: this.ratio(summary.addToCart, summary.clicks)
      },
      placementPerformance: placements.map(p => ({
        ...p,
        ctr: this.ratio(p.clicks, p.impressions),
        addToCartRate: this.ratio(p.addToCart, p.impressions),
        clickToCartRate: this.ratio(p.addToCart, p.clicks),
        attributedEventShare: this.ratio(p.attributedEvents, p.impressions + p.clicks + p.addToCart),
        organicEventShare: this.ratio(p.organicEvents, p.impressions + p.clicks + p.addToCart),
        ruleAssistedEventShare: this.ratio(p.ruleAssistedEvents, p.impressions + p.clicks + p.addToCart)
      })),
      rulePerformance: rules.map(r => ({
        ...r,
        label: r.ruleName || (r.ruleId ? "Unnamed Rule" : "Organic / no rule"),
        ctr: this.ratio(r.clicks, r.impressions),
        addToCartRate: this.ratio(r.addToCart, r.impressions)
      })),
      productPerformance: products.map(p => ({
        ...p,
        productName: p.productName ?? undefined,
        sku: p.sku ?? undefined,
        ctr: this.ratio(p.clicks, p.impressions),
        addToCartRate: this.ratio(p.addToCart, p.impressions)
      })),
      eventHealth: {
        ...health,
        latestEventAt: health.latestEventAt?.toISOString() ?? null,
        trackingStatus: this.determineTrackingStatus(health.totalEvents, health.latestEventAt),
        dataQualityWarnings: this.generateQualityWarnings(health)
      },
      identityHealth: {
        ...identity,
        identityLinkRate: this.ratio(identity.eventsWithLeadId + identity.eventsWithCustomerId, identity.eventsWithAnonymousId)
      },
      unavailableMetrics: this.getUnavailableMetrics()
    };
  }

  private parseDateRange(query: RecommendationAnalyticsQuery): { startDate: Date; endDate: Date } {
    const end = query.endDate ? new Date(query.endDate) : new Date();
    const start = query.startDate ? new Date(query.startDate) : new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      throw new Error("Invalid date format.");
    }

    if (start > end) {
      throw new Error("startDate must be before endDate.");
    }

    return { startDate: start, endDate: end };
  }

  private ratio(numerator: number, denominator: number): number | null {
    if (denominator <= 0) return null;
    return numerator / denominator;
  }

  private determineTrackingStatus(total: number, latest: Date | null): AnalyticsTrackingStatus {
    if (total === 0) return "no_data";
    
    if (latest) {
      const ageMs = Date.now() - latest.getTime();
      if (ageMs > 24 * 60 * 60 * 1000) return "quiet";
    }

    return "healthy";
  }

  private generateQualityWarnings(health: { totalEvents: number; missingAnonymousId: number; missingPlacement: number }): string[] {
    const warnings: string[] = [];
    if (health.totalEvents > 0) {
      if (health.missingAnonymousId / health.totalEvents > 0.1) {
        warnings.push("High volume of events missing anonymousId.");
      }
      if (health.missingPlacement / health.totalEvents > 0.05) {
        warnings.push("Some events are missing placement context.");
      }
    }
    return warnings;
  }

  private getUnavailableMetrics(): UnavailableMetric[] {
    return [
      { metric: "revenueAttribution", reason: "Revenue attribution requires completed order/payment linkage and is not available in this pass." },
      { metric: "completedOrderConversion", reason: "Completed order conversion is deferred until order attribution is connected." },
      { metric: "customerLifetimeValue", reason: "Customer lifetime value requires repeat purchase and order history aggregation." },
      { metric: "roas", reason: "ROAS requires media cost data and revenue attribution." },
      { metric: "profitContribution", reason: "Profit contribution requires product margin and completed order attribution." }
    ];
  }
}
