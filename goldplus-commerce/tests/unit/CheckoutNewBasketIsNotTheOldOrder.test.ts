import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A customer abandons the PesaPal page (the intent stays on that unpaid order) and builds a DIFFERENT basket.
 * Checkout answered CHECKOUT_ALREADY_ORDERED, and the page treated the new basket as the old order: "pay now"
 * charged the OLD order's amount, and pay on delivery sealed a receipt listing the NEW items under the old order
 * number while no order existed for them. Same items with only a detail changed is still that order.
 */
const page = readFileSync(join(__dirname, '../../apps/web/src/pages/checkout.astro'), 'utf8');

vi.mock('../../apps/web/src/lib/checkoutIntent', () => ({ clearCheckoutIntent: vi.fn() }));

describe('a different basket under an unpaid order', () => {
  const different = page.slice(page.indexOf("result.existingOrder.sameItems === false"), page.indexOf("// The SAME items as the order this checkout already made"));

  it('never pays the old order, never shows the received screen or seals its receipt', () => {
    expect(different.length).toBeGreaterThan(200);
    expect(different).not.toMatch(/startPayment\(/);
    expect(different).not.toMatch(/status = 'received'/);
    expect(different).toMatch(/status = 'error'/);
    expect(different).toMatch(/offerNewOrder = true/);
    expect(different).toMatch(/track-order\?reference=/);
  });

  it('offers placing this basket as a new order, by an explicit same-origin POST', () => {
    expect(page).toMatch(/\{offerNewOrder && \(\s*<form method="POST" action="\/checkout\/new-order"/);
  });

  it('the same items (a changed address or payment method) still pay or confirm THAT order', () => {
    const same = page.slice(page.indexOf("// The SAME items as the order this checkout already made"), page.indexOf("result.code === 'STOCK_NOT_RESERVED'"));
    expect(same).toMatch(/startPayment\(\{\s*orderId: existing\.orderId/);
  });
});

describe('/checkout/new-order', () => {
  it('drops the intent only for a same-origin POST, then returns to checkout', async () => {
    const { clearCheckoutIntent } = await import('../../apps/web/src/lib/checkoutIntent');
    const { POST } = await import('../../apps/web/src/pages/checkout/new-order');
    const call = (headers: Record<string, string>) =>
      POST({ request: new Request('https://shopgoldplus.com/checkout/new-order', { method: 'POST', headers }), cookies: {} } as never) as Response;
    const ok = call({ 'sec-fetch-site': 'same-origin', origin: 'https://shopgoldplus.com' });
    expect(ok.status).toBe(303);
    expect(ok.headers.get('Location')).toBe('/checkout?new_order=1');
    expect(clearCheckoutIntent).toHaveBeenCalledTimes(1);
    const cross = call({ 'sec-fetch-site': 'cross-site', origin: 'https://evil.example' });
    expect(cross.headers.get('Location')).toBe('/checkout');
    expect(clearCheckoutIntent).toHaveBeenCalledTimes(1);
  });
});
