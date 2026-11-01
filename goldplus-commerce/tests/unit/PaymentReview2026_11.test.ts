import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const api = (p: string) => readFileSync(join(__dirname, '../../apps/api/src', p), 'utf8');

/**
 * Payment review 2026-11: wiring checks for fixes that live in the composition
 * root or in routes, where a behavioural test would need the whole container.
 */
describe('payment review 2026-11 wiring', () => {
  it('the payment-start order reader carries storeCreditAppliedUgx', () => {
    const src = api('infrastructure/Registry.ts');
    const start = src.indexOf('startOrderPaymentUseCase = new StartOrderPaymentUseCase');
    const block = src.slice(start, src.indexOf('attempts:', start));
    expect(block).toMatch(/storeCreditAppliedUgx:\s*order\.storeCreditAppliedUgx/);
  });
});

describe('admin refund form key (review 2026-11)', () => {
  it('reuses the unresolved refund key instead of minting a fresh one per render', async () => {
    const { unresolvedRefundOf } = await import('../../apps/web/src/lib/adminRefundKey');
    const refunds = [
      { idempotencyKey: 'old-accepted', status: 'requested', providerStatus: '200', createdAt: '2026-11-01T08:00:00Z' },
      { idempotencyKey: 'unknown', status: 'requested', providerStatus: 'PROVIDER_CALL_FAILED', createdAt: '2026-11-01T09:00:00Z' },
      { idempotencyKey: 'done', status: 'settled', providerStatus: '200', createdAt: '2026-11-01T07:00:00Z' },
    ];
    expect(unresolvedRefundOf(refunds)?.idempotencyKey).toBe('unknown');
    expect(unresolvedRefundOf(refunds.filter((r) => r.idempotencyKey !== 'unknown'))).toBeNull();
    const page = readFileSync(join(__dirname, '../../apps/web/src/pages/admin/payments/index.astro'), 'utf8');
    expect(page).toMatch(/refundIdempotencyKey = unresolvedRefund\?\.idempotencyKey/);
    expect(page).not.toMatch(/^const refundIdempotencyKey = crypto\.randomUUID\(\);$/m);
  });
});

describe('refund ledger counts store credit (review 2026-11)', () => {
  it('store credit issued for the order reduces the cash refundable balance', async () => {
    const { cashRefundableUgx } = await import('../../apps/api/src/infrastructure/db/repositories/DrizzleRefundLedgerRepository');
    expect(cashRefundableUgx(100_000, 0, 100_000)).toBe(0);
    expect(cashRefundableUgx(100_000, 30_000, 20_000)).toBe(50_000);
    const src = api('infrastructure/db/repositories/DrizzleRefundLedgerRepository.ts');
    const reserve = src.slice(src.indexOf('async reserveRefund'), src.indexOf('async recordProviderOutcome'));
    expect(reserve).toMatch(/from credit_instruments[\s\S]*source_order_id = \$\{input\.orderId\}/);
    expect(reserve).toMatch(/refundableUgx = cashRefundableUgx\(/);
  });
});

describe('paid-orders catch-up (review 2026-11)', () => {
  it('excludes cancelled orders and checkouts held in PAYMENT_REVIEW at the top level', () => {
    const src = api('infrastructure/payments/PaidOrdersOwedEffects.ts');
    const head = src.slice(src.indexOf("where o.payment_status = 'paid'"), src.indexOf('and exists (select 1 from payment_attempts'));
    expect(head).toMatch(/o\.status not in \('cancelled', 'failed'\)/);
    expect(head).toMatch(/not exists \(select 1 from checkout_idempotency ci where ci\.order_id = o\.id and ci\.stage = 'PAYMENT_REVIEW'\)/);
  });
});

describe('payment attempt updated_at (review 2026-11)', () => {
  it('a timestamp-only or same-status write does not move updated_at', async () => {
    const { attemptWriteChangesAttempt } = await import('../../apps/api/src/infrastructure/db/repositories/DrizzlePaymentAttemptRepository');
    expect(attemptWriteChangesAttempt('completed', {})).toBe(false);
    expect(attemptWriteChangesAttempt('completed', { status: 'completed' })).toBe(false);
    expect(attemptWriteChangesAttempt('pending', { status: 'completed' })).toBe(true);
    expect(attemptWriteChangesAttempt('pending', { orderTrackingId: 't1' })).toBe(true);
    const src = api('infrastructure/db/repositories/DrizzlePaymentAttemptRepository.ts');
    expect(src).toMatch(/updatedAt: attemptWriteChangesAttempt\(current\?\.status, update\) \? new Date\(\) : undefined/);
  });
});

describe('refund resolve step-up (review 2026-11)', () => {
  it('POST refunds/:refundId/resolve requires the payment_refund step-up', () => {
    const src = api('interfaces/http/routes/admin/payments.ts');
    expect(src).toMatch(/routes\.post\('\/orders\/:orderId\/refunds\/:refundId\/resolve', requirePermissions\(\[PERMISSIONS\.PAYMENTS_REFUND\]\), requireStepUp\('payment_refund'\)/);
  });
});

describe('already_settled return copy (review 2026-11)', () => {
  it('never promises "no second payment" (a sibling attempt may still be pending)', async () => {
    const { paymentReturnCopy } = await import('../../apps/web/src/lib/paymentReturn');
    const copy = paymentReturnCopy('already_settled', 'GP-202611-ABCD');
    expect(`${copy.money} ${copy.next}`).not.toMatch(/did not take a second payment|no second payment|nothing more to do/i);
    expect(copy.next).toMatch(/do not pay again/i);
  });
});
