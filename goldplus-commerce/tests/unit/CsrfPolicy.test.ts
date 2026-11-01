import { describe, it, expect } from 'vitest';
import {
  decideCsrf,
  isStateChanging,
  isCsrfExempt,
  resolveRequestOrigin,
  originAllowed,
} from '../../apps/api/src/domain/security/CsrfPolicy';

const allow = ['https://goldplus.example', 'https://admin.goldplus.example'];

const decide = (over: Partial<Parameters<typeof decideCsrf>[0]> = {}) =>
  decideCsrf({
    method: 'POST',
    path: '/account/preferences',
    cookieHeader: 'goldplus_session=abc',
    originHeader: 'https://goldplus.example',
    refererHeader: undefined,
    allowlist: allow,
    ...over,
  });

describe('decideCsrf', () => {
  it('allows a cookie-authenticated mutation from an allowlisted origin', () => {
    expect(decide().action).toBe('ALLOW');
  });

  it('blocks a cookie-authenticated mutation from a foreign origin', () => {
    const d = decide({ originHeader: 'https://evil.example' });
    expect(d).toEqual({ action: 'BLOCK', reason: 'origin_not_allowed' });
  });

  it('blocks when neither Origin nor Referer is present on a cookie mutation', () => {
    const d = decide({ originHeader: undefined, refererHeader: undefined });
    expect(d).toEqual({ action: 'BLOCK', reason: 'no_origin_or_referer' });
  });

  it('falls back to Referer when Origin is absent', () => {
    const d = decide({ originHeader: undefined, refererHeader: 'https://goldplus.example/cart' });
    expect(d.action).toBe('ALLOW');
  });

  it('treats a literal "null" Origin as no origin', () => {
    const d = decide({ originHeader: 'null', refererHeader: undefined });
    expect(d.action).toBe('BLOCK');
  });

  it('allows Bearer/no-cookie requests — not forgeable via ambient credentials', () => {
    expect(decide({ cookieHeader: undefined, originHeader: 'https://evil.example' }).action).toBe('ALLOW');
    expect(decide({ cookieHeader: '', originHeader: 'https://evil.example' }).action).toBe('ALLOW');
  });

  it('allows safe methods regardless of origin', () => {
    for (const m of ['GET', 'HEAD', 'OPTIONS']) {
      expect(decide({ method: m, originHeader: 'https://evil.example' }).action).toBe('ALLOW');
    }
  });

  it('exempts provider webhooks (HMAC-authenticated, no Origin)', () => {
    const d = decide({ path: '/webhooks/payment/mtn', originHeader: undefined, refererHeader: undefined });
    expect(d.action).toBe('ALLOW');
  });

  it('does not let a webhook-lookalike path escape the check', () => {
    // /webhooksX is not under /webhooks/
    const d = decide({ path: '/webhooksx', originHeader: 'https://evil.example' });
    expect(d.action).toBe('BLOCK');
  });
});

describe('CSRF helpers', () => {
  it('classifies state-changing methods', () => {
    expect(isStateChanging('POST')).toBe(true);
    expect(isStateChanging('get')).toBe(false);
  });
  it('matches origins by scheme+host+port only', () => {
    expect(originAllowed('https://goldplus.example', allow)).toBe(true);
    expect(originAllowed('http://goldplus.example', allow)).toBe(false); // scheme differs
    expect(resolveRequestOrigin('https://goldplus.example/path?x=1', undefined)).toBe(
      'https://goldplus.example',
    );
  });
  it('keeps the webhook exemption narrow', () => {
    expect(isCsrfExempt('/webhooks/payment/airtel')).toBe(true);
    expect(isCsrfExempt('/account/webhooks')).toBe(false);
  });
});
