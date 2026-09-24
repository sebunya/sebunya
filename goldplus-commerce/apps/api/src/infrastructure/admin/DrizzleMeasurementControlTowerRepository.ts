import { eq, count, sql, isNotNull, desc, isNull, max, and } from 'drizzle-orm';
import { db } from '../db/client';
import { env } from '../../config/env';
import { outboxEvents } from '../db/schema/system';
import { DrizzleAdDestinationRepository } from '../db/repositories/DrizzleAdDestinationRepository';
import {
  IMeasurementControlTowerRepository,
  MeasurementHealthSummary,
  ConsentSafetySummary,
  ProductFinderSummary,
  PreferenceCentreSummary,
  PaymentReconciliationSummary,
  PaidSocialReadinessSummary,
  GtmAutomationSummary,
  DataQualityWarning,
  RecentRedactedEvent,
} from '../../application/ports/admin/MeasurementControlTowerRepository';

// Import all required schema tables based on domain queries needed
import {
  measurementAuditLogs,
  measurementDeadLetterEvents,
  measurementDestinationDeliveryLogs,
  measurementPaidSocialDeliveryLogs,
  measurementGtmAccounts,
  measurementDataQualityAlerts,
} from '../db/schema/measurement-advanced';

import {
  consentCurrentState,
  consentRecords,
} from '../db/schema/consent';

import {
  productFinderSessions,
} from '../db/schema/product_finder';

import {
  customerPreferences,
  preferenceAuditLog,
} from '../db/schema/preferences';

import {
  paymentMeasurementReconciliations,
  purchaseMeasurementEvents,
} from '../db/schema/measurement';

const rowsOf = (r: unknown): any[] => (Array.isArray(r) ? r : ((r as { rows?: any[] })?.rows ?? []));

export class DrizzleMeasurementControlTowerRepository implements IMeasurementControlTowerRepository {
  async getMeasurementHealthSummary(): Promise<MeasurementHealthSummary> {
    const [auditCountResult] = await db.select({ value: count() }).from(measurementAuditLogs);
    const [dlqCountResult] = await db.select({ value: count() }).from(measurementDeadLetterEvents).where(eq(measurementDeadLetterEvents.isResolved, false));
    // Queued = browser events waiting in the outbox to be dispatched. This card
    // used to show the dead-letter count (the same query as "failed"), so the
    // page reported failures as a queue and counted them twice in its total.
    const [queuedCount] = await db.select({ value: count() })
      .from(outboxEvents)
      .where(and(eq(outboxEvents.eventType, 'TELEMETRY_DISPATCH'), eq(outboxEvents.isProcessed, false)));

    const [blockedCount] = await db.select({ value: count() })
      .from(measurementAuditLogs)
      .where(eq(measurementAuditLogs.action, 'CONSENT_BLOCKED'));

    const [dryRunCount] = await db.select({ value: count() })
      .from(measurementAuditLogs)
      .where(eq(measurementAuditLogs.action, 'DRY_RUN'));

    // Measured, not asserted. This said "last event: now" and HEALTHY
    // unconditionally, with zero events and an unresolved dead-letter backlog.
    const [last] = await db.select({ at: max(measurementAuditLogs.createdAt) }).from(measurementAuditLogs);
    const status = dlqCountResult.value > 0 ? 'DEGRADED' : auditCountResult.value === 0 ? 'NO_DATA' : 'HEALTHY';
    return {
      totalSafeEvents: auditCountResult.value,
      eventsQueued: queuedCount.value,
      eventsFailed: dlqCountResult.value,
      eventsBlockedByConsent: blockedCount.value,
      dryRunEvents: dryRunCount.value,
      lastEventReceived: last?.at ?? null,
      lastQueueError: dlqCountResult.value > 0 ? `${dlqCountResult.value} unresolved dead-letter event(s)` : null,
      measurementQueueStatus: status,
    };
  }

