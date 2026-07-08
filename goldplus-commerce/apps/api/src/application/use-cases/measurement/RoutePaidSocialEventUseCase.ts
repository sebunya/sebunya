import { PaidSocialDestinationRepository } from '../../ports/measurement/PaidSocialDestinationRepository';
import { MeasurementLogger } from '../../ports/measurement/MeasurementLogger';
import { ConsentService } from './ConsentService';
import { IMeasurementQueuePort } from '../../ports/measurement/IMeasurementQueuePort';

export class RoutePaidSocialEventUseCase {
  constructor(
    private readonly destinationRepo: PaidSocialDestinationRepository,
    private readonly queuePort: IMeasurementQueuePort,
    private readonly consentService: ConsentService,
    private readonly logger: MeasurementLogger
  ) {}

  async execute(userId: string, eventName: string, eventPayload: any) {
    // 1. Fetch current consent state
    const consent = await this.consentService.getCurrentState(userId);
    
    if (!consent) {
      this.logger.warn({ userId, eventName }, '[RoutePaidSocialEvent] Dropping event: No consent record found.');
      return;
    }

    // 2. Fetch active destinations
    const destinations = await this.destinationRepo.getActiveDestinations();

    // 3. Evaluate each destination against consent
    for (const destination of destinations) {
      if (!this.evaluateConsent(destination.name, consent)) {
        this.logger.info({ userId, eventName, destination: destination.name }, '[RoutePaidSocialEvent] Dropping event for destination: Consent denied.');
        continue;
      }

      // 4. Redact payload if necessary (basic implementation)
      const redactedPayload = this.redactPayload(eventPayload, consent);

      // 5. Enqueue for asynchronous delivery
      await this.enqueueEvent(destination.name, redactedPayload);
    }
  }

  private evaluateConsent(destinationName: string, consent: any): boolean {
    // simplified evaluation: require advertising and analytics
    return consent.advertising === true && consent.analytics === true;
  }

  private redactPayload(payload: any, consent: any): any {
    const redacted = { ...payload };
    // If no personalization consent, strip specific PII
    if (consent.personalization !== true) {
      delete redacted.email;
      delete redacted.phone;
    }
    return redacted;
  }

  private async enqueueEvent(destinationName: string, payload: any) {
    await this.queuePort.enqueuePaidSocialEvent(destinationName, payload);
  }
}
