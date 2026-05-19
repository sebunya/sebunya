import { expect, test, describe } from 'vitest';
import { NotificationChannelEligibility } from '../../apps/api/src/application/use-cases/notifications/NotificationChannelEligibility';

describe('NotificationChannelEligibility', () => {
  test('should allow email when email is valid', () => {
    const res = NotificationChannelEligibility.evaluate('email', { email: 'customer@example.com' });
    expect(res.isEligible).toBe(true);
  });

  test('should block email when email is missing or invalid', () => {
    const res1 = NotificationChannelEligibility.evaluate('email', { email: '' });
    expect(res1.isEligible).toBe(false);
    expect(res1.reason).toContain('missing or invalid');

    const res2 = NotificationChannelEligibility.evaluate('email', { email: 'invalid-email' });
    expect(res2.isEligible).toBe(false);
  });

  test('should allow SMS when phone is valid', () => {
    const res = NotificationChannelEligibility.evaluate('sms', { phone: '0788000000' });
    expect(res.isEligible).toBe(true);
  });

  test('should block SMS when phone is missing', () => {
    const res = NotificationChannelEligibility.evaluate('sms', { phone: '' });
    expect(res.isEligible).toBe(false);
    expect(res.reason).toContain('phone number is missing');
  });

  test('should return whatsapp_handoff support-link-only channel info', () => {
    const res = NotificationChannelEligibility.evaluate('whatsapp_handoff', {});
    expect(res.isEligible).toBe(true);
    expect(res.reason).toContain('client-side support link handoff');
  });

  test('should defer whatsapp_api_deferred channel', () => {
    const res = NotificationChannelEligibility.evaluate('whatsapp_api_deferred', {});
    expect(res.isEligible).toBe(false);
    expect(res.isDeferred).toBe(true);
  });
});
