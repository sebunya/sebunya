import type { OrderStatus } from '../../../domain/commerce/Order';
import type { OrderTransitionContext } from '../../ports/IOrderTransitionPort';
import type { ILoyaltyCompletionRepository } from '../../ports/ILoyaltyCompletion';
import { appLogger } from '../../logging/appLogger';
import { customerMessageForTransition } from '../../notifications/OrderLifecycleMessages';
import type {
  VestLoyaltyOnDeliveryUseCase,
  ConsumeRedemptionUseCase,
  ClawbackOrderEarnUseCase,
  ReverseRedemptionUseCase,
  ReverseReferralOnRefundUseCase,
} from '../loyalty/LoyaltyCompletionUseCases';
import type { EvaluateGamificationForUserUseCase, QualifyReferralOnDeliveryUseCase } from '../loyalty/LoyaltyGamificationUseCases';
import type { GrantDrawTokenUseCase, ReverseDrawOnRefundUseCase } from '../loyalty/LoyaltyDrawUseCases';
import type { ReholdStockOnLatePaymentUseCase } from '../payments/ReholdStockOnLatePaymentUseCase';
import type { ApplyFulfilmentStockEffectUseCase } from '../inventory/ApplyFulfilmentStockEffectUseCase';
import type { ReleaseCancelledOrderHoldsUseCase } from '../commerce/ReleaseCancelledOrderHoldsUseCase';

/** One committed order-status move, as the canonical OrderTransitionService reports it. */
export interface OrderTransitionEvent {
  orderId: string;
  toStatus: OrderStatus;
  ctx: OrderTransitionContext;
}

/**
 * What the order lifecycle effects reach for. The names are the composition
 * root's own member names, and the composition root passes ITSELF: every
 * dependency is read when a transition fires, not when the subscriber is
 * registered, exactly as the subscriber did when it lived inside the Registry
 * (a member replaced after construction is the one used).
 */
export interface OrderTransitionEffectsPorts {
  readonly vestLoyaltyOnDeliveryUseCase: Pick<VestLoyaltyOnDeliveryUseCase, 'execute'>;
  readonly consumeRedemptionUseCase: Pick<ConsumeRedemptionUseCase, 'settleOnDelivery'>;
  readonly loyaltyCompletionRepo: Pick<ILoyaltyCompletionRepository, 'findEarnEntryForOrder'>;
  readonly orderRepo: { findLoyaltyEarnSource(orderId: string): Promise<{ userId: string } | null> };
  readonly loyaltyOutboxNotifier: {
    enqueue(input: { userId: string; eventType: 'LOYALTY_POINTS_EARNED'; idempotencyKey: string; data: Record<string, unknown> }): Promise<unknown>;
  };
  readonly gamificationRepo: { awardBadgeByKey(userId: string, badgeKey: string): Promise<unknown> };
  readonly evaluateGamificationForUserUseCase: Pick<EvaluateGamificationForUserUseCase, 'execute'>;
  readonly grantDrawTokenUseCase: Pick<GrantDrawTokenUseCase, 'execute'>;
  readonly qualifyReferralOnDeliveryUseCase: Pick<QualifyReferralOnDeliveryUseCase, 'execute'>;
  readonly reholdStockOnLatePaymentUseCase: Pick<ReholdStockOnLatePaymentUseCase, 'execute'>;
  readonly applyFulfilmentStockEffectUseCase: Pick<ApplyFulfilmentStockEffectUseCase, 'consumeForClosedOrder'>;
  readonly releaseCancelledOrderHoldsUseCase: Pick<ReleaseCancelledOrderHoldsUseCase, 'execute'>;
  readonly clawbackOrderEarnUseCase: Pick<ClawbackOrderEarnUseCase, 'execute'>;
  readonly reverseRedemptionUseCase: Pick<ReverseRedemptionUseCase, 'execute'>;
  readonly reverseReferralOnRefundUseCase: Pick<ReverseReferralOnRefundUseCase, 'execute'>;
  readonly reverseDrawOnRefundUseCase: Pick<ReverseDrawOnRefundUseCase, 'execute'>;
}

/** One customer order message through the outbox (the composition root owns the order read and the switch). */
export type EnqueueCustomerOrderMessage = (orderId: string, template: string) => Promise<void>;

/**
 * Loyalty ↔ order lifecycle wiring (loyalty brief PARTs F–G), registered
 * once at construction. Post-commit, isolated, idempotent:
 *  - delivered/completed → vest points (signed-in retail orders paid online or cash on delivery —
 *    domain/loyalty/LoyaltyEarnEligibility) and
 *    consume any COD redemption reservation attached to the order
 *  - cancelled → release any open points reservation (points never eaten)
 *    and any stock the order still holds
 *  - payment reversed (chargeback/refund) → claw back the earn in full and
 *    reverse an applied redemption, points returning with original expiry.
 *
 * Moved out of the composition root unchanged (2026-11 refactor): the steps,
 * their order, what each one catches and what it lets through are exactly as
 * they were in `Registry.registerOrderTransitionSubscribers`.
 */
export class ApplyOrderTransitionEffectsUseCase {
  constructor(
    private readonly ports: OrderTransitionEffectsPorts,
    private readonly enqueueCustomerOrderMessage: EnqueueCustomerOrderMessage,
  ) {}

