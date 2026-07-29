import { describe, it, expect, beforeEach } from 'vitest';
import {
  RecordPaymentWebhookUseCase,
  type OrderAmountResolver,
} from '../../apps/api/src/application/use-cases/payments/RecordPaymentWebhookUseCase';
import type { IPaymentRepository } from '../../apps/api/src/application/ports/IPaymentRepository';

/**
 * A SUCCESS webhook must be verified against the order total before it is recorded.
 *
 * The provider payload is untrusted input: a signature proves who sent it, not that
 * the figure is correct. Without verification, a webhook reporting less than the
 * order total marks the order paid for the smaller sum and the recorded payment
 * becomes the only record of what "should" have been paid — the under-charge is
 * then invisible to every downstream reconciliation.
 */

class FakePaymentRepo implements Partial<IPaymentRepository> {
  recorded: { orderId: string; amount: number; idempotencyKey: string }[] = [];
  existing = new Map<string, { id: string; orderId: string; amount: number }>();

  async findByIdempotencyKey(key: string) {
    return (this.existing.get(key) ?? null) as never;
  }
  async recordWebhookOutcome(input: {
    orderId: string;
    idempotencyKey: string;
    amount: number;
  }) {
    this.recorded.push({
      orderId: input.orderId,
      amount: input.amount,
      idempotencyKey: input.idempotencyKey,
    });
    const row = { id: `pay-${this.recorded.length}`, orderId: input.orderId, amount: input.amount };
    this.existing.set(input.idempotencyKey, row);
    return row as never;
  }
}

const ORDER = '33333333-3333-4333-8333-333333333333';
const ORDER_TOTAL = 100_000;

const resolver = (total: number | null): OrderAmountResolver => ({
  findTotalAmount: async () => total,
});

const webhook = (over: Partial<Parameters<RecordPaymentWebhookUseCase['execute']>[0]> = {}) => ({
  provider: 'mtn',
  orderId: ORDER,
  providerReference: 'REF-1',
  amount: ORDER_TOTAL,
  outcome: 'SUCCESS' as const,
  signatureVerified: true,
  ...over,
});

let payments: FakePaymentRepo;

beforeEach(() => {
  payments = new FakePaymentRepo();
});

describe('payment webhook amount verification', () => {
  it('records a payment whose amount matches the order total', async () => {
    const useCase = new RecordPaymentWebhookUseCase(payments as never, resolver(ORDER_TOTAL));
    const result = await useCase.execute(webhook());
    expect(result.ok).toBe(true);
    expect(payments.recorded).toHaveLength(1);
    expect(payments.recorded[0].amount).toBe(ORDER_TOTAL);
  });

  it('REFUSES an under-payment and records nothing', async () => {
    const useCase = new RecordPaymentWebhookUseCase(payments as never, resolver(ORDER_TOTAL));
    const result = await useCase.execute(webhook({ amount: 1_000 }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('AMOUNT_MISMATCH');
    expect(result.detail).toEqual({
      expectedAmount: ORDER_TOTAL,
      reportedAmount: 1_000,
      orderId: ORDER,
    });
    // The critical assertion: nothing was written, so the order is not paid.
    expect(payments.recorded).toEqual([]);
  });

  it('REFUSES an over-payment rather than silently accepting it', async () => {
    const useCase = new RecordPaymentWebhookUseCase(payments as never, resolver(ORDER_TOTAL));
    const result = await useCase.execute(webhook({ amount: ORDER_TOTAL + 1 }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('AMOUNT_MISMATCH');
    expect(payments.recorded).toEqual([]);
  });

  it('refuses a webhook for an order that does not exist', async () => {
    const useCase = new RecordPaymentWebhookUseCase(payments as never, resolver(null));
    const result = await useCase.execute(webhook());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('ORDER_NOT_FOUND');
    expect(payments.recorded).toEqual([]);
  });

  it('does not amount-check a FAILED webhook — a failure carries no settled sum', async () => {
    const useCase = new RecordPaymentWebhookUseCase(payments as never, resolver(ORDER_TOTAL));
    const result = await useCase.execute(webhook({ outcome: 'FAILED', amount: 1 }));
    expect(result.ok).toBe(true);
    expect(payments.recorded).toHaveLength(1);
  });

  it('stays backward compatible when no resolver is supplied', async () => {
    // Existing callers must keep working; verification is additive.
    const useCase = new RecordPaymentWebhookUseCase(payments as never);
    const result = await useCase.execute(webhook({ amount: 1 }));
    expect(result.ok).toBe(true);
  });

  it('verifies BEFORE the idempotency lookup, so a bad amount cannot be replayed in', async () => {
    const useCase = new RecordPaymentWebhookUseCase(payments as never, resolver(ORDER_TOTAL));
    // Seed a prior good payment under the key this webhook would derive.
    await useCase.execute(webhook());
    expect(payments.recorded).toHaveLength(1);

    // A second webhook with the SAME key but a wrong amount must not be waved
    // through as a "replay" of the earlier good payment.
    const tampered = await useCase.execute(webhook({ amount: 5 }));
    expect(tampered.ok).toBe(false);
    if (!tampered.ok) expect(tampered.code).toBe('AMOUNT_MISMATCH');
    expect(payments.recorded).toHaveLength(1);
  });

  it('still replays an identical, correct webhook without double-recording', async () => {
    const useCase = new RecordPaymentWebhookUseCase(payments as never, resolver(ORDER_TOTAL));
    const first = await useCase.execute(webhook());
    const second = await useCase.execute(webhook());

    expect(first.ok && second.ok).toBe(true);
    if (second.ok) expect(second.replay).toBe(true);
    expect(payments.recorded).toHaveLength(1);
  });

  it('rejects a non-integer or non-positive amount before anything else', async () => {
    const useCase = new RecordPaymentWebhookUseCase(payments as never, resolver(ORDER_TOTAL));
    for (const amount of [0, -1, 1.5, Number.NaN]) {
      const result = await useCase.execute(webhook({ amount }));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('BAD_AMOUNT');
    }
    expect(payments.recorded).toEqual([]);
  });
});
