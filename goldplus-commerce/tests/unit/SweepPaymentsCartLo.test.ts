import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MutateCartUseCase,
  type CartOwner,
  type CartRecord,
  type ICartAuthorizedRepository,
} from '../../apps/api/src/application/use-cases/commerce/MutateCartUseCase';
import { pricingCustomerScopeKey } from '../../apps/api/src/domain/pricing/CustomerIdentity';
import { kampalaWallTimeToIso, buildNextVersionDraft } from '../../apps/web/src/lib/pricingVersionDraft';
import { basketSavingLabel, basketSavingUgx } from '../../apps/web/src/lib/storefrontDiscount';
import {
  requestUserId,
  resolveAuthenticatedCustomer,
  SESSION_CHECK_TIMEOUT_MS,
} from '../../apps/web/src/lib/customerAuth';

/**
 * Payments + cart sweep, P2/P3 (2026-09-24). One block per finding; the ones
 * already covered elsewhere say where.
 *  - return page "already paid" on every success: PaymentReturnTwoDoors.test.ts
 *  - retry resubmits a stale attempt / cancel page names no order:
 *    StartPaymentNeverOrphansAPage.test.ts
 */

const root = resolve(__dirname, '../..');
const read = (file: string) => readFileSync(resolve(root, file), 'utf8');

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('checkout keeps what the customer chose across an error re-render', () => {
  const src = read('apps/web/src/pages/checkout.astro');

  it('binds the payment method, points, promo code and preview quote to the submitted values', () => {
    expect(src).not.toMatch(/name="paymentMethod" value="offline" checked\s/);
    expect(src).toMatch(/value="offline" checked=\{paymentMethodValue !== 'pesapal'\}/);
    expect(src).toMatch(/value="pesapal" checked=\{paymentMethodValue === 'pesapal'\}/);
    expect(src).toMatch(/value=\{redeemPointsValue\}/);
    expect(src).toMatch(/value=\{couponCodeValue\}/);
    expect(src).toMatch(/value=\{previewQuoteIdValue\}/);
    expect(src).toMatch(/paymentMethodValue === 'pesapal' \? 'Pay securely now' : 'Place order'/);
  });

  it('moves focus to the error, including a refusal with no field to point at', () => {
    expect(src).toMatch(/id="checkout-feedback" tabindex="-1"/);
    expect(src).toMatch(/getElementById\('checkout-error-summary'\) \?\? document\.querySelector<HTMLElement>\('#checkout-feedback\[data-error\]'\)\)\?\.focus\(\)/);
  });
});

