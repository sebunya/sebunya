import { DestinationMapperResult, PaidSocialDestinationMapper } from '../../../application/ports/measurement/PaidSocialDestinationMapper';
import { DestinationPayloadGuards } from './DestinationPayloadGuards';
import { Sha256MeasurementHashingService } from '../../../application/services/measurement/Sha256MeasurementHashingService';

export class XConversionMapper implements PaidSocialDestinationMapper {
  readonly destinationKey = 'x';
  readonly supportedEvents = [
    'page_view',
    'purchase',
    'lead_form_submit',
    'quote_request',
    'whatsapp_click',
    'product_finder_complete',
  ];

  constructor(private readonly hashingService: Sha256MeasurementHashingService) {}

  private mapEventName(eventName: string): string {
    const map: Record<string, string> = {
      page_view: 'Page View',
      purchase: 'Purchase',
      lead_form_submit: 'Sign up', // X doesn't have a direct Lead out-of-the-box standard name, "Sign up" or custom
      quote_request: 'Sign up',
      whatsapp_click: 'Custom', // Using Custom for Whatsapp click
      product_finder_complete: 'Search',
    };
    return map[eventName] || eventName;
  }

  validateEvent(eventName: string, rawPayload: any): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!this.supportedEvents.includes(eventName)) {
      errors.push(`Event ${eventName} is not supported by XConversionMapper`);
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
    
    if (rawPayload?.user?.phone) {
      user.phone_number = [this.hashingService.hashPhone(rawPayload.user.phone)];
    } else if (rawPayload?.hashedPhone) {
      user.phone_number = [rawPayload.hashedPhone];
    }

    if (rawPayload.twclid) user.twclid = rawPayload.twclid;

    const custom: Record<string, any> = { ...rawPayload.properties };
    if (rawPayload.value) custom.value = String(rawPayload.value); // X requires strings usually
    if (rawPayload.currency) custom.currency = rawPayload.currency;

    let idempotencyKey = `x:${eventId}`;
    if (eventName === 'purchase' && rawPayload.order_id) {
      idempotencyKey = `x:purchase:${rawPayload.order_id}:${eventId}`;
      custom.order_id = rawPayload.order_id;
    }

    const payload = {
      event_id: eventId,
      event_name: destinationEventName,
      conversion_time: rawPayload.event_time ? new Date(rawPayload.event_time * 1000).toISOString() : new Date().toISOString(),
      user,
      custom_properties: custom,
    };

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
        hasPhone: !!user.phone_number,
        value: custom.value,
      },
    };
  }
}
