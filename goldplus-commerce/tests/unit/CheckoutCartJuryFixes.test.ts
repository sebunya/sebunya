import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  normaliseCheckoutPhone,
  UG_FIXED_LINE,
  PHONE_FORMAT_MESSAGE,
  looksLikeEmail,
  sameDayCutoffCopy,
  sameDayLineFor,
  isSameDayDistrict,
  sealOrderReceipt,
  openOrderReceipt,
  maskPhone,
  orderReceiptSigner,
  ORDER_RECEIPT_MAX_AGE_SECONDS,
  type OrderReceipt,
} from '../../apps/web/src/lib/checkout';
import { invalidCheckoutField, customerMessageFor } from '../../apps/web/src/lib/checkoutClient';
import { cartLineHref, chunkIds, isCartProductId, parseLocalCartCookie } from '../../apps/web/src/lib/cart';

/**
 * Awards-jury findings on the cart and checkout (2026-09-24). Each block pins
 * the behaviour that was wrong: a 404 from every server-cart line, a same-day
 * promise to Arua, "check the highlighted fields" with nothing highlighted, a
 * phone number nobody could call, a confirmation lost on refresh, and a
 * cancellation page whose "Pay" button led to an empty cart.
 */

const read = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');

describe('a phone number we can actually call', () => {
  it('accepts Ugandan mobiles however they are written', () => {
    expect(normaliseCheckoutPhone('0772 123 456')).toBe('0772123456');
    expect(normaliseCheckoutPhone('772123456')).toBe('0772123456');
    expect(normaliseCheckoutPhone('+256 772-123-456')).toBe('0772123456');
    expect(normaliseCheckoutPhone('256772123456')).toBe('0772123456');
    expect(normaliseCheckoutPhone('(0701) 123.456')).toBe('0701123456');
  });

  it('refuses what cannot be called', () => {
    for (const bad of ['', '12345', '0772 12', 'abc', '0772 123 4567', '+256 41 123 456', '0512345678', '0112345678', '041 123 456']) {
      expect(normaliseCheckoutPhone(bad)).toBeNull();
    }
  });

  it('accepts a Ugandan landline (02/03/04 then eight digits), as the API always did', () => {
    expect(normaliseCheckoutPhone('0414 123 456')).toBe('0414123456');
    expect(normaliseCheckoutPhone('0312 345 678')).toBe('0312345678');
    expect(normaliseCheckoutPhone('0200 123 456')).toBe('0200123456');
    expect(normaliseCheckoutPhone('+256 414 123 456')).toBe('0414123456');
    expect(UG_FIXED_LINE.test('0414123456')).toBe(true);
    expect(UG_FIXED_LINE.test('0772123456')).toBe(false);
    expect(PHONE_FORMAT_MESSAGE).toMatch(/0414 123 456/);
  });

  it('lets a relative abroad order with an international number', () => {
    expect(normaliseCheckoutPhone('+254 712 345 678')).toBe('+254712345678');
    expect(normaliseCheckoutPhone('0044 20 7946 0958')).toBe('+442079460958');
  });

  it('checks the email only for shape, and an empty email is fine at the call site', () => {
    expect(looksLikeEmail('name@example.com')).toBe(true);
    expect(looksLikeEmail('not-an-email')).toBe(false);
    expect(looksLikeEmail('a@b')).toBe(false);
  });
});

