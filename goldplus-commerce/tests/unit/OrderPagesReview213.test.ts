import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { orderProgressStage, orderReachedCustomer } from '../../apps/web/src/lib/orderProgress';

const read = (p: string) => readFileSync(path.resolve(__dirname, '../..', p), 'utf8');
const accountOrder = read('apps/web/src/pages/orders/[id].astro');
const track = read('apps/web/src/pages/track-order.astro');

describe('order pages agree (review 213)', () => {
  it('one stage mapping: an order awaiting owner review is still "placed"', () => {
    expect(orderProgressStage('pending_owner_review')).toBe(0);
    expect(orderProgressStage('received')).toBe(0);
    expect(orderProgressStage('PROCESSING')).toBe(1);
    expect(orderProgressStage('delivery_failed')).toBe(2);
    expect(orderProgressStage('DELIVERED')).toBe(3);
    expect(accountOrder).toMatch(/orderProgressStage\(statusKey\)/);
    expect(track).toMatch(/orderProgressStage/);
  });

  it('the return link reads the status case-insensitively', () => {
    expect(orderReachedCustomer('DELIVERED')).toBe(true);
    expect(orderReachedCustomer('completed')).toBe(true);
    expect(orderReachedCustomer('dispatched')).toBe(false);
    expect(accountOrder).toMatch(/\{orderReachedCustomer\(order\.status\) && \(/);
  });

  it('Pay on the account page uses the on-site payment page and remembers the order', () => {
    const pay = accountOrder.slice(accountOrder.indexOf('if (payRes.ok) {'), accountOrder.indexOf('payMessage = paymentStartMessageFor'));
    expect(pay).toMatch(/rememberPaymentOrder\(Astro\.cookies, order\.orderNumber/);
    expect(pay).toMatch(/Astro\.redirect\(onSitePaymentPath\(\{ redirectUrl: payRes\.data\.redirectUrl/);
  });
});
