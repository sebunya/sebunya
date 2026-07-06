import { pointsForPaidAmount } from '../../../domain/loyalty/Loyalty';
import {
  ILoyaltyLedgerRepository,
  ILoyaltyOrderLookup,
  LoyaltyLedgerEntry,
} from '../../ports/ILoyaltyLedgerRepository';

export type AwardOrderLoyaltyPointsResult =
  | { ok: true; entry: LoyaltyLedgerEntry; replay: false }
  | { ok: true; entry: LoyaltyLedgerEntry; replay: true }
  | { ok: false; code: 'ORDER_NOT_FOUND' | 'NO_POINTS'; message: string };

/**
 * Awards loyalty points for a successfully paid order.
 *
 * Idempotent per order: replays (e.g. duplicate payment webhooks) return
 * the existing ledger entry instead of double-crediting.
 */
export class AwardOrderLoyaltyPointsUseCase {
  constructor(
    private readonly ledger: ILoyaltyLedgerRepository,
    private readonly orders: ILoyaltyOrderLookup
  ) {}

  async execute(input: { orderId: string }): Promise<AwardOrderLoyaltyPointsResult> {
    const existing = await this.ledger.findByOrderAndReason(input.orderId, 'ORDER_PAID');
    if (existing) {
      return { ok: true, entry: existing, replay: true };
    }

    const order = await this.orders.findLoyaltyTarget(input.orderId);
    if (!order) {
      return { ok: false, code: 'ORDER_NOT_FOUND', message: `Order ${input.orderId} not found.` };
    }

    const points = pointsForPaidAmount(order.totalAmount);
    if (points <= 0) {
      return { ok: false, code: 'NO_POINTS', message: 'Order amount is below the minimum earn threshold.' };
    }

    const entry = await this.ledger.append({
      userId: order.userId,
      orderId: order.orderId,
      points,
      reason: 'ORDER_PAID',
      description: `Earned on paid order (${order.totalAmount} UGX).`,
    });

    return { ok: true, entry, replay: false };
  }
}
