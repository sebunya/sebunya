import { DestinationMapperResult, PaidSocialDestinationMapper } from '../../../application/ports/measurement/PaidSocialDestinationMapper';
import { DestinationPayloadGuards } from './DestinationPayloadGuards';
import { Sha256MeasurementHashingService } from '../../../application/services/measurement/Sha256MeasurementHashingService';

export class MetaCapiMapper implements PaidSocialDestinationMapper {
  readonly destinationKey = 'meta';
  readonly supportedEvents = [
    'page_view',
    'view_item',
    'search',
    'add_to_cart',
    'begin_checkout',
    'purchase',
    'lead_form_submit',
    'quote_request',
    'whatsapp_click',
    'product_finder_complete',
    'warranty_registration',
  ];

  constructor(private readonly hashingService: Sha256MeasurementHashingService) {}

  private mapEventName(eventName: string): string {
    const map: Record<string, string> = {
      page_view: 'PageView',
      view_item: 'ViewContent',
      search: 'Search',
      add_to_cart: 'AddToCart',
      begin_checkout: 'InitiateCheckout',
      purchase: 'Purchase',
      lead_form_submit: 'Lead',
      quote_request: 'SubmitApplication', // Or Lead
      whatsapp_click: 'Contact',
      product_finder_complete: 'FindLocation', // Using standard event proxy
      warranty_registration: 'CompleteRegistration',
    };
    return map[eventName] || eventName;
  }

  validateEvent(eventName: string, rawPayload: any): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!this.supportedEvents.includes(eventName)) {
      errors.push(`Event ${eventName} is not supported by MetaCapiMapper`);
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
    
    // Build user data safely
    const userData: Record<string, any> = {};
    
    // Hash emails/phones if they come in raw format from payload.user
    if (rawPayload?.user?.email) {
      userData.em = [this.hashingService.hashString(rawPayload.user.email)];
    } else if (rawPayload?.hashedEmail) {
      userData.em = [rawPayload.hashedEmail];
    }
    
    if (rawPayload?.user?.phone) {
      userData.ph = [this.hashingService.hashPhone(rawPayload.user.phone)];
    } else if (rawPayload?.hashedPhone) {
      userData.ph = [rawPayload.hashedPhone];
    }

    if (rawPayload?.client_ip_address) userData.client_ip_address = rawPayload.client_ip_address;
    if (rawPayload?.client_user_agent) userData.client_user_agent = rawPayload.client_user_agent;
    if (rawPayload?.fbc) userData.fbc = rawPayload.fbc;
    if (rawPayload?.fbp) userData.fbp = rawPayload.fbp;

    const customData: Record<string, any> = { ...rawPayload.properties };
    if (rawPayload.value) customData.value = rawPayload.value;
    if (rawPayload.currency) customData.currency = rawPayload.currency;
    if (rawPayload.contents) customData.contents = rawPayload.contents;

    let idempotencyKey = `meta:${eventId}`;
    if (eventName === 'purchase' && rawPayload.order_id) {
      idempotencyKey = `meta:purchase:${rawPayload.order_id}:${eventId}`;
    }

    const payload = {
      event_name: destinationEventName,
      event_time: rawPayload.event_time || Math.floor(Date.now() / 1000),
      event_id: eventId,
      action_source: 'website',
      event_source_url: rawPayload.source_url || rawPayload.page_url,
      user_data: userData,
      custom_data: customData,
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

    const redactedSummary = {
      event_name: destinationEventName,
      hasEmail: !!userData.em,
      hasPhone: !!userData.ph,
      value: customData.value,
    };

    return {
      success: true,
      status: 'MAPPED',
      destination: this.destinationKey,
      eventName,
      destinationEventName,
      eventId,
      idempotencyKey,
      payload,
      redactedSummary,
    };
  }
}
