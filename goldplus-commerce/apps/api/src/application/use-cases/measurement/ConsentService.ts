import { db } from '../../../infrastructure/db/client';
import { consentRecords, consentCurrentState } from '../../../infrastructure/db/schema/consent';
import { eq, desc, and } from 'drizzle-orm';
import { logger } from '../../../infrastructure/logging/logger';
import type {
  ConsentSignal,
  ConsentState,
  ConsentGrantType,
  ConsentCheckResult,
  MeasurementDestination,
  ConsentWithdrawal,
} from '@goldplus/shared';
import {
  CONSENT_PURPOSES,
  DESTINATION_PURPOSE_MAP,
  ConsentStateSchema,
} from '@goldplus/shared';
import * as client from 'prom-client';

// ─────────────────────────────────────────────────────────────────────────────
// Prometheus Metrics
// ─────────────────────────────────────────────────────────────────────────────

const consentGrantCounter = new client.Counter({
  name: 'goldplus_consent_grants_total',
  help: 'Total consent grant events by purpose and grant type',
  labelNames: ['purpose', 'grant_type', 'surface'],
});

const consentWithdrawalCounter = new client.Counter({
  name: 'goldplus_consent_withdrawals_total',
  help: 'Total consent withdrawal events by purpose',
  labelNames: ['purpose'],
});

const consentCheckCounter = new client.Counter({
  name: 'goldplus_consent_checks_total',
  help: 'Total consent checks by destination and outcome',
  labelNames: ['destination', 'outcome'],
});

const registerSafe = (m: client.Metric) => {
  try { client.register.registerMetric(m); } catch { /* already registered */ }
};
[consentGrantCounter, consentWithdrawalCounter, consentCheckCounter].forEach(registerSafe);

// ─────────────────────────────────────────────────────────────────────────────
// Consent TTL — how long an explicit grant is valid (GDPR: max 13 months)
// ─────────────────────────────────────────────────────────────────────────────
const CONSENT_TTL_DAYS = 395; // ~13 months

// ─────────────────────────────────────────────────────────────────────────────
// ConsentService
// ─────────────────────────────────────────────────────────────────────────────

export class ConsentService {
  /**
   * Record an incoming consent signal and update the current state.
   * This is the write path — called from POST /consent/signal.
   */
  async recordSignal(signal: ConsentSignal, ipAddress?: string, userAgent?: string): Promise<{
    recordId: string;
    state: ConsentState;
  }> {
    // Essential is always true — enforce at storage layer
    const purposes: ConsentState = {
      ...signal.purposes,
      essential: true,
    };

    const capturedAt = signal.consent_at
      ? new Date(signal.consent_at * 1000)
      : new Date();

    // 1. Append to immutable audit log
    const [inserted] = await db.insert(consentRecords).values({
      fpClientId:      signal.fp_client_id,
      userId:          signal.user_id,
      purposes,
      grantType:       signal.grant_type,
      captureSurface:  signal.capture_surface,
      noticeVersion:   signal.notice_version,
      consentLanguage: signal.consent_language,
      ipAddress:       ipAddress,
      userAgent:       userAgent,
      isWithdrawal:    false,
      capturedAt,
    }).returning({ id: consentRecords.id });

    // 2. Upsert the current state (fast-read path)
    const expiresAt = signal.grant_type === 'explicit'
      ? new Date(Date.now() + CONSENT_TTL_DAYS * 86_400_000)
      : null;

    const key = signal.user_id
      ? { userId: signal.user_id }
      : { fpClientId: signal.fp_client_id };

    await db.insert(consentCurrentState).values({
      ...key,
      analyticsGranted:       purposes.analytics,
      advertisingGranted:     purposes.advertising,
      personalizationGranted: purposes.personalization,
      lastGrantType:          signal.grant_type,
      lastNoticeVersion:      signal.notice_version,
      lastConsentRecordId:    inserted.id,
      updatedAt:              new Date(),
      expiresAt,
    }).onConflictDoUpdate({
      target: signal.user_id ? consentCurrentState.userId : consentCurrentState.fpClientId,
      set: {
        analyticsGranted:       purposes.analytics,
        advertisingGranted:     purposes.advertising,
        personalizationGranted: purposes.personalization,
        lastGrantType:          signal.grant_type,
        lastNoticeVersion:      signal.notice_version,
        lastConsentRecordId:    inserted.id,
        updatedAt:              new Date(),
        expiresAt,
      },
    });

    // 3. Track metrics
    for (const purpose of CONSENT_PURPOSES) {
      if (purpose === 'essential') continue;
      const granted = purposes[purpose as keyof ConsentState];
      if (granted) {
        consentGrantCounter.inc({
          purpose,
          grant_type: signal.grant_type,
          surface:    signal.capture_surface,
        });
      }
    }

    logger.info({
      recordId: inserted.id,
      fpClientId: signal.fp_client_id,
      userId: signal.user_id,
      purposes,
      grantType: signal.grant_type,
    }, '[ConsentService] Consent signal recorded');

    return { recordId: inserted.id, state: purposes };
  }

