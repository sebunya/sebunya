import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const src = (p: string) => readFileSync(resolve(__dirname, '../../', p), 'utf8');
const PDP = 'apps/web/src/pages/products/[slug].astro';

describe('Baymard wave 4 — code-only rows', () => {
  it('K12: the one payment method is a statement; the form still posts paymentMethod=pesapal', () => {
    const page = src('apps/web/src/pages/checkout.astro');
    expect(page).toContain('data-payment-statement');
    expect(page).toMatch(/name="paymentMethod" value="pesapal" checked class="sr-only"/);
    expect(page).not.toMatch(/<legend class="sr-only">Choose how to pay<\/legend>/);
    expect(page).toContain("['MTN MoMo', 'Airtel Money', 'Visa', 'Mastercard']");
  });

  it('S2: a card without a written line shows its two leading verified specs, never an unverified one', () => {
    const card = src('apps/web/src/components/ProductCard.astro');
    expect(card).toContain('data-card-spec');
    expect(card).toMatch(/\.filter\(\(a\) => a\.isVerified && a\.name !== 'CardShortDescription'/);
    expect(card).toContain('const keySpecs = shortDescAttr ? [] :');
  });

  it('P10: every buyer photo in one strip before the reviews, capped', () => {
    const pdp = src(PDP);
    expect(pdp).toContain('data-review-photo-strip');
    expect(pdp).toContain('.flatMap((r) => (Array.isArray(r.photoIds) ? r.photoIds : [])).slice(0, 12)');
  });

  it('P4: each piece of a bundle shows its own price', () => {
    expect(src(PDP)).toContain('data-bundle-item-price');
  });

  it('Q2 / Q4: a category name offers the shelf; a symptom offers the finder', () => {
    const shop = src('apps/web/src/pages/shop.astro');
    expect(shop).toContain('data-category-route');
    expect(shop).toContain('data-symptom-route');
    expect(shop).toContain("href: '/charger-finder'");
    expect(shop).toContain("href: '/battery-finder'");
    // A help question wins over a symptom (one aside, not two).
    expect(shop).toContain('const symptomRoute = search && !helpRoute ?');
  });

  it('Q4: the symptom patterns catch the phrases customers type', () => {
    const shop = src('apps/web/src/pages/shop.astro');
    const block = shop.slice(shop.indexOf('const SYMPTOM_ROUTES'), shop.indexOf('const symptomRoute'));
    const charger = new RegExp(block.match(/words: (\/.+?\/i), href: '\/charger-finder'/)![1].slice(1, -2), 'i');
    const battery = new RegExp(block.match(/words: (\/.+?\/i), href: '\/battery-finder'/)![1].slice(1, -2), 'i');
    for (const q of ['phone charging slowly', 'not charging', "won't charge", 'slow charging cable']) expect(charger.test(q), q).toBe(true);
    for (const q of ['battery dies fast', 'battery draining fast', 'swollen battery', 'phone dies quickly']) expect(battery.test(q), q).toBe(true);
    for (const q of ['charger', 'power bank 20000mah', 'battery for tecno spark']) { expect(charger.test(q), q).toBe(false); expect(battery.test(q), q).toBe(false); }
  });

  it('Q11 was already met: the phone bar has a search button that opens the menu search', () => {
    expect(src('apps/web/src/components/GpNav.astro')).toContain('id="gpNavMSearch"');
  });
});
