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
    /** True only when the customer actually chose (a stored, unexpired record). */
    explicit: boolean;
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
    const explicit = (await this.consentService.getExplicitState(undefined, userId)) !== null;
    // The advertising switch shows what is really sent to ad platforms (D-002),
    // not the owner default, which said "off" while purchases went out.
    // Any failure (including an older ConsentService) falls back to the stored state.
    const advertising = await Promise.resolve()
      .then(() => this.consentService.advertisingConversionsSent(undefined, userId))
      .catch(() => consent.advertising);

    return {
      channels: prefs?.channels || { email: false, sms: false, whatsapp: false },
      topics: prefs?.topics || {},
      interests: prefs?.interests || {},
      intent: prefs?.intent || {},
      consent: {
        analytics: consent.analytics,
        advertising,
        personalization: consent.personalization,
        essential: true, // Always true for strictly necessary
        explicit,
      }
    };
  }
}
