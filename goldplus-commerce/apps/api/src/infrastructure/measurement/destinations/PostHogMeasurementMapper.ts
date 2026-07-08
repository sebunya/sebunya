import { DestinationMapperResult, PaidSocialDestinationMapper } from '../../../application/ports/measurement/PaidSocialDestinationMapper';
import { DestinationPayloadGuards } from './DestinationPayloadGuards';
import { Sha256MeasurementHashingService } from '../../../application/services/measurement/Sha256MeasurementHashingService';

export class PostHogMeasurementMapper implements PaidSocialDestinationMapper {
  readonly destinationKey = 'posthog';
  readonly supportedEvents = [
    'page_view',
    'view_item',
    'search',
    'add_to_cart',
    'begin_checkout',
    'purchase',
    'quote_request',
    'whatsapp_click',
    'product_finder_complete',
    'preference_updated',
    'consent_granted',
    'consent_withdrawn',
  ];

  constructor(private readonly hashingService: Sha256MeasurementHashingService) {}

  private mapEventName(eventName: string): string {
    const map: Record<string, string> = {
      page_view: '$pageview',
      view_item: 'Product Viewed',
      search: 'Product Searched',
      add_to_cart: 'Cart Item Added',
      begin_checkout: 'Checkout Started',
      purchase: 'Order Completed',
      quote_request: 'Quote Requested',
      whatsapp_click: 'WhatsApp Clicked',
      product_finder_complete: 'Product Finder Completed',
      preference_updated: 'Preference Updated',
      consent_granted: 'Consent Granted',
      consent_withdrawn: 'Consent Withdrawn',
    };
    return map[eventName] || eventName;
  }

  validateEvent(eventName: string, rawPayload: any): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!this.supportedEvents.includes(eventName)) {
      errors.push(`Event ${eventName} is not supported by PostHogMeasurementMapper`);
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
    
    // PostHog uses distinct_id
    const distinctId = rawPayload?.user_id || rawPayload?.anonymous_id || rawPayload?.client_ip_address || 'anonymous';
    
    let hashedEmail: string | undefined;
    if (rawPayload?.user?.email) {
      hashedEmail = this.hashingService.hashString(rawPayload.user.email);
    } else if (rawPayload?.hashedEmail) {
      hashedEmail = rawPayload.hashedEmail;
    }
    
    const properties: Record<string, any> = { ...rawPayload.properties };
    if (hashedEmail) properties.$set = { email_hash: hashedEmail };
    if (rawPayload.client_ip_address) properties.$ip = rawPayload.client_ip_address;
    if (rawPayload.client_user_agent) properties.$browser = rawPayload.client_user_agent; // Posthog parses UA usually
    if (rawPayload.source_url || rawPayload.page_url) properties.$current_url = rawPayload.source_url || rawPayload.page_url;

    if (rawPayload.value) properties.revenue = Number(rawPayload.value);
    if (rawPayload.currency) properties.currency = rawPayload.currency;
    if (eventName === 'purchase' && rawPayload.order_id) properties.order_id = rawPayload.order_id;
    if (rawPayload.contents) properties.contents = rawPayload.contents;

    let idempotencyKey = `posthog:${eventId}`;
    if (eventName === 'purchase' && rawPayload.order_id) {
      idempotencyKey = `posthog:purchase:${rawPayload.order_id}:${eventId}`;
    }

    const payload = {
      event: destinationEventName,
      distinct_id: distinctId,
      properties,
      timestamp: rawPayload.event_time ? new Date(rawPayload.event_time * 1000).toISOString() : new Date().toISOString(),
      messageId: eventId,
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
        hasEmail: !!hashedEmail,
        value: properties.revenue,
      },
    };
  }
}
