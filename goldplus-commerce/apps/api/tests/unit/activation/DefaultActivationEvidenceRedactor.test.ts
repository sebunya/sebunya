import { describe, it, expect } from 'vitest';
import { DefaultActivationEvidenceRedactor } from '../../../src/infrastructure/activation/DefaultActivationEvidenceRedactor.js';

describe('DefaultActivationEvidenceRedactor', () => {
  const redactor = new DefaultActivationEvidenceRedactor();

  it('redacts Authorization', () => {
    expect(redactor.redact('Header Authorization: Bearer abc123def')).toBe('Header Authorization: Bearer [REDACTED]');
  });

  it('redacts access_token', () => {
    expect(redactor.redact('URL?access_token=xyz987')).toBe('URL?access_token=[REDACTED]');
  });

  it('redacts PESAPAL_SECRET', () => {
    expect(redactor.redact('PESAPAL_SECRET="very_secret_key"')).toBe('PESAPAL_SECRET="[REDACTED]"');
  });

  it('redacts customerEmail', () => {
    expect(redactor.redact('customerEmail="test@example.com"')).toBe('customerEmail="[REDACTED]"');
  });

  it('redacts rawEmail', () => {
    expect(redactor.redact('rawEmail="another@test.com"')).toBe('rawEmail="[REDACTED]"');
  });
});
