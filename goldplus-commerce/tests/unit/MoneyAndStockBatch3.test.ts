import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { refundsProvenByReversal, refundedShareBps } from '../../apps/api/src/infrastructure/db/repositories/DrizzleRefundLedgerRepository';
import { cancellationCarriesGa4Refund, refundCarriesGa4Refund } from '../../apps/api/src/infrastructure/measurement/DeliveryService';
import { ApplyRefundConsequencesUseCase, readRefund } from '../../apps/api/src/application/use-cases/payments/ApplyRefundConsequencesUseCase';
import { RefundPesaPalPaymentUseCase, ResolveRefundUseCase } from '../../apps/api/src/application/use-cases/payments/RefundPesaPalPaymentUseCase';
import { VerifyPesaPalPaymentUseCase } from '../../apps/api/src/application/use-cases/payments/VerifyPesaPalPaymentUseCase';
import { ReconcilePendingPaymentsUseCase } from '../../apps/api/src/application/use-cases/payments/ReconcilePendingPaymentsUseCase';
import {
  ClawbackOrderEarnUseCase,
  RunLoyaltyDailySweepUseCase,
  VestLoyaltyOnDeliveryUseCase,
} from '../../apps/api/src/application/use-cases/loyalty/LoyaltyCompletionUseCases';
import { ReleaseCancelledOrderHoldsUseCase } from '../../apps/api/src/application/use-cases/commerce/ReleaseCancelledOrderHoldsUseCase';
import { StartOrderPaymentUseCase } from '../../apps/api/src/application/use-cases/commerce/StartOrderPaymentUseCase';
import { ApplyFulfilmentStockEffectUseCase } from '../../apps/api/src/application/use-cases/inventory/ApplyFulfilmentStockEffectUseCase';
import { checkOrderStock, reconcileCommerce } from '../../apps/api/src/domain/commerce/CommerceIntegrity';
import { sameCatalogueSnapshot } from '../../apps/api/src/infrastructure/db/repositories/DrizzlePimImportRepository';
import { computeBalance, computeExpirableEarns, LoyaltyLedgerEntry } from '../../apps/api/src/domain/loyalty/LoyaltyLedger';
import { confirmationForPlacedOrder, customerMessageForTransition } from '../../apps/api/src/application/notifications/OrderLifecycleMessages';
import { MAX_LINE_QUANTITY } from '../../apps/api/src/application/use-cases/commerce/MutateCartUseCase';
import { DomainError } from '../../apps/api/src/domain/errors/DomainError';

/**
 * Batch 3 (money and stock), 2026-09-24. One block per finding, so a
 * regression names the finding it reopened.
 */
const ROOT = resolve(__dirname, '../..');
const read = (f: string) => readFileSync(resolve(ROOT, f), 'utf8');
const audit = () => ({ entries: [] as any[], async save(e: any) { this.entries.push(e); return e; } });

const attempt = {
  id: 'att-1', orderId: 'order-1', merchantReference: 'ref-1', orderTrackingId: 'trk-1', amount: 200_000, currency: 'UGX',
  status: 'completed', redirectUrl: null, provider: 'pesapal', ipnReceivedAt: null, callbackReceivedAt: null, createdAt: new Date(), updatedAt: new Date(),
};

describe('a REVERSED status settles only the refund it can be about', () => {
  it('settles the single outstanding accepted refund on the first observation', () => {
    expect(refundsProvenByReversal(['r1'], 0)).toEqual(['r1']);
  });
  it('settles nothing when two are outstanding: the status names neither', () => {
    expect(refundsProvenByReversal(['r1', 'r2'], 0)).toEqual([]);
  });
  it('settles nothing once a refund on the attempt already landed: REVERSED stays set', () => {
    expect(refundsProvenByReversal(['r3'], 1)).toEqual([]);
  });
  it('the poll no longer passes a money ceiling that capped nothing', () => {
    expect(read('apps/api/src/application/use-cases/payments/VerifyPesaPalPaymentUseCase.ts')).toMatch(/settleRefundsForAttempt\(attempt\.id\)/);
  });
});

describe('GA4 hears one net refund per order', () => {
  it('a cancellation refunds the whole order only when no money refund exists for it', () => {
    expect(cancellationCarriesGa4Refund('ACCEPTED', false)).toBe(true);
    expect(cancellationCarriesGa4Refund('ACCEPTED', true)).toBe(false);
    expect(cancellationCarriesGa4Refund('PENDING', false)).toBe(false);
  });
  it('a money refund is sent unless a cancellation already refunded the order', () => {
    expect(refundCarriesGa4Refund('PROCESSED', false)).toBe(true);
    expect(refundCarriesGa4Refund('PROCESSED', true)).toBe(false);
    expect(refundCarriesGa4Refund(undefined, false)).toBe(false);
  });
  it('the cancellation checks the refund EVENT, not its intent (routing order)', () => {
    const src = read('apps/api/src/infrastructure/measurement/DeliveryService.ts');
    expect(src).toMatch(/event_name = 'refund_confirmed' and environment = \$\{ev\.environment\} limit 1/);
    expect(src).toMatch(/cancellationCarriesGa4Refund\(ga\?\.state, moneyRefunded\)/);
  });
});

