import { describe, it, expect } from 'vitest';
import {
  RecordPaymentWebhookUseCase,
} from '../../apps/api/src/application/use-cases/payments/RecordPaymentWebhookUseCase';
import {
  IPaymentRepository,
  RecordedPayment,
} from '../../apps/api/src/application/ports/IPaymentRepository';

function makeFakeRepo(): IPaymentRepository & { _store: Map<string, RecordedPayment>; _writes: number } {
  const store = new Map<string, RecordedPayment>();
  return {
    _store: store,
    _writes: 0,
    async findByIdempotencyKey(key) {
      return store.get(key) ?? null;
    },
    async recordWebhookOutcome(input) {
      this._writes++;
      const payment: RecordedPayment = {
        id: `pay_${store.size + 1}`,
        orderId: input.orderId,
        idempotencyKey: input.idempotencyKey,
        provider: input.provider,
        providerReference: input.providerReference,
        amount: input.amount,
        status: input.outcome,
        paidAt: input.outcome === 'SUCCESS' ? new Date() : null,
      };
      store.set(input.idempotencyKey, payment);
      return payment;
    },
  };
}

describe('RecordPaymentWebhookUseCase', () => {
  const baseInput = {
    provider: 'mtn',
    orderId: 'ord_1',
    providerReference: 'mtn-ref-001',
    amount: 50000,
    outcome: 'SUCCESS' as const,
    idempotencyKey: null,
    signatureVerified: true,
  };

  it('refuses unknown providers', async () => {
    const repo = makeFakeRepo();
    const uc = new RecordPaymentWebhookUseCase(repo);
    const out = await uc.execute({ ...baseInput, provider: 'paypal' });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe('UNKNOWN_PROVIDER');
    expect(repo._writes).toBe(0);
  });

  it('records a SUCCESS payment and updates the store', async () => {
    const repo = makeFakeRepo();
    const uc = new RecordPaymentWebhookUseCase(repo);
    const out = await uc.execute(baseInput);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.replay).toBe(false);
      expect(out.payment.status).toBe('SUCCESS');
      expect(out.signatureVerified).toBe(true);
    }
    expect(repo._writes).toBe(1);
  });

  it('replays return the original payment without a second write', async () => {
    const repo = makeFakeRepo();
    const uc = new RecordPaymentWebhookUseCase(repo);
    const first = await uc.execute(baseInput);
    const second = await uc.execute(baseInput);
    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(second.replay).toBe(true);
      expect(second.payment.id).toBe(first.payment.id);
    }
    expect(repo._writes).toBe(1);
  });

  it('refuses a webhook with no idempotency anchor', async () => {
    const repo = makeFakeRepo();
    const uc = new RecordPaymentWebhookUseCase(repo);
    const out = await uc.execute({ ...baseInput, providerReference: null, idempotencyKey: null });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe('MISSING_IDEMPOTENCY');
    expect(repo._writes).toBe(0);
  });

  it('records FAILED outcomes with null paidAt', async () => {
    const repo = makeFakeRepo();
    const uc = new RecordPaymentWebhookUseCase(repo);
    const out = await uc.execute({ ...baseInput, outcome: 'FAILED', providerReference: 'mtn-ref-002' });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.payment.status).toBe('FAILED');
      expect(out.payment.paidAt).toBeNull();
    }
  });

  it('rejects non-positive or non-integer amounts', async () => {
    const repo = makeFakeRepo();
    const uc = new RecordPaymentWebhookUseCase(repo);
    expect((await uc.execute({ ...baseInput, amount: 0 })).ok).toBe(false);
    expect((await uc.execute({ ...baseInput, amount: -10 })).ok).toBe(false);
    expect((await uc.execute({ ...baseInput, amount: 12.5 })).ok).toBe(false);
    expect(repo._writes).toBe(0);
  });

  it('rejects outcomes other than SUCCESS or FAILED', async () => {
    const repo = makeFakeRepo();
    const uc = new RecordPaymentWebhookUseCase(repo);
    const out = await uc.execute({ ...baseInput, outcome: 'PENDING' as any });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe('BAD_OUTCOME');
  });

  it('propagates signatureVerified=false through a normal write', async () => {
    const repo = makeFakeRepo();
    const uc = new RecordPaymentWebhookUseCase(repo);
    const out = await uc.execute({ ...baseInput, signatureVerified: false });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.signatureVerified).toBe(false);
  });

  it('uses provider:providerReference as a deterministic fallback key', async () => {
    const repo = makeFakeRepo();
    const uc = new RecordPaymentWebhookUseCase(repo);
    const out = await uc.execute(baseInput);
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.payment.idempotencyKey).toBe('mtn:mtn-ref-001');
  });
});
