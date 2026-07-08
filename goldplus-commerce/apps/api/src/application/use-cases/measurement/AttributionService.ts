import type { AttributionRepository } from '../../ports/measurement/AttributionRepository';
import type { MeasurementLogger } from '../../ports/measurement/MeasurementLogger';
import type { CanonicalTelemetryEvent } from '@goldplus/shared';

export interface AttributionReport {
  orderId:          string;
  touchpoints:      AttributionTouchpoint[];
  matchQualityAvg:  number;
  firstTouch?:      AttributionTouchpoint;
  lastTouch?:       AttributionTouchpoint;
  hasAdvertisingConsent: boolean;
}

export interface AttributionTouchpoint {
  id:                 string;
  eventName:          string;
  eventTime:          Date;
  matchScore:         number;
  routedDestinations: string[];
  blockedDestinations: string[];
  signals: {
    hasEmail:    boolean;
    hasPhone:    boolean;
    hasFbp:      boolean;
    hasFbc:      boolean;
    hasGclid:    boolean;
    hasTtclid:   boolean;
    hasIpAddr:   boolean;
  };
}

/**
 * MEASUREMENT CONTROL TOWER — ATTRIBUTION SERVICE
 *
 * Multi-touch attribution analysis for GoldPlus conversion journeys.
 *
 * Provides:
 * - Journey reconstruction (all touchpoints for an order)
 * - Match quality analytics (avg, min, max per journey)
 * - First-touch / Last-touch attribution
 * - Attribution degradation alerts
 */
export class AttributionService {
  constructor(
    private readonly attributionRepo: AttributionRepository,
    private readonly logger: MeasurementLogger
  ) {}
  /**
   * Build a complete attribution report for an order.
   * This includes all touchpoints recorded for the order's identities.
   */
  async getAttributionReport(orderId: string): Promise<AttributionReport | null> {
    // Find all touchpoints associated with this order
    const touchpoints = await this.attributionRepo.getTouchpointsByOrderId(orderId);

    if (touchpoints.length === 0) {
      this.logger.warn({ orderId }, '[AttributionService] No touchpoints found for order');
      return null;
    }

    const mappedTouchpoints: AttributionTouchpoint[] = touchpoints.map(row => ({
      id:                  row.id,
      eventName:           row.eventName,
      eventTime:           row.eventTime,
      matchScore:          row.matchScore,
      routedDestinations:  row.routedDestinations ?? [],
      blockedDestinations: row.blockedDestinations ?? [],
      signals: {
        hasEmail:  row.hasHashedEmail === 1,
        hasPhone:  row.hasHashedPhone === 1,
        hasFbp:    row.hasFbp === 1,
        hasFbc:    row.hasFbc === 1,
        hasGclid:  row.hasGclid === 1,
        hasTtclid: row.hasTtclid === 1,
        hasIpAddr: row.hasIpAddress === 1,
      },
    }));

    const matchQualityAvg = mappedTouchpoints.reduce((sum, tp) => sum + tp.matchScore, 0) / mappedTouchpoints.length;
    const hasAdvertisingConsent = mappedTouchpoints.some(
      tp => tp.routedDestinations.includes('meta_capi') || tp.routedDestinations.includes('tiktok_capi')
    );

    // Attribution degradation warning
    if (matchQualityAvg < 40) {
      this.logger.warn({
        orderId,
        matchQualityAvg: matchQualityAvg.toFixed(1),
        touchpoints:     mappedTouchpoints.length,
      }, '[AttributionService] Attribution quality degraded — avg match score below 40%');
    }

    return {
      orderId,
      touchpoints: mappedTouchpoints,
      matchQualityAvg,
      firstTouch:            mappedTouchpoints[0],
      lastTouch:             mappedTouchpoints[mappedTouchpoints.length - 1],
      hasAdvertisingConsent,
    };
  }

  /**
   * Get match quality metrics across all conversion events in a time window.
   * Used by the admin measurement dashboard.
   */
  async getMatchQualitySummary(days = 7): Promise<{
    avgScore:    number;
    below40Pct:  number;
    above80Pct:  number;
    totalEvents: number;
  }> {
    return await this.attributionRepo.getMatchQualitySummary(days);
  }
}