  async execute({ orderId, toStatus, ctx }: OrderTransitionEvent): Promise<void> {
    if (toStatus === 'delivered' || toStatus === 'completed') {
      // Isolated like every step after it. Un-caught, one transient DB error
      // here skipped redemption settlement, the earned SMS, badges, referral
      // qualification and the scratch card for this order, permanently —
      // this subscriber runs once, after commit, and nothing re-runs it.
      await this.ports.vestLoyaltyOnDeliveryUseCase.execute(orderId).catch((err: unknown) =>
        appLogger.error({ orderId, err }, 'LOYALTY_VEST_FAILED — points for this delivered order did not vest'));
      // A failure is reported and the stuck reservation released (settleOnDelivery).
      await this.ports.consumeRedemptionUseCase.settleOnDelivery(orderId).catch(() => undefined);
      // PART M: earn confirmation when points VEST, not when the order is
      // placed. Enqueued only when an earn actually landed for this order.
      const earn = await this.ports.loyaltyCompletionRepo.findEarnEntryForOrder(orderId).catch(() => null);
      // A paid retail order by a customer, whether or not it earned points (a paused budget, a zero earn).
      const orderSource = await this.ports.orderRepo.findLoyaltyEarnSource(orderId).catch(() => null);
      const source = earn ? orderSource : null;
      if (earn && source) {
        await this.ports.loyaltyOutboxNotifier
          .enqueue({
            userId: source.userId,
            eventType: 'LOYALTY_POINTS_EARNED',
            idempotencyKey: `earned:${earn.id}`,
            data: { points: earn.points, orderId },
          })
          .catch(() => undefined);
      }
      // Gamification (0087): a delivery is the verified completion event —
      // first-order badge, mission progress, referral qualification. Every
      // award inside is idempotent; a gamification failure never fails the
      // order transition.
      if (source) {
        await this.ports.gamificationRepo.awardBadgeByKey(source.userId, 'first_order').catch(() => undefined);
        await this.ports.evaluateGamificationForUserUseCase.execute({ userId: source.userId }).catch(() => undefined);

        // 0088: a delivered order grants ONE scratch card. Idempotent on the
        // order id, so a replayed transition never mints a second card.
        await this.ports.grantDrawTokenUseCase
          .execute({ trigger: 'order_delivered', userId: source.userId, sourceType: 'order', sourceId: orderId })
          .catch(() => undefined);
      }
      // Referral qualification on EVERY paid retail delivery, not only one that earned points (2026-10-22): a
      // friend's first delivery that earned nothing used to skip it, and the referral then stayed pending forever.
      if (orderSource) {
        const referral = await this.ports.qualifyReferralOnDeliveryUseCase.execute({ orderId, refereeUserId: orderSource.userId })
          .catch((err: unknown) => { appLogger.error({ orderId, err: err instanceof Error ? err.message : String(err) }, 'referral qualification failed'); return undefined; });
        // An awarded referral is the referrer's completion event (REFERRAL_COUNT, 0174).
        if (referral?.ok && referral.status === 'awarded' && referral.referrerUserId) {
          await this.ports.evaluateGamificationForUserUseCase.execute({ userId: referral.referrerUserId }).catch(() => undefined);
        }
      }
    }
    if (toStatus === 'processing' && ctx.paymentStatus === 'paid') {
      // Paid after the stock hold expired: hold it again, or flag it.
      await this.ports.reholdStockOnLatePaymentUseCase.execute(orderId)
        .catch((err: unknown) => appLogger.error({ orderId, err: err instanceof Error ? err.message : String(err) }, 'late-payment stock re-hold failed'));
    }
    if (toStatus === 'delivered' || toStatus === 'completed') {
      // Goods that left the shop use up their reservation. Dispatch consumes
      // at READY_FOR_DISPATCH, but an order closed without dispatch (a
      // counter collection, processing → completed) never did: its units
      // stayed reserved for good, and cancelling the stranded task later
      // put goods already gone back on sale. A no-op once consumed.
      await this.ports.applyFulfilmentStockEffectUseCase.consumeForClosedOrder(orderId);
    }
    if (toStatus === 'cancelled') {
      // Stock as well as points: idempotent, isolated, never fails the transition.
      await this.ports.releaseCancelledOrderHoldsUseCase.execute(orderId);
    }
    // The customer hears about the moves that change what they should
    // expect (owner, 2026-09-24): dispatched, delivered, cancelled.
    const lifecycleMessage = customerMessageForTransition(toStatus, ctx.actorType);
    if (lifecycleMessage) {
      await this.enqueueCustomerOrderMessage(orderId, lifecycleMessage).catch((err: unknown) =>
        appLogger.error({ orderId, template: lifecycleMessage, err: err instanceof Error ? err.message : String(err) }, 'CUSTOMER_ORDER_MESSAGE_ENQUEUE_FAILED'));
    }
    if (ctx.paymentStatus === 'reversed') {
      await this.ports.clawbackOrderEarnUseCase
        .execute({ orderId, actorId: null, actorType: 'system', reason: 'Payment reversed by provider' })
        .catch(() => undefined);
      await this.ports.reverseRedemptionUseCase.execute({ orderId, reason: 'Payment reversed by provider' }).catch(() => undefined);
      await this.ports.reverseReferralOnRefundUseCase.execute({ orderId, reason: 'Payment reversed by provider' })
        .catch((err: unknown) => appLogger.error({ orderId, err: err instanceof Error ? err.message : String(err) }, 'loyalty referral reversal failed'));
      await this.ports.reverseDrawOnRefundUseCase.execute({ orderId, reason: 'Payment reversed by provider' })
        .catch((err: unknown) => appLogger.error({ orderId, err: err instanceof Error ? err.message : String(err) }, 'loyalty scratch card reversal failed'));
    }
  }
}
