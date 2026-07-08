import { DestinationMapperResult, PaidSocialDestinationMapper } from '../../../application/ports/measurement/PaidSocialDestinationMapper';
import { DestinationPayloadGuards } from './DestinationPayloadGuards';
import { Sha256MeasurementHashingService } from '../../../application/services/measurement/Sha256MeasurementHashingService';

export class LinkedInConversionMapper implements PaidSocialDestinationMapper {
  readonly destinationKey = 'linkedin';
  readonly supportedEvents = [
    'page_view',
    'lead_form_submit',
    'quote_request',
    'dealer_application_submit',
    'corporate_inquiry_submit',
    'purchase',
  ];

  constructor(private readonly hashingService: Sha256MeasurementHashingService) {}

  private mapEventName(eventName: string): string {
    const map: Record<string, string> = {
      page_view: 'PAGE_VIEW',
      purchase: 'PURCHASE',
      lead_form_submit: 'LEAD',
      quote_request: 'REQUEST_QUOTE',
      dealer_application_submit: 'LEAD',
      corporate_inquiry_submit: 'LEAD',
    };
    return map[eventName] || eventName;
  }

  validateEvent(eventName: string, rawPayload: any): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!this.supportedEvents.includes(eventName)) {
      errors.push(`Event ${eventName} is not supported by LinkedInConversionMapper`);
      return { valid: false, errors };
    }

    if (eventName === 'purchase') {
      if (!rawPayload?.value) errors.push('Purchase event requires a value');
      if (!rawPayload?.currency) errors.push('Purchase event requires a currency');
    }

    return { valid: errors.length === 0, errors };
  }

  mapEvent(eventName: string, eventId: string, rawPayload: any): DestinationMapperResult {
    if (!eventId) {
      return {
        success: false,
        status: 'VALIDATION_FAILED',
        destination: this.destinationKey,
        eventName,
        errors: ['event_id is required'],
      };
    }

    if (!this.supportedEvents.includes(eventName)) {
      return {
        success: false,
        status: 'UNSUPPORTED_EVENT',
        destination: this.destinationKey,
        eventName,
        eventId,
      };
    }

    const validation = this.validateEvent(eventName, rawPayload);
    if (!validation.valid) {
      return {
        success: false,
        status: 'VALIDATION_FAILED',
        destination: this.destinationKey,
        eventName,
        eventId,
        errors: validation.errors,
      };
    }

    const destinationEventName = this.mapEventName(eventName);
    
    const user: Record<string, any> = {};
    if (rawPayload?.user?.email) {
      user.email = [this.hashingService.hashString(rawPayload.user.email)];
    } else if (rawPayload?.hashedEmail) {
      user.email = [rawPayload.hashedEmail];
    }
    
    // LinkedIn supports Title, Company etc, but mostly uses FirstPartyData
    const firstPartyData: Record<string, any> = {};
    if (user.email) firstPartyData.emails = user.email;

    const payload: any = {
      conversionId: destinationEventName, // Technically LinkedIn uses rule-specific conversion IDs, we pass the standard mapped type or standard CAPI format
      conversionType: destinationEventName,
      conversion_happened_at: rawPayload.event_time ? rawPayload.event_time * 1000 : Date.now(),
    };

    if (Object.keys(firstPartyData).length > 0) {
      payload.user = firstPartyData;
    }

    if (rawPayload.value) payload.conversionValue = { currencyCode: rawPayload.currency, amount: String(rawPayload.value) };
    if (rawPayload.eventId) payload.eventId = eventId;

    let idempotencyKey = `linkedin:${eventId}`;
    if (eventName === 'purchase' && rawPayload.order_id) {
      idempotencyKey = `linkedin:purchase:${rawPayload.order_id}:${eventId}`;
    }

    if (DestinationPayloadGuards.hasRawPii(payload)) {
      return {
        success: false,
        status: 'PII_BLOCKED',
        destination: this.destinationKey,
        eventName,
        eventId,
        errors: ['Raw PII detected in output payload'],
      };
    }

    return {
      success: true,
      status: 'MAPPED',
      destination: this.destinationKey,
      eventName,
      destinationEventName,
      eventId,
      idempotencyKey,
      payload,
      redactedSummary: {
        event_name: destinationEventName,
        hasEmail: !!user.email,
        value: payload.conversionValue?.amount,
      },
    };
  }
}
