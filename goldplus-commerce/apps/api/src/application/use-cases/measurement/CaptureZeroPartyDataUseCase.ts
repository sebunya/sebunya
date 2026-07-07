import { db } from '../../../infrastructure/db/client';
import { zeroPartySignals } from '../../../infrastructure/db/schema/measurement';
import { consentService } from './ConsentService';
import { logger } from '../../../infrastructure/logging/logger';
import type { ZeroPartySignal } from '@goldplus/shared';
import * as client from 'prom-client';

const zeroPartySignalCounter = new client.Counter({
  name: 'goldplus_zero_party_signals_total',
  help: 'Total zero-party data signals captured by type',
  labelNames: ['signal_type', 'outcome'],
});

try {
  client.register.registerMetric(zeroPartySignalCounter);
} catch { /* already registered */ }

/**
 * MEASUREMENT CONTROL TOWER — ZERO-PARTY DATA CAPTURE USE CASE
 *
 * Captures a zero-party signal only if the user has granted personalization consent.
 * If consent is denied, the signal is silently dropped without error.
 *
 * This ensures commerce functionality is never broken by consent denial.
 */
export class CaptureZeroPartyDataUseCase {
  async execute(
    signal: ZeroPartySignal,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<{ captured: boolean; id?: string }> {
    // Consent check — personalization purpose required
    const consentCheck = await consentService.checkDestinationPermission(
      'ga4', // GA4 uses 'analytics' purpose — ZPD needs 'personalization'
      signal.fp_client_id,
      signal.user_id,
    );

    // Actually check personalization directly
    const state = await consentService.getCurrentState(signal.fp_client_id, signal.user_id);
    if (!state.personalization) {
      logger.debug({
        fpClientId:  signal.fp_client_id,
        signalType:  signal.signal_type,
      }, '[ZeroPartyData] Personalization consent denied — signal dropped');
      zeroPartySignalCounter.inc({ signal_type: signal.signal_type, outcome: 'consent_denied' });
      return { captured: false };
    }

    const capturedAt = signal.captured_at
      ? new Date(signal.captured_at * 1000)
      : new Date();

    try {
      const [inserted] = await db.insert(zeroPartySignals).values({
        fpClientId:      signal.fp_client_id,
        userId:          signal.user_id,
        sessionId:       signal.session_id,
        signalType:      signal.signal_type,
        payload:         signal.payload as any,
        pageLocation:    signal.page_location,
        productId:       signal.product_id,
        sourceComponent: signal.source_component,
        capturedAt,
      }).returning({ id: zeroPartySignals.id });

      zeroPartySignalCounter.inc({ signal_type: signal.signal_type, outcome: 'captured' });

      logger.info({
        id:         inserted.id,
        fpClientId: signal.fp_client_id,
        signalType: signal.signal_type,
      }, '[ZeroPartyData] Signal captured');

      return { captured: true, id: inserted.id };
    } catch (err) {
      logger.error({ err, signalType: signal.signal_type }, '[ZeroPartyData] Failed to insert signal');
      zeroPartySignalCounter.inc({ signal_type: signal.signal_type, outcome: 'error' });
      throw err;
    }
  }
}
