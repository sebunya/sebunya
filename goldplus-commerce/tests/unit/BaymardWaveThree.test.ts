import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { lowestDeliveryFeeUgx } from '../../apps/api/src/domain/delivery/DeliveryFeeLadder';
import { normalizeSearchWords } from '../../packages/shared/src/search/index';
import { validateRegistration, REGISTER_FIELD_ORDER } from '../../apps/web/src/lib/registerForm';
import { GetProductBySlugUseCase } from '../../apps/api/src/application/use-cases/products/GetProductBySlugUseCase';

const src = (p: string) => readFileSync(resolve(__dirname, '../../', p), 'utf8');
const PDP = 'apps/web/src/pages/products/[slug].astro';

describe('Baymard wave 3 — P5/C3: "Delivery from" is the quoting service\'s own floor, never a typed number', () => {
  it('takes the bottom ladder rung when the ladder shape is published', () => {
    expect(lowestDeliveryFeeUgx({ fee_shape: 'ladder', fee_ladder: '8000, 5000, 12000', minimum_fee_ugx: '3000' })).toBe(5000);
  });
  it('falls back to the published minimum fee under the continuous shape, and to nothing when neither is set', () => {
    expect(lowestDeliveryFeeUgx({ fee_shape: 'continuous', minimum_fee_ugx: '5,000' })).toBe(5000);
    expect(lowestDeliveryFeeUgx({ fee_shape: 'ladder', fee_ladder: 'nonsense', minimum_fee_ugx: '4000' })).toBe(4000);
    expect(lowestDeliveryFeeUgx({})).toBeNull();
    expect(lowestDeliveryFeeUgx({ minimum_fee_ugx: '0' })).toBeNull();
  });
  it('the product page and the cart show the figure only when one is published', () => {
    const pdp = src(PDP);
    expect(pdp).toContain("const deliveryFromP = settle(getDeliveryFrom());");
    expect(pdp).toContain('{canBuy && deliveryFrom.fromUgx !== null && (');
    const cart = src('apps/web/src/pages/cart.astro');
    expect(cart).toContain('data-cart-delivery-from');
    expect(cart).not.toContain('Not included yet');
    expect(src('apps/web/src/lib/deliveryFrom.ts')).toContain('`${apiBase}/delivery/from`');
    expect(src('apps/api/src/interfaces/http/routes/delivery.ts')).toContain("routes.get('/from'");
  });
});

describe('Baymard wave 3 — P1: every version of one item on one page', () => {
  const view = (id: string, name: string, group: string | null) => ({
    entity: { id, slug: id, name, sku: 'S', modelNumber: 'M', isPreOrderEnabled: false, availableQuantity: () => 3, shortDescription: '', longDescription: '' },
    retailPriceUgx: 10000, floorPriceUgx: null, categoryName: 'Power', images: [], attributeValues: [], variantGroup: group,
  }) as any;

  it('offers the listed siblings of a grouped product, itself excluded, and nothing for an ungrouped one', async () => {
    const asked: string[] = [];
    const repo = {
      findPublicViewBySlug: async (slug: string) => (slug === 'pb-10' ? view('pb-10', 'Slim 10000 mAh', 'PB-SLIM') : slug === 'solo' ? view('solo', 'Solo', null) : null),
      findSiblings: async (id: string) => { asked.push(id); return [view('pb-20', 'Slim 20000 mAh', 'PB-SLIM')]; },
    } as any;
    const uc = new GetProductBySlugUseCase(repo);
    const grouped = await uc.execute('pb-10');
    expect(grouped.ok && grouped.dto.siblings).toEqual([{ id: 'pb-20', slug: 'pb-20', name: 'Slim 20000 mAh', retailPriceUgx: 10000, availability: { kind: 'in_stock', quantity: 3 } }]);
    const alone = await uc.execute('solo');
    expect(alone.ok && alone.dto.siblings).toEqual([]);
    expect(asked).toEqual(['pb-10']);
  });

  it('a sibling read that fails costs nothing: the product page still renders', async () => {
    const repo = { findPublicViewBySlug: async () => view('pb-10', 'Slim', 'PB-SLIM'), findSiblings: async () => { throw new Error('db down'); } } as any;
    const r = await new GetProductBySlugUseCase(repo).execute('pb-10');
    expect(r.ok && r.dto.siblings).toEqual([]);
  });

  it('the page marks the current one and links the others; admin edits the group on the properties form', () => {
    const pdp = src(PDP);
    expect(pdp).toContain('data-pdp-siblings');
    expect(pdp).toContain('aria-current="page"');
    expect(src('apps/web/src/pages/admin/products/[id]/edit-properties.astro')).toContain('name="variantGroup"');
    expect(src('apps/api/src/interfaces/http/routes/admin/products.ts')).toContain("typeof body.variantGroup === 'string'");
    expect(src('apps/api/src/infrastructure/db/migrations/0218_baymard_wave_3.sql')).toContain('"variant_group" varchar(60)');
  });
});

