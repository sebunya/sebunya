import { describe, it, expect } from 'vitest';
import { MeasurementControlTowerRedactor } from '../../src/infrastructure/admin/MeasurementControlTowerRedactor';

describe('MeasurementControlTowerRedactor', () => {
  it('redacts raw email and phone', () => {
    const redactor = new MeasurementControlTowerRedactor();
    const payload = {
      customer: {
        email: 'test@test.com',
        phone: '1234567890',
        name: 'Test',
      }
    };
    const result = redactor.redactPayload(payload);
    expect(result.customer.email).toBe('[REDACTED]');
    expect(result.customer.phone).toBe('[REDACTED]');
    expect(result.customer.name).toBe('Test');
  });

  it('redacts secrets and authorization headers', () => {
    const redactor = new MeasurementControlTowerRedactor();
    const payload = {
      headers: {
        authorization: 'Bearer secret_token',
        'x-client-secret': 'supersecret',
      }
    };
    const result = redactor.redactPayload(payload);
    expect(result.headers.authorization).toBe('[REDACTED]');
    expect(result.headers['x-client-secret']).toBe('[REDACTED]');
  });
});
