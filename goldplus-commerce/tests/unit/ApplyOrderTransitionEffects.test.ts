import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApplyOrderTransitionEffectsUseCase,
  type OrderTransitionEffectsPorts,
  type OrderTransitionEvent,
} from '../../apps/api/src/application/use-cases/orders/ApplyOrderTransitionEffectsUseCase';
import { resetAppLogger, setAppLogger } from '../../apps/api/src/application/logging/appLogger';
import type { OrderTransitionContext } from '../../apps/api/src/application/ports/IOrderTransitionPort';
// Loaded at collection time, as the other real-Registry tests do: building it takes longer than one test's budget.
import { Registry } from '../../apps/api/src/infrastructure/Registry';

/**
 * Behaviour of the post-commit order lifecycle effects (moved out of the
 * Registry, 2026-11). Until the move these steps were pinned only by matching
 * the Registry's source text; these tests run them.
 */

const ORDER = 'order-1';
const BUYER = 'user-buyer';

/** Every port records its call, in order, into one log; behaviour is overridable per test. */
function harness(overrides: Partial<Record<string, (...args: any[]) => Promise<unknown>>> = {}) {
  const log: string[] = [];
  const calls: Record<string, unknown[][]> = {};
  const step = (name: string, fallback: (...args: any[]) => Promise<unknown>) => (...args: unknown[]) => {
    log.push(name);
    (calls[name] ??= []).push(args);
    return (overrides[name] ?? fallback)(...args);
  };
  const ok = async () => undefined;
  const ports: OrderTransitionEffectsPorts = {
    vestLoyaltyOnDeliveryUseCase: { execute: step('vest', ok) as never },
    consumeRedemptionUseCase: { settleOnDelivery: step('settleRedemption', ok) as never },
    loyaltyCompletionRepo: { findEarnEntryForOrder: step('findEarn', async () => ({ id: 'earn-9', points: 40 })) as never },
    orderRepo: { findLoyaltyEarnSource: step('findSource', async () => ({ userId: BUYER, totalUgx: 50_000 })) as never },
    loyaltyOutboxNotifier: { enqueue: step('notifyEarned', async () => 'sent') as never },
    gamificationRepo: { awardBadgeByKey: step('badge', async () => true) as never },
    evaluateGamificationForUserUseCase: { execute: step('evaluateGamification', ok) as never },
    grantDrawTokenUseCase: { execute: step('grantDraw', ok) as never },
    qualifyReferralOnDeliveryUseCase: { execute: step('qualifyReferral', async () => ({ ok: true, status: 'none' })) as never },
    reholdStockOnLatePaymentUseCase: { execute: step('rehold', ok) as never },
    applyFulfilmentStockEffectUseCase: { consumeForClosedOrder: step('consumeStock', ok) as never },
    releaseCancelledOrderHoldsUseCase: { execute: step('releaseHolds', ok) as never },
    clawbackOrderEarnUseCase: { execute: step('clawback', ok) as never },
    reverseRedemptionUseCase: { execute: step('reverseRedemption', ok) as never },
    reverseReferralOnRefundUseCase: { execute: step('reverseReferral', ok) as never },
    reverseDrawOnRefundUseCase: { execute: step('reverseDraw', ok) as never },
  };
  const enqueue = step('customerMessage', ok) as (orderId: string, template: string) => Promise<void>;
  const useCase = new ApplyOrderTransitionEffectsUseCase(ports, enqueue);
  return { useCase, ports, log, calls };
}

const event = (toStatus: OrderTransitionEvent['toStatus'], ctx: Partial<OrderTransitionContext> = {}): OrderTransitionEvent => ({
  orderId: ORDER,
  toStatus,
  ctx: { actorType: 'admin', source: 'admin_api', ...ctx } as OrderTransitionContext,
});

const errors: Array<{ obj: unknown; msg?: string }> = [];
beforeEach(() => {
  errors.length = 0;
  setAppLogger({ debug() {}, info() {}, warn() {}, error: (obj, msg) => { errors.push({ obj, msg }); } });
});
afterEach(() => resetAppLogger());

