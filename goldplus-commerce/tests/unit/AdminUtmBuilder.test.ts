import { describe, expect, it } from 'vitest';

import {
  buildUtmUrl, normalizeUtmValue, reviewTaxonomy, UTM_PARAMS,
} from '@goldplus/shared';

/**
 * The UTM builder was shipped as a card reading "Parameter Builder
 * Unconnected", telling operators it "requires analytical tracking setup".
 * It never did — tagging a URL is string work on a URL the operator supplies.
 * These tests pin the behaviour that claim was standing in for.
 */

const base = { url: 'https://shopgoldplus.com/shop', source: 'Google', medium: 'CPC', campaign: 'December Power Sale' };

describe('a tagged link is built from the operator’s own URL', () => {
  it('builds a link with the three required parameters', () => {
    const r = buildUtmUrl(base);
    expect(r.ok).toBe(true);
    const u = new URL(r.url!);
    expect(u.searchParams.get('utm_source')).toBe('google');
    expect(u.searchParams.get('utm_medium')).toBe('cpc');
    expect(u.searchParams.get('utm_campaign')).toBe('december-power-sale');
  });

  it('includes optional parameters only when supplied', () => {
    const r = buildUtmUrl({ ...base, content: 'hero banner', term: '', id: 'gp-2026-12' });
    const u = new URL(r.url!);
    expect(u.searchParams.get('utm_content')).toBe('hero-banner');
    expect(u.searchParams.get('utm_id')).toBe('gp-2026-12');
    expect(u.searchParams.has('utm_term')).toBe(false);
  });

  it('normalises casing and spacing so one campaign stays one row', () => {
    expect(normalizeUtmValue('  December   POWER Sale ')).toBe('december-power-sale');
    expect(normalizeUtmValue('Facebook')).toBe('facebook');
  });

  it('can preserve exact values when normalisation is switched off', () => {
    const r = buildUtmUrl({ ...base, normalizeValues: false });
    expect(new URL(r.url!).searchParams.get('utm_source')).toBe('Google');
  });
});

describe('existing query state is respected', () => {
  it('PRESERVES non-UTM parameters already on the URL', () => {
    const r = buildUtmUrl({ ...base, url: 'https://shopgoldplus.com/shop?category=power&sort=price-high-low' });
    const u = new URL(r.url!);
    // Dropping these would change which page the link actually opens.
    expect(u.searchParams.get('category')).toBe('power');
    expect(u.searchParams.get('sort')).toBe('price-high-low');
    expect(r.preserved).toEqual(expect.arrayContaining(['category', 'sort']));
  });

  it('replaces existing UTM values and says so', () => {
    const r = buildUtmUrl({ ...base, url: 'https://shopgoldplus.com/shop?utm_source=old&utm_medium=email' });
    const u = new URL(r.url!);
    expect(u.searchParams.get('utm_source')).toBe('google');
    // Silently overwriting these is how a campaign gets mis-attributed.
    expect(r.replaced).toEqual(expect.arrayContaining(['utm_source', 'utm_medium']));
    expect(r.issues.some((i) => i.message.includes('Replaced parameters'))).toBe(true);
  });

  it('does not duplicate a parameter that was already present', () => {
    const r = buildUtmUrl({ ...base, url: 'https://shopgoldplus.com/shop?utm_source=old' });
    expect((r.url!.match(/utm_source=/g) ?? []).length).toBe(1);
  });

  it('keeps a fragment and warns about it', () => {
    const r = buildUtmUrl({ ...base, url: 'https://shopgoldplus.com/shop#reviews' });
    expect(r.url).toContain('#reviews');
    expect(r.issues.some((i) => i.message.includes('#fragment'))).toBe(true);
  });

  it('encodes special characters correctly', () => {
    const r = buildUtmUrl({ ...base, campaign: 'sale & clearance', normalizeValues: false });
    expect(r.url).toContain('utm_campaign=sale+%26+clearance');
    expect(new URL(r.url!).searchParams.get('utm_campaign')).toBe('sale & clearance');
  });
});