  /**
   * Record a consent withdrawal for specified purposes.
   */
  async recordWithdrawal(withdrawal: ConsentWithdrawal, ipAddress?: string, userAgent?: string): Promise<{
    recordId: string;
  }> {
    const key = withdrawal.user_id
      ? { userId: withdrawal.user_id }
      : { fpClientId: withdrawal.fp_client_id };

    // Fetch current state to apply partial withdrawal
    const current = await this.getCurrentState(withdrawal.fp_client_id, withdrawal.user_id);

    const updatedPurposes: ConsentState = {
      essential:       true,
      analytics:       withdrawal.purposes.includes('analytics') ? false : current.analytics,
      advertising:     withdrawal.purposes.includes('advertising') ? false : current.advertising,
      personalization: withdrawal.purposes.includes('personalization') ? false : current.personalization,
    };

    const [inserted] = await db.insert(consentRecords).values({
      fpClientId:      withdrawal.fp_client_id,
      userId:          withdrawal.user_id,
      purposes:        updatedPurposes,
      grantType:       'withdrawn',
      captureSurface:  'privacy_settings',
      noticeVersion:   'v1.0',
      consentLanguage: 'en',
      ipAddress,
      userAgent,
      isWithdrawal:    true,
      withdrawnPurposes: withdrawal.purposes,
      capturedAt:      new Date(),
    }).returning({ id: consentRecords.id });

    // Update current state
    await db.insert(consentCurrentState).values({
      ...key,
      analyticsGranted:       updatedPurposes.analytics,
      advertisingGranted:     updatedPurposes.advertising,
      personalizationGranted: updatedPurposes.personalization,
      lastGrantType:          'withdrawn',
      lastNoticeVersion:      'v1.0',
      lastConsentRecordId:    inserted.id,
      updatedAt:              new Date(),
    }).onConflictDoUpdate({
      target: withdrawal.user_id ? consentCurrentState.userId : consentCurrentState.fpClientId,
      set: {
        analyticsGranted:       updatedPurposes.analytics,
        advertisingGranted:     updatedPurposes.advertising,
        personalizationGranted: updatedPurposes.personalization,
        lastGrantType:          'withdrawn',
        lastConsentRecordId:    inserted.id,
        updatedAt:              new Date(),
      },
    });

    // Track metrics
    for (const purpose of withdrawal.purposes) {
      consentWithdrawalCounter.inc({ purpose });
    }

    logger.info({
      recordId: inserted.id,
      purposes: withdrawal.purposes,
    }, '[ConsentService] Consent withdrawal recorded');

    return { recordId: inserted.id };
  }

  /**
   * Get the current consent state for an identity.
   * Falls back to "all denied" if no record exists (privacy-safe default).
   */
  async getCurrentState(fpClientId?: string, userId?: string): Promise<ConsentState> {
    try {
      let row = null;

      if (userId) {
        [row] = await db.select().from(consentCurrentState)
          .where(eq(consentCurrentState.userId, userId))
          .limit(1);
      }

      if (!row && fpClientId) {
        [row] = await db.select().from(consentCurrentState)
          .where(eq(consentCurrentState.fpClientId, fpClientId))
          .limit(1);
      }

      if (!row) {
        // No consent record — default to all denied (privacy-safe)
        return ConsentStateSchema.parse({
          essential: true,
          analytics: false,
          advertising: false,
          personalization: false,
        });
      }

      // Check expiry
      if (row.expiresAt && row.expiresAt < new Date()) {
        logger.info({ fpClientId, userId }, '[ConsentService] Consent expired — treating as denied');
        return ConsentStateSchema.parse({
          essential: true,
          analytics: false,
          advertising: false,
          personalization: false,
        });
      }

      return ConsentStateSchema.parse({
        essential:       true,
        analytics:       row.analyticsGranted,
        advertising:     row.advertisingGranted,
        personalization: row.personalizationGranted,
      });
    } catch (err) {
      logger.error({ err, fpClientId, userId }, '[ConsentService] Failed to read consent state — defaulting to denied');
      return ConsentStateSchema.parse({
        essential: true, analytics: false, advertising: false, personalization: false,
      });
    }
  }

  /**
   * Check if routing to a specific measurement destination is permitted.
   * This is the hot path — called before every conversion event dispatch.
   */
  async checkDestinationPermission(
    destination: MeasurementDestination,
    fpClientId?: string,
    userId?: string,
  ): Promise<ConsentCheckResult> {
    const state = await this.getCurrentState(fpClientId, userId);
    const requiredPurpose = DESTINATION_PURPOSE_MAP[destination];
    const allowed = state[requiredPurpose as keyof ConsentState] === true;

    const outcome = allowed ? 'allowed' : 'blocked';
    consentCheckCounter.inc({ destination, outcome });

    return {
      allowed,
      grantType:      allowed ? 'explicit' : 'unknown',
      purposes:       state,
      resolvedAt:     new Date(),
      blockedReason:  allowed ? undefined : `Purpose '${requiredPurpose}' not granted for destination '${destination}'`,
    };
  }

  /**
   * Get the full consent audit trail for an identity (for GDPR SAR).
   */
  async getAuditTrail(fpClientId?: string, userId?: string, limit = 50): Promise<typeof consentRecords.$inferSelect[]> {
    const conditions = [];
    if (userId)     conditions.push(eq(consentRecords.userId, userId));
    if (fpClientId) conditions.push(eq(consentRecords.fpClientId, fpClientId));

    if (conditions.length === 0) return [];

    return db.select().from(consentRecords)
      .where(conditions.length === 1 ? conditions[0] : and(...conditions))
      .orderBy(desc(consentRecords.createdAt))
      .limit(limit);
  }
}

export const consentService = new ConsentService();
