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
