import { DestinationMapperResult, PaidSocialDestinationMapper } from '../../../application/ports/measurement/PaidSocialDestinationMapper';
import { DestinationPayloadGuards } from './DestinationPayloadGuards';
import { Sha256MeasurementHashingService } from '../../../application/services/measurement/Sha256MeasurementHashingService';

export class TikTokEventsMapper implements PaidSocialDestinationMapper {
  readonly destinationKey = 'tiktok';
  readonly supportedEvents = [
    'page_view',
    'view_item',
    'search',
    'add_to_cart',
    'begin_checkout',
    'purchase',
    'lead_form_submit',
    'quote_request',
    'product_finder_complete',
  ];

  constructor(private readonly hashingService: Sha256MeasurementHashingService) {}

  private mapEventName(eventName: string): string {
    const map: Record<string, string> = {
      page_view: 'Pageview',
      view_item: 'ViewContent',
      search: 'Search',
      add_to_cart: 'AddToCart',
      begin_checkout: 'InitiateCheckout',
      purchase: 'PlaceAnOrder',
      lead_form_submit: 'SubmitForm',
      quote_request: 'SubmitForm',
      product_finder_complete: 'Search',
    };
    return map[eventName] || eventName;
  }

  validateEvent(eventName: string, rawPayload: any): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!this.supportedEvents.includes(eventName)) {
      errors.push(`Event ${eventName} is not supported by TikTokEventsMapper`);
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
    
    // Build user data
    const user: Record<string, any> = {};
    if (rawPayload?.user?.email) {
      user.email = this.hashingService.hashString(rawPayload.user.email);
    } else if (rawPayload?.hashedEmail) {
      user.email = rawPayload.hashedEmail;
    }
    
    if (rawPayload?.user?.phone) {
      user.phone_number = this.hashingService.hashPhone(rawPayload.user.phone);
    } else if (rawPayload?.hashedPhone) {
      user.phone_number = rawPayload.hashedPhone;
    }

    const context: Record<string, any> = {
      page: {
        url: rawPayload.source_url || rawPayload.page_url,
      },
      user,
      user_agent: rawPayload.client_user_agent,
      ip: rawPayload.client_ip_address,
    };
    
    if (rawPayload.ttclid) context.ad = { callback: rawPayload.ttclid };

    const properties: Record<string, any> = { ...rawPayload.properties };
    if (rawPayload.value) properties.value = rawPayload.value;
    if (rawPayload.currency) properties.currency = rawPayload.currency;
    if (rawPayload.contents) properties.contents = rawPayload.contents;

    let idempotencyKey = `tiktok:${eventId}`;
    if (eventName === 'purchase' && rawPayload.order_id) {
      idempotencyKey = `tiktok:purchase:${rawPayload.order_id}:${eventId}`;
    }

    const payload = {
      event: destinationEventName,
      event_id: eventId,
      timestamp: rawPayload.event_time ? new Date(rawPayload.event_time * 1000).toISOString() : new Date().toISOString(),
      context,
      properties,
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
        value: properties.value,
      },
    };
  }
}
