import { logger } from '../logging/logger';
import { consentService } from '../../application/use-cases/measurement/ConsentService';
import { db } from '../db/client';
import { attributionTouchpoints } from '../db/schema/measurement';
import { outboxEvents } from '../db/schema/system';
import type { CanonicalTelemetryEvent, MeasurementDestination } from '@goldplus/shared';
import { MEASUREMENT_DESTINATIONS, DESTINATION_PURPOSE_MAP } from '@goldplus/shared';
import * as client from 'prom-client';

// ─────────────────────────────────────────────────────────────────────────────
// Prometheus Metrics
// ─────────────────────────────────────────────────────────────────────────────

const conversionRouted = new client.Counter({
  name: 'goldplus_conversion_routed_total',
  help: 'Total conversion events routed by destination and outcome',
  labelNames: ['destination', 'event_name', 'outcome'],
});

const conversionMatchQuality = new client.Histogram({
  name: 'goldplus_conversion_match_quality',
  help: 'Match quality score (0–100) for routed conversion events',
  labelNames: ['event_name'],
  buckets: [10, 20, 30, 40, 50, 60, 70, 80, 90, 100],
});

const routingBlockedByConsent = new client.Counter({
  name: 'goldplus_routing_blocked_by_consent_total',
  help: 'Conversion events blocked by consent enforcement, by destination',
  labelNames: ['destination', 'event_name'],
});

const registerSafe = (m: client.Metric) => {
  try { client.register.registerMetric(m); } catch { /* already registered */ }
};
[conversionRouted, conversionMatchQuality, routingBlockedByConsent].forEach(registerSafe);

// ─────────────────────────────────────────────────────────────────────────────
// Routing Result
// ─────────────────────────────────────────────────────────────────────────────

export interface RoutingDecision {
  event_id:       string;
  event_name:     string;
  routed:         MeasurementDestination[];
  blocked:        MeasurementDestination[];
  match_score:    number;
  touchpoint_id?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// ConversionRouter
// ─────────────────────────────────────────────────────────────────────────────

/**
 * MEASUREMENT CONTROL TOWER — CONSENT-AWARE CONVERSION ROUTER
 *
 * This is the authoritative routing layer that sits between any conversion
 * event source (outbox, direct API, webhooks) and the downstream measurement
 * destinations (sGTM, Meta CAPI, TikTok, etc.).
 *
 * ROUTING ALGORITHM:
 * 1. Compute match quality score for the event's identity signals.
 * 2. For each destination in MEASUREMENT_DESTINATIONS:
 *    a. Look up required consent purpose via DESTINATION_PURPOSE_MAP.
 *    b. Check ConsentService for current state.
 *    c. If granted → add to `routed` list.
 *    d. If denied  → add to `blocked` list (emit metric, log).
 * 3. Dispatch only to `routed` destinations via the outbox.
 * 4. Record attribution touchpoint.
 *
 * INVARIANT: This router NEVER throws for consent denials. Consent denial
 * silently blocks routing but does NOT break commerce functionality.
 */
export class ConversionRouter {
  /**
   * Route a canonical telemetry event through the consent-aware routing layer.
   *
   * Returns the routing decision (what was routed, what was blocked, match score).
   * Does NOT dispatch — the caller (use-case) is responsible for committing to outbox.
   */
  async resolveRouting(
    event: CanonicalTelemetryEvent,
  ): Promise<{
    routed:    MeasurementDestination[];
    blocked:   MeasurementDestination[];
    matchScore: number;
  }> {
    const fpClientId = event.user_data?.fp_client_id;
    const userId     = event.user_data?.user_id;

    const routed:  MeasurementDestination[] = [];
    const blocked: MeasurementDestination[] = [];

    // Check each destination
    await Promise.all(
      MEASUREMENT_DESTINATIONS.map(async (destination) => {
        try {
          const result = await consentService.checkDestinationPermission(
            destination, fpClientId, userId,
          );

          if (result.allowed) {
            routed.push(destination);
            conversionRouted.inc({ destination, event_name: event.event_name, outcome: 'routed' });
          } else {
            blocked.push(destination);
            routingBlockedByConsent.inc({ destination, event_name: event.event_name });
            logger.debug({
              eventId:    event.event_id,
              eventName:  event.event_name,
              destination,
              reason:     result.blockedReason,
            }, '[ConversionRouter] Destination blocked by consent');
          }
        } catch (err) {
          // Fail-safe: if consent check errors, block the destination
          blocked.push(destination);
          logger.error({ err, destination, eventId: event.event_id },
            '[ConversionRouter] Consent check threw — blocking destination as fail-safe');
        }
      })
    );

    const matchScore = this.computeMatchScore(event);
    conversionMatchQuality.observe({ event_name: event.event_name }, matchScore);

    return { routed, blocked, matchScore };
  }

