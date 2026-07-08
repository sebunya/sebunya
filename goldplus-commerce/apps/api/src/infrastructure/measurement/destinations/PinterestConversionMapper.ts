import { DestinationMapperResult, PaidSocialDestinationMapper } from '../../../application/ports/measurement/PaidSocialDestinationMapper';
import { DestinationPayloadGuards } from './DestinationPayloadGuards';
import { Sha256MeasurementHashingService } from '../../../application/services/measurement/Sha256MeasurementHashingService';

export class PinterestConversionMapper implements PaidSocialDestinationMapper {
  readonly destinationKey = 'pinterest';
  readonly supportedEvents = [
    'page_view',
    'view_item',
    'search',
    'add_to_cart',
    'begin_checkout',
    'purchase',
    'lead_form_submit',
  ];

  constructor(private readonly hashingService: Sha256MeasurementHashingService) {}

  private mapEventName(eventName: string): string {
    const map: Record<string, string> = {
      page_view: 'page_visit',
      view_item: 'page_visit',
      search: 'search',
      add_to_cart: 'add_to_cart',
      begin_checkout: 'checkout',
      purchase: 'checkout',
      lead_form_submit: 'lead',
    };
    return map[eventName] || eventName;
  }

  validateEvent(eventName: string, rawPayload: any): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!this.supportedEvents.includes(eventName)) {
      errors.push(`Event ${eventName} is not supported by PinterestConversionMapper`);
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
    
    const user_data: Record<string, any> = {};
    if (rawPayload?.user?.email) {
      user_data.em = [this.hashingService.hashString(rawPayload.user.email)];
    } else if (rawPayload?.hashedEmail) {
      user_data.em = [rawPayload.hashedEmail];
    }
    
    if (rawPayload?.user?.phone) {
      user_data.ph = [this.hashingService.hashPhone(rawPayload.user.phone)];
    } else if (rawPayload?.hashedPhone) {
      user_data.ph = [rawPayload.hashedPhone];
    }

    if (rawPayload.client_ip_address) user_data.client_ip_address = rawPayload.client_ip_address;
    if (rawPayload.client_user_agent) user_data.client_user_agent = rawPayload.client_user_agent;

    const custom_data: Record<string, any> = { ...rawPayload.properties };
    if (rawPayload.value) custom_data.value = rawPayload.value;
    if (rawPayload.currency) custom_data.currency = rawPayload.currency;

    let idempotencyKey = `pinterest:${eventId}`;
    if (eventName === 'purchase' && rawPayload.order_id) {
      idempotencyKey = `pinterest:purchase:${rawPayload.order_id}:${eventId}`;
      custom_data.order_id = rawPayload.order_id;
    }

    const payload = {
      event_name: destinationEventName,
      action_source: 'web',
      event_time: rawPayload.event_time || Math.floor(Date.now() / 1000),
      event_id: eventId,
      user_data,
      custom_data,
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
        hasEmail: !!user_data.em,
        value: custom_data.value,
      },
    };
  }
}
