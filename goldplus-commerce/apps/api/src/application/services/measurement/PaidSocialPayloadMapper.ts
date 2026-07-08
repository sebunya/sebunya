import { Sha256MeasurementHashingService } from './Sha256MeasurementHashingService';

export class PaidSocialPayloadMapper {
  constructor(private readonly hashingService: Sha256MeasurementHashingService) {}

  map(eventName: string, rawPayload: any, platform: string): any {
    // Basic normalization for phase 2. Phase 3 (Slice 4) will do platform-specific mappers.
    const mapped = {
      event_name: eventName,
      event_time: Math.floor(Date.now() / 1000),
      action_source: 'website',
      user_data: {} as any,
      custom_data: rawPayload.properties || {}
    };

    if (rawPayload.user?.email) {
      mapped.user_data.em = [this.hashingService.hashString(rawPayload.user.email)];
    }
    if (rawPayload.user?.phone) {
      mapped.user_data.ph = [this.hashingService.hashPhone(rawPayload.user.phone)];
    }

    return mapped;
  }
}
