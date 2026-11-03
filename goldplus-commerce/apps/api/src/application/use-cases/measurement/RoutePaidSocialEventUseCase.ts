import { PaidSocialDestinationRepository } from '../../ports/measurement/PaidSocialDestinationRepository';
import { MeasurementLogger } from '../../ports/measurement/MeasurementLogger';
import { ConsentService } from './ConsentService';
import { MeasurementEventQueue } from '../../ports/measurement/MeasurementEventQueue';

export class RoutePaidSocialEventUseCase {
  constructor(
    private readonly destinationRepo: PaidSocialDestinationRepository,
    private readonly measurementQueue: MeasurementEventQueue,
    private readonly consentService: ConsentService,
    private readonly logger: MeasurementLogger
  ) {}

  async execute(eventName: string, payload: any, userId?: string, sessionId?: string): Promise<void> {
    try {
      // 1. Consent Check
      //
      // These events go to ADVERTISING destinations, so the absence of consent
      // means do not send. Previously the check ran only when an identity was
      // present, so an event with neither a user nor a session skipped it
      // entirely and was forwarded on: the one case where we can prove nothing
      // about consent was the one case that was allowed through.
      if (!userId && !sessionId) {
        this.logger.info({ reason: 'NO_IDENTITY' }, `Measurement event ${eventName} not forwarded: consent cannot be established without an identity`);
        return;
      }
      // D-002 (the ad-conversion rule): sent unless an explicit advertising
      // refusal is stored. getCurrentState() falls back to the owner default
      // (off) when nothing is stored, which dropped every event (review 228).
      // The second argument is the browser's fp_client_id, as everywhere else.
      const allowed = await this.consentService.advertisingConversionsSent(sessionId, userId);
      if (!allowed) {
        this.logger.info({ userId, sessionId, reason: 'CONSENT_REFUSED' }, `Measurement event ${eventName} blocked: advertising refused`);
        return;
      }

      // 2. Fetch Active Destinations
      const destinations = await this.destinationRepo.getActiveDestinations();
      if (destinations.length === 0) {
        return;
      }

      // 3. Route to Queue
      for (const destination of destinations) {
        // We will perform mapping later via PreparePaidSocialPayloadUseCase 
        // This is just routing the raw event to the generic queue for processing
        await this.measurementQueue.addEvent(destination.id, {
          eventName,
          rawPayload: payload,
          routedAt: new Date()
        });
      }

      this.logger.info({ count: destinations.length }, `Successfully routed measurement event ${eventName} to ${destinations.length} destinations`);
    } catch (e: any) {
      this.logger.error({ error: e.message }, `Failed to route measurement event ${eventName}`);
      throw e;
    }
  }
}
