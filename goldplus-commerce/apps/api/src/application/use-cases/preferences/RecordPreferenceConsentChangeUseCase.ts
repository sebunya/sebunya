import { ConsentService } from '../measurement/ConsentService';

export interface ConsentChangeInput {
  userId: string;
  analyticsGranted?: boolean;
  advertisingGranted?: boolean;
  personalizationGranted?: boolean;
  source: string;
  ipAddress?: string;
  userAgent?: string;
}

export class RecordPreferenceConsentChangeUseCase {
  constructor(private consentService: ConsentService) {}

  async execute(input: ConsentChangeInput): Promise<void> {
    // get current consent
    const current = await this.consentService.getCurrentState(undefined, input.userId);
    
    // check if anything changed
    const changes: Record<string, boolean> = {};
    if (input.analyticsGranted !== undefined && input.analyticsGranted !== current.analytics) {
      changes.analytics = input.analyticsGranted;
    }
    if (input.advertisingGranted !== undefined && input.advertisingGranted !== current.advertising) {
      changes.advertising = input.advertisingGranted;
    }
    if (input.personalizationGranted !== undefined && input.personalizationGranted !== current.personalization) {
      changes.personalization = input.personalizationGranted;
    }

    if (Object.keys(changes).length === 0) {
      return; // no changes to consent
    }

    // append new record via ConsentService
    const newPurposes = {
      analytics: input.analyticsGranted ?? current.analytics,
      advertising: input.advertisingGranted ?? current.advertising,
      personalization: input.personalizationGranted ?? current.personalization,
      essential: true
    };

    await this.consentService.recordSignal({
      user_id: input.userId,
      fp_client_id: `user_${input.userId}`,
      purposes: newPurposes as any,
      grant_type: 'explicit',
      capture_surface: input.source as any,
      consent_language: 'en',
      notice_version: 'v1.0'
    }, input.ipAddress, input.userAgent);
  }
}