describe('invalid input is refused with a reason, not a broken link', () => {
  it('rejects an empty URL', () => {
    const r = buildUtmUrl({ ...base, url: '' });
    expect(r.ok).toBe(false);
    expect(r.url).toBeNull();
  });

  it('rejects a malformed URL', () => {
    expect(buildUtmUrl({ ...base, url: 'ht!tp://not a url' }).ok).toBe(false);
  });

  it('rejects a non-http scheme', () => {
    expect(buildUtmUrl({ ...base, url: 'javascript:alert(1)' }).ok).toBe(false);
    expect(buildUtmUrl({ ...base, url: 'file:///etc/passwd' }).ok).toBe(false);
  });

  it('accepts a bare domain by assuming https', () => {
    const r = buildUtmUrl({ ...base, url: 'shopgoldplus.com/shop' });
    expect(r.ok).toBe(true);
    expect(r.url).toMatch(/^https:\/\/shopgoldplus\.com/);
  });

  it('warns on http rather than silently tagging it', () => {
    const r = buildUtmUrl({ ...base, url: 'http://shopgoldplus.com/shop' });
    expect(r.ok).toBe(true);
    expect(r.issues.some((i) => i.message.includes('http link'))).toBe(true);
  });

  it('requires each of source, medium and campaign, naming the missing one', () => {
    for (const missing of ['source', 'medium', 'campaign'] as const) {
      const r = buildUtmUrl({ ...base, [missing]: '' });
      expect(r.ok).toBe(false);
      expect(r.issues.some((i) => i.severity === 'ERROR' && i.field === `utm_${missing}`)).toBe(true);
    }
  });

  it('treats a whitespace-only value as missing', () => {
    expect(buildUtmUrl({ ...base, source: '   ' }).ok).toBe(false);
  });

  it('tags an external URL as readily as an internal one', () => {
    // This is a link builder, not a crawler; the operator chooses the target.
    expect(buildUtmUrl({ ...base, url: 'https://partner.example.com/landing' }).ok).toBe(true);
  });
});

describe('output is deterministic', () => {
  it('produces byte-identical URLs for identical input', () => {
    expect(buildUtmUrl(base).url).toBe(buildUtmUrl(base).url);
  });

  it('orders parameters consistently regardless of input order', () => {
    const a = buildUtmUrl({ ...base, content: 'x', term: 'y' });
    const b = buildUtmUrl({ url: base.url, campaign: base.campaign, medium: base.medium, source: base.source, term: 'y', content: 'x' });
    expect(b.url).toBe(a.url);
  });

  it('covers every declared UTM parameter', () => {
    const r = buildUtmUrl({ ...base, content: 'c', term: 't', id: 'i' });
    const u = new URL(r.url!);
    for (const p of UTM_PARAMS) expect(u.searchParams.has(p)).toBe(true);
  });
});

describe('taxonomy guidance advises without blocking', () => {
  it('flags an unconventional medium', () => {
    expect(reviewTaxonomy({ source: 'google', medium: 'billboard', campaign: 'c' })
      .some((i) => i.field === 'utm_medium')).toBe(true);
  });

  it('accepts a conventional medium silently', () => {
    expect(reviewTaxonomy({ source: 'google', medium: 'cpc', campaign: 'winter' })
      .some((i) => i.field === 'utm_medium')).toBe(false);
  });

  it('flags a campaign identical to its source', () => {
    expect(reviewTaxonomy({ source: 'google', medium: 'cpc', campaign: 'Google' })
      .some((i) => i.field === 'utm_campaign')).toBe(true);
  });

  it('never turns guidance into an error', () => {
    expect(reviewTaxonomy({ source: 'google', medium: 'billboard', campaign: 'google' })
      .every((i) => i.severity === 'WARNING')).toBe(true);
  });
});
