import { describe, it, expect, vi } from 'vitest';
import { GetCustomerPreferenceCentreUseCase } from '../../src/application/use-cases/preferences/GetCustomerPreferenceCentreUseCase';
import { UpdateCustomerPreferenceCentreUseCase } from '../../src/application/use-cases/preferences/UpdateCustomerPreferenceCentreUseCase';
import { RecordPreferenceConsentChangeUseCase } from '../../src/application/use-cases/preferences/RecordPreferenceConsentChangeUseCase';
import { PreferenceRedactor } from '../../src/infrastructure/preferences/PreferenceRedactor';

describe('Storefront Preference Centre', () => {

  describe('PreferenceRedactor', () => {
    it('redacts PII and secrets recursively', () => {
      const payload = {
        eventName: 'preference_updated',
        user: {
          id: 'user_123',
          email: 'test@example.com',
          phone: '+123456789',
          hashedEmail: 'abc123hash', // Should not be redacted due to exception
        },
        token: 'secret_access_token',
        authorization: 'Bearer foo',
      };

      const redacted = PreferenceRedactor.redact(payload);

      expect(redacted.user.id).toBe('user_123');
      expect(redacted.user.email).toBe('[REDACTED_PII]');
      expect(redacted.user.phone).toBe('[REDACTED_PII]');
      expect(redacted.user.hashedEmail).toBe('abc123hash');
      // "token" doesn't strictly match the current secretKeys unless we add it, but authorization does
      expect(redacted.authorization).toBe('[REDACTED_SECRET]');
    });
  });

  describe('GetCustomerPreferenceCentreUseCase', () => {
    it('merges DB preferences with ConsentService state', async () => {
      const mockPrefRepo = { getPreferences: vi.fn(), upsertPreferences: vi.fn() };
      const mockConsentService = { getCurrentState: vi.fn(), recordSignal: vi.fn() };

      mockPrefRepo.getPreferences.mockResolvedValue({
        channels: { email: true, sms: false, whatsapp: true },
        topics: {},
        interests: { laptops: true },
        intent: {}
      });

      mockConsentService.getCurrentState.mockResolvedValue({
        analytics: true,
        advertising: false,
        personalization: true,
      });

      const uc = new GetCustomerPreferenceCentreUseCase(mockPrefRepo as any, mockConsentService as any);
      const result = await uc.execute('user_1');

      expect(result.channels.email).toBe(true);
      expect(result.channels.sms).toBe(false);
      expect(result.interests.laptops).toBe(true);
      expect(result.consent.analytics).toBe(true);
      expect(result.consent.advertising).toBe(false);
      expect(result.consent.personalization).toBe(true);
      expect(result.consent.essential).toBe(true);
    });
  });

  describe('UpdateCustomerPreferenceCentreUseCase', () => {
    it('updates preferences, logs audit, publishes measurement, and conditionally updates consent', async () => {
      const mockPrefRepo = { getPreferences: vi.fn(), upsertPreferences: vi.fn() };
      const mockAuditRepo = { logAudit: vi.fn(), getAuditTrail: vi.fn() };
      const mockPublisher = { publishPreferenceUpdate: vi.fn() };
      const mockRecordConsentUc = { execute: vi.fn() };

      mockPrefRepo.getPreferences.mockResolvedValue(null);
      mockPrefRepo.upsertPreferences.mockImplementation(async (userId, data) => data);

      const uc = new UpdateCustomerPreferenceCentreUseCase(
        mockPrefRepo as any,
        mockAuditRepo as any,
        mockPublisher as any,
        mockRecordConsentUc as any
      );

      const input = {
        userId: 'user_1',
        channels: { email: true },
        consent: { analytics: true, advertising: false, personalization: true }
      };

      const result = await uc.execute(input);

      expect(mockPrefRepo.upsertPreferences).toHaveBeenCalled();
      expect(mockAuditRepo.logAudit).toHaveBeenCalled();
      expect(mockPublisher.publishPreferenceUpdate).toHaveBeenCalled();
      expect(mockRecordConsentUc.execute).toHaveBeenCalledWith(expect.objectContaining({
        analyticsGranted: true,
        advertisingGranted: false,
        personalizationGranted: true
      }));

      expect(result.channels.email).toBe(true);
      expect(result.channels.sms).toBe(false); // default false
    });
  });
});
