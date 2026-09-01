import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../..');
const read = (f: string) => readFileSync(resolve(ROOT, f), 'utf8');

/**
 * What an answer engine needs to CITE the shop, rather than merely index it:
 * a business it can pin to a street and opening hours, list pages that say
 * what they list, and a plain-text brief it can read in one fetch. Every value
 * comes from the admin-editable business info or the live catalogue — a fixed
 * address or a hand-typed product count would drift the moment the shop moves
 * or the catalogue changes.
 */
describe('answer-engine surfaces', () => {
  it('the homepage describes the shop as a place, from business info only', () => {
    const src = read('apps/web/src/components/SiteJsonLd.astro');
    expect(src).toContain("'@type': 'Store'");
    expect(src).toContain('streetAddress: biz.addressLine1');
    expect(src).toContain('telephone: biz.phoneDial');
    expect(src).toMatch(/if \(openingHours\) store\.openingHours = openingHours;/);
    // Nothing invented: no literal address, phone or hours in the component.
    expect(src).not.toMatch(/Wilson Road|\+256|8:30am/);
    expect(src).toContain('serializeJsonLd(store)');
  });

  it('parsed opening hours are omitted rather than guessed when the format is unfamiliar', () => {
    const src = read('apps/web/src/components/SiteJsonLd.astro');
    expect(src).toMatch(/const openingHours = .*\? *`\$\{dayRange\[0\]\}-\$\{dayRange\[1\]\} \$\{hoursRange\[0\]\}-\$\{hoursRange\[1\]\}`\s*: null;/s);
  });

  it('the shop page states what it lists', () => {
    const src = read('apps/web/src/pages/shop.astro');
    expect(src).toContain("import { serializeJsonLd, breadcrumbJsonLd } from '../lib/jsonld';");
    expect(src).toContain("'@type': 'ItemList'");
    expect(src).toContain('numberOfItems: pageProducts.length');
    expect(src).toContain('serializeJsonLd(shopItemList)');
    expect(src).toContain('serializeJsonLd(shopBreadcrumb)');
  });

  it('llms.txt is generated from live data, never fixed copy', () => {
    const src = read('apps/web/src/pages/llms.txt.ts');
    expect(src).toContain('fetchApprovedCatalogue');
    expect(src).toContain('getBusinessInfo');
    expect(src).toContain('text/plain; charset=utf-8');
    expect(src).toMatch(/# GoldPlus/);
    // The catalogue decides the categories and the count.
    expect(src).toContain('byCategory');
    expect(src).toContain('${products.length} products are listed online');
    expect(src).not.toMatch(/Wilson Road|0705 004545/);
  });
});
