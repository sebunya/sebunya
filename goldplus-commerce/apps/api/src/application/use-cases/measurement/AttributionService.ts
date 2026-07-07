import { db } from '../../../infrastructure/db/client';
import { attributionTouchpoints } from '../../../infrastructure/db/schema/measurement';
import { outboxEvents } from '../../../infrastructure/db/schema/system';
import { eq, desc, and, gte } from 'drizzle-orm';
import { logger } from '../../../infrastructure/logging/logger';
import { conversionRouter } from '../../../infrastructure/measurement/ConversionRouter';
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
  /**
   * Build a complete attribution report for an order.
   * This includes all touchpoints recorded for the order's identities.
   */
  async getAttributionReport(orderId: string): Promise<AttributionReport | null> {
    // Find all touchpoints associated with this order
    const rows = await db
      .select()
      .from(attributionTouchpoints)
      .where(eq(attributionTouchpoints.orderId, orderId))
      .orderBy(attributionTouchpoints.eventTime);

    if (rows.length === 0) {
      logger.warn({ orderId }, '[AttributionService] No touchpoints found for order');
      return null;
    }

    const touchpoints: AttributionTouchpoint[] = rows.map(row => ({
      id:                  row.id,
      eventName:           row.eventName,
      eventTime:           row.eventTime,
      matchScore:          row.matchScore,
      routedDestinations:  (row.routedDestinations as string[]) ?? [],
      blockedDestinations: (row.blockedDestinations as string[]) ?? [],
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

    const matchQualityAvg = touchpoints.reduce((sum, tp) => sum + tp.matchScore, 0) / touchpoints.length;
    const hasAdvertisingConsent = touchpoints.some(
      tp => tp.routedDestinations.includes('meta_capi') || tp.routedDestinations.includes('tiktok_capi')
    );

    // Attribution degradation warning
    if (matchQualityAvg < 40) {
      logger.warn({
        orderId,
        matchQualityAvg: matchQualityAvg.toFixed(1),
        touchpoints:     touchpoints.length,
      }, '[AttributionService] Attribution quality degraded — avg match score below 40%');
    }

    return {
      orderId,
      touchpoints,
      matchQualityAvg,
      firstTouch:            touchpoints[0],
      lastTouch:             touchpoints[touchpoints.length - 1],
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
    const since = new Date(Date.now() - days * 86_400_000);

    const rows = await db
      .select()
      .from(attributionTouchpoints)
      .where(gte(attributionTouchpoints.eventTime, since));

    if (rows.length === 0) {
      return { avgScore: 0, below40Pct: 0, above80Pct: 0, totalEvents: 0 };
    }

    const total  = rows.length;
    const avg    = rows.reduce((sum, r) => sum + r.matchScore, 0) / total;
    const below40 = rows.filter(r => r.matchScore < 40).length;
    const above80 = rows.filter(r => r.matchScore >= 80).length;

    return {
      avgScore:    Math.round(avg * 10) / 10,
      below40Pct:  Math.round((below40 / total) * 100),
      above80Pct:  Math.round((above80 / total) * 100),
      totalEvents: total,
    };
  }
}

export const attributionService = new AttributionService();