describe('Baymard wave 3 — P9: the shop replies under a review, in its own voice', () => {
  it('the public read carries the reply only when a person wrote one', () => {
    const repo = src('apps/api/src/infrastructure/db/repositories/DrizzleReviewRepository.ts');
    expect(repo).toContain('staffReply: staffReply && staffRepliedAt ? { body: staffReply, at: staffRepliedAt } : null');
    expect(repo).toContain('async reply(input: { reviewId: string; body: string; now: Date })');
  });
  it('the admin route needs the moderation permission and caps the reply', () => {
    const route = src('apps/api/src/interfaces/http/routes/admin/new-modules.ts');
    expect(route).toContain("routes.post('/reviews/:id/reply', requirePermissions([PERMISSIONS.REVIEWS_MODERATE])");
    expect(route).toContain('reply.length > 1000');
  });
  it('the page styles the reply apart from the buyer\'s words', () => {
    const pdp = src(PDP);
    expect(pdp).toContain('data-staff-reply');
    expect(pdp).toContain('Reply from GoldPlus');
    expect(src('apps/web/src/pages/admin/platform-modules.astro')).toContain('intent === "reply_review"');
  });
});

describe('Baymard wave 3 — A2 / A9 / C5 / P17 / P18 / Q7 / S1', () => {
  it('A2: one password field; a confirm value is ignored', () => {
    expect(REGISTER_FIELD_ORDER).toEqual(['email', 'phone', 'password']);
    expect(validateRegistration({ email: 'a@b.co', phone: '0772123456', password: 'longenough' })).toEqual({});
    const page = src('apps/web/src/pages/register.astro');
    expect(page).not.toContain('name="confirmPassword"');
    expect(page).toContain('data-password-toggle');
  });
  it('A9: an address is edited in place through the existing PUT, the area itself never from this form', () => {
    const page = src('apps/web/src/pages/account/addresses.astro');
    expect(page).toContain("action === 'edit'");
    expect(page).toContain("method: 'PUT'");
    expect(page).toContain('data-address-edit');
    expect(page).not.toMatch(/action === 'edit'[\s\S]*?district:/);
  });
  it('C5: the cart says the basket is kept', () => {
    expect(src('apps/web/src/pages/cart.astro')).toContain('data-cart-persists');
  });
  it('P17: questions are searchable on the page once there are more than three', () => {
    const pdp = src(PDP);
    expect(pdp).toContain('data-question-filter');
    expect(pdp).toContain('answeredQuestions.length > 3 && (');
  });
  it('P18: a buyable product still offers a person on WhatsApp', () => {
    expect(src(PDP)).toContain('data-pdp-whatsapp');
  });
  it('Q7: spelled-out charging standards search as the catalogue spells them', () => {
    expect(normalizeSearchWords(['power', 'delivery', 'charger'])).toEqual(['pd', 'charger']);
    expect(normalizeSearchWords(['quick', 'charge', '3.0'])).toEqual(['qc', '3.0']);
    expect(normalizeSearchWords(['20', 'watt', 'power', 'delivery'])).toEqual(['20w', 'pd']);
    expect(normalizeSearchWords(['power', 'bank'])).toEqual(['power', 'bank']);
  });
  it('S1: the shop header carries a visible breadcrumb', () => {
    const shop = src('apps/web/src/pages/shop.astro');
    expect(shop).toContain('aria-label="Breadcrumb"');
    expect(shop).toContain('data-shop-breadcrumb');
  });
});