describe('a delivered order', () => {
  it('runs every delivery effect in the original order, then tells the customer', async () => {
    const { useCase, log, calls } = harness();
    await useCase.execute(event('delivered'));
    expect(log).toEqual([
      'vest', 'settleRedemption', 'findEarn', 'findSource', 'notifyEarned',
      'badge', 'evaluateGamification', 'grantDraw', 'qualifyReferral',
      'consumeStock', 'customerMessage',
    ]);
    expect(calls.notifyEarned[0][0]).toEqual({
      userId: BUYER, eventType: 'LOYALTY_POINTS_EARNED', idempotencyKey: 'earned:earn-9', data: { points: 40, orderId: ORDER },
    });
    expect(calls.badge[0]).toEqual([BUYER, 'first_order']);
    expect(calls.grantDraw[0][0]).toEqual({ trigger: 'order_delivered', userId: BUYER, sourceType: 'order', sourceId: ORDER });
    expect(calls.qualifyReferral[0][0]).toEqual({ orderId: ORDER, refereeUserId: BUYER });
    expect(calls.customerMessage[0]).toEqual([ORDER, 'ORDER_FULFILLMENT_COMPLETED']);
  });

  it('a counter collection (completed) gets the same effects and the collected message', async () => {
    const { useCase, log, calls } = harness();
    await useCase.execute(event('completed'));
    expect(log).toContain('vest');
    expect(log).toContain('consumeStock');
    expect(calls.customerMessage[0]).toEqual([ORDER, 'ORDER_COLLECTED']);
  });

  it('with no earn: no earned message, badge or scratch card, but the referral still qualifies', async () => {
    const { useCase, log } = harness({ findEarn: async () => null });
    await useCase.execute(event('delivered'));
    expect(log).not.toContain('notifyEarned');
    expect(log).not.toContain('badge');
    expect(log).not.toContain('grantDraw');
    expect(log).toContain('qualifyReferral');
  });

  it('an awarded referral re-evaluates the REFERRER', async () => {
    const { useCase, calls } = harness({ qualifyReferral: async () => ({ ok: true, status: 'awarded', referrerUserId: 'user-referrer' }) });
    await useCase.execute(event('delivered'));
    expect(calls.evaluateGamification.map((c) => c[0])).toEqual([{ userId: BUYER }, { userId: 'user-referrer' }]);
  });

  it('a failed vesting is logged and does not skip the steps after it', async () => {
    const { useCase, log } = harness({ vest: async () => { throw new Error('db blip'); } });
    await useCase.execute(event('delivered'));
    expect(errors.map((e) => e.msg)).toContain('LOYALTY_VEST_FAILED — points for this delivered order did not vest');
    expect(log.slice(1)).toEqual([
      'settleRedemption', 'findEarn', 'findSource', 'notifyEarned',
      'badge', 'evaluateGamification', 'grantDraw', 'qualifyReferral',
      'consumeStock', 'customerMessage',
    ]);
  });

  it('gamification failures never fail the transition', async () => {
    const boom = async () => { throw new Error('nope'); };
    const { useCase, log } = harness({ badge: boom, evaluateGamification: boom, grantDraw: boom, notifyEarned: boom });
    await expect(useCase.execute(event('delivered'))).resolves.toBeUndefined();
    expect(log).toContain('customerMessage');
  });
});

describe('payment and cancellation', () => {
  it('a paid move to processing re-holds stock; an unpaid one does not', async () => {
    const paid = harness();
    await paid.useCase.execute(event('processing', { paymentStatus: 'paid' }));
    expect(paid.log).toEqual(['rehold']);
    const unpaid = harness();
    await unpaid.useCase.execute(event('processing'));
    expect(unpaid.log).toEqual([]);
  });

  it('a shop cancellation releases the holds and tells the customer; their own does not message them', async () => {
    const byShop = harness();
    await byShop.useCase.execute(event('cancelled'));
    expect(byShop.log).toEqual(['releaseHolds', 'customerMessage']);
    expect(byShop.calls.customerMessage[0]).toEqual([ORDER, 'ORDER_CANCELLED_BY_SHOP']);
    const byCustomer = harness();
    await byCustomer.useCase.execute(event('cancelled', { actorType: 'customer' }));
    expect(byCustomer.log).toEqual(['releaseHolds']);
  });

  it('a dispatch only tells the customer', async () => {
    const { useCase, log, calls } = harness();
    await useCase.execute(event('dispatched'));
    expect(log).toEqual(['customerMessage']);
    expect(calls.customerMessage[0]).toEqual([ORDER, 'ORDER_DISPATCHED']);
  });

  it('a reversed payment reverses all four loyalty effects, each isolated', async () => {
    const { useCase, log, calls } = harness({ reverseRedemption: async () => { throw new Error('x'); }, reverseReferral: async () => { throw new Error('y'); } });
    await useCase.execute(event('cancelled', { paymentStatus: 'reversed', actorType: 'payment_provider' }));
    expect(log.slice(-4)).toEqual(['clawback', 'reverseRedemption', 'reverseReferral', 'reverseDraw']);
    expect(calls.clawback[0][0]).toEqual({ orderId: ORDER, actorId: null, actorType: 'system', reason: 'Payment reversed by provider' });
    expect(calls.reverseDraw[0][0]).toEqual({ orderId: ORDER, reason: 'Payment reversed by provider' });
    expect(errors.map((e) => e.msg)).toContain('loyalty referral reversal failed');
  });

  it('a customer message that cannot be queued is logged, not thrown', async () => {
    const { useCase } = harness({ customerMessage: async () => { throw new Error('outbox down'); } });
    await expect(useCase.execute(event('dispatched'))).resolves.toBeUndefined();
    expect(errors.find((e) => e.msg === 'CUSTOMER_ORDER_MESSAGE_ENQUEUE_FAILED')?.obj).toMatchObject({ orderId: ORDER, template: 'ORDER_DISPATCHED', err: 'outbox down' });
  });
});

describe('dependencies are read when a transition fires', () => {
  it('a port replaced after construction is the one used (as when this lived in the Registry)', async () => {
    const { useCase, ports } = harness();
    const replacement = vi.fn(async () => undefined);
    Object.defineProperty(ports, 'releaseCancelledOrderHoldsUseCase', { value: { execute: replacement } });
    await useCase.execute(event('cancelled', { actorType: 'customer' }));
    expect(replacement).toHaveBeenCalledWith(ORDER);
  });
});

describe('the real composition root', () => {
  it('registers the effects as an order transition subscriber, resolving members at fire time', async () => {
    const registry = Registry.getInstance();
    const release = vi.fn(async () => undefined);
    Object.defineProperty(registry, 'releaseCancelledOrderHoldsUseCase', { value: { execute: release }, configurable: true });
    // notify() is the post-commit fan-out OrderTransitionService runs after a committed move.
    await (registry.orderTransitionService as unknown as { notify: (id: string, to: string, ctx: OrderTransitionContext) => Promise<void> })
      .notify(ORDER, 'cancelled', { actorType: 'customer', source: 'customer' });
    expect(release).toHaveBeenCalledWith(ORDER);
  });
});
