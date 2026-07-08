import { describe, it, expect } from 'vitest';
import { ProductFinderRedactor } from '../../src/infrastructure/product-finder/ProductFinderRedactor';

describe('ProductFinderRedactor', () => {
  it('redacts PII and secrets from payloads', () => {
    const redactor = new ProductFinderRedactor();
    const raw = {
      email: 'secret@goldplus.com',
      phone: '0700000000',
      safeData: 'hello',
      nested: {
        customerEmail: 'hidden@example.com',
        token: 'xyz',
        public: true
      }
    };

    const clean = redactor.redact(raw);
    expect(clean.email).toBe('[REDACTED_PII]');
    expect(clean.phone).toBe('[REDACTED_PII]');
    expect(clean.safeData).toBe('hello');
    expect(clean.nested.customerEmail).toBe('[REDACTED_PII]');
    expect(clean.nested.token).toBe('[REDACTED_PII]');
    expect(clean.nested.public).toBe(true);
  });
});
