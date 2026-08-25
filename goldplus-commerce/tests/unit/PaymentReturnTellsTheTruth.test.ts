import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  normalisePaymentReturnKind,
  orderNumberFromMerchantReference,
  paymentReturnCopy,
  type PaymentReturnKind,
} from '../../apps/web/src/lib/paymentReturn';
import { customerMessageFor } from '../../apps/web/src/lib/checkoutClient';
import { orderStatusCopy, paymentStatusCopy } from '../../apps/web/src/lib/orderStatusCopy';

/**
 * The page a customer lands on after PesaPal used to test only for `success`
 * and render every other settlement — including ALREADY_SETTLED (they HAVE
 * paid) and PENDING (their MoMo debit is in flight) — as "Payment Verification
 * Failed. No funds have been charged", with a "Retry Checkout" button. That is
 * the most expensive sentence on the site to get wrong. These contracts keep
 * every money claim tied to what the settlement actually said.
 */

const ROOT = join(__dirname, '../..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const KINDS: PaymentReturnKind[] = ['success', 'pending', 'review_required', 'already_settled', 'failed', 'unknown_attempt'];

describe('payment return copy', () => {
  it('never flatly asserts "not charged" — FAILED includes a provider reversal, where money did move', () => {
    for (const kind of KINDS) {
      const c = paymentReturnCopy(kind, 'GP-202608-3F7A');
      expect(c.money, kind).not.toMatch(/have not been charged|no funds have been charged/i);
    }
    // …but a failure must still say the order is unpaid and what happens to any money that left.
    const failed = paymentReturnCopy('failed', null);
    expect(failed.money).toMatch(/not paid/i);
    expect(failed.money).toMatch(/returns it|come back/i);
  });

  it('tells a customer whose payment is in flight NOT to pay again', () => {
    for (const kind of ['pending', 'review_required', 'unknown_attempt'] as const) {
      const c = paymentReturnCopy(kind, null);
      expect(c.next, kind).toMatch(/do not pay again/i);
      expect(c.primaryCta.href, kind).not.toBe('/checkout');
      expect(c.offerHelp, kind).toBe(true);
    }
  });

  it('offers a retry only on a genuine failure, and says it will not duplicate the order', () => {
    const c = paymentReturnCopy('failed', 'GP-202608-3F7A');
    expect(c.primaryCta.href).toBe('/checkout');
    expect(c.next).toMatch(/not create a second/i);
  });

  it('treats an unrecognised or empty status as unknown, never as success or failure', () => {
    expect(normalisePaymentReturnKind('')).toBe('unknown_attempt');
    expect(normalisePaymentReturnKind('garbage')).toBe('unknown_attempt');
    expect(normalisePaymentReturnKind('ALREADY_SETTLED')).toBe('already_settled');
    expect(normalisePaymentReturnKind('success')).toBe('success');
  });

  it('recovers the order number the tracking page asks for from the merchant reference', () => {
    expect(orderNumberFromMerchantReference('GP-GP-202608-3F7A-a1b2c3')).toBe('GP-202608-3F7A');
    expect(orderNumberFromMerchantReference('nonsense')).toBeNull();
    expect(paymentReturnCopy('success', 'GP-202608-3F7A').primaryCta.href).toBe('/track-order?reference=GP-202608-3F7A');
  });

  it('never promises real-time tracking or a package already being prepared', () => {
    for (const kind of KINDS) {
      const c = paymentReturnCopy(kind, null);
      expect(`${c.money} ${c.next}`).not.toMatch(/real-time|already preparing|logistics/i);
    }
  });
});

describe('the callback page renders no provider or exception text', () => {
  const page = read('apps/web/src/pages/checkout/pesapal/callback.astro');
  const api = read('apps/api/src/interfaces/http/routes/commerce.ts');

  it('ignores the message query parameter entirely', () => {
    expect(page).not.toMatch(/searchParams\.get\('message'\)/);
    expect(page).not.toMatch(/Error Reason/);
    expect(page).not.toMatch(/No funds have been charged/);
  });

  it('branches on the settlement kind, not on success-or-else', () => {
    expect(page).toMatch(/normalisePaymentReturnKind/);
    expect(page).not.toMatch(/status === 'success'/);
  });

  it('the API never puts an exception message in the redirect, and never calls an exception "failed"', () => {
    expect(api).not.toMatch(/message=\$\{encodeURIComponent\(err\.message\)\}/);
    expect(api).not.toMatch(/status=failed&message=/);
  });
});

describe('checkout refusals are spoken in the customer\'s language', () => {
  const api = read('apps/api/src/interfaces/http/routes/commerce.ts');

  it('the API no longer prefixes the enum onto the sentence', () => {
    expect(api).not.toMatch(/\$\{outcome\.reason\}: \$\{mapped\.message\}/);
  });

  it('every terminal business code has its own wording and says nothing was charged', () => {
    for (const code of ['PRICE_CHANGED', 'PROMOTION_CHANGED', 'PRODUCT_UNAVAILABLE', 'PRICE_UNAVAILABLE'] as const) {
      const out = customerMessageFor({ ok: false, status: 409, code, message: `${code}: raw api text` } as any);
      expect(out.message, code).not.toContain(code);
      expect(out.message, code).not.toContain('raw api text');
      expect(out.message, code).toMatch(/not been charged/i);
    }
  });

  it('an unknown code never passes the API text through', () => {
    const out = customerMessageFor({ ok: false, status: 500, code: 'SOMETHING_NEW' as any, message: 'internal: pool exhausted' } as any);
    expect(out.message).not.toContain('pool exhausted');
  });
});

describe('order and payment statuses are never shown as raw enums', () => {
  it('maps every order status the domain can produce', () => {
    const domain = read('apps/api/src/domain/commerce/Order.ts');
    const statuses = [...domain.matchAll(/export type OrderStatus = ([^;]+);/g)][0][1].match(/'([a-z_]+)'/g)!.map((s) => s.replace(/'/g, ''));
    expect(statuses.length).toBeGreaterThan(5);
    for (const s of statuses) {
      const c = orderStatusCopy(s);
      expect(c.label, s).not.toMatch(/_/);
      expect(c.label, s).not.toBe('In progress'); // the generic fallback means "unmapped"
      expect(c.meaning.length, s).toBeGreaterThan(20);
    }
  });

  it('maps every payment status the domain can produce', () => {
    const domain = read('apps/api/src/domain/commerce/Order.ts');
    const statuses = [...domain.matchAll(/export type PaymentStatus = ([^;]+);/g)][0][1].match(/'([a-z_]+)'/g)!.map((s) => s.replace(/'/g, ''));
    for (const s of statuses) {
      expect(paymentStatusCopy(s).label, s).not.toBe('Payment status unknown');
    }
  });

  it('is case-insensitive, because the account API shouts and the lookup whispers', () => {
    expect(orderStatusCopy('PENDING_PAYMENT').label).toBe(orderStatusCopy('pending_payment').label);
  });

  it('no customer page prints status.replace(/_/g, " ") any more', () => {
    for (const p of ['apps/web/src/pages/orders/[id].astro', 'apps/web/src/pages/account/orders.astro', 'apps/web/src/pages/account/index.astro', 'apps/web/src/pages/track-order.astro']) {
      expect(read(p), p).not.toMatch(/status\.replace\(\/_\/g/);
    }
  });
});
