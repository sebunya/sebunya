import { describe, it, expect } from 'vitest';
import { PaidSocialPayloadRedactor } from '../../apps/api/src/application/services/measurement/PaidSocialPayloadRedactor';

describe('PaidSocialPayloadRedactor', () => {
  const redactor = new PaidSocialPayloadRedactor();

  it('removes raw PII fields', () => {
    const payload = {
      event_name: 'Purchase',
      email: 'test@example.com',
      phone: '1234567890',
      user: {
        email: 'test@example.com',
        firstName: 'John',
        lastName: 'Doe'
      },
      custom_data: { value: 100 }
    };

    const redacted = redactor.redactPii(payload);
    
    expect(redacted.email).toBeUndefined();
    expect(redacted.phone).toBeUndefined();
    expect(redacted.user.email).toBeUndefined();
    expect(redacted.user.firstName).toBeUndefined();
    expect(redacted.custom_data.value).toBe(100);
  });
});
