import { describe, it, expect } from 'vitest';
import { RecordPaymentWebhookUseCase } from '../../apps/api/src/application/use-cases/payments/RecordPaymentWebhookUseCase';

/**
 * signatureVerified was computed by the route, threaded through this use case,
 * and returned in the result — without ever gating anything.
 *
 * An unsigned request, a wrongly-signed request, and a request arriving while
 * the provider secret was simply unset were all recorded as genuine payments.
 * Anyone who could reach the endpoint could POST an order id, an amount and
 * outcome SUCCESS and mark an order paid, with no credential of any kind.
 */

class RecordingRepo {
  recorded: unknown[] = [];
  lookups = 0;
  async findByIdempotencyKey() {
    this.lookups++;
    return null;
  }
  async recordWebhookOutcome(input: Record<string, unknown>) {
    this.recorded.push(input);
    return { id: 'p1', orderId: String(input.orderId), status: 'SUCCESS' as const };
  }
}

const valid = {
  provider: 'mtn',
  orderId: 'order-1',
  providerReference: 'ref-1',
  amount: 50_000,
  outcome: 'SUCCESS' as const,
  idempotencyKey: 'key-1',
};

const orders = { findTotalAmount: async () => 50_000 };

describe('an unverified webhook is not recorded', () => {
  it('refuses when the signature did not verify', async () => {
    const repo = new RecordingRepo();
    const result = await new RecordPaymentWebhookUseCase(repo as never, orders).execute({
      ...valid,
      signatureVerified: false,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('SIGNATURE_INVALID');
    expect(repo.recorded).toHaveLength(0);
  });

  it('records nothing and reads nothing on an unverified payload', async () => {
    // The check must come first: every later branch reads or writes on behalf
    // of a payload nobody has authenticated.
    const repo = new RecordingRepo();
    let orderLookups = 0;
    await new RecordPaymentWebhookUseCase(repo as never, {
      findTotalAmount: async () => {
        orderLookups++;
        return 50_000;
      },
    }).execute({ ...valid, signatureVerified: false });

    expect(repo.recorded).toHaveLength(0);
    expect(repo.lookups).toBe(0);
    expect(orderLookups).toBe(0);
  });

  it('refuses a FAILED outcome too, not just SUCCESS', async () => {
    // A forged FAILED marks a real payment as failed — a denial of service
    // against the customer's completed order.
    const repo = new RecordingRepo();
    const result = await new RecordPaymentWebhookUseCase(repo as never, orders).execute({
      ...valid,
      outcome: 'FAILED',
      signatureVerified: false,
    });
    expect(result.ok).toBe(false);
    expect(repo.recorded).toHaveLength(0);
  });

  it('is refused before the amount check, which cannot save an unsigned payload', async () => {
    const repo = new RecordingRepo();
    const result = await new RecordPaymentWebhookUseCase(repo as never, orders).execute({
      ...valid,
      amount: 1,
      signatureVerified: false,
    });
    if (!result.ok) expect(result.code).toBe('SIGNATURE_INVALID');
  });

  it('does not reveal whether the secret was configured or the signature was wrong', async () => {
    // That tells an attacker which of the two to work on.
    const repo = new RecordingRepo();
    const result = await new RecordPaymentWebhookUseCase(repo as never, orders).execute({
      ...valid,
      signatureVerified: false,
    });
    if (!result.ok) {
      expect(result.message).not.toMatch(/configur|secret|missing key/i);
    }
  });

  it('still records a properly verified webhook', async () => {
    const repo = new RecordingRepo();
    const result = await new RecordPaymentWebhookUseCase(repo as never, orders).execute({
      ...valid,
      signatureVerified: true,
    });
    expect(result.ok).toBe(true);
    expect(repo.recorded).toHaveLength(1);
  });

  it('keeps the amount check working for verified payloads', async () => {
    // A signature proves who sent the payload, not that the figure is right.
    const repo = new RecordingRepo();
    const result = await new RecordPaymentWebhookUseCase(repo as never, {
      findTotalAmount: async () => 90_000,
    }).execute({ ...valid, signatureVerified: true });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('AMOUNT_MISMATCH');
    expect(repo.recorded).toHaveLength(0);
  });
});