describe('a refused basket write is visible and leaves the device copy alone', () => {
  const cart = read('apps/web/src/pages/cart.astro');

  it('renders the notice instead of redirecting it away', () => {
    expect(cart).toMatch(/if \(!cartNotice\) \{\s*if \(buyNow\)/);
  });

  it('writes the device cookie only when the server took the change (or there is no server basket)', () => {
    const guard = cart.indexOf('if (!cartCredential || !cartNotice) {');
    expect(guard).toBeGreaterThan(-1);
    expect(cart.indexOf("Astro.cookies.set('goldplus_cart_data'", guard)).toBeGreaterThan(guard);
    // No unguarded write before it.
    expect(cart.slice(0, guard)).not.toContain("Astro.cookies.set('goldplus_cart_data'");
  });
});

describe('a product withdrawn while in the basket is named, not silently blocking', () => {
  const owner: CartOwner = { kind: 'GUEST', id: 'guest-1' };
  const record: CartRecord = {
    id: 'cart-1',
    version: 3,
    ownerKind: 'GUEST',
    ownerId: 'guest-1',
    items: [
      { productId: 'bank', name: 'Power bank', slug: 'power-bank', unitPriceUgx: 185_000, quantity: 1 },
      { productId: 'cable', name: 'Withdrawn cable', slug: 'cable', unitPriceUgx: 15_000, quantity: 1 },
    ],
  };
  const repo: ICartAuthorizedRepository = {
    find: async () => structuredClone(record),
    create: async () => undefined,
    claimOwnership: async () => false,
    replaceItems: async () => true,
  };

  it('flags the line and leaves it out of the subtotal', async () => {
    const useCase = new MutateCartUseCase({
      carts: repo,
      products: { findPurchasable: async () => [{ id: 'bank', name: 'Power bank', unitPriceUgx: 185_000 }] },
    });
    const outcome = await useCase.read({ cartId: 'cart-1', owner, traceId: 't' });
    expect(outcome.kind).toBe('APPLIED');
    if (outcome.kind !== 'APPLIED') return;
    expect(outcome.cart.items.find((l) => l.productId === 'cable')?.unavailable).toBe(true);
    expect(outcome.cart.items.find((l) => l.productId === 'bank')?.unavailable).toBeUndefined();
    expect(outcome.cart.subtotalUgx).toBe(185_000);
  });

  it('still returns the basket, unflagged, when the catalogue read fails', async () => {
    const useCase = new MutateCartUseCase({
      carts: repo,
      products: { findPurchasable: async () => { throw new Error('db down'); } },
    });
    const outcome = await useCase.read({ cartId: 'cart-1', owner, traceId: 't' });
    expect(outcome.kind).toBe('APPLIED');
    if (outcome.kind === 'APPLIED') expect(outcome.cart.subtotalUgx).toBe(200_000);
  });

  it('the cart page names the line, drops its +/−, keeps Remove, and excludes it from totals', () => {
    const cart = read('apps/web/src/pages/cart.astro');
    expect(cart).toMatch(/unavailable: line\.unavailable === true/);
    expect(cart).toMatch(/const purchasableItems = items\.filter\(\(i\) => !i\.unavailable\)/);
    expect(cart).toMatch(/const subtotal = purchasableItems\.reduce/);
    expect(cart).toMatch(/\{!item\.unavailable && <form method="POST" action="\/cart" class="flex items-center gap-1 sm:gap-2">/);
    expect(cart).toContain('No longer available');
  });
});

describe('the basket shows every automatic saving the evaluator charges', () => {
  const preview = (data: Record<string, number>) =>
    vi.fn(async () => new Response(JSON.stringify({ success: true, data }), { status: 200 }));
  const items = [{ productId: '11111111-1111-1111-1111-111111111111', quantity: 1 }];

  it('reports a conditional promotion even though no storefront campaign is running', async () => {
    vi.stubGlobal('fetch', preview({ baseSubtotalUgx: 520_000, discountTotalUgx: 20_000, goodsTotalUgx: 500_000 }));
    expect(await basketSavingUgx(items, 520_000)).toBe(20_000);
  });

  it('never shows more saving than the page subtotal, and nothing on failure', async () => {
    vi.stubGlobal('fetch', preview({ baseSubtotalUgx: 900_000, discountTotalUgx: 900_000, goodsTotalUgx: 0 }));
    expect(await basketSavingUgx(items, 100_000)).toBe(100_000);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    expect(await basketSavingUgx(items, 100_000)).toBe(0);
  });

  it('neither page gates the evaluator on the simple storefront campaign any more', () => {
    for (const f of ['apps/web/src/pages/cart.astro', 'apps/web/src/pages/checkout.astro']) {
      const src = read(f);
      expect(src, f).toContain('basketSavingUgx(');
      expect(src, f).not.toMatch(/CampaignRunning\s*\n?\s*\?\s*await/);
      expect(src, f).not.toMatch(/campaignRunning\s*\n?\s*\?\s*await/);
    }
  });
});

describe('the saving is not labelled with a percentage it does not give', () => {
  const campaign = { active: true, percent: 10, percentBps: 1000, endsIso: null, name: 'Launch offer', priceFloorUgx: 0 };
  const lines = [{ unitPriceUgx: 145_000, quantity: 1 }, { unitPriceUgx: 185_000, quantity: 1 }];

  it('says "Sale saving" when floors cut the saving below the campaign percentage', () => {
    expect(basketSavingLabel(campaign, lines, 18_500)).toBe('Sale saving · Launch offer');
  });

  it('names the percentage when the saving is exactly that percentage of every line', () => {
    expect(basketSavingLabel(campaign, lines, 33_000)).toBe('10% off · Launch offer');
  });

  it('is plain when no simple campaign is running', () => {
    expect(basketSavingLabel({ ...campaign, active: false, name: null }, lines, 20_000)).toBe('Sale saving');
  });

  it('both summaries use it', () => {
    expect(read('apps/web/src/pages/cart.astro')).not.toMatch(/\{cartDiscount\.percent\}% discount/);
    expect(read('apps/web/src/pages/checkout.astro')).not.toMatch(/\{checkoutDiscount\.percent\}% discount/);
  });
});

describe('a per-customer promotion limit counts one person once', () => {
  it('reads the same person the same way however the phone is written', () => {
    const keys = ['0700000000', '0700 000 000', '+256700000000', '256-700-000-000'].map((phone) =>
      pricingCustomerScopeKey({ principal: null, phone }),
    );
    expect(new Set(keys).size).toBe(1);
    expect(keys[0]).toBe('phone:+256700000000');
  });

  it('prefers the signed-in account and never uses the email', () => {
    expect(pricingCustomerScopeKey({ principal: { kind: 'USER', id: 'u-1' }, phone: '0700000000' })).toBe('user:u-1');
    expect(pricingCustomerScopeKey({ principal: { kind: 'GUEST', id: 'g-1' }, phone: '0700000000' })).toBe('phone:+256700000000');
    const src = read('apps/api/src/application/use-cases/commerce/CheckoutUseCase.ts');
    expect(src).toMatch(/const customerScopeKey = pricingCustomerScopeKey\(/);
    expect(src).not.toMatch(/email\?\.trim\(\)\.toLowerCase\(\) \|\| dto\.customerDetails\.phone/);
  });

  it('keeps a non-Ugandan number stable across punctuation', () => {
    expect(pricingCustomerScopeKey({ principal: null, phone: '+44 20 7946 0000' })).toBe(
      pricingCustomerScopeKey({ principal: null, phone: '+442079460000' }),
    );
  });
});

describe('the cart says when its figures come from this device', () => {
  const cart = read('apps/web/src/pages/cart.astro');

  it('keeps a failed read visible and flags the device copy', () => {
    expect(cart).not.toMatch(/fetchError = null/);
    expect(cart).toMatch(/pricedFromDevice = items\.length > 0/);
    expect(cart).toMatch(/\{pricedFromDevice && \(/);
  });

  it('asks for line details by id, not from the newest 100 products', () => {
    expect(cart).not.toMatch(/\/products\?limit=100/);
    expect(cart).toMatch(/\/products\?ids=/);
  });
});

describe('promotion schedules are Kampala time', () => {
  it('adds +03:00 to a bare datetime-local value and leaves an explicit offset alone', () => {
    expect(kampalaWallTimeToIso('2026-09-25T00:00')).toBe('2026-09-25T00:00+03:00');
    expect(new Date(kampalaWallTimeToIso('2026-09-25T00:00')).toISOString()).toBe('2026-09-24T21:00:00.000Z');
    expect(kampalaWallTimeToIso('2026-09-25T00:00:30')).toBe('2026-09-25T00:00:30+03:00');
    expect(kampalaWallTimeToIso('2026-09-25T00:00:00Z')).toBe('2026-09-25T00:00:00Z');
    expect(kampalaWallTimeToIso('2026-09-25T00:00+01:00')).toBe('2026-09-25T00:00+01:00');
    expect(kampalaWallTimeToIso('')).toBe('');
  });

  it('both admin forms send the offset', () => {
    const next = buildNextVersionDraft({}, { startsAt: '2026-10-01T08:00', endsAt: '2026-10-02T00:00', benefitType: 'PERCENTAGE_OFF', benefitValue: 1000, priority: 0, priceFloorUgx: 0 });
    expect(next.schedule).toEqual({ startsAt: '2026-10-01T08:00+03:00', endsAt: '2026-10-02T00:00+03:00' });
    const create = read('apps/web/src/pages/admin/pricing/index.astro');
    expect(create).toMatch(/startsAt: kampalaWallTimeToIso\(/);
    expect(create).toMatch(/endsAt: kampalaWallTimeToIso\(/);
    expect(create).toContain('Starts (Kampala time)');
    expect(read('apps/web/src/pages/admin/pricing/[id].astro')).toContain('Ends (Kampala time)');
  });
});

describe('the MTN/Airtel webhook dedupe key comes from signed content only', () => {
  it('ignores the unsigned Idempotency-Key header', () => {
    const src = read('apps/api/src/interfaces/http/routes/webhooks.ts');
    expect(src).not.toMatch(/c\.req\.header\('idempotency-key'\)/i);
    expect(src).toMatch(/idempotencyKey: typeof parsed\.idempotencyKey === 'string' \? parsed\.idempotencyKey : null/);
  });
});

describe('the cart does not promise points to a guest', () => {
  it('splits the copy by sign-in state, like checkout', () => {
    const cart = read('apps/web/src/pages/cart.astro');
    expect(cart).toMatch(/cartPotentialPoints > 0 && \(cartUserId \?/);
    expect(cart).toContain('to earn at least {cartPotentialPoints');
    expect(cart).not.toMatch(/>Earn \{cartPotentialPoints/);
  });
});

describe('the sign-in check cannot stall a page', () => {
  const cookies = (token: string | null) => ({ get: (name: string) => (name === 'goldplus_session' && token ? { value: token } : undefined) }) as never;

  it('passes a timeout signal to /account/me and degrades to guest when it fires', async () => {
    let seen: AbortSignal | undefined;
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      seen = init?.signal ?? undefined;
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    }));
    expect(await resolveAuthenticatedCustomer(cookies('tok'))).toBeNull();
    expect(seen).toBeInstanceOf(AbortSignal);
    expect(SESSION_CHECK_TIMEOUT_MS).toBeLessThanOrEqual(2000);
  });

  it('reuses the answer the middleware already resolved instead of asking again', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    expect(await requestUserId({ gpUserId: 'u-1' }, cookies('tok'))).toBe('u-1');
    expect(await requestUserId({ gpUserId: null }, cookies('tok'))).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('asks only when the middleware did not', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ success: true, data: { id: 'u-2' } }), { status: 200 })));
    expect(await requestUserId({}, cookies('tok'))).toBe('u-2');
  });

  it('cart and checkout read the request-scoped answer', () => {
    // requestSession: the same request-scoped answer, with UNKNOWN kept distinct
    // (SessionUnknownKeepsTheBasket.test.ts).
    expect(read('apps/web/src/pages/cart.astro')).toContain('requestSession(Astro.locals, Astro.cookies)');
    expect(read('apps/web/src/pages/checkout.astro')).toContain('requestSession(Astro.locals, Astro.cookies)');
  });
});
