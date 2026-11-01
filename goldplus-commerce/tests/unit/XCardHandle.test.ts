import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DEFAULT_BUSINESS_INFO, xHandleFromSocials } from '@goldplus/shared';

describe('the X handle for card attribution', () => {
  const social = (href: string, enabled = true) => [{ key: 'x', href, enabled }];

  it('the default X link is @shopgoldplus', () => {
    expect(xHandleFromSocials(DEFAULT_BUSINESS_INFO.socials)).toBe('@shopgoldplus');
  });

  it('reads the handle from an x.com or twitter.com profile link, whatever its decoration', () => {
    expect(xHandleFromSocials(social('https://x.com/shopgoldplus'))).toBe('@shopgoldplus');
    expect(xHandleFromSocials(social('https://twitter.com/ShopGoldPlus/'))).toBe('@ShopGoldPlus');
    expect(xHandleFromSocials(social('https://www.x.com/@shopgoldplus?lang=en'))).toBe('@shopgoldplus');
  });

  it('names no account when the link is off, missing, or not a profile', () => {
    expect(xHandleFromSocials(social('https://x.com/shopgoldplus', false))).toBeNull();
    expect(xHandleFromSocials([])).toBeNull();
    expect(xHandleFromSocials(null)).toBeNull();
    expect(xHandleFromSocials(social('https://example.com/shopgoldplus'))).toBeNull();
    expect(xHandleFromSocials(social('https://x.com/'))).toBeNull();
    expect(xHandleFromSocials(social('https://x.com/a-handle-that-is-far-too-long'))).toBeNull();
    expect(xHandleFromSocials(social('not a url'))).toBeNull();
  });

  it('the layout writes twitter:* as name tags and takes the account from that handle', () => {
    const layout = readFileSync(resolve(__dirname, '../../apps/web/src/layouts/BaseLayout.astro'), 'utf8');
    expect(layout).not.toMatch(/property="twitter:/);
    expect(layout).toContain('<meta name="twitter:card" content="summary_large_image" />');
    expect(layout).toContain('{xHandle && <meta name="twitter:site" content={xHandle} />}');
  });
});

import { classifyChannel } from '../../apps/api/src/domain/measurement/Channels';

describe('traffic from X is attributed to the right channel', () => {
  it('an X ad click is paid social, whatever else the link carries', () => {
    expect(classifyChannel({ clickIdTypes: ['twclid'] })).toBe('paid_social');
    expect(classifyChannel({ source: 'x', medium: 'paid_social', clickIdTypes: ['twclid'] })).toBe('paid_social');
    expect(classifyChannel({ source: 'x', medium: 'paid-social' })).toBe('paid_social');
  });

  it('a visit from x.com, twitter.com or the t.co shortener with no tags is organic social', () => {
    for (const referrerHost of ['x.com', 't.co', 'twitter.com', 'mobile.twitter.com']) {
      expect(classifyChannel({ referrerHost }), referrerHost).toBe('organic_social');
    }
  });

  it('a link tagged utm_source=x with no medium (a bio link, a post) is organic social, not "other"', () => {
    for (const source of ['x', 'X', 'twitter', 'x.com', 't.co', 'instagram', 'facebook']) {
      expect(classifyChannel({ source }), source).toBe('organic_social');
    }
    expect(classifyChannel({ source: 'x', medium: 'social' })).toBe('organic_social');
  });

  it('a source that merely contains a network name is not swept in, and a stated medium still wins', () => {
    expect(classifyChannel({ source: 'xyz-newsletter' })).toBe('other');
    expect(classifyChannel({ source: 'x', medium: 'email' })).toBe('email');
    expect(classifyChannel({ source: 'x', medium: 'referral' })).toBe('referral');
  });
});
