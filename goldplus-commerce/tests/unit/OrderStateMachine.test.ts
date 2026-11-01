import { describe, it, expect } from 'vitest';
import { canTransitionOrder, isTerminalOrderStatus } from '../../apps/api/src/domain/commerce/OrderStateMachine';
import type { OrderStatus, PaymentStatus } from '../../apps/api/src/domain/commerce/Order';

const can = (from: OrderStatus, to: OrderStatus, paymentStatus: PaymentStatus = 'unpaid') =>
  canTransitionOrder(from, to, { paymentStatus });

describe('canTransitionOrder — order state machine', () => {
  it('allows the legal forward transitions', () => {
    expect(can('received', 'processing').allowed).toBe(true);
    expect(can('received', 'cancelled').allowed).toBe(true);
    expect(can('pending_owner_review', 'processing').allowed).toBe(true);
    expect(can('processing', 'completed').allowed).toBe(true);
    expect(can('processing', 'cancelled').allowed).toBe(true);
  });

  it('rejects skipping the machine and going backwards', () => {
    expect(can('received', 'completed').allowed).toBe(false);
    expect(can('completed', 'received').allowed).toBe(false);
    expect(can('processing', 'received').allowed).toBe(false);
  });

  it('treats completed/cancelled/failed as terminal', () => {
    for (const t of ['completed', 'cancelled', 'failed'] as OrderStatus[]) {
      expect(isTerminalOrderStatus(t)).toBe(true);
      expect(can(t, 'processing').allowed).toBe(false);
    }
  });

  it('will not process an unpaid order that is pending payment', () => {
    const unpaid = can('pending_payment', 'processing', 'unpaid');
    expect(unpaid.allowed).toBe(false);
    if (!unpaid.allowed) expect(unpaid.code).toBe('UNPAID');
    expect(can('pending_payment', 'processing', 'paid').allowed).toBe(true);
    // Cancelling an unpaid pending-payment order is always fine.
    expect(can('pending_payment', 'cancelled', 'unpaid').allowed).toBe(true);
  });

  it('rejects a no-op transition', () => {
    expect(can('processing', 'processing').allowed).toBe(false);
  });
});

describe('an order the customer chose to pay online is not processed unpaid (owner, 2026-10-15)', () => {
  const ctx = (o: { paymentStatus?: PaymentStatus; paymentMethod?: string | null; payOnDeliveryConfirmed?: boolean }) =>
    ({ paymentStatus: o.paymentStatus ?? 'unpaid', paymentMethod: o.paymentMethod ?? null, payOnDeliveryConfirmed: o.payOnDeliveryConfirmed });

  it('refuses an unpaid PesaPal order, from received and from owner review', () => {
    for (const from of ['received', 'pending_owner_review'] as const) {
      const r = canTransitionOrder(from, 'processing', ctx({ paymentMethod: 'pesapal' }));
      expect(r, from).toMatchObject({ allowed: false, code: 'UNPAID_ONLINE' });
      expect(!r.allowed && r.message, from).toMatch(/re-verify the payment|pay on delivery or at the shop/);
    }
  });

  it('allows it once paid, or once a person confirms pay on delivery / at the shop', () => {
    expect(canTransitionOrder('received', 'processing', ctx({ paymentMethod: 'pesapal', paymentStatus: 'paid' })).allowed).toBe(true);
    expect(canTransitionOrder('received', 'processing', ctx({ paymentMethod: 'pesapal', payOnDeliveryConfirmed: true })).allowed).toBe(true);
  });

  it('pay-on-delivery and older orders with no method are unchanged', () => {
    expect(canTransitionOrder('received', 'processing', ctx({ paymentMethod: 'offline' })).allowed).toBe(true);
    expect(canTransitionOrder('received', 'processing', ctx({ paymentMethod: null })).allowed).toBe(true);
  });

  it('only the move INTO processing is gated (cancelling an unpaid online order still works)', () => {
    expect(canTransitionOrder('received', 'cancelled', ctx({ paymentMethod: 'pesapal' })).allowed).toBe(true);
  });
});
