import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loyaltyWorkedExample, WORKED_EXAMPLE_ORDER_UGX } from '../../apps/web/src/lib/loyaltyWorkedExample';
import { orderAwaitsPayment } from '../../apps/web/src/lib/checkoutClient';
import { normaliseCheckoutPhone } from '../../apps/web/src/lib/checkout';
import { validateRegistration, REGISTER_FIELD_MESSAGES } from '../../apps/web/src/lib/registerForm';

/**
 * Round 2 of the 2026-09-24 storefront jury, checkout / accounts / loyalty
 * surfaces, plus the owner decisions of the same day:
 *  1. loyalty rates are correct (20% back); say so honestly, with a worked
 *     example computed from the live config, and link the published odds;
 *  3. sign-in is by email, so no page says the phone number is the account;
 *  4. no numeric stock counts.
 */
const root = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

const LIVE = { earnRatePer1000Ugx: 10, pointValueUgx: 20, minPoints: 500, maxShareBps: 5000 };

describe('loyalty worked example is computed from the programme config (owner decision 1)', () => {
  it('the live rates give 20% back: 200,000 UGX earns 2,000 points worth 40,000 UGX', () => {
    const ex = loyaltyWorkedExample(LIVE);
    expect(ex).not.toBeNull();
    expect(ex!.orderTotalUgx).toBe(WORKED_EXAMPLE_ORDER_UGX);
    expect(ex!.pointsEarned).toBe(2000);
    expect(ex!.valueUgx).toBe(40_000);
    expect(ex!.returnPercent).toBe('20');
    expect(ex!.maxSharePct).toBe(50);
    // 40,000 UGX of points at a 50% ceiling needs 80,000 UGX of goods.
    expect(ex!.goodsToUseAllUgx).toBe(80_000);
    expect(ex!.minPoints).toBe(500);
  });

  it('follows the config when the admin changes a rate', () => {
    expect(loyaltyWorkedExample({ ...LIVE, pointValueUgx: 10 })!.returnPercent).toBe('10');
    expect(loyaltyWorkedExample({ ...LIVE, earnRatePer1000Ugx: 5, pointValueUgx: 25 })!.returnPercent).toBe('12.5');
    // Earning mirrors the ledger: whole thousands only.
    expect(loyaltyWorkedExample(LIVE, 1999)!.pointsEarned).toBe(10);
  });

  it('shows nothing rather than an invented figure when a value is missing', () => {
    expect(loyaltyWorkedExample({ ...LIVE, pointValueUgx: null })).toBeNull();
    expect(loyaltyWorkedExample({ ...LIVE, earnRatePer1000Ugx: 0 })).toBeNull();
    expect(loyaltyWorkedExample(LIVE, 999)).toBeNull();
    const noCeiling = loyaltyWorkedExample({ ...LIVE, maxShareBps: null });
    expect(noCeiling!.goodsToUseAllUgx).toBeNull();
    expect(noCeiling!.maxSharePct).toBeNull();
  });

  it('/loyalty renders the example from the fetched config, and links the published odds', () => {
    const page = read('apps/web/src/pages/loyalty.astro');
    expect(page).toMatch(/loyaltyWorkedExample\(\{\s*earnRatePer1000Ugx: programme\.earnRatePer1000Ugx/);
    expect(page).toMatch(/Worked example/);
    expect(page).toMatch(/href: "\/loyalty-terms#scratch-cards"/);
    expect(page).toMatch(/text: "the odds are published"/);
    // No typed-in percentage in the markup: the figure comes from the helper.
    expect(page).toMatch(/\{example\.returnPercent\}% back/);
    expect(page).not.toMatch(/<strong[^>]*>20% back/);
    const terms = read('apps/web/src/pages/loyalty-terms.astro');
    expect(terms).toMatch(/<section id="scratch-cards"/);
  });

  it('the decisions log states the true 20% return and no longer says 2%', () => {
    const doc = read('docs/loyalty-decisions.md');
    expect(doc).toMatch(/\*\*20 UGX\*\* \(20% return/);
    expect(doc).toMatch(/RECOMMEND \*\*20 UGX \(20%\)\*\*/);
    expect(doc).not.toMatch(/\(2% return\)/);
    expect(doc).not.toMatch(/RECOMMEND \*\*20 UGX \(2%\)\*\*/);
  });
});

describe('sign-in wording matches reality: email, not phone (owner decision 3)', () => {
  const pages = ['login', 'register', 'forgot-password', 'reset-password'].map((p) => read(`apps/web/src/pages/${p}.astro`));

  it('no auth page says the phone number is the account', () => {
    for (const page of pages) {
      expect(page).not.toMatch(/number is (?:your|the) account/i);
      expect(page).not.toMatch(/sign in with your (?:phone|number)/i);
    }
  });

  it('login and register say the email signs you in and what the phone is for', () => {
    expect(pages[0]).toMatch(/Sign in with the email address and password/);
    expect(pages[1]).toMatch(/You sign in with this email address and your password\./);
    expect(pages[1]).toMatch(/It is not used to sign in\./);
  });
});

describe('phone rules: checkout takes a landline, the account phone stays a mobile', () => {
  it('checkout accepts 0414 123 456; register refuses it with the mobile message', () => {
    expect(normaliseCheckoutPhone('0414 123 456')).toBe('0414123456');
    const ok = { email: 'a@example.com', phone: '0772 123 456', password: 'longenough', confirmPassword: 'longenough' };
    expect(validateRegistration(ok)).toEqual({});
    expect(validateRegistration({ ...ok, phone: '0414 123 456' })).toEqual({ phone: REGISTER_FIELD_MESSAGES.phone });
    expect(REGISTER_FIELD_MESSAGES.phone).toMatch(/mobile/);
  });

  it('the checkout phone field says a landline is fine', () => {
    expect(read('apps/web/src/pages/checkout.astro')).toMatch(/label="Phone \(mobile or landline\)"/);
  });
});

describe('an order waiting for money gets no dispatch ladder, on both order pages', () => {
  it('reads the payment status, not an order status nothing writes', () => {
    expect(orderAwaitsPayment({ status: 'received', paymentStatus: 'failed', paymentMethod: null })).toBe(true);
    expect(orderAwaitsPayment({ status: 'RECEIVED', paymentStatus: 'FAILED', paymentMethod: 'offline' })).toBe(true);
    expect(orderAwaitsPayment({ status: 'pending_payment', paymentStatus: 'unpaid' })).toBe(true);
    expect(orderAwaitsPayment({ status: 'received', paymentStatus: 'unpaid', paymentMethod: 'pesapal' })).toBe(true);
  });

  it('keeps the ladder for cash on delivery, paid and moving orders', () => {
    expect(orderAwaitsPayment({ status: 'received', paymentStatus: 'unpaid', paymentMethod: 'offline' })).toBe(false);
    // Method unknown: do not hide a possibly-COD order's progress.
    expect(orderAwaitsPayment({ status: 'received', paymentStatus: 'unpaid', paymentMethod: null })).toBe(false);
    expect(orderAwaitsPayment({ status: 'received', paymentStatus: 'paid', paymentMethod: 'pesapal' })).toBe(false);
    expect(orderAwaitsPayment({ status: 'dispatched', paymentStatus: 'unpaid', paymentMethod: 'pesapal' })).toBe(false);
  });

  it('/orders/[id] and /track-order both use the one rule', () => {
    const detail = read('apps/web/src/pages/orders/[id].astro');
    expect(detail).toMatch(/orderAwaitsPayment\(\{ status: order\.status, paymentStatus: order\.paymentStatus/);
    expect(detail).toMatch(/const showProgress = Boolean\(order\) && !awaitingPayment/);
    expect(read('apps/web/src/pages/track-order.astro')).toMatch(/const isUnpaid = Boolean\(order\) && orderAwaitsPayment\(/);
  });
});

describe('order confirmation recap adds up', () => {
  const confirmed = read('apps/web/src/pages/checkout/confirmed.astro');

  it('names items by quantity only, with no list-price line totals', () => {
    const itemsBlock = confirmed.slice(confirmed.indexOf('receipt.items.map'), confirmed.indexOf('</ul>', confirmed.indexOf('receipt.items.map')));
    expect(itemsBlock).toMatch(/× \{item\.quantity\}/);
    expect(itemsBlock).not.toMatch(/formatUgx/);
  });

  it('has a Delivery row and a total label that says what it includes', () => {
    expect(confirmed).toMatch(/<dt class="text-slate-600">Delivery<\/dt>/);
    expect(confirmed).toMatch(/'Total to pay' : 'Total \(delivery fee confirmed by phone\)'/);
  });

  it('says points come with a DELIVERED order and uses no dead shadow class', () => {
    expect(confirmed).toMatch(/earn GoldPlus points on every delivered order/);
    expect(confirmed).not.toMatch(/paid order/);
    expect(confirmed).not.toMatch(/shadow-xs/);
  });
});

describe('no numeric stock counts on checkout, cart, order or account pages (owner decision 4)', () => {
  it('none of these pages prints a stock quantity', () => {
    const files = [
      'apps/web/src/pages/cart.astro',
      'apps/web/src/pages/checkout.astro',
      'apps/web/src/pages/checkout/confirmed.astro',
      'apps/web/src/pages/orders/[id].astro',
      'apps/web/src/pages/track-order.astro',
    ];
    for (const f of files) {
      const src = read(f);
      expect(src, f).not.toMatch(/\{[^}]*(?:stockQuantity|availableQuantity|quantityAvailable|stockOnHand)[^}]*\}/);
      expect(src, f).not.toMatch(/\d+\s+(?:available|left in stock|in stock)\b/);
    }
  });
});

describe('deferred layout and accessibility items', () => {
  it('FormField: a plain label is a block with the asterisk inline', () => {
    const field = read('apps/web/src/components/FormField.astro');
    expect(field).toMatch(/: 'block text-sm font-bold text-brand-dark mb-2';/);
    expect(field).toMatch(/<slot name="label">\{label\}<\/slot>\{required && <span class="text-red-600 ml-1" aria-hidden="true">\*<\/span>\}/);
    // Only custom label markup keeps the flex row.
    expect(field).toMatch(/Astro\.slots\.has\('label'\)\s*\?\s*'text-sm font-bold text-brand-dark mb-2 flex items-center gap-1'/);
  });

  it('content pages use a div, not a second <main>, inside BaseLayout', () => {
    for (const p of ['returns', 'warranty', 'faq', 'support/index', 'loyalty', 'loyalty-terms', 'privacy', 'terms', 'account/surveys']) {
      expect(read(`apps/web/src/pages/${p}.astro`), p).not.toMatch(/<main\b/);
    }
  });

  it('rewards inputs are 16px on phones so iOS does not zoom', () => {
    const rewards = read('apps/web/src/pages/account/rewards.astro');
    expect(rewards.match(/px-4 py-2 text-base sm:text-sm/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
  });

  it('terms and privacy contents links show only the ring on focus', () => {
    for (const p of ['terms', 'privacy']) {
      const src = read(`apps/web/src/pages/${p}.astro`);
      const toc = src.match(/<li><a class="[^"]*" href="#[^"]+">/g) ?? [];
      expect(toc.length, p).toBeGreaterThan(0);
      for (const a of toc) expect(a).toMatch(/focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primaryInk/);
    }
  });

  it('track-order help pills go to the real pages and inputs have a visible edge', () => {
    const track = read('apps/web/src/pages/track-order.astro');
    expect(track).toMatch(/href="\/returns"[^>]*>Returns help</);
    expect(track).toMatch(/href="\/warranty"[^>]*>Warranty help</);
    expect(track).toMatch(/href="\/support#terms-guidance"/);
    expect(track).not.toMatch(/<input[^>]*border-slate-300/);
    expect(track).toMatch(/placeholder:text-gray-500/);
  });

  it('forgot and reset password buttons are 48px with a real ink colour', () => {
    for (const p of ['forgot-password', 'reset-password']) {
      const src = read(`apps/web/src/pages/${p}.astro`);
      expect(src, p).not.toMatch(/text-gray-955/);
      expect(src, p).not.toMatch(/py-2\.5 rounded-full font-bold text-xs tracking-wider uppercase/);
      expect(src, p).toMatch(/min-h-12/);
      expect(src, p).toMatch(/<div class="container mx-auto px-4 lg:px-8 py-12 md:py-20">/);
    }
  });

  it('the cart heading matches the other pages', () => {
    expect(read('apps/web/src/pages/cart.astro')).toMatch(/<h1 class="text-3xl md:text-4xl font-black tracking-tight[^"]*">Your cart<\/h1>/);
  });
});
