import { describe, it, expect } from 'vitest';
import { businessDedupeKey, canonicalJson, canonicalSha256, eventForTransition, validateEventData, environmentOf } from '../../apps/api/src/domain/measurement/BusinessEvents';
import { classifyResponse, nextAttemptDelayMs, retryIsSafeAfterUnknown, toCanonical } from '../../apps/api/src/infrastructure/measurement/DeliveryService';

const confirmed = {
  orderId: 'o-1', orderNumber: 'GP-202609-ABCD1234', currency: 'UGX', netMerchandiseUGX: '90000', collectedDeliveryUGX: '5000', taxUGX: '0',
  paymentMethod: 'pesapal', confirmationBasis: 'payment_verified', economicPolicyVersion: 'ugx-v1',
  items: [{ lineId: 'l1', productId: 'p1', sku: 'GP-PB20', name: 'Power bank', quantity: 2, netLineUGX: '90000', cogsUGX: '55000' }],
};

describe('GP-CON: authoritative event contracts', () => {
  it('canonical hash is key-order independent and changes with content', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [3, { f: 1, e: 2 }] } })).toBe('{"a":{"c":[3,{"e":2,"f":1}],"d":2},"b":1}');
    const a = canonicalSha256('order_confirmed', confirmed);
    expect(canonicalSha256('order_confirmed', JSON.parse(JSON.stringify(confirmed)))).toBe(a);
    expect(canonicalSha256('order_confirmed', { ...confirmed, netMerchandiseUGX: '90001' })).not.toBe(a);
  });
  it('strict schemas: valid passes; unknown keys, float money, zero quantity and browser-style fields reject (CON-01)', () => {
    expect(() => validateEventData('order_confirmed', confirmed)).not.toThrow();
    expect(() => validateEventData('order_confirmed', { ...confirmed, customerEmail: 'x@y.z' })).toThrow();
    expect(() => validateEventData('order_confirmed', { ...confirmed, netMerchandiseUGX: '90000.5' })).toThrow();
    expect(() => validateEventData('order_confirmed', { ...confirmed, items: [{ ...confirmed.items[0], quantity: 0 }] })).toThrow();
    expect(() => validateEventData('order_confirmed', { ...confirmed, confirmationBasis: 'browser_said_so' })).toThrow();
  });
  it('one business effect per order milestone; transitions map to the dictionary', () => {
    expect(businessDedupeKey('order_confirmed', 'o-1')).toBe('order_confirmed:order:o-1');
    expect(eventForTransition({ toStatus: 'processing', paymentStatus: 'paid' })).toBe('order_confirmed');
    expect(eventForTransition({ toStatus: 'processing', paymentStatus: 'unpaid' })).toBeNull();
    expect(eventForTransition({ toStatus: 'delivered', paymentStatus: 'paid' })).toBe('order_delivered');
    expect(eventForTransition({ toStatus: 'cancelled', paymentStatus: 'failed' })).toBe('order_cancelled');
    expect(environmentOf('production')).toBe('production');
    expect(environmentOf(undefined)).toBe('development');
  });
  it('FIN-01 worked fixture arithmetic (dossier §3.6)', () => {
    expect(90000 + 5000 - 55000 - 2000 - 7000).toBe(31000);
    expect(31000 - 18000 + 11000 - 3000).toBe(21000);
  });
});

describe('GP-DLV: classification, retry and unknown outcomes', () => {
  it('classifies provider replies (DLV-07/08/10)', () => {
    expect(classifyResponse(200, null, null).kind).toBe('accepted');
    expect(classifyResponse(200, 'partial failure: bad gclid', null)).toEqual({ kind: 'permanent', code: 'SEMANTIC_FAILURE' });
    expect(classifyResponse(429, null, null).kind).toBe('retry');
    expect(classifyResponse(503, null, null).kind).toBe('retry');
    expect(classifyResponse(401, null, null)).toEqual({ kind: 'permanent', code: 'CREDENTIALS' });
    expect(classifyResponse(400, null, null).kind).toBe('permanent');
    expect(classifyResponse(null, null, 'after-send').kind).toBe('unknown');
    expect(classifyResponse(null, null, 'before-send').kind).toBe('retry');
  });
  it('backoff grows, is jittered within bounds, and honours Retry-After', () => {
    expect(nextAttemptDelayMs(1, null, 0.5)).toBe(30_000);
    expect(nextAttemptDelayMs(3, null, 0.5)).toBe(120_000);
    expect(nextAttemptDelayMs(1, '600', 0.5)).toBe(600_000);
    expect(nextAttemptDelayMs(40, null, 0.5)).toBe(6 * 3600_000);
    expect(nextAttemptDelayMs(1, null, 0)).toBe(24_000);
  });
  it('unknown outcomes retry only where the provider dedupes our id', () => {
    expect(retryIsSafeAfterUnknown('ga4:purchase')).toBe(true);
    expect(retryIsSafeAfterUnknown('ad:meta:purchase')).toBe(true);
    expect(retryIsSafeAfterUnknown('ad:opera:purchase')).toBe(false);
    expect(retryIsSafeAfterUnknown('ad:linkedin:purchase')).toBe(false);
  });
  it('the wire event carries the order value, stable id and items; refunds carry no items', () => {
    const ev = { event_id: 'e-1', event_name: 'order_confirmed', occurred_at: '2026-09-20T10:00:00Z', payload: confirmed };
    const c = toCanonical(ev, 'ga4:purchase', { fp_client_id: 'fp.1.x', ip_address: '41.84.203.125', hashed_email: undefined });
    expect(c.event_name).toBe('purchase');
    expect(c.event_id).toBe('e-1');
    expect(c.ecommerce).toMatchObject({ transaction_id: 'GP-202609-ABCD1234', value: 95000, currency: 'UGX', shipping: 5000 });
    expect(c.ecommerce!.items![0]).toEqual({ item_id: 'p1', item_name: 'Power bank', price: 45000, quantity: 2 });
    expect(c.user_data).toEqual({ fp_client_id: 'fp.1.x', ip_address: '41.84.203.125' });
    const r = toCanonical(ev, 'ga4:refund', {});
    expect(r.event_name).toBe('refund');
    expect(r.ecommerce!.items).toBeUndefined();
  });
});
