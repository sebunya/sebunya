import { describe, expect, it } from 'vitest';
import {
  orderStatusMeta,
  paymentStatusMeta,
  isAwaitingPayment,
} from '../../packages/shared/src/types/order-presentation';
import type { OrderStatus, PaymentStatus } from '../../packages/shared/src/types/account';

// The exact set of values the domain (apps/api/src/domain/commerce/Order.ts)
// can produce. If the domain grows a status, this test forces us to give it
// a label/tone rather than silently falling back.
const ALL_ORDER_STATUSES: OrderStatus[] = [
  'received',
  'pending_payment',
  'pending_owner_review',
  'processing',
  'completed',
  'cancelled',
  'failed',
];
const ALL_PAYMENT_STATUSES: PaymentStatus[] = ['unpaid', 'pending', 'paid', 'failed'];

const VALID_TONES = new Set(['neutral', 'info', 'success', 'warning', 'danger']);

describe('order status presentation', () => {
  it('gives every real order status a non-fallback label and valid tone', () => {
    for (const status of ALL_ORDER_STATUSES) {
      const meta = orderStatusMeta(status);
      expect(meta.label, `${status} needs a label`).not.toBe('Unknown');
      expect(meta.label).not.toContain('_');
      expect(VALID_TONES.has(meta.tone), `${status} tone`).toBe(true);
    }
  });

  it('gives every payment status a label and valid tone', () => {
    for (const status of ALL_PAYMENT_STATUSES) {
      const meta = paymentStatusMeta(status);
      expect(meta.label).toBeTruthy();
      expect(VALID_TONES.has(meta.tone)).toBe(true);
    }
  });

  it('uses sensible tones for terminal and in-progress states', () => {
    expect(orderStatusMeta('completed').tone).toBe('success');
    expect(orderStatusMeta('failed').tone).toBe('danger');
    expect(orderStatusMeta('pending_payment').tone).toBe('warning');
    expect(paymentStatusMeta('paid').tone).toBe('success');
    expect(paymentStatusMeta('failed').tone).toBe('danger');
  });

  it('humanises unexpected raw values instead of showing them raw', () => {
    const meta = orderStatusMeta('in_transit');
    expect(meta.label).toBe('In transit');
    expect(meta.tone).toBe('neutral');
  });

  it('detects awaiting-payment states', () => {
    expect(isAwaitingPayment('unpaid')).toBe(true);
    expect(isAwaitingPayment('pending')).toBe(true);
    expect(isAwaitingPayment('paid')).toBe(false);
    expect(isAwaitingPayment('failed')).toBe(false);
  });
});