  async getConsentSafetySummary(): Promise<ConsentSafetySummary> {
    const [grantedAds] = await db.select({ value: count() }).from(consentCurrentState).where(eq(consentCurrentState.advertisingGranted, true));
    const [withdrawnAds] = await db.select({ value: count() }).from(consentCurrentState).where(eq(consentCurrentState.advertisingGranted, false));
    const [grantedAnalytics] = await db.select({ value: count() }).from(consentCurrentState).where(eq(consentCurrentState.analyticsGranted, true));
    const [grantedPersonalisation] = await db.select({ value: count() }).from(consentCurrentState).where(eq(consentCurrentState.personalizationGranted, true));

    const [prefAudit] = await db.select({ value: count() }).from(preferenceAuditLog);

    return {
      advertisingConsentGranted: grantedAds.value,
      advertisingConsentWithdrawn: withdrawnAds.value,
      analyticsConsentGranted: grantedAnalytics.value,
      personalisationConsentGranted: grantedPersonalisation.value,
      eventsBlockedByAdvertisingOptOut: 0, // No specific table for this in the current context, 0 is honest
      eventsBlockedByMissingConsent: 0,
      preferenceUpdatesAudited: prefAudit.value,
    };
  }

  async getProductFinderSummary(): Promise<ProductFinderSummary> {
    const [started] = await db.select({ value: count() }).from(productFinderSessions);
    const [completed] = await db.select({ value: count() }).from(productFinderSessions).where(eq(productFinderSessions.status, 'FINDER_COMPLETED'));
    const [noMatch] = await db.select({ value: count() }).from(productFinderSessions).where(eq(productFinderSessions.status, 'NO_MATCH'));

    return {
      finderSessionsStarted: started.value,
      finderSessionsCompleted: completed.value,
      completionRate: started.value > 0 ? (completed.value / started.value) * 100 : 0,
      noMatchSessions: noMatch.value,
      topRequestedCategories: [],
      topProblemsSelected: [],
      topBuyingContexts: [],
      whatsappIntentClicks: 0,
      addToCartIntentClicks: 0,
    };
  }

  async getPreferenceCentreSummary(): Promise<PreferenceCentreSummary> {
    const [updated] = await db.select({ value: count() }).from(customerPreferences);
    
    return {
      preferencesViewed: updated.value,
      preferencesUpdated: updated.value,
      communicationOptIns: 0,
      communicationOptOuts: 0,
      whatsappOptIns: 0,
      whatsappOptOuts: 0,
      productInterestsSaved: 0,
      lastPreferenceAuditEvent: null,
    };
  }

  /**
   * The REAL GA4 purchase delivery (0140 delivery_intent), not the legacy
   * reconciliation table. That table was counted on statuses nothing writes
   * ('VERIFIED', 'PENDING'), so "verified purchase conversions" stayed 0 after
   * the first real paid order.
   */
  async getPaymentReconciliationSummary(): Promise<PaymentReconciliationSummary> {
    const r = rowsOf(await db.execute(sql`select
        count(*) filter (where state in ('ACCEPTED','PROCESSED'))::int as verified,
        count(*) filter (where state in ('PENDING','LEASED','RETRY_WAIT','UNKNOWN_OUTCOME'))::int as pending,
        count(*) filter (where state in ('DEAD_LETTER','QUARANTINED'))::int as failed,
        count(*) filter (where state = 'RETRY_WAIT' and attempt_count > 0)::int as retryable,
        max(accepted_at) as last_accepted
      from measurement.delivery_intent where sink_key = 'ga4:purchase'`))[0] ?? {};
    const lastError = rowsOf(await db.execute(sql`select state_reason from measurement.delivery_intent
      where sink_key = 'ga4:purchase' and state in ('DEAD_LETTER','QUARANTINED') order by updated_at desc limit 1`))[0];

    return {
      verifiedPurchaseConversions: Number(r.verified ?? 0),
      pendingReconciliations: Number(r.pending ?? 0),
      failedReconciliations: Number(r.failed ?? 0),
      duplicateCallbacksHandled: 0,
      retryableFailures: Number(r.retryable ?? 0),
      lastVerifiedPayment: r.last_accepted ? new Date(r.last_accepted) : null,
      lastReconciliationError: lastError?.state_reason ?? null,
    };
  }