describe('the same-day line is true for where the order is going', () => {
  const open = { closed: false, beforeCutoff: true, minsToCutoff: 185 };

  it('names the area until a district is chosen, and never promises "today" outside it', () => {
    const copy = sameDayCutoffCopy(open);
    expect(sameDayLineFor(copy, null)).toBe('Kampala & Wakiso: order in 3h 5m for same-day delivery');
    expect(sameDayLineFor(copy, 'Kampala')).toBe('Order in 3h 5m and this arrives today');
    expect(sameDayLineFor(copy, 'wakiso')).toBe('Order in 3h 5m and this arrives today');
    const arua = sameDayLineFor(copy, 'Arua');
    expect(arua).not.toMatch(/today/i);
    expect(arua).toMatch(/Kampala & Wakiso/);
  });

  it('the last hour is scoped the same way', () => {
    const copy = sameDayCutoffCopy({ closed: false, beforeCutoff: true, minsToCutoff: 40 });
    expect(copy.scoped).toMatch(/^Kampala & Wakiso: only 40 minutes/);
    expect(copy.outside).not.toMatch(/minutes/);
  });

  it('closed and after-cutoff lines are the same everywhere', () => {
    const closed = sameDayCutoffCopy({ closed: true, beforeCutoff: false, minsToCutoff: 0 });
    expect(new Set(Object.values(closed)).size).toBe(1);
    expect(isSameDayDistrict('Gulu')).toBe(false);
  });

  it('the cart and checkout both use it, and the checkout switches it on the chosen district', () => {
    const cart = read('apps/web/src/pages/cart.astro');
    const checkout = read('apps/web/src/pages/checkout.astro');
    expect(cart).toMatch(/sameDayCutoffCopy\(cut\)\.scoped/);
    expect(cart).not.toMatch(/and this arrives today`/);
    expect(checkout).toMatch(/data-in-area=\{sameDayCopy\.inArea\}/);
    expect(checkout).toMatch(/setCutoffFor\(district\)/);
  });
});

describe('validation points at the field it is about', () => {
  it('maps the API path to a form field, in our words', () => {
    expect(invalidCheckoutField('customerDetails.email: Invalid email')).toMatchObject({ field: 'email' });
    expect(invalidCheckoutField('customerDetails.phone: String must contain at least 5 character(s)')).toMatchObject({ field: 'phone' });
    expect(invalidCheckoutField('customerDetails.deliveryLocation.district: "X" is not a Uganda district.')).toMatchObject({ field: 'locationJson' });
    expect(invalidCheckoutField('items: Array must contain at least 1 element(s)')).toBeNull();
    expect(invalidCheckoutField('customerDetails.email: Invalid email')!.message).not.toMatch(/Invalid email/);
  });

  it('the unpinned fallback no longer claims fields are highlighted', () => {
    const out = customerMessageFor({ ok: false, status: 400, code: 'INVALID_CHECKOUT', message: 'x' });
    expect(out.message).not.toMatch(/highlighted/);
  });

  it('the page renders a focusable summary that links to each field', () => {
    const checkout = read('apps/web/src/pages/checkout.astro');
    expect(checkout).toMatch(/id="checkout-error-summary" role="alert" tabindex="-1"/);
    expect(checkout).toMatch(/getElementById\('checkout-error-summary'\)\?\.focus\(\)/);
    expect(checkout).toMatch(/errors\.phone = PHONE_FORMAT_MESSAGE/);
    expect(checkout).toMatch(/errorMessage=\{errors\.email\}/);
  });

  it('the location error is part of the input description', () => {
    const picker = read('apps/web/src/components/UgandaLocationPicker.astro');
    expect(picker).toMatch(/aria-describedby=\{describedBy\}/);
    expect(picker).toMatch(/id=\{errorId\}/);
  });
});

describe('the confirmation survives a refresh', () => {
  const sign = (d: string) => createHmac('sha256', 'test-secret').update(d).digest('base64url');
  const receipt: OrderReceipt = {
    v: 1,
    ref: 'GP-202609-8A776429',
    orderId: '5b0f0a4e-6f4b-4c35-9a53-1a2b3c4d5e6f',
    message: 'Our team will call you to confirm the total before you pay.',
    actionLabel: 'View & track this order',
    items: [{ name: 'Power bank', quantity: 2, lineTotalUgx: 370000 }],
    totalUgx: 370000,
    deliveryFeeConfirmed: false,
    deliveryPlace: 'Najjera, Wakiso',
    phoneMasked: maskPhone('0772 123 456'),
    issuedAt: 1_000_000,
  };

  it('round-trips a sealed receipt', () => {
    const sealed = sealOrderReceipt(receipt, sign);
    expect(openOrderReceipt(sealed, sign, 1_000_000 + 5_000)).toMatchObject({ ref: receipt.ref, totalUgx: 370000 });
  });

  it('refuses a tampered, foreign or expired receipt', () => {
    const sealed = sealOrderReceipt(receipt, sign);
    const [body, mac] = sealed.split('.');
    const forged = Buffer.from(JSON.stringify({ ...receipt, ref: 'GP-202609-FFFFFFFF' })).toString('base64url');
    expect(openOrderReceipt(`${forged}.${mac}`, sign, 1_000_000)).toBeNull();
    const other = (d: string) => createHmac('sha256', 'other').update(d).digest('base64url');
    expect(openOrderReceipt(`${body}.${mac}`, other, 1_000_000)).toBeNull();
    expect(openOrderReceipt(sealed, sign, 1_000_000 + ORDER_RECEIPT_MAX_AGE_SECONDS * 1000 + 1)).toBeNull();
    expect(openOrderReceipt('garbage', sign, 1_000_000)).toBeNull();
  });

  it('masks the phone and has no signer without a secret', () => {
    expect(maskPhone('0772 123 456')).toMatch(/456$/);
    expect(maskPhone('0772 123 456')).not.toMatch(/0772/);
    expect(orderReceiptSigner({})).toBeNull();
    expect(orderReceiptSigner({ JWT_SECRET: 'x' })).toBeTypeOf('function');
  });

  it('checkout redirects to its own confirmation page (Post/Redirect/Get)', () => {
    const checkout = read('apps/web/src/pages/checkout.astro');
    expect(checkout).toMatch(/return Astro\.redirect\(`\$\{ORDER_RECEIPT_PATH\}\?ref=/);
    const confirmed = read('apps/web/src/pages/checkout/confirmed.astro');
    expect(confirmed).toMatch(/title="Order received"/);
    expect(confirmed).toMatch(/openOrderReceipt\(/);
  });
});

describe('cart lines go somewhere real', () => {
  it('a line with no known slug is not a link to /products/', () => {
    expect(cartLineHref('')).toBeNull();
    expect(cartLineHref(undefined)).toBeNull();
    expect(cartLineHref('../admin')).toBeNull();
    expect(cartLineHref('gp-w5-power-bank')).toBe('/products/gp-w5-power-bank');
  });

  it('asks the catalogue by id, in the batches the public list accepts', () => {
    const ids = ['a', 'b', 'c', 'd', 'a', 'e', 'f', 'g'];
    expect(chunkIds(ids)).toEqual([['a', 'b', 'c'], ['d', 'e', 'f'], ['g']]);
    const cart = read('apps/web/src/pages/cart.astro');
    expect(cart).not.toMatch(/products\?limit=100/);
    expect(cart).toMatch(/products\?ids=\$\{ids\.join\(','\)\}/);
    expect(cart).not.toMatch(/href=\{`\/products\/\$\{item\.slug\}`\}/);
  });

  it('only a UUID ever reaches a redirect or an element id', () => {
    expect(isCartProductId('deb4ec61-94d8-4364-a7fe-d3c051657d3d')).toBe(true);
    expect(isCartProductId('x" onload="y')).toBe(false);
  });

  it('keeps the category written on the device', () => {
    const [line] = parseLocalCartCookie(JSON.stringify([{ productId: 'p', name: 'n', unitPriceUgx: 1, quantity: 1, slug: 's', categoryName: 'Power' }]));
    expect(line.categoryName).toBe('Power');
  });

  it('confirms an add, offers Undo on remove, and returns to the line after +/-', () => {
    const cart = read('apps/web/src/pages/cart.astro');
    expect(cart).toMatch(/\/cart\?added=\$\{productId\}/);
    expect(cart).toMatch(/\/cart\?removed=\$\{productId\}/);
    expect(cart).toMatch(/action === 'restore'/);
    expect(cart).toMatch(/#line-\$\{id\}/);
  });
});

describe('payment return and tracking tell one story', () => {
  it('cancelled payment pays the ORDER, not an emptied checkout', () => {
    const page = read('apps/web/src/pages/checkout/pesapal/cancelled.astro');
    expect(page).not.toMatch(/href="\/checkout"/);
    expect(page).not.toMatch(/If the checkout looks empty/);
    expect(page).toMatch(/\/track-order\?reference=/);
    expect(read('apps/web/src/pages/checkout.astro')).toMatch(/rememberPaymentOrder\(dto\.orderNumber\)/);
  });

  it('a failed payment is not described as "nothing was taken"', () => {
    const track = read('apps/web/src/pages/track-order.astro');
    expect(track).not.toMatch(/nothing was taken/);
    expect(track).toMatch(/If money left your phone or card, it will come back/);
    expect(track).not.toMatch(/<main/);
    expect(track).toMatch(/value=\{submittedContact\}/);
  });

  it('a clearing payment is re-checked, within a bound', () => {
    const cb = read('apps/web/src/pages/checkout/pesapal/callback.astro');
    expect(cb).toMatch(/MAX_CHECKS = 18/);
    expect(cb).toMatch(/return-state/);
  });
});

describe('checkout polish', () => {
  const checkout = read('apps/web/src/pages/checkout.astro');

  it('the back button cannot show "Place order" under a selected "Pay now"', () => {
    expect(checkout).not.toMatch(/const submitLabel =/);
    expect(checkout).toMatch(/window\.addEventListener\('pageshow'[\s\S]{0,300}resyncChoices\(\)/);
  });

  it('an unpriceable place says so instead of "pick a location"', () => {
    expect(checkout).toMatch(/Confirmed by phone before dispatch/);
    expect(checkout).not.toMatch(/we'll show your exact delivery fee/);
  });

  it('the directions link says what it is and that it opens a new tab', () => {
    const dq = read('apps/web/src/components/DeliveryQuote.astro');
    expect(dq).not.toMatch(/Collect free from our shop\s*\n\s*<span aria-hidden/);
    expect(dq).toMatch(/opens Google Maps in a new tab/);
  });
});
