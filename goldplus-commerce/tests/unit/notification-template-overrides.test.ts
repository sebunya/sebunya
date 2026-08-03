import { afterEach, describe, expect, it } from 'vitest';
import {
  NOTIFICATION_TEMPLATE_KEYS,
  NotificationTemplateRenderer,
  setTemplateOverrideProvider,
} from '../../apps/api/src/application/use-cases/notifications/NotificationTemplateRenderer';

/**
 * Wave 2E-3: operator overrides fall through PER FIELD — an override with only a
 * subject changes only the subject — and wording can never render blank: absent
 * provider, absent row, or empty field all land on the code defaults.
 */
afterEach(() => setTemplateOverrideProvider(null));

describe('notification template overrides', () => {
  const renderer = new NotificationTemplateRenderer();

  it('exposes all seven template keys for the admin surface', () => {
    expect(NOTIFICATION_TEMPLATE_KEYS).toHaveLength(7);
  });

  it('uses code defaults when no provider is set', () => {
    expect(renderer.getSubject('ORDER_PAYMENT_SUCCESS')).toBe('Payment received for your GoldPlus order');
  });

  it('applies an override per field and falls back per field', () => {
    setTemplateOverrideProvider((key) =>
      key === 'ORDER_PAYMENT_SUCCESS' ? { subject: 'Asante! Payment confirmed' } : undefined,
    );
    expect(renderer.getSubject('ORDER_PAYMENT_SUCCESS')).toBe('Asante! Payment confirmed');
    // preheader had no override → code default remains.
    expect(renderer.getPreheader('ORDER_PAYMENT_SUCCESS')).toBe('Your payment has been verified.');
    // other templates untouched.
    expect(renderer.getSubject('ORDER_PAYMENT_FAILED')).toBe('Your GoldPlus payment did not go through');
  });

  it('treats empty-string overrides as absent (never blank wording)', () => {
    setTemplateOverrideProvider(() => ({ subject: '', preheader: null }));
    expect(renderer.getSubject('ORDER_RECEIVED_UNPAID')).toBe('We received your GoldPlus order');
    expect(renderer.getPreheader('ORDER_RECEIVED_UNPAID')).toBe('Complete payment to move your order forward.');
  });
});
