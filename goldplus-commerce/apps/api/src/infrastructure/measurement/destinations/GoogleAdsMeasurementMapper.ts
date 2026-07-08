import { DestinationMapperResult, PaidSocialDestinationMapper } from '../../../application/ports/measurement/PaidSocialDestinationMapper';
import { DestinationPayloadGuards } from './DestinationPayloadGuards';
import { Sha256MeasurementHashingService } from '../../../application/services/measurement/Sha256MeasurementHashingService';

export class GoogleAdsMeasurementMapper implements PaidSocialDestinationMapper {
  readonly destinationKey = 'google_ads';
  readonly supportedEvents = [
    'purchase',
    'lead_form_submit',
    'quote_request',
    'dealer_application_submit',
    'corporate_inquiry_submit',
  ];

  constructor(private readonly hashingService: Sha256MeasurementHashingService) {}

  private mapEventName(eventName: string): string {
    const map: Record<string, string> = {
      purchase: 'purchase',
      lead_form_submit: 'generate_lead',
      quote_request: 'generate_lead',
      dealer_application_submit: 'generate_lead',
      corporate_inquiry_submit: 'generate_lead',
    };
    return map[eventName] || eventName;
  }

  validateEvent(eventName: string, rawPayload: any): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!this.supportedEvents.includes(eventName)) {
      errors.push(`Event ${eventName} is not supported by GoogleAdsMeasurementMapper`);
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

    const user_data: Record<string, any> = {};
    if (hashedEmail) user_data.email_address = hashedEmail;
    if (hashedPhone) user_data.phone_number = hashedPhone;

    const payload: any = {
      event_name: destinationEventName,
      conversion_environment: 'CLIENT', 
    };

    if (Object.keys(user_data).length > 0) {
      payload.user_data = user_data;
    }

    if (rawPayload.gclid) payload.gclid = rawPayload.gclid;
    if (rawPayload.wbraid) payload.wbraid = rawPayload.wbraid;
    if (rawPayload.gbraid) payload.gbraid = rawPayload.gbraid;

    if (rawPayload.value) payload.conversion_value = Number(rawPayload.value);
    if (rawPayload.currency) payload.currency_code = rawPayload.currency;
    if (eventName === 'purchase' && rawPayload.order_id) payload.transaction_id = rawPayload.order_id;
    if (rawPayload.event_time) payload.conversion_date_time = new Date(rawPayload.event_time * 1000).toISOString();

    let idempotencyKey = `google_ads:${eventId}`;
    if (eventName === 'purchase' && rawPayload.order_id) {
      idempotencyKey = `google_ads:purchase:${rawPayload.order_id}:${eventId}`;
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
        value: payload.conversion_value,
      },
    };
  }
}
