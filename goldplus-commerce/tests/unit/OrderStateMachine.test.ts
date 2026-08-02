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
