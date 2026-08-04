import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateCheckoutPayload } from '../../apps/web/src/lib/checkout';

const read = (file: string) => readFileSync(resolve(__dirname, '../..', file), 'utf8');
const checkout = read('apps/web/src/pages/checkout.astro');

describe('Slice 03 checkout location and payment P0 protected contract', () => {
  it('requires delivery area and address before an order can be valid', () => {
    const result = validateCheckoutPayload({
      customerDetails: { name: 'Customer', phone: '0700000000', deliveryArea: '', deliveryAddress: '' },
      buyerType: 'retail',
      items: [{ productId: 'p1', quantity: 1 }],
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining(['Delivery area is required', 'Delivery address is required']));
  });

  it('uses the server cart subtotal as the displayed checkout total', () => {
    expect(checkout).toContain('{formatUgx(cart.subtotalUgx)}');
    // Delivery wave replaced the static "Calculated post-zone" copy with the
    // live estimate row. The protected part of the contract is unchanged: only
    // a CONFIRMED operator-zone fee may join the total the customer commits to.
    expect(checkout).toContain('id="delivery-estimate-value"');
    expect(checkout).toMatch(/kind === 'CONFIRMED'[\s\S]*?\? est\.feeUgx : 0|CONFIRMED' \? \(initialDeliveryEstimate\.feeUgx \?\? 0\) : 0|initialDeliveryEstimate\?\.kind === 'CONFIRMED' \? initialDeliveryEstimate\.feeUgx \?\? 0 : 0/);
  });

  it('keeps offline drafts unmistakably separate from submitted orders', () => {
    expect(checkout).toContain('Local Demo Mode Only');
    expect(checkout).toContain('Order was not submitted to the server.');
    expect(checkout).toContain('This order has <strong>not</strong> been submitted');
  });

  it('does not claim a payment succeeded or an order is paid', () => {
    // The loyalty preview honestly says points arrive "when this order is paid"
    // — a conditional future, not a success claim. The guard forbids CLAIMS of
    // completed payment, so the conditional form is carved out explicitly.
    expect(checkout).not.toMatch(/payment (?:complete|successful)|paid in full/i);
    expect(checkout).not.toMatch(/(?<!when (?:the|this) )order (?:is|was) paid/i);
  });

  it('tells the customer payment failed via a mapped code, not the API message', () => {
    // The page used to show `payRes.message` — the API's own internal error text,
    // including the server's missing PesaPal configuration. Every failure branch
    // now goes through paymentStartMessageFor, which is exhaustive over the typed
    // codes, so no case can fall through to a passed-through message.
    expect(checkout).toContain('paymentStartMessageFor(payRes.code)');
    expect(checkout).not.toContain('payRes.message');
  });
});
