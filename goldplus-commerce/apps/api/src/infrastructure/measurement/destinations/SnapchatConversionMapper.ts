import { DestinationMapperResult, PaidSocialDestinationMapper } from '../../../application/ports/measurement/PaidSocialDestinationMapper';
import { DestinationPayloadGuards } from './DestinationPayloadGuards';
import { Sha256MeasurementHashingService } from '../../../application/services/measurement/Sha256MeasurementHashingService';

export class SnapchatConversionMapper implements PaidSocialDestinationMapper {
  readonly destinationKey = 'snapchat';
  readonly supportedEvents = [
    'page_view',
    'view_item',
    'add_to_cart',
    'begin_checkout',
    'purchase',
    'lead_form_submit',
  ];

  constructor(private readonly hashingService: Sha256MeasurementHashingService) {}

  private mapEventName(eventName: string): string {
    const map: Record<string, string> = {
      page_view: 'PAGE_VIEW',
      view_item: 'VIEW_CONTENT',
      add_to_cart: 'ADD_CART',
      begin_checkout: 'START_CHECKOUT',
      purchase: 'PURCHASE',
      lead_form_submit: 'SIGN_UP', // Or LEAD, Snapchat supports both
    };
    return map[eventName] || eventName;
  }

  validateEvent(eventName: string, rawPayload: any): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!this.supportedEvents.includes(eventName)) {
      errors.push(`Event ${eventName} is not supported by SnapchatConversionMapper`);
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
    
    let hashedEmail: string | undefined;
    let hashedPhone: string | undefined;

    if (rawPayload?.user?.email) {
      hashedEmail = this.hashingService.hashString(rawPayload.user.email);
    } else if (rawPayload?.hashedEmail) {
      hashedEmail = rawPayload.hashedEmail;
    }
    
    if (rawPayload?.user?.phone) {
      hashedPhone = this.hashingService.hashPhone(rawPayload.user.phone);
    } else if (rawPayload?.hashedPhone) {
      hashedPhone = rawPayload.hashedPhone;
    }

    const payload: any = {
      event_type: destinationEventName,
      event_conversion_type: 'WEB',
      event_tag: eventId,
      timestamp: rawPayload.event_time ? String(rawPayload.event_time) : String(Math.floor(Date.now() / 1000)),
    };

    if (hashedEmail) payload.hashed_email = hashedEmail;
    if (hashedPhone) payload.hashed_phone_number = hashedPhone;
    if (rawPayload.client_ip_address) payload.ip_address = rawPayload.client_ip_address;
    if (rawPayload.client_user_agent) payload.user_agent = rawPayload.client_user_agent;
    if (rawPayload.source_url || rawPayload.page_url) payload.page_url = rawPayload.source_url || rawPayload.page_url;

    if (rawPayload.value) payload.price = Number(rawPayload.value);
    if (rawPayload.currency) payload.currency = rawPayload.currency;
    if (eventName === 'purchase' && rawPayload.order_id) payload.transaction_id = rawPayload.order_id;

    let idempotencyKey = `snapchat:${eventId}`;
    if (eventName === 'purchase' && rawPayload.order_id) {
      idempotencyKey = `snapchat:purchase:${rawPayload.order_id}:${eventId}`;
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
        hasEmail: !!hashedEmail,
        hasPhone: !!hashedPhone,
        value: payload.price,
      },
    };
  }
}
