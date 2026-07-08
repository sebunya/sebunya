import { CustomerPreferenceRepository } from '../../ports/preferences/CustomerPreferenceRepository';
import { PreferenceAuditRepository } from '../../ports/preferences/PreferenceAuditRepository';
import { PreferenceMeasurementPublisher } from '../../ports/preferences/PreferenceMeasurementPublisher';
import { RecordPreferenceConsentChangeUseCase } from './RecordPreferenceConsentChangeUseCase';
import { PreferenceCentreDto } from './GetCustomerPreferenceCentreUseCase';

export interface UpdatePreferenceInput {
  userId: string;
  channels?: {
    email?: boolean;
    sms?: boolean;
    whatsapp?: boolean;
  };
  topics?: Record<string, boolean>;
  interests?: Record<string, boolean>;
  intent?: Record<string, any>;
  consent?: {
    analytics?: boolean;
    advertising?: boolean;
    personalization?: boolean;
  };
  ipAddress?: string;
  userAgent?: string;
}

export class UpdateCustomerPreferenceCentreUseCase {
  constructor(
    private preferenceRepo: CustomerPreferenceRepository,
    private auditRepo: PreferenceAuditRepository,
    private measurementPublisher: PreferenceMeasurementPublisher,
    private recordConsentUc: RecordPreferenceConsentChangeUseCase
  ) {}

  async execute(input: UpdatePreferenceInput): Promise<PreferenceCentreDto> {
    // 1. Fetch current preference state
    const currentPrefs = await this.preferenceRepo.getPreferences(input.userId);

    const beforeState = currentPrefs ? {
      channels: currentPrefs.channels,
      topics: currentPrefs.topics,
      interests: currentPrefs.interests,
      intent: currentPrefs.intent
    } : null;

    // 2. Validate & Merge changes
    const newChannels = {
      email: input.channels?.email ?? currentPrefs?.channels.email ?? false,
      sms: input.channels?.sms ?? currentPrefs?.channels.sms ?? false,
      whatsapp: input.channels?.whatsapp ?? currentPrefs?.channels.whatsapp ?? false,
    };
    const newTopics = { ...(currentPrefs?.topics || {}), ...(input.topics || {}) };
    const newInterests = { ...(currentPrefs?.interests || {}), ...(input.interests || {}) };
    const newIntent = { ...(currentPrefs?.intent || {}), ...(input.intent || {}) };

    // 3. Update Preferences
    const updated = await this.preferenceRepo.upsertPreferences(input.userId, {
      userId: input.userId,
      channels: newChannels,
      topics: newTopics,
      interests: newInterests,
      intent: newIntent,
    });

    const afterState = {
      channels: updated.channels,
      topics: updated.topics,
      interests: updated.interests,
      intent: updated.intent
    };

    // 4. Audit Preference Change
    await this.auditRepo.logAudit({
      userId: input.userId,
      beforeState,
      afterState,
      source: 'storefront_preference_centre'
    });

    // 5. Publish Measurement Event
    await this.measurementPublisher.publishPreferenceUpdate({
      eventName: 'preference_updated',
      userId: input.userId,
      payload: afterState,
      source: 'storefront_preference_centre'
    });

    // 6. Handle Consent Change if present
    if (input.consent) {
      await this.recordConsentUc.execute({
        userId: input.userId,
        analyticsGranted: input.consent.analytics,
        advertisingGranted: input.consent.advertising,
        personalizationGranted: input.consent.personalization,
        source: 'storefront_preference_centre',
        ipAddress: input.ipAddress,
        userAgent: input.userAgent
      });
    }

    // 7. Return mapped DTO (assuming a full reload or manual map)
    // We can just construct the return since we know the new states.
    return {
      channels: newChannels,
      topics: newTopics,
      interests: newInterests,
      intent: newIntent,
      consent: {
        analytics: input.consent?.analytics ?? false, // Will be exact on next GET
        advertising: input.consent?.advertising ?? false,
        personalization: input.consent?.personalization ?? false,
        essential: true
      }
    };
  }
}
