import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { normalizeSearchWords, hasWholeSearchWord } from '../../packages/shared/src/search';
import { rankDiscoveryProducts } from '../../apps/web/src/lib/product-discovery';
import { searchTerms } from '../../apps/api/src/domain/products/ProductSearchService';
import { parseGuestSaved, toggleGuestSaved, GUEST_SAVED_MAX } from '../../apps/web/src/lib/guestSaved';
import type { ProductPublicDto } from '@goldplus/shared';

/** Baymard wave 2 (docs/ux/BAYMARD.md): search that reads like a shopper types, and saving without an account. */
const read = (p: string) => readFileSync(resolve(__dirname, '../../', p), 'utf8');

const product = (name: string, extra: Partial<ProductPublicDto> = {}): ProductPublicDto =>
  ({ id: name.toLowerCase().replace(/\W+/g, '-'), name, sku: null, modelNumber: null, categoryName: 'Power Devices', availability: { kind: 'in_stock' }, ...extra }) as unknown as ProductPublicDto;

describe('query words as the catalogue spells them (Q1, Q3, Q7)', () => {
  it('joins a number and its unit, drops the thousands comma, shortens watt', () => {
    expect(normalizeSearchWords(['10000', 'mah', 'power', 'bank'])).toEqual(['10000mah', 'power', 'bank']);
    expect(normalizeSearchWords(['10,000mah'])).toEqual(['10000mah']);
    expect(normalizeSearchWords(['20', 'watt', 'charger'])).toEqual(['20w', 'charger']);
    expect(normalizeSearchWords(['65watts'])).toEqual(['65w']);
    expect(normalizeSearchWords(['32', 'gb', 'card'])).toEqual(['32gb', 'card']);
  });

  it('leaves ordinary words and model tokens alone', () => {
    expect(normalizeSearchWords(['samsung', 'a14', 'charger'])).toEqual(['samsung', 'a14', 'charger']);
    expect(normalizeSearchWords(['a', 'cable'])).toEqual(['a', 'cable']);
  });

  it('both engines call it: the API searchTerms agrees', () => {
    expect(searchTerms('10,000 mAh Power Bank')).toEqual(['10000mah', 'power', 'bank']);
    expect(read('apps/web/src/lib/product-discovery.ts')).toContain('normalizeSearchWords(query.toLocaleLowerCase');
  });

  it('a hyphen-stripped model code is searched on both surfaces', () => {
    expect(read('apps/web/src/lib/product-discovery.ts')).toContain("product.sku?.replace(/-/g, '')");
    expect(read('apps/api/src/infrastructure/db/repositories/DrizzleProductRepository.ts')).toContain("replace(coalesce(${products.sku}, ''), '-', '')");
  });
});

describe('best match order (S4, Q5)', () => {
  const car = product('GoldPlus GP-CA03 Car Charger');
  const card = product('GoldPlus 32GB Memory Card (microSD, Class 10)');
  const bank = product('GoldPlus GP-X01 Power Bank', { sku: 'GP-X01' });
  const cable = product('GoldPlus USB-C Cable');

  it('"car" leads with the car charger, and the memory card (a substring hit) follows', () => {
    expect(rankDiscoveryProducts([card, car], 'car').map((p) => p.name)).toEqual([car.name, card.name]);
  });

  it('whole words beat substrings: "car" is not a card', () => {
    expect(hasWholeSearchWord('gp-ca03 car charger', 'car')).toBe(true);
    expect(hasWholeSearchWord('32gb memory card', 'car')).toBe(false);
  });

  it('a model code typed without its hyphen ranks first; nothing is dropped', () => {
    const ranked = rankDiscoveryProducts([card, cable, bank], 'gpx01');
    expect(ranked[0].name).toBe(bank.name);
    expect(ranked).toHaveLength(3);
  });

  it('the shop lists a search by best match unless another order was chosen', () => {
    const shop = read('apps/web/src/pages/shop.astro');
    expect(shop).toContain("search && sort === 'default'\n  ? rankDiscoveryProducts(");
    expect(shop).toContain("{search ? 'Best match' : 'Default order'}");
  });
});

describe('save for later without an account (P3, C6)', () => {
  it('the device list holds unique product ids, newest last, capped', () => {
    const a = '11111111-1111-4111-8111-111111111111';
    const b = '22222222-2222-4222-8222-222222222222';
    expect(toggleGuestSaved([], a, 'add')).toEqual([a]);
    expect(toggleGuestSaved([a], b, 'add')).toEqual([a, b]);
    expect(toggleGuestSaved([a, b], a, 'add')).toEqual([b, a]);
    expect(toggleGuestSaved([a, b], a, 'remove')).toEqual([b]);
    expect(parseGuestSaved(encodeURIComponent(JSON.stringify([a, 'nope', a, b])))).toEqual([a, b]);
    expect(parseGuestSaved('garbage')).toEqual([]);
    const many = Array.from({ length: GUEST_SAVED_MAX + 5 }, (_, i) => `${String(i).padStart(8, '0')}-0000-4000-8000-000000000000`);
    expect(parseGuestSaved(encodeURIComponent(JSON.stringify(many)))).toHaveLength(GUEST_SAVED_MAX);
  });

  it('a signed-out Save keeps the product on the device instead of bouncing to sign-in', () => {
    const route = read('apps/web/src/pages/api/saved.ts');
    expect(route).not.toContain("if (!token) return redirect(`/login");
    expect(route).toContain('writeGuestSaved(cookies, toggleGuestSaved(readGuestSaved(cookies), productId, op)');
  });

  it('signing in or registering moves the device list into the account', () => {
    for (const page of ['apps/web/src/pages/login.astro', 'apps/web/src/pages/register.astro']) {
      expect(read(page), page).toContain('await mergeGuestSavedIntoAccount(Astro.cookies, json.data.token)');
    }
  });

  it('the cart can save a line for later, and the saved page serves guests', () => {
    const cart = read('apps/web/src/pages/cart.astro');
    expect(cart).toContain('name="saveForLater" value="1"');
    expect(cart).toContain("formData.get('saveForLater')?.toString() === '1'");
    const saved = read('apps/web/src/pages/account/saved.astro');
    expect(saved).not.toContain("if (!token) return Astro.redirect('/login?returnTo=/account/saved', 303);");
    expect(saved).toContain('readGuestSaved(Astro.cookies)');
  });
});

describe('product page (P10, P12, P17, P19)', () => {
  const pdp = read('apps/web/src/pages/products/[slug].astro');

  it('reviews and answered questions offer "See all" instead of a silent cut-off', () => {
    expect(pdp).toContain('See all {productReviews.reviews.length} reviews');
    expect(pdp).toContain('See all {answeredQuestions.length} answered questions');
  });

  it('Add to cart confirms on the page; Buy now still leaves; no JavaScript still lands on /cart?added=', () => {
    expect(pdp).toContain("if (submitter?.name === 'buyNow') return;");
    expect(pdp).toContain("landed.searchParams.get('added') === id");
    expect(pdp).toContain("id = 'pdp-added-toast'");
  });

  it('the sticky bar reserves its own height below the page', () => {
    expect(pdp).toContain('document.body.style.paddingBottom = buyBar.hidden');
  });
});
