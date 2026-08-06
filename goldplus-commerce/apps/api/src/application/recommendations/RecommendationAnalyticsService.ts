
/**
 * §19 data purity: a percentage is only shown when its denominator is safe.
 * Below MIN_SAMPLE the share is withheld with the reason, never rendered as a
 * misleadingly precise number.
 */
export const DEPTH_MIN_SAMPLE = 30;
export function safeShare(numerator: number, denominator: number): { pct: number | null; reason: string | null } {
  if (denominator < DEPTH_MIN_SAMPLE) {
    return { pct: null, reason: `Sample too small (${denominator} < ${DEPTH_MIN_SAMPLE}) — percentage withheld.` };
  }
  return { pct: Math.round((numerator / denominator) * 1000) / 10, reason: null };
}

import type { 
  RecommendationAnalyticsQuery, 
  RecommendationAnalyticsResponse,
  AnalyticsTrackingStatus,
  UnavailableMetric
} from "@goldplus/shared";
import { validateOptionalDateRange } from "@goldplus/shared";
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
    const rawStart = query.startDate === "" ? null : (query.startDate ?? null);
    const rawEnd = query.endDate === "" ? null : (query.endDate ?? null);

    if (rawStart === null && rawEnd === null) {
      const end = new Date();
      const start = new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
      return { startDate: start, endDate: end };
    }

    const validation = validateOptionalDateRange({
      start: rawStart,
      end: rawEnd,
      mode: "date",
      allowSameDay: true,
    });

    if (!validation.ok) {
      if (validation.errorCode === "END_BEFORE_START") {
        throw new Error("startDate must be before endDate.");
      }
      throw new Error("Invalid date format.");
    }

    let start = validation.start;
    let end = validation.end;

    if (start && !end) {
      end = new Date();
      if (start > end) {
        throw new Error("startDate must be before endDate.");
      }
    } else if (end && !start) {
      start = new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
    }

    return { startDate: start!, endDate: end! };
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

  /** §19 depth metrics: coverage, placement integrity, concentration, source mix. */
  /** R6: serving truth per placement, from server-native response events. */
  async getServingHealth(windowDays = 7) {
    const clamped = Math.min(90, Math.max(1, windowDays));
    return this.repo.getServingHealth(clamped);
  }

  /**
   * R4: lineage health. Distinguishes DATA problems from ENGINE problems
   * (AC22): historic pre-contract rows are a fact of history, orphan clicks
   * are a producer defect, identity-unavailable rows are a capture defect.
   */
  async getLineageReport(windowDays = 30) {
    const clamped = Math.min(90, Math.max(1, windowDays));
    return this.repo.getLineageReport(clamped);
  }

  async getDepthMetrics(windowDays = 30) {
    const raw = await this.repo.depthMetricsRaw(windowDays);
    const coverage = safeShare(raw.distinctRecommendedProducts, raw.activeProducts >= 1 ? Math.max(raw.activeProducts, DEPTH_MIN_SAMPLE * 0 + raw.activeProducts) : 0);
    const unknownPlacement = safeShare(raw.nullPlacementEvents + raw.invalidPlacementEvents, raw.totalEvents);
    const top5Events = raw.topProducts.reduce((sum, t) => sum + t.events, 0);
    const concentration = safeShare(top5Events, raw.totalEvents);
    return {
      windowDays,
      totalEvents: raw.totalEvents,
      coverage: {
        distinctRecommendedProducts: raw.distinctRecommendedProducts,
        activeProducts: raw.activeProducts,
        // Coverage denominator is the catalogue, not the event stream: it is safe
        // whenever the catalogue is non-empty, so the share gates only on that.
        pct: raw.activeProducts > 0 ? Math.round((raw.distinctRecommendedProducts / raw.activeProducts) * 1000) / 10 : null,
        reason: raw.activeProducts > 0 ? null : 'No active products — coverage undefined.',
      },
      unknownPlacement: {
        nullPlacementEvents: raw.nullPlacementEvents,
        invalidPlacementEvents: raw.invalidPlacementEvents,
        ...unknownPlacement,
      },
      catalogueConcentration: {
        top5Events,
        topProducts: raw.topProducts,
        ...concentration,
      },
      sourceBreakdown: raw.sourceBreakdown,
      note: 'Raw counts always shown; percentages appear only with safe denominators (min sample ' + String(DEPTH_MIN_SAMPLE) + ' events).',
    };
  }

}
