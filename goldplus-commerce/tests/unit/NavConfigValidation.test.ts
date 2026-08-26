import { describe, it, expect } from 'vitest';
import {
  DEFAULT_NAV_CONFIG,
  validateNavConfig,
  navConfigWarnings,
  sanitiseNavHtml,
  sanitiseNavConfig,
  navVisibleText,
  NAV_LIMITS,
  HERO_SLIDE_LIBRARY,
  type NavConfig,
} from '@goldplus/shared';

/**
 * §9 guard rails. The header CMS must refuse any save that would break the
 * header — a broken header on every page is worse than a hardcoded one. These
 * pin the boundaries the editor relies on, plus the three seed-time corrections
 * baked into DEFAULT_NAV_CONFIG.
 */

const clone = (): NavConfig => structuredClone(DEFAULT_NAV_CONFIG);

describe('DEFAULT_NAV_CONFIG', () => {
  it('validates clean — the seed can never be a save that the CMS refuses', () => {
    // An expired sale is a non-blocking WARNING, not a hard error, so it never
    // appears here; validateNavConfig must be empty for the shipped seed.
    expect(validateNavConfig(DEFAULT_NAV_CONFIG)).toEqual([]);
  });

  it('every mega-panel key has a matching rail entry', () => {
    const railKeys = new Set(DEFAULT_NAV_CONFIG.rail.map((r) => r.key));
    for (const p of DEFAULT_NAV_CONFIG.panels) expect(railKeys.has(p.key)).toBe(true);
  });

  it('types no sale deadline anywhere — the live promotion is the only clock', () => {
    // The nav used to mirror a hand-typed hero deadline, which expired while a
    // real promotion ran. Now neither seed carries one: header and hero both
    // read /commerce/storefront-discount.
    const heroFlash = HERO_SLIDE_LIBRARY.find((s) => s.slideKey === 'flash');
    expect(heroFlash?.extras?.saleEndsIso).toBeUndefined();
    expect(DEFAULT_NAV_CONFIG.settings.saleEndsIso).toBe('');
  });

  it('the first-order estimate is one field, and the refer link is not double-account', () => {
    expect(typeof DEFAULT_NAV_CONFIG.settings.firstOrderEstimateUgx).toBe('string');
    const refer = DEFAULT_NAV_CONFIG.popover.signedIn.links.find((l) => l.label === 'Refer a friend');
    expect(refer?.href).toBe('/account/rewards');
    expect(JSON.stringify(DEFAULT_NAV_CONFIG)).not.toContain('/account/account/');
  });
});

describe('validateNavConfig', () => {
  it('refuses a header with zero categories', () => {
    const c = clone(); c.rail = [];
    expect(validateNavConfig(c).some((e) => e.path === 'rail')).toBe(true);
  });

  it('refuses a category label past its width', () => {
    const c = clone(); c.rail[0].label = 'x'.repeat(NAV_LIMITS.categoryLabel + 1);
    expect(validateNavConfig(c).some((e) => e.path === 'rail[0].label')).toBe(true);
  });

  it('refuses a dead category link (# or empty)', () => {
    const c = clone(); c.rail[1].href = '#';
    expect(validateNavConfig(c).some((e) => e.path === 'rail[1].href')).toBe(true);
  });

  it('refuses a featured image with no alt text', () => {
    const c = clone();
    const power = c.panels.find((p) => p.key === 'power')!;
    power.featured!.alt = '   ';
    expect(validateNavConfig(c).some((e) => e.path === 'panels.power.featured.alt')).toBe(true);
  });

  it('refuses a featured name past its width', () => {
    const c = clone();
    const power = c.panels.find((p) => p.key === 'power')!;
    power.featured!.name = 'x'.repeat(NAV_LIMITS.featuredName + 1);
    expect(validateNavConfig(c).some((e) => e.path === 'panels.power.featured.name')).toBe(true);
  });

  it('refuses an unbalanced <b> tag in the zero-result copy', () => {
    const c = clone(); c.search.zeroResultCopy = 'No match for <b>{q}. Try again.';
    expect(validateNavConfig(c).some((e) => e.path === 'search.zeroResultCopy')).toBe(true);
  });

  it('refuses a trending term with an unreal href (dead link or javascript:)', () => {
    const c = clone();
    c.search.trendingTerms = [{ label: 'Power banks', href: 'javascript:alert(1)' }];
    expect(validateNavConfig(c).some((e) => e.path === 'search.trendingTerms[0].href')).toBe(true);
  });

  it('refuses out-of-range offer figures (negative or >100 percent)', () => {
    const c = clone(); c.settings.firstOrderDiscountPct = -5;
    expect(validateNavConfig(c).some((e) => e.path === 'settings.firstOrderDiscountPct')).toBe(true);
  });

  it('offers no flash stock meter to validate in the first place', () => {
    // This used to check that "left" could not exceed "of" and that the bar
    // width was a sane percentage — careful validation of a number with
    // nothing behind it. The meter advertised "14 left of 60 at this price"
    // for a sale with no items. Validating invented scarcity is not the fix;
    // the field is gone, so there is nothing to get wrong.
    const c = clone() as Record<string, any>;
    expect(c.flash.stock).toBeUndefined();
    expect(c.flash.discountRows).toBeUndefined();
  });
});

