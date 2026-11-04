import { verifyOrderByContact, type VerifiableOrder } from '../../services/OrderContactVerification';
import type { FailureLockoutStore } from '../../ports/FailureLockoutStore';

/**
 * Baymard A1 (docs/ux/BAYMARD.md): the account offered after a guest order keeps that order. Registration itself
 * never claims past orders by phone (RegisterCustomerUseCase explains why: the phone is unverified). This is the
 * one narrow exception, and it needs the same proof as order tracking: the order number plus the phone or email
 * the order was placed with, under the shared lockout. An order that already belongs to another account is never
 * moved. Idempotent: claiming your own order again says so.
 */
export type ClaimOutcome = 'claimed' | 'already_yours' | 'taken' | 'missing';

export interface IOrderClaimRepository {
  /** Sets orders.user_id when it is null; reports what it found otherwise. */
  claimForUser(orderId: string, userId: string): Promise<ClaimOutcome>;
}

export type ClaimOrderResult =
  | { ok: true; outcome: 'claimed' | 'already_yours'; orderId: string; orderNumber: string }
  | { ok: false; status: 400 | 401 | 409 | 429; code: 'VERIFICATION_FAILED' | 'TOO_MANY_REQUESTS' | 'ORDER_TAKEN'; message: string };

export class ClaimOrderUseCase<O extends VerifiableOrder = VerifiableOrder> {
  constructor(
    private readonly claims: IOrderClaimRepository,
    private readonly lockout: FailureLockoutStore,
    private readonly findOrder: (reference: string) => Promise<O | null>,
  ) {}

  async execute(input: { userId: string; reference: unknown; contact: unknown; now?: number }): Promise<ClaimOrderResult> {
    const verified = await verifyOrderByContact(
      { reference: input.reference, contact: input.contact, now: input.now ?? Date.now() },
      { lockout: this.lockout, findOrder: this.findOrder },
    );
    if (!verified.ok) return { ok: false, status: verified.status, code: verified.code, message: verified.message };
    const outcome = await this.claims.claimForUser(verified.order.id, input.userId);
    if (outcome === 'claimed' || outcome === 'already_yours') {
      return { ok: true, outcome, orderId: verified.order.id, orderNumber: verified.order.orderNumber };
    }
    if (outcome === 'taken') {
      return { ok: false, status: 409, code: 'ORDER_TAKEN', message: 'That order is already on another account.' };
    }
    return { ok: false, status: 401, code: 'VERIFICATION_FAILED', message: 'We could not verify that order. Please check your reference and contact details.' };
  }
}
