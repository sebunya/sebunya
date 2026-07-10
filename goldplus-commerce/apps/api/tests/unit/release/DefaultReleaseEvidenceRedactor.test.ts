import { describe, it, expect } from 'vitest';
import { DefaultReleaseEvidenceRedactor } from '../../../src/infrastructure/release/DefaultReleaseEvidenceRedactor';

describe('DefaultReleaseEvidenceRedactor', () => {
  const redactor = new DefaultReleaseEvidenceRedactor();

  it('redacts raw email addresses', () => {
    const input = 'User email is test@example.com inside the log';
    expect(redactor.redactCommandOutput(input)).not.toContain('test@example.com');
    expect(redactor.redactCommandOutput(input)).toContain('[EMAIL_REDACTED]');
  });

  it('redacts raw phone numbers', () => {
    const input = 'Call me at +254712345678 or 0712345678.';
    expect(redactor.redactCommandOutput(input)).toContain('[PHONE_REDACTED]');
  });

  it('redacts Authorization headers and tokens', () => {
    const input = 'Header: Authorization: Bearer secret-token-123\naccess_token=secret-456';
    const result = redactor.redactCommandOutput(input);
    expect(result).not.toContain('secret-token-123');
    expect(result).toContain('[REDACTED]');
  });

  it('redacts PesaPal secrets', () => {
    const input = 'PESAPAL_CONSUMER_SECRET=real-secret-key PESAPAL_CONSUMER_KEY=foo';
    const result = redactor.redactCommandOutput(input);
    expect(result).not.toContain('real-secret-key');
    expect(result).toContain('[REDACTED]');
  });

  it('redacts env values that look like secrets', () => {
    const input = 'gtm_secret_foo=real-client-secret-123';
    expect(redactor.redactCommandOutput(input)).toContain('[REDACTED]');
  });

  it('redacts object properties recursively', () => {
    const inputObj = {
      user: {
        email: 'test@example.com',
        phone: '+254712345678'
      },
      headers: {
        Authorization: 'Bearer secret',
        'x-api-key': 'key-123'
      },
      message: 'Logged in as test@example.com'
    };

    const result = redactor.redactEvidence(inputObj);
    expect(result.user.email).toContain('[EMAIL_REDACTED]');
    expect(result.user.phone).toContain('[PHONE_REDACTED]');
    expect(result.headers.Authorization).toContain('[REDACTED]');
    expect(result.message).toContain('[EMAIL_REDACTED]');
  });
});