describe('navConfigWarnings (non-blocking)', () => {
  it('reports an expired sale as a WARNING — never a save-blocking error', () => {
    const c = clone(); c.settings.saleEndsIso = '2020-01-01T00:00:00+03:00';
    // Not in the hard errors (so unrelated edits still save)…
    expect(validateNavConfig(c).some((e) => e.path === 'settings.saleEndsIso')).toBe(false);
    // …but surfaced as a warning for the operator.
    expect(navConfigWarnings(c).some((w) => w.path === 'settings.saleEndsIso')).toBe(true);
  });
});

describe('sanitiseNavConfig (applied once on read)', () => {
  it('neutralises a smuggled <img onerror> in zeroResultCopy but keeps <b>', () => {
    const c = clone();
    c.search.zeroResultCopy = 'No match for <b>{q}</b> <img src=x onerror=alert(1)>';
    const out = sanitiseNavConfig(c);
    expect(out.search.zeroResultCopy).toContain('<b>{q}</b>'); // allowed tag survives
    expect(out.search.zeroResultCopy).not.toContain('<img');   // no live tag reaches the DOM
    expect(out.search.zeroResultCopy).toContain('&lt;img');    // it is inert, escaped text
  });

  it('returns a deep copy and never mutates the input (raw stays raw for re-editing)', () => {
    const c = clone();
    c.search.zeroResultCopy = "Today's <img onerror=x> deal";
    const before = c.search.zeroResultCopy;
    sanitiseNavConfig(c);
    expect(c.search.zeroResultCopy).toBe(before);
  });
});

describe('sanitiseNavHtml (the XSS boundary)', () => {
  it('keeps the two allowed tags', () => {
    expect(sanitiseNavHtml('Up to <b>40% off</b> and <em>today only</em>')).toBe('Up to <b>40% off</b> and <em>today only</em>');
  });

  it('neutralises a script tag', () => {
    expect(sanitiseNavHtml('<script>alert(1)</script>')).not.toContain('<script>');
  });

  it('neutralises an event handler smuggled onto an allowed tag', () => {
    // <em onmouseover=...> is NOT the bare <em> the restore step allows, so it stays escaped.
    const out = sanitiseNavHtml('<em onmouseover="steal()">x</em>');
    expect(out).not.toContain('onmouseover="steal()"');
    expect(out).toContain('&lt;em onmouseover');
  });
});

describe('navVisibleText', () => {
  it('does not count the allowed tags toward the character width', () => {
    expect(navVisibleText('<b>40% off</b>')).toBe('40% off');
    expect(navVisibleText('<b>40% off</b>').length).toBeLessThan('<b>40% off</b>'.length);
  });
});