describe('refunds whose outcome is unknown can be seen and resolved', () => {
  it('the refund request waits long enough for a slow acceptance', () => {
    expect(read('apps/api/src/infrastructure/payments/pesapal/PesaPalClient.ts')).toMatch(/timeoutMs: 30_000/);
  });
  it('the order page shows the provider status and posts a resolution', () => {
    const src = read('apps/web/src/pages/admin/orders/[id].astro');
    expect(src).toMatch(/action === 'resolve_refund'/);
    expect(src).toMatch(/\/refunds\/\$\{encodeURIComponent\(refundId\)\}\/resolve/);
    expect(src).toMatch(/r\.status === 'requested' && \(/);
    expect(src).toMatch(/PesaPal: \{r\.providerStatus \?\? 'no answer'\}/);
  });
  it('a replayed refund whose first outcome is unknown is not called a success', () => {
    expect(read('apps/web/src/pages/admin/payments/index.astro')).toMatch(/the first request's outcome is unknown/);
  });
});

function consequences(refundedUgx: number, transition: () => Promise<unknown> = () => Promise.resolve({})) {
  const paymentRepo = { updatePaymentAttemptStatus: vi.fn(), updateOrderPaymentStatusSafely: vi.fn().mockResolvedValue(true) };
  const orderTransition = { transition: vi.fn().mockImplementation(transition), history: vi.fn() };
  const loyalty = { execute: vi.fn().mockResolvedValue(undefined) };
  const uc = new ApplyRefundConsequencesUseCase(paymentRepo as never, orderTransition as never, { getRefundedTotalUgx: async () => refundedUgx }, loyalty);
  return { uc, paymentRepo, orderTransition, loyalty };
}

describe('a refund an operator confirms has the same consequences as one the poll saw', () => {
  const pending = { id: 'r1', paymentAttemptId: 'att-1', orderId: 'order-1', idempotencyKey: 'k', amountUgx: 200_000, reason: 'r', status: 'requested', providerStatus: 'PROVIDER_CALL_FAILED', providerMessage: null, createdAt: new Date() };
  const resolve = (c: ReturnType<typeof consequences>) =>
    new ResolveRefundUseCase(
      { listRefundsForOrder: async () => [pending], recordProviderOutcome: vi.fn() } as never,
      audit() as never,
      { findAttemptsByOrderId: async () => [attempt] } as never,
      c.uc,
    ).execute({ orderId: 'order-1', refundId: 'r1', resolution: 'settled', reason: 'PesaPal dashboard shows it paid', actorId: 'ops-1' });

  it('a full refund reverses the attempt and cancels the order with payment reversed', async () => {
    const c = consequences(200_000);
    expect((await resolve(c)).ok).toBe(true);
    expect(c.paymentRepo.updatePaymentAttemptStatus).toHaveBeenCalledWith('att-1', { status: 'reversed' });
    expect(c.orderTransition.transition).toHaveBeenCalledWith('order-1', 'cancelled', expect.objectContaining({
      paymentStatus: 'reversed', actorType: 'administrator', idempotencyKey: 'pesapal:reversed:trk-1',
    }));
  });

  it('a partial refund claws back its share and leaves the order alone', async () => {
    const c = consequences(50_000);
    await resolve(c);
    expect(c.orderTransition.transition).not.toHaveBeenCalled();
    expect(c.loyalty.execute).toHaveBeenCalledWith(expect.objectContaining({ orderId: 'order-1', refundedShareBps: 2_500 }));
  });

  it('a delivered order that cannot be cancelled records the payment fact and reverses loyalty', async () => {
    const c = consequences(200_000, () => Promise.reject(new DomainError('Illegal transition delivered -> cancelled')));
    const out = await c.uc.execute(attempt, { actorType: 'administrator', source: 'admin_api', providerConfirmed: false });
    expect(out.lifecycleConflict).toBe(true);
    expect(c.paymentRepo.updateOrderPaymentStatusSafely).toHaveBeenCalledWith('order-1', 'reversed');
    expect(c.loyalty.execute).toHaveBeenCalledWith(expect.objectContaining({ refundedShareBps: 10_000 }));
  });

  it('reads only a figure strictly inside the collected amount as partial', () => {
    expect(readRefund(0, 100)).toBe('total');
    expect(readRefund(50, 100)).toBe('partial');
    expect(readRefund(100, 100)).toBe('total');
    expect(readRefund(150, 100)).toBe('total');
  });
});

describe('a refund before delivery is clawed back once the points vest', () => {
  const vest = (share: number) => {
    const applyRefund = { execute: vi.fn().mockResolvedValue(undefined) };
    const uc = new VestLoyaltyOnDeliveryUseCase(
      { execute: vi.fn().mockResolvedValue({ ok: true, value: {} }) } as never,
      { findLoyaltyEarnSource: async () => ({ userId: 'u1', totalUgx: 1_000_000 }) },
      { getProgrammeConfig: async () => ({ killSwitch: false, budgetCapPoints: null }), lifetimeIssuedPoints: async () => 0, recordFraudSignal: vi.fn() } as never,
      { getRefundedShareBpsForOrder: async () => share },
      applyRefund,
    );
    return { uc, applyRefund };
  };
  it('claws the refunded share straight after vesting', async () => {
    const { uc, applyRefund } = vest(5_000);
    await uc.execute('order-1');
    expect(applyRefund.execute).toHaveBeenCalledWith({ orderId: 'order-1', refundedShareBps: 5_000, reason: 'Refunded before delivery' });
  });
  it('does nothing when nothing was refunded', async () => {
    const { uc, applyRefund } = vest(0);
    await uc.execute('order-1');
    expect(applyRefund.execute).not.toHaveBeenCalled();
  });
  it('the share is floored and capped', () => {
    expect(refundedShareBps(500_000, 1_000_000)).toBe(5_000);
    expect(refundedShareBps(1, 3)).toBe(3_333);
    expect(refundedShareBps(2_000, 1_000)).toBe(10_000);
    expect(refundedShareBps(10, 0)).toBe(0);
  });
});

describe('a cancelled order whose stock was already taken off is reported', () => {
  it('tells someone to record the return; never restocks by itself', async () => {
    const onStockAlreadyTaken = vi.fn();
    await new ReleaseCancelledOrderHoldsUseCase({
      releaseInventory: { execute: vi.fn().mockResolvedValue({ released: false }) },
      releaseRedemption: { execute: vi.fn().mockResolvedValue({ ok: true }) },
      reservations: { summariseReservations: async () => ({ consumed: 2 }) },
      onStockAlreadyTaken,
    }).execute('order-1');
    expect(onStockAlreadyTaken).toHaveBeenCalledWith('order-1', 2);
  });
  it('says nothing when the hold was simply released', async () => {
    const onStockAlreadyTaken = vi.fn();
    await new ReleaseCancelledOrderHoldsUseCase({
      releaseInventory: { execute: vi.fn().mockResolvedValue({ released: true }) },
      releaseRedemption: { execute: vi.fn().mockResolvedValue({ ok: true }) },
      reservations: { summariseReservations: async () => ({ consumed: 0 }) },
      onStockAlreadyTaken,
    }).execute('order-1');
    expect(onStockAlreadyTaken).not.toHaveBeenCalled();
  });
  it('the integrity scan flags it, and a closed order still holding a reservation', () => {
    expect(checkOrderStock({ orderId: 'o', orderStatus: 'cancelled', taskStatus: 'CANCELLED', reservedRows: 0, consumedRows: 1 }).map((e) => e.type)).toEqual(['CANCELLED_AFTER_CONSUME']);
    expect(checkOrderStock({ orderId: 'o', orderStatus: 'completed', taskStatus: null, reservedRows: 1, consumedRows: 0 }).map((e) => e.type)).toEqual(['DISPATCHED_WITH_RESERVATION']);
    expect(checkOrderStock({ orderId: 'o', orderStatus: 'processing', taskStatus: 'READY_FOR_DISPATCH', reservedRows: 1, consumedRows: 0 }).map((e) => e.type)).toEqual(['DISPATCHED_WITH_RESERVATION']);
    expect(checkOrderStock({ orderId: 'o', orderStatus: 'processing', taskStatus: 'PICKING', reservedRows: 1, consumedRows: 0 })).toEqual([]);
    expect(reconcileCommerce({ orders: [], inventory: [] })).toEqual([]);
  });
  it('a finished cancel-after-consume case stops alerting after a week (nothing can clear it)', () => {
    const repo = read('apps/api/src/infrastructure/db/repositories/DrizzleCommerceReconciliationRepository.ts');
    expect(repo).toMatch(/o\.status = 'cancelled' and max\(o\.updated_at\) > now\(\) - interval '7 days'/);
  });
});

describe('an order whose stock hold was released cannot be paid', () => {
  const start = (state: string | null) => {
    const provider = { execute: vi.fn().mockResolvedValue({ redirectUrl: 'https://pay', orderTrackingId: 't', merchantReference: 'm' }) };
    const uc = new StartOrderPaymentUseCase({
      idempotency: { findByOrderId: async () => ({ principalKey: 'p', stage: 'PAYMENT_READY', identity: 'i' }), advancePaymentStage: async () => true } as never,
      orders: { findById: async () => ({ id: 'order-1', paymentStatus: 'unpaid', totalUgx: 1_000, orderStatus: 'received' }) },
      attempts: { findAttemptsByOrderId: async () => [] },
      provider,
      sideEffectRecorder: { record: async () => 'DURABLY_RECORDED' } as never,
      reservationState: { getReservationState: async () => state as never },
    });
    return { uc, provider };
  };
  it('RELEASED is refused as an expired hold, and nothing is started', async () => {
    const { uc, provider } = start('RELEASED');
    expect(await uc.execute({ orderId: 'order-1', principalKey: 'p', traceId: 't' })).toEqual({ kind: 'NOT_PAYABLE', reason: 'ORDER_HOLD_EXPIRED' });
    expect(provider.execute).not.toHaveBeenCalled();
  });
  it('a held order still pays', async () => {
    const { uc, provider } = start('RESERVED');
    expect((await uc.execute({ orderId: 'order-1', principalKey: 'p', traceId: 't' })).kind).toBe('REDIRECT_READY');
    expect(provider.execute).toHaveBeenCalled();
  });
  it('the storefront explains the refusal', () => {
    expect(read('apps/web/src/lib/checkoutClient.ts')).toMatch(/case 'ORDER_HOLD_EXPIRED':/);
  });
  it('a resumed checkout does not count released rows as held', () => {
    expect(read('apps/api/src/infrastructure/db/repositories/DrizzleInventoryRepository.ts')).toMatch(/const held = r\.status === 'released' \? 0 : r\.reservedQuantity;/);
  });
});

describe('fulfilment stock effects: one use case, retried, reported', () => {
  const make = (orderStatus: string | null, fail = false) => {
    const inventory = {
      consumeForOrder: vi.fn().mockImplementation(async () => { if (fail) throw new Error('deadlock detected'); return { consumed: true }; }),
      releaseForOrder: vi.fn().mockResolvedValue({ released: true }),
    };
    const notifyCancelled = vi.fn().mockResolvedValue(undefined);
    const report = vi.fn();
    const uc = new ApplyFulfilmentStockEffectUseCase({ inventory, orders: { findStatus: async () => orderStatus }, notifyCancelled, report });
    return { uc, inventory, notifyCancelled, report };
  };
  it('READY_FOR_DISPATCH uses up the reservation', async () => {
    const m = make('processing');
    await m.uc.afterTaskTransition('o', 'READY_FOR_DISPATCH');
    expect(m.inventory.consumeForOrder).toHaveBeenCalledWith('o');
  });
  it('cancelling the stranded task of a COMPLETED order consumes, never releases, and sends no cancel email', async () => {
    const m = make('completed');
    await m.uc.afterTaskTransition('o', 'CANCELLED');
    expect(m.inventory.consumeForOrder).toHaveBeenCalledWith('o');
    expect(m.inventory.releaseForOrder).not.toHaveBeenCalled();
    expect(m.notifyCancelled).not.toHaveBeenCalled();
  });
  it('cancelling a live order releases and tells the admin', async () => {
    const m = make('processing');
    await m.uc.afterTaskTransition('o', 'CANCELLED');
    expect(m.inventory.releaseForOrder).toHaveBeenCalledWith('o');
    expect(m.notifyCancelled).toHaveBeenCalledWith('o');
  });
  it('an order closed without dispatch uses up its reservation', async () => {
    const m = make('completed');
    await m.uc.consumeForClosedOrder('o');
    expect(m.inventory.consumeForOrder).toHaveBeenCalledWith('o');
  });
  it('a failed order-status read is reported and releases nothing, emails nothing', async () => {
    const m = make('processing');
    const orders = { findStatus: vi.fn().mockRejectedValue(new Error('connection reset')) };
    const uc = new ApplyFulfilmentStockEffectUseCase({ inventory: m.inventory, orders, notifyCancelled: m.notifyCancelled, report: m.report });
    await expect(uc.afterTaskTransition('o', 'CANCELLED')).resolves.toBeUndefined();
    expect(m.report).toHaveBeenCalledWith(expect.objectContaining({ orderId: 'o', effect: 'release' }));
    expect(m.inventory.releaseForOrder).not.toHaveBeenCalled();
    expect(m.inventory.consumeForOrder).not.toHaveBeenCalled();
    expect(m.notifyCancelled).not.toHaveBeenCalled();
  });
  it('a failure is reported, not swallowed, and never throws', async () => {
    const m = make('processing', true);
    await expect(m.uc.afterTaskTransition('o', 'READY_FOR_DISPATCH')).resolves.toBeUndefined();
    expect(m.report).toHaveBeenCalledWith(expect.objectContaining({ orderId: 'o', effect: 'consume' }));
  });
  it('the route delegates, and consume/release retry a lost race', () => {
    const route = read('apps/api/src/interfaces/http/routes/admin/fulfilment.ts');
    expect(route).toMatch(/applyFulfilmentStockEffectUseCase\.afterTaskTransition\(result\.orderId, result\.to\)/);
    expect(route).not.toMatch(/Inventory\/email effect after fulfilment transition failed/);
    const repo = read('apps/api/src/infrastructure/db/repositories/DrizzleInventoryRepository.ts');
    expect(repo).toMatch(/async consumeForOrder\(orderId: string\): Promise<\{ consumed: boolean \}> \{\n\s+return withTransactionRetry\(/);
    expect(repo).toMatch(/async releaseForOrder\(orderId: string\): Promise<\{ released: boolean \}> \{\n\s+return withTransactionRetry\(/);
  });
});

describe('a PIM import is not blocked by stock moving', () => {
  const before = { productId: 'p', name: 'A', priceUgx: 100, stockQuantity: 3 };
  it('ignores stock when comparing catalogue facts', () => {
    expect(sameCatalogueSnapshot({ ...before, stockQuantity: 1 }, before)).toBe(true);
    expect(sameCatalogueSnapshot({ ...before, priceUgx: 90 }, before)).toBe(false);
  });
  it('still compares stock before deleting a created product on rollback', () => {
    expect(read('apps/api/src/infrastructure/db/repositories/DrizzlePimImportRepository.ts'))
      .toMatch(/row\.action === "CREATE" \? sameSnapshot : sameCatalogueSnapshot/);
  });
});

describe('a reused idempotency key on another payment is never a success', () => {
  it('answers IDEMPOTENCY_KEY_CONFLICT and sends nothing', async () => {
    const requestRefund = vi.fn();
    const uc = new RefundPesaPalPaymentUseCase(
      { findByMerchantReference: async () => attempt } as never,
      { getTransactionStatus: vi.fn(), requestRefund } as never,
      audit() as never,
      { reserveRefund: async () => ({ outcome: 'KEY_CONFLICT' }) } as never,
    );
    const out = await uc.execute({ merchantReference: 'ref-1', amountUgx: 1_000, reason: 'stockout refund for customer', actorId: 'a', actorUsername: 'a', idempotencyKey: 'stockout-refund' });
    expect(out).toMatchObject({ ok: false, code: 'IDEMPOTENCY_KEY_CONFLICT' });
    expect(requestRefund).not.toHaveBeenCalled();
  });
  it('the ledger checks the key belongs to this payment', () => {
    expect(read('apps/api/src/infrastructure/db/repositories/DrizzleRefundLedgerRepository.ts'))
      .toMatch(/String\(existingRow\.payment_attempt_id\) !== input\.paymentAttemptId/);
  });
});

describe('the admin money screens say what happened', () => {
  it('a fully refunded order still shows what was collected', () => {
    const src = read('apps/web/src/pages/admin/orders/[id].astro');
    expect(src).toMatch(/a\.status === 'completed' \|\| a\.status === 'reversed'/);
    expect(src).toMatch(/Fully refunded\. No refundable balance remains\./);
  });
  it('the refund form asks for the 10 characters the API requires', () => {
    const src = read('apps/web/src/pages/admin/payments/index.astro');
    expect(src).toMatch(/name="reason" required minlength="10"/);
    expect(src).not.toMatch(/name="reason" required minlength="5"/);
  });
});

describe('a partly refunded payment is paid, not unpaid', () => {
  const verify = () =>
    new VerifyPesaPalPaymentUseCase(
      { findByTrackingId: async () => attempt, updatePaymentAttemptStatus: vi.fn(), updateOrderPaymentStatusSafely: vi.fn() } as never,
      { getTransactionStatus: async () => ({ merchant_reference: 'ref-1', amount: 200_000, currency: 'UGX', status_code: 3, payment_status_description: 'Reversed' }) } as never,
      { transition: vi.fn(), history: vi.fn() } as never,
      { hasOutstandingRefunds: async () => true, getRefundedTotalUgx: async () => 50_000, settleRefundsForAttempt: async () => 1 } as never,
    );
  it('reports PAYMENT_PARTIALLY_REFUNDED with ok:true', async () => {
    const out = await verify().execute({ orderTrackingId: 'trk-1', merchantReference: 'ref-1', source: 'poll' });
    expect(out).toMatchObject({ ok: true, status: 'completed' });
    expect(out.message).toMatch(/^PAYMENT_PARTIALLY_REFUNDED: 50000 of 200000/);
  });
  it('the sweep counts an already-settled answer apart from failures', async () => {
    const sweep = new ReconcilePendingPaymentsUseCase(
      { listAttemptsForReconciliation: async () => [attempt as never], listStartFailuresForAbandonment: async () => [], updatePaymentAttemptStatus: vi.fn() as never },
      { execute: async () => ({ confirmed: false, verification: { ok: true, status: 'completed' }, settlement: { kind: 'ALREADY_SETTLED' } }) } as never,
      { pollAfterMinutes: 0, abandonStartFailuresAfterHours: 1, batchLimit: 10 },
    );
    const r = await sweep.execute();
    expect(r).toMatchObject({ polled: 1, failed: 0, alreadySettled: 1 });
  });
});

describe('stock copy and stock labels tell the truth', () => {
  it('the battery stock page no longer claims every balance change is a movement', () => {
    const src = read('apps/web/src/pages/admin/batteries/stock.astro');
    expect(src).not.toMatch(/Nothing changes a balance without a movement/);
    expect(src).toMatch(/change the balance without a movement here/);
  });
  it('packing warns that cancelled units are still deducted', () => {
    expect(read('apps/web/src/pages/admin/fulfilment/[id]/packing.astro')).toMatch(/Stock is not put back automatically for cancelled units/);
  });
  it('a property save derives the label from the LIVE quantity', () => {
    expect(read('apps/api/src/infrastructure/db/repositories/DrizzleProductRepository.ts')).toMatch(/stockStatus: stockStatusForLabel\(product\.stockStatus\)/);
    expect(read('apps/api/src/infrastructure/db/StockStatusSql.ts')).toMatch(/when \$\{products\.stockQuantity\} <= 0 and \$\{label\}::text <> 'pre_order' then 'out_of_stock'/);
  });
  it('hero and the inStock filter count AVAILABLE stock, like the PDP and the feed', () => {
    const hero = read('apps/api/src/infrastructure/hero/HeroSignalsService.ts');
    expect(hero).toMatch(/\(active and stock_quantity - reserved_quantity > 0\) as in_stock/);
    expect(hero).toMatch(/and p\.stock_quantity - p\.reserved_quantity > 0/);
    expect(hero).not.toMatch(/stock_status = 'in_stock'/);
    expect(read('apps/api/src/infrastructure/db/repositories/DrizzleProductRepository.ts'))
      .toMatch(/conditions\.push\(sql`\$\{products\.stockQuantity\} - \$\{products\.reservedQuantity\} > 0`\)/);
  });
});

/* ── Owner-approved held items ─────────────────────────────────────────── */

describe('held 4: one basket bound, 99, everywhere', () => {
  it('the basket stops where checkout stops', () => {
    expect(MAX_LINE_QUANTITY).toBe(99);
    const route = read('apps/api/src/interfaces/http/routes/commerce.ts');
    expect(route).toMatch(/quantity: z\.number\(\)\.int\(\)\.min\(0\)\.max\(MAX_LINE_QUANTITY\)\.optional\(\)/);
    // Out-of-range lines are refused, never silently dropped into a fake discount.
    expect(route).toMatch(/if \(items\.length !== mapped\.length\) \{/);
  });
  it('the cart shows the limit and stops the + button', () => {
    const cart = read('apps/web/src/pages/cart.astro');
    expect(cart).toMatch(/disabled=\{item\.quantity >= 99\}/);
    expect(cart).toMatch(/99 is the most of one product per order\./);
  });
});

describe('held 5: cash-on-delivery customers hear about their order', () => {
  it('a pay-on-delivery order is confirmed when placed; an online one when paid', () => {
    expect(confirmationForPlacedOrder('offline')).toBe('ORDER_RECEIVED_UNPAID');
    expect(confirmationForPlacedOrder('pesapal')).toBeNull();
    expect(confirmationForPlacedOrder(null)).toBeNull();
  });
  it('dispatch, delivery and a shop cancellation each send their message', () => {
    expect(customerMessageForTransition('dispatched', 'administrator')).toBe('ORDER_DISPATCHED');
    expect(customerMessageForTransition('delivered', 'fulfilment_worker')).toBe('ORDER_FULFILLMENT_COMPLETED');
    expect(customerMessageForTransition('completed', 'administrator')).toBeNull(); // a counter collection is not a delivery
    expect(customerMessageForTransition('cancelled', 'system')).toBe('ORDER_CANCELLED_BY_SHOP');
    expect(customerMessageForTransition('cancelled', 'customer')).toBeNull();
    expect(customerMessageForTransition('processing', 'payment_provider')).toBeNull();
  });
  it('the registry produces them through the one idempotent outbox path', () => {
    const reg = read('apps/api/src/infrastructure/Registry.ts');
    expect(reg).toMatch(/confirmationForPlacedOrder\(await this\.orderRepo\.findPaymentMethod\(order\.id\)\)/);
    expect(reg).toMatch(/customerMessageForTransition\(toStatus, ctx\.actorType\)/);
    expect(reg).toMatch(/idempotencyKey: `customer-order-message:\$\{orderId\}:\$\{template\}`/);
  });
});

const E = (over: Partial<LoyaltyLedgerEntry>): LoyaltyLedgerEntry => ({
  id: 'e', accountId: 'a', type: 'earn', points: 100, orderId: 'o', reason: 'r', idempotencyKey: 'k',
  expiresAt: null, reversedEntryId: null, createdAt: new Date('2026-01-01T00:00:00Z'), ...over,
});
const now = new Date('2026-09-01T00:00:00Z');
const past = new Date('2026-05-01T00:00:00Z');

describe('held 6: the FIFO expiry engine never goes negative and never leaves points immortal', () => {
  it('a partial clawback leaves the rest of the earn expiring', () => {
    const rows = [E({ id: 'earn', expiresAt: past }), E({ id: 'claw', type: 'reversal', points: -50, reversedEntryId: 'earn' })];
    expect(computeExpirableEarns(rows, now).map((d) => d.points)).toEqual([50]);
  });
  it('two partial clawbacks both count', () => {
    const rows = [E({ id: 'earn', expiresAt: past }), E({ id: 'c1', type: 'reversal', points: -25, reversedEntryId: 'earn' }), E({ id: 'c2', type: 'reversal', points: -25, reversedEntryId: 'earn' })];
    expect(computeExpirableEarns(rows, now).map((d) => d.points)).toEqual([50]);
  });
  it('a manual debit is spent FIFO, so expiry cannot take the balance negative', () => {
    const rows = [E({ id: 'earn', points: 1_000, expiresAt: past }), E({ id: 'adj', type: 'adjustment', points: -300, orderId: null })];
    const due = computeExpirableEarns(rows, now);
    expect(due.map((d) => d.points)).toEqual([700]);
    const after = [...rows, E({ id: 'x', type: 'expiry', points: -700, reversedEntryId: 'earn' })];
    expect(computeBalance(after, now).available).toBe(0);
  });
  it('a merged balance spends the survivor redemptions against the source earns', () => {
    const rows = [
      E({ id: 'm', accountId: 'source', points: 1_000, expiresAt: past, createdAt: new Date('2026-01-01T00:00:00Z') }),
      E({ id: 's', accountId: 'survivor', points: 100, expiresAt: new Date('2027-01-01T00:00:00Z'), createdAt: new Date('2026-02-01T00:00:00Z') }),
      E({ id: 'r', accountId: 'survivor', type: 'redeem', points: -1_000, orderId: null }),
    ];
    expect(computeExpirableEarns(rows, now)).toEqual([]);
    expect(computeBalance(rows, now).available).toBe(100);
  });
  it('points a refund returns to an already-expired earn expire again, keyed on the running total', () => {
    const rows = [
      E({ id: 'earn', expiresAt: past }),
      E({ id: 'red', type: 'redeem', points: -60, orderId: null }),
      E({ id: 'exp', type: 'expiry', points: -40, reversedEntryId: 'earn' }),
      E({ id: 'back', type: 'reversal', points: 60, reversedEntryId: 'red' }),
    ];
    const due = computeExpirableEarns(rows, now);
    expect(due.map((d) => ({ points: d.points, alreadyExpired: d.alreadyExpired }))).toEqual([{ points: 60, alreadyExpired: 40 }]);
    expect(read('apps/api/src/infrastructure/db/repositories/DrizzleLoyaltyRepository.ts'))
      .toMatch(/`expiry:\$\{source\.id\}:\$\{dueEarn\.alreadyExpired \+ dueEarn\.points\}`/);
  });
  it('expiry runs once per survivor over its merged set', () => {
    const src = read('apps/api/src/infrastructure/db/repositories/DrizzleLoyaltyRepository.ts');
    expect(src).toMatch(/if \(mergedAway\) return \[\];/);
    expect(src).toMatch(/\.where\(inArray\(loyaltyLedgerEntries\.accountId, accountIds\)\)/);
  });
  it('a second partial clawback on an unmigrated database is a clear refusal, not a 500', async () => {
    const uc = new ClawbackOrderEarnUseCase(
      { append: async () => { throw Object.assign(new Error('duplicate key value violates unique constraint "loyalty_ledger_reversal_source_idx"'), { code: '23505' }); } } as never,
      { findEarnEntryForOrder: async () => ({ id: 'earn', accountId: 'a', points: 100 }), sumReversedPointsForEntry: async () => 25 } as never,
      audit() as never,
    );
    expect(await uc.execute({ orderId: 'o', cumulativeShareBps: 5_000, actorId: null, actorType: 'system', reason: 'Partial refund' }))
      .toMatchObject({ ok: false, code: 'MANUAL_REQUIRED' });
  });
  it('migration 0151 drops the one-row-per-source uniqueness, additively', () => {
    const sql = read('apps/api/src/infrastructure/db/migrations/0151_loyalty_ledger_multi_settlement.sql');
    expect(sql).toMatch(/DROP INDEX IF EXISTS "loyalty_ledger_reversal_source_idx"/);
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS "loyalty_ledger_expiry_source_idx"/);
    expect(sql).not.toMatch(/CREATE UNIQUE INDEX/);
    expect(read('apps/api/src/infrastructure/db/migrations/meta/_journal.json')).toMatch(/"tag": "0151_loyalty_ledger_multi_settlement"/);
  });
});

describe('held 8: the loyalty pages state the rules the code follows', () => {
  it('no claim that nobody can change a balance, and refunds claw back', () => {
    const page = read('apps/web/src/pages/loyalty.astro');
    expect(page).not.toMatch(/Nobody at GoldPlus can type in or change your balance/);
    expect(page).toMatch(/If our team ever corrects it, the correction is recorded with a reason/);
    expect(page).not.toMatch(/Your balance is/);
    expect(page).toMatch(/taken back in proportion to the refund/);
  });
  it('the terms scope expiry to order points and fix the broken sentence', () => {
    const terms = read('apps/web/src/pages/loyalty-terms.astro');
    expect(terms).not.toMatch(/Cancelled, refused at the door, or returned\. Does not earn points\./);
    expect(terms).toMatch(/Points earned on orders expire/);
    expect(terms).toMatch(/from any other source do not expire/);
  });
  it('the account page shows the balance with its UGX value when configured', () => {
    expect(read('apps/web/src/pages/account/loyalty.astro')).toMatch(/worth UGX \{\(history\.balance\.available \* pointValueUgx\)\.toLocaleString\('en-UG'\)\} off an order/);
  });
});

describe('held 16: no expiry, and no "use them" warning, while points cannot be spent', () => {
  const sweep = (config: Record<string, unknown>, gateActive = true) => {
    const repo = { expireDue: vi.fn().mockResolvedValue([]), listEntries: vi.fn().mockResolvedValue([]), mergedInto: vi.fn().mockResolvedValue(null), getConfig: vi.fn().mockResolvedValue({ earnRatePer1000Ugx: 0 }) };
    const completion = {
      getProgrammeConfig: vi.fn().mockResolvedValue(config),
      listExpiredReservations: vi.fn().mockResolvedValue([]),
      markReservation: vi.fn(),
      listAccountIds: vi.fn().mockResolvedValue([{ accountId: 'a', userId: 'u' }]),
      listEarnsNearingExpiry: vi.fn().mockResolvedValue([]),
      ledgerTotals: vi.fn().mockResolvedValue({ issued: 0, redeemed: 0, expired: 0, clawedBack: 0, outstanding: 0 }),
      pendingEarnOrders: vi.fn().mockResolvedValue([]),
      writeLiabilitySnapshot: vi.fn(),
    };
    const uc = new RunLoyaltyDailySweepUseCase(repo as never, completion as never, vi.fn(), { isActive: async () => gateActive });
    return { uc, repo, completion };
  };
  const live = { enabled: true, killSwitch: false, pointValueUgx: 20, redemptionMinPoints: 100, redemptionMaxShareBps: 2000 };
  it('the kill switch pauses expiry and warnings but still writes the snapshot', async () => {
    const s = sweep({ ...live, killSwitch: true });
    await s.uc.execute(now);
    expect(s.repo.expireDue).not.toHaveBeenCalled();
    expect(s.completion.listEarnsNearingExpiry).not.toHaveBeenCalled();
    expect(s.completion.writeLiabilitySnapshot).toHaveBeenCalled();
  });
  it('a disabled programme, an inactive deployment key or unconfigured redemption pause it too', async () => {
    for (const s of [sweep({ ...live, enabled: false }), sweep(live, false), sweep({ ...live, pointValueUgx: null })]) {
      await s.uc.execute(now);
      expect(s.repo.expireDue).not.toHaveBeenCalled();
    }
  });
  it('a live programme expires as before', async () => {
    const s = sweep(live);
    await s.uc.execute(now);
    expect(s.repo.expireDue).toHaveBeenCalledWith('a', now);
  });
});
