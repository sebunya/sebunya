
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
      // Empty by design. These five metrics ARE implemented — by
      // RecommendationCommercialService, which the analytics page already
      // renders above. This list previously declared them unavailable while
      // the working panels sat directly above it, so the page contradicted
      // itself. The field stays for backward compatibility with existing
      // consumers.
      unavailableMetrics: []
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

  /**
   * Quality warnings, measured against the population each field applies to.
   *
   * These previously divided by TOTAL events, which is dominated by
   * server-rendered serving records that can never carry a browser identifier
   * or a placement. That inflated denominator worked in both directions and
   * neither was honest: it reported 4% missing identity when 87% of the
   * numerator's own population lacked one, and it would equally have raised a
   * false alarm about placement on events that never have a placement.
   *
   * The warning now asks the question an operator actually needs answered: is
   * any event unattributable to a visitor at all? An event carrying a visit
   * profile but no anonymousId is fully attributable and is not a gap.
   */
  private generateQualityWarnings(health: {
    totalEvents: number; missingAnonymousId: number; missingPlacement: number;
    identityEligibleEvents?: number; missingAnonymousIdEligible?: number; eventsWithoutAnyIdentity?: number;
    placementEligibleEvents?: number; missingPlacementEligible?: number;
  }): string[] {
    const warnings: string[] = [];

    const orphanedIdentity = health.eventsWithoutAnyIdentity ?? 0;
    if (orphanedIdentity > 0 && health.totalEvents > 0) {
      const share = orphanedIdentity / health.totalEvents;
      warnings.push(
        `${orphanedIdentity} event(s) carry no visitor identity of any kind (${(share * 100).toFixed(1)}% of all events); they cannot be attributed.`,
      );
    }

    const identityEligible = health.identityEligibleEvents ?? 0;
    if (identityEligible > 0) {
      // Matched pair: both sides count client-produced events only.
      const missingShare = (health.missingAnonymousIdEligible ?? 0) / identityEligible;
      // Only client-produced events are expected to hold a browser id.
      if (missingShare > 0.1) {
        warnings.push(
          `${(missingShare * 100).toFixed(1)}% of client-produced events are missing anonymousId, which usually means browser storage is unavailable for those visitors.`,
        );
      }
    }

    const placementEligible = health.placementEligibleEvents ?? 0;
    if (placementEligible > 0) {
      const missingPlacementShare = (health.missingPlacementEligible ?? 0) / placementEligible;
      if (missingPlacementShare > 0.05) {
        warnings.push(
          `${(missingPlacementShare * 100).toFixed(1)}% of recommendation events are missing placement context.`,
        );
      }
    }

    return warnings;
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
