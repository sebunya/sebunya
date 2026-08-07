import { describe, it, expect } from 'vitest';
import {
  HERO_SLIDE_LIBRARY,
  HERO_LIMITS,
  sanitiseHeadline,
  headlineVisibleText,
  validateHeroSlide,
  flashSaleHasEnded,
  type HeroSlideSeed,
} from '@goldplus/shared';

/**
 * Hero slider (0107). The two things worth pinning are the XSS boundary and the
 * guard rails — the rest is presentation.
 */

describe('the headline <em> boundary is the XSS boundary', () => {
  it('renders <em> as a real tag but escapes EVERYTHING else', () => {
    expect(sanitiseHeadline('Up to <em>40% off</em>')).toBe('Up to <em>40% off</em>');
  });

  it('a <script> in a headline becomes inert text, never a script', () => {
    const out = sanitiseHeadline('<script>alert(1)</script><em>ok</em>');
    expect(out).not.toContain('<script>');
    expect(out).toContain('&lt;script&gt;');
    expect(out).toContain('<em>ok</em>');
  });

  it('an <em> with an injected attribute or handler cannot survive', () => {
    // Only the bare tags are restored; anything with attributes stays escaped.
    const out = sanitiseHeadline('<em onmouseover="steal()">x</em><em class="y">z</em>');
    // No live <em ...> with attributes exists in the output.
    expect(/<em\s+[^>]*>/i.test(out)).toBe(false);
    // The attribute-bearing tags remain escaped as text.
    expect(out).toContain('&lt;em onmouseover');
    expect(out).toContain('&lt;em class');
  });

  it('an img onerror payload is fully escaped', () => {
    const out = sanitiseHeadline('<img src=x onerror=alert(1)>');
    expect(out).not.toContain('<img');
    expect(out).toContain('&lt;img');
  });

  it('length is measured on the VISIBLE text, so the tag never counts as width', () => {
    expect(headlineVisibleText('Up to <em>40% off</em>')).toBe('Up to 40% off');
  });
});

describe('guard rails refuse a slide that would break the homepage', () => {
  const base: HeroSlideSeed = {
    slideKey: 'flash', position: 1, enabled: true, theme: 'offer', tint: 'a', media: 'stage',
    kicker: 'k', headline: 'A <em>headline</em>', subcopy: 's', ctaLabel: 'Go', ctaUrl: '/shop',
    finePrint: 'fp', imageUrl: '/products/x.webp', imageAlt: 'alt', priority: 0, extras: {},
  };

  it('a valid slide passes', () => {
    expect(validateHeroSlide(base)).toEqual([]);
  });

  it('an over-length headline is caught (measured without the <em>)', () => {
    const long = 'x'.repeat(HERO_LIMITS.headline + 1);
    const errs = validateHeroSlide({ ...base, headline: `<em></em>${long}` });
    expect(errs.some((e) => e.field === 'headline')).toBe(true);
  });

  it('an unbalanced <em> is caught before it can leak green across the line', () => {
    expect(validateHeroSlide({ ...base, headline: 'Up to <em>40% off' }).some((e) => e.field === 'headline')).toBe(true);
  });

  it('an enabled slide with a "#" CTA is refused', () => {
    expect(validateHeroSlide({ ...base, ctaUrl: '#' }).some((e) => e.field === 'ctaUrl')).toBe(true);
  });

  it('an enabled bleed slide with no image is refused', () => {
    expect(validateHeroSlide({ ...base, media: 'bleed', imageUrl: '' }).some((e) => e.field === 'imageUrl')).toBe(true);
  });

  it('an image without alt text is refused', () => {
    expect(validateHeroSlide({ ...base, imageAlt: '' }).some((e) => e.field === 'imageAlt')).toBe(true);
  });

  it('a DISABLED slide is held only to storage-safety, so a draft can be parked', () => {
    // No headline, no CTA — but disabled, so it does not block being saved out of rotation.
    expect(validateHeroSlide({ ...base, enabled: false, headline: '', ctaUrl: '', imageUrl: '', imageAlt: '' })).toEqual([]);
  });

  it('a past flash-sale date is flagged', () => {
    expect(flashSaleHasEnded({ saleEndsIso: '2020-01-01T00:00:00+03:00' })).toBe(true);
    expect(flashSaleHasEnded({ saleEndsIso: '2999-01-01T00:00:00+03:00' })).toBe(false);
  });
});

describe('the 12-slide library is coherent', () => {
  it('has exactly 12 slides with unique, locked keys', () => {
    expect(HERO_SLIDE_LIBRARY).toHaveLength(12);
    const keys = HERO_SLIDE_LIBRARY.map((s) => s.slideKey);
    expect(new Set(keys).size).toBe(12);
    keys.forEach((k) => expect(k).toMatch(/^[a-z][a-z0-9]{1,23}$/));
  });

  it('every seeded slide passes its own validation — the seed can never ship a broken slide', () => {
    for (const s of HERO_SLIDE_LIBRARY) {
      expect(validateHeroSlide(s), `${s.slideKey}: ${JSON.stringify(validateHeroSlide(s))}`).toEqual([]);
    }
  });

  it('keeps an evergreen trust slide to fall back to', () => {
    const authentic = HERO_SLIDE_LIBRARY.find((s) => s.slideKey === 'authentic');
    expect(authentic?.enabled).toBe(true);
    expect(authentic?.theme).toBe('trust');
  });

  it('the bleed slides point at real committed hero photos, not the dead Unsplash URLs', () => {
    const bleed = HERO_SLIDE_LIBRARY.filter((s) => s.media === 'bleed');
    expect(bleed.length).toBeGreaterThan(0);
    bleed.forEach((s) => expect(s.imageUrl).toMatch(/^\/hero\/.+\.jpg$/));
  });
});