  /** Readiness is read from the live ad_destinations table (0138), never assumed. */
  async getPaidSocialReadinessSummary(): Promise<PaidSocialReadinessSummary> {
    const live = new Set((await new DrizzleAdDestinationRepository().active()).map((d) => d.platform));
    const readiness = (platform: string) => (live.has(platform) ? 'LIVE' : 'NOT_CONFIGURED');
    const [eligible] = await db.select({ value: count() }).from(measurementPaidSocialDeliveryLogs);
    const [failures] = await db.select({ value: count() }).from(measurementPaidSocialDeliveryLogs).where(eq(measurementPaidSocialDeliveryLogs.deliveryStatus, 'failed'));
    const [dryRuns] = await db.select({ value: count() }).from(measurementPaidSocialDeliveryLogs).where(eq(measurementPaidSocialDeliveryLogs.deliveryStatus, 'dry_run'));

    return {
      eventsEligibleForRouting: eligible.value,
      eventsBlockedByConsent: 0,
      eventsBlockedByMissingIdentifiers: 0,
      dryRunRoutedEvents: dryRuns.value,
      destinationPayloadsPrepared: eligible.value,
      destinationFailures: failures.value,
      metaReadiness: readiness('meta'),
      googleAdsReadiness: readiness('google_ads'),
      tiktokReadiness: readiness('tiktok'),
      pinterestReadiness: readiness('pinterest'),
      linkedInReadiness: readiness('linkedin'),
      snapchatReadiness: readiness('snapchat'),
      xReadiness: readiness('x'),
      // PostHog is not an ad destination; its key is set in the environment.
      postHogReadiness: env.posthogProjectApiKey ? 'CONFIGURED' : 'NOT_CONFIGURED',
    };
  }

  async getGtmAutomationSummary(): Promise<GtmAutomationSummary> {
    const [accounts] = await db.select({ value: count() }).from(measurementGtmAccounts);

    return {
      gtmCredentialsStatus: accounts.value > 0 ? 'CONFIGURED' : 'NOT_CONFIGURED',
      lastPlanStatus: 'NO_DATA_AVAILABLE',
      lastValidateStatus: 'NO_DATA_AVAILABLE',
      lastDiffStatus: 'NO_DATA_AVAILABLE',
      lastWorkspaceDraftStatus: 'NO_DATA_AVAILABLE',
      lastVersionDraftStatus: 'NO_DATA_AVAILABLE',
      publishStatus: 'DISABLED_FOR_SLICE_8',
    };
  }

  async getDataQualityWarnings(limit: number = 50): Promise<DataQualityWarning[]> {
    const alerts = await db.select().from(measurementDataQualityAlerts).limit(limit).orderBy(desc(measurementDataQualityAlerts.createdAt));

    return alerts.map(a => ({
      id: a.id,
      timestamp: a.createdAt,
      severity: 'HIGH',
      area: (a as any).area || 'Measurement',
      issue: a.alertMessage,
      status: a.status,
      suggestedNextAction: 'Review measurement pipeline',
      safeReferenceId: (a as any).referenceId || a.id,
    }));
  }

  async getAdminReviewQueue(limit: number = 50): Promise<DataQualityWarning[]> {
    return this.getDataQualityWarnings(limit);
  }

  async getRecentRedactedEvents(limit: number = 50, filters?: any): Promise<RecentRedactedEvent[]> {
    // Return empty array if there are no events to safely display
    const logs = await db.select().from(measurementAuditLogs).limit(limit).orderBy(desc(measurementAuditLogs.createdAt));
    return logs.map(l => ({
        id: l.id,
        timestamp: l.createdAt,
        source: l.entityType,
        type: l.action,
        status: 'REDACTED',
        redactedPayload: {}
    }));
  }
}

