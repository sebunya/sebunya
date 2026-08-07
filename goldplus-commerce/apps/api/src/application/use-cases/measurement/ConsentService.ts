import {
  CONSENT_PURPOSES,
  DESTINATION_PURPOSE_MAP,
  ConsentStateSchema,
} from '@goldplus/shared';
import type {
  ConsentSignal,
  ConsentState,
  ConsentGrantType,
  ConsentCheckResult,
  MeasurementDestination,
  ConsentWithdrawal,
} from '@goldplus/shared';
import * as client from 'prom-client';
import type { MeasurementLogger } from '../../ports/measurement/MeasurementLogger';
import type { ConsentRepository } from '../../ports/measurement/ConsentRepository';

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
// ConsentService
// ─────────────────────────────────────────────────────────────────────────────

export class ConsentService {
  constructor(
    private readonly consentRepo: ConsentRepository,
    private readonly logger: MeasurementLogger
  ) {}

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

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 180); // 180 days

    const { recordId } = await this.consentRepo.recordSignal(signal, purposes, expiresAt, ipAddress, userAgent);

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

    this.logger.info({
      recordId,
      fpClientId: signal.fp_client_id,
      userId: signal.user_id,
      purposes,
      grantType: signal.grant_type,
    }, '[ConsentService] Consent signal recorded');

    return { recordId, state: purposes };
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

    const { recordId } = await this.consentRepo.recordWithdrawal(withdrawal, updatedPurposes, ipAddress, userAgent);

    // Track metrics
    for (const purpose of withdrawal.purposes) {
      consentWithdrawalCounter.inc({ purpose });
    }

    this.logger.info({
      recordId,
      purposes: withdrawal.purposes,
    }, '[ConsentService] Consent withdrawal recorded');

    return { recordId };
  }

  /**
   * Default consent when nothing explicit is stored (owner decision 2026-08-07).
   *
   * First-party ON-SITE personalisation is ALWAYS ON: `personalization` is granted
   * by default. `analytics` and `advertising` stay DENIED by default because EVERY
   * measurement destination is third-party (ga4/gtm_web = Google, meta/tiktok/
   * linkedin/pinterest = ad platforms — see DESTINATION_PURPOSE_MAP), and the
   * owner's rule is that data is never shared with a third party. The
   * ConversionRouter therefore still dispatches nothing off-site by default.
   */
  private defaultConsentState(): ConsentState {
    return ConsentStateSchema.parse({
      essential: true,
      analytics: false,       // gates GA4 + GTM (third-party) — stays off
      advertising: false,     // gates Meta/TikTok/etc. (third-party) — stays off
      personalization: true,  // on-site only, in no destination map — always on
    });
  }

  /**
   * Get the current consent state for an identity. When nothing explicit is
   * stored (the common case — there is no storefront consent banner), first-party
   * personalisation is granted and third-party measurement stays denied. An
   * explicit stored grant/denial is still honoured verbatim.
   */
  async getCurrentState(fpClientId?: string, userId?: string): Promise<ConsentState> {
    try {
      const { row } = await this.consentRepo.getCurrentState(fpClientId, userId);

      // No consent record → owner-default (first-party on, third-party off).
      if (!row) return this.defaultConsentState();

      // Expired → fall back to the same default, not all-denied.
      if (row.expiresAt && row.expiresAt < new Date()) {
        this.logger.info({ fpClientId, userId }, '[ConsentService] Consent expired — applying owner default');
        return this.defaultConsentState();
      }

      return ConsentStateSchema.parse({
        essential:       true,
        analytics:       row.analyticsGranted,
        advertising:     row.advertisingGranted,
        personalization: row.personalizationGranted,
      });
    } catch (err) {
      this.logger.error({ err, fpClientId, userId }, '[ConsentService] Failed to read consent state — applying owner default');
      return this.defaultConsentState();
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
  async getAuditTrail(fpClientId?: string, userId?: string, limit = 50) {
    return await this.consentRepo.getAuditTrail(fpClientId, userId, limit);
  }
}
