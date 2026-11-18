import { afterEach, describe, expect, it } from 'vitest';
import { publicBaseUrl, trackOrderUrl } from '../../apps/api/src/application/notifications/CustomerMessages';

/**
 * The origin customer messages link to. www.shopgoldplus.com answers with a 301
 * to the apex (checked live 2026-11-12), so the default is the apex, and an
 * unset message-specific variable falls back to the one the rest of the API reads.
 */
const KEYS = ['PUBLIC_BASE_URL', 'PUBLIC_SITE_URL', 'PUBLIC_WEB_BASE_URL'] as const;
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
const setEnv = (v: Partial<Record<(typeof KEYS)[number], string>>) => {
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, v);
};
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('publicBaseUrl', () => {
  it('defaults to the apex host, which serves without a redirect', () => {
    setEnv({});
    expect(publicBaseUrl()).toBe('https://shopgoldplus.com');
    expect(trackOrderUrl('GP-1')).toBe('https://shopgoldplus.com/track-order?reference=GP-1');
  });

  it('keeps the message-specific settings first, in their old order', () => {
    setEnv({ PUBLIC_BASE_URL: 'https://a.example/', PUBLIC_SITE_URL: 'https://b.example', PUBLIC_WEB_BASE_URL: 'https://c.example' });
    expect(publicBaseUrl()).toBe('https://a.example');
    setEnv({ PUBLIC_SITE_URL: 'https://b.example', PUBLIC_WEB_BASE_URL: 'https://c.example' });
    expect(publicBaseUrl()).toBe('https://b.example');
  });

  it('falls back to the site origin the rest of the API links to', () => {
    setEnv({ PUBLIC_WEB_BASE_URL: 'https://staging.example/' });
    expect(publicBaseUrl()).toBe('https://staging.example');
  });
});
