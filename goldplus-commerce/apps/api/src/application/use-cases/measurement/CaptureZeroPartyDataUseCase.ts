import type { ConsentService } from './ConsentService';
import type { ZeroPartyDataRepository } from '../../ports/measurement/ZeroPartyDataRepository';
import type { MeasurementLogger } from '../../ports/measurement/MeasurementLogger';
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
  constructor(
    private readonly zpdRepo: ZeroPartyDataRepository,
    private readonly logger: MeasurementLogger,
    private readonly consentService: ConsentService
  ) {}

  async execute(
    signal: ZeroPartySignal,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<{ captured: boolean; id?: string }> {
    // Consent check — personalization purpose required
    const consentCheck = await this.consentService.checkDestinationPermission(
      'ga4', // GA4 uses 'analytics' purpose — ZPD needs 'personalization'
      signal.fp_client_id,
      signal.user_id,
    );

    // Actually check personalization directly
    const state = await this.consentService.getCurrentState(signal.fp_client_id, signal.user_id);
    if (!state.personalization) {
      this.logger.warn({
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
      const { id } = await this.zpdRepo.insertSignal(signal, capturedAt);

      zeroPartySignalCounter.inc({ signal_type: signal.signal_type, outcome: 'captured' });

      this.logger.info({
        id,
        fpClientId: signal.fp_client_id,
        signalType: signal.signal_type,
      }, '[ZeroPartyData] Signal captured');

      return { captured: true, id };
    } catch (err) {
      this.logger.error({ err, signalType: signal.signal_type }, '[ZeroPartyData] Failed to insert signal');
      zeroPartySignalCounter.inc({ signal_type: signal.signal_type, outcome: 'error' });
      throw err;
    }
  }
}
