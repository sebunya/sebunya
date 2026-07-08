import { CustomerPreferenceRepository } from '../../ports/preferences/CustomerPreferenceRepository';
import { ConsentService } from '../measurement/ConsentService';

export interface PreferenceCentreDto {
  channels: {
    email: boolean;
    sms: boolean;
    whatsapp: boolean;
  };
  topics: Record<string, boolean>;
  interests: Record<string, boolean>;
  intent: Record<string, any>;
  consent: {
    analytics: boolean;
    advertising: boolean;
    personalization: boolean;
    essential: boolean;
  };
}

export class GetCustomerPreferenceCentreUseCase {
  constructor(
    private preferenceRepo: CustomerPreferenceRepository,
    private consentService: ConsentService
  ) {}

  async execute(userId: string): Promise<PreferenceCentreDto> {
    const prefs = await this.preferenceRepo.getPreferences(userId);
    const consent = await this.consentService.getCurrentState(undefined, userId);

    return {
      channels: prefs?.channels || { email: false, sms: false, whatsapp: false },
      topics: prefs?.topics || {},
      interests: prefs?.interests || {},
      intent: prefs?.intent || {},
      consent: {
        analytics: consent.analytics,
        advertising: consent.advertising,
        personalization: consent.personalization,
        essential: true, // Always true for strictly necessary
      }
    };
  }
}
