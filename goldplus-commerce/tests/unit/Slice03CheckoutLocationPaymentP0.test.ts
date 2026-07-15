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
    expect(checkout).toContain('Calculated post-zone');
  });

  it('keeps offline drafts unmistakably separate from submitted orders', () => {
    expect(checkout).toContain('Local Demo Mode Only');
    expect(checkout).toContain('Order was not submitted to the server.');
    expect(checkout).toContain('This order has <strong>not</strong> been submitted');
  });

  it('does not claim a payment succeeded or an order is paid', () => {
    expect(checkout).not.toMatch(/payment (?:complete|successful)|order (?:is|was) paid|paid in full/i);
    expect(checkout).toContain('We could not start payment. Please try again or contact support.');
  });
});