  /**
   * Route and record a conversion event:
   * 1. Resolve routing decisions
   * 2. Persist attribution touchpoint
   * 3. Return decision (caller writes to outbox/dispatches)
   */
  async routeAndRecord(event: CanonicalTelemetryEvent): Promise<RoutingDecision> {
    const { routed, blocked, matchScore } = await this.resolveRouting(event);

    // Record attribution touchpoint
    let touchpointId: string | undefined;
    try {
      const ud = event.user_data;
      const [tp] = await db.insert(attributionTouchpoints).values({
        fpClientId:         ud?.fp_client_id,
        userId:             ud?.user_id,
        eventId:            event.event_id,
        eventName:          event.event_name,
        hasHashedEmail:     ud?.hashed_email ? 1 : 0,
        hasHashedPhone:     ud?.hashed_phone ? 1 : 0,
        hasFbp:             ud?.fbp  ? 1 : 0,
        hasFbc:             ud?.fbc  ? 1 : 0,
        hasGclid:           ud?.gclid  ? 1 : 0,
        hasTtclid:          ud?.ttclid ? 1 : 0,
        hasLiFatId:         ud?.li_fat_id ? 1 : 0,
        hasIpAddress:       ud?.ip_address ? 1 : 0,
        hasUserAgent:       ud?.user_agent ? 1 : 0,
        matchScore,
        routedDestinations:  routed,
        blockedDestinations: blocked,
        eventTime:           new Date(event.event_time * 1000),
      }).returning({ id: attributionTouchpoints.id });
      touchpointId = tp?.id;
    } catch (err) {
      // Non-fatal — routing decision is still valid even if touchpoint write fails
      logger.warn({ err, eventId: event.event_id },
        '[ConversionRouter] Failed to record attribution touchpoint');
    }

    logger.info({
      eventId:    event.event_id,
      eventName:  event.event_name,
      routed:     routed.length,
      blocked:    blocked.length,
      matchScore,
      destinations: routed,
    }, '[ConversionRouter] Routing decision resolved');

    return {
      event_id:      event.event_id,
      event_name:    event.event_name,
      routed,
      blocked,
      match_score:   matchScore,
      touchpoint_id: touchpointId,
    };
  }

  /**
   * Compute a 0–100 match quality score for a telemetry event.
   * Higher score = better chance of user-graph matching at ad platforms.
   *
   * Scoring weights are calibrated to Meta CAPI's Enhanced Match documentation:
   * - SHA-256 email: highest weight (most reliable signal)
   * - SHA-256 phone: high weight
   * - FBP / FBC: medium (important for Meta attribution)
   * - IP + UA: low (fallback signals)
   * - Click IDs (gclid, ttclid, etc.): medium (platform-specific)
   */
  computeMatchScore(event: CanonicalTelemetryEvent): number {
    const ud = event.user_data;
    if (!ud) return 0;

    let score = 0;
    if (ud.hashed_email)  score += 25;
    if (ud.hashed_phone)  score += 20;
    if (ud.fbp)           score += 12;
    if (ud.fbc)           score += 12;
    if (ud.ip_address)    score += 8;
    if (ud.user_agent)    score += 5;
    if (ud.gclid || ud.wbraid || ud.gbraid) score += 10;
    if (ud.ttclid)        score += 5;
    if (ud.li_fat_id)     score += 2;
    if (ud.epik)          score += 1;

    return Math.min(score, 100);
  }
}

export const conversionRouter = new ConversionRouter();
