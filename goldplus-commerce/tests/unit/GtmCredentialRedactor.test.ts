import { describe, it, expect } from 'vitest';
import { GtmCredentialRedactor } from '../../apps/api/src/infrastructure/measurement/GtmCredentialRedactor';

describe('GtmCredentialRedactor', () => {
  const redactor = new GtmCredentialRedactor();

  it('redacts tokens from objects', () => {
    const input = {
      message: 'Failed to auth',
      access_token: '12345secret',
      nested: {
        authorization: 'Bearer something'
      }
    };
    const output = redactor.redact(input);
    expect(output.access_token).toBe('***REDACTED***');
    expect(output.nested.authorization).toBe('***REDACTED***');
    expect(output.message).toBe('Failed to auth');
  });

  it('redacts tokens from strings', () => {
    const input = 'Error: access_token=12345&foo=bar Bearer 12345 GTM_API_CLIENT_SECRET=xyz';
    const output = redactor.redact(input);
    expect(output).toContain('access_token=***REDACTED***');
    expect(output).toContain('Bearer ***REDACTED***');
    expect(output).toContain('GTM_API_CLIENT_SECRET=***REDACTED***');
    expect(output).toContain('&foo=bar');
  });
});
