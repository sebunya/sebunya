import { expect, test, describe } from 'vitest';
import { NotificationIdempotency } from '../../apps/api/src/application/use-cases/notifications/NotificationIdempotency';

describe('NotificationIdempotency', () => {
  const input = {
    orderId: 'order-123',
    eventType: 'PAYMENT_SUCCESS',
    channel: 'email',
    templateName: 'ORDER_PAYMENT_SUCCESS',
    paymentStatus: 'paid',
    orderStatus: 'processing',
    statusVersion: 1,
  };

  test('should generate deterministic keys containing no PII or secrets', () => {
    const key = NotificationIdempotency.buildKey(input);
    expect(key).toBe('order-123:PAYMENT_SUCCESS:email:ORDER_PAYMENT_SUCCESS:paid:processing:1');

    // Verification that key contains no email, phone or address
    expect(key).not.toContain('john');
    expect(key).not.toContain('@');
    expect(key).not.toContain('+256');
    expect(key).not.toContain('Kampala');
  });

  test('should produce the same key for duplicate inputs', () => {
    const key1 = NotificationIdempotency.buildKey(input);
    const key2 = NotificationIdempotency.buildKey({ ...input });
    expect(key1).toBe(key2);
  });

  test('should produce a different key for a different statusVersion', () => {
    const key1 = NotificationIdempotency.buildKey(input);
    const key2 = NotificationIdempotency.buildKey({ ...input, statusVersion: 2 });
    expect(key1).not.toBe(key2);
    expect(key2).toContain(':2');
  });
});
