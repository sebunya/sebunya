import { describe, it, expect } from 'vitest';
import { PaymentMeasurementRedactor } from '../../src/infrastructure/measurement/PaymentMeasurementRedactor';

describe('PaymentMeasurementRedactor', () => {
  const redactor = new PaymentMeasurementRedactor();

  it('redacts email, phone, Authorization, access_token, refresh_token, client_secret, payment_token', () => {
    const payload = {
      email: 'secret@email.com',
      phone: '0770000000',
      Authorization: 'Bearer xyz',
      access_token: 'xyz',
      refresh_token: 'xyz',
      client_secret: 'xyz',
      order_id: 'safe-123'
    };
    const redacted = redactor.redact(payload);
    expect(redacted.email).toBe('[REDACTED]');
    expect(redacted.phone).toBe('[REDACTED]');
    expect(redacted.Authorization).toBe('[REDACTED]');
    expect(redacted.access_token).toBe('[REDACTED]');
    expect(redacted.refresh_token).toBe('[REDACTED]');
    expect(redacted.client_secret).toBe('[REDACTED]');
    expect(redacted.order_id).toBe('safe-123');
  });

  it('redacts nested payloads', () => {
    const payload = { nested: { email: 'test@example.com' } };
    const redacted = redactor.redact(payload);
    expect(redacted.nested.email).toBe('[REDACTED]');
  });

  it('redacts arrays inside payloads', () => {
    const payload = { arr: [{ phone: '123' }, { phone: '456' }] };
    const redacted = redactor.redact(payload);
    expect(redacted.arr[0].phone).toBe('[REDACTED]');
    expect(redacted.arr[1].phone).toBe('[REDACTED]');
  });

  it('does not mutate original object', () => {
    const payload = { email: 'test@example.com' };
    const redacted = redactor.redact(payload);
    expect(redacted.email).toBe('[REDACTED]');
    expect(payload.email).toBe('test@example.com');
  });
});
