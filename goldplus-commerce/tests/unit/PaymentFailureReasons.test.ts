import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { VerifyPesaPalPaymentUseCase } from '../../apps/api/src/application/use-cases/payments/VerifyPesaPalPaymentUseCase';
import type { RecordedPaymentAttempt } from '../../apps/api/src/application/ports/IPesaPalPaymentRepository';
import {
  MAX_FAILURE_DESCRIPTION_LENGTH,
  failureFields,
  failureReasonToRecord,
  summariseFailureReasons,
  withAttemptNumbers,
  type FailureReasonRecord,
} from '../../apps/api/src/domain/payments/PaymentFailureReason';

/** Why a payment attempt failed (migration 0162): persistence rule and read mapping. */

describe('failureReasonToRecord', () => {
  it('records code and trimmed description for failed / invalid / reversed', () => {
    for (const resolvedStatus of ['failed', 'invalid', 'reversed']) {
      const r = failureReasonToRecord({ currentStatus: 'pending', resolvedStatus, statusCode: 2, description: '  Insufficient   funds \n' });
      expect(r?.providerStatusCode).toBe(2);
      expect(r?.providerStatusDescription).toBe('Insufficient funds');
      expect(r?.failedAt).toBeInstanceOf(Date);
    }
  });

  it('bounds the description length', () => {
    const r = failureReasonToRecord({ currentStatus: 'pending', resolvedStatus: 'failed', statusCode: 2, description: 'x'.repeat(5000) });
    expect(r?.providerStatusDescription?.length).toBe(MAX_FAILURE_DESCRIPTION_LENGTH);
  });

  it('writes nothing for a paid or still-pending outcome', () => {
    expect(failureReasonToRecord({ currentStatus: 'pending', resolvedStatus: 'completed', statusCode: 1, description: 'COMPLETED' })).toBeNull();
    expect(failureReasonToRecord({ currentStatus: 'pending', resolvedStatus: 'pending', statusCode: 0, description: '' })).toBeNull();
  });

  it('never overwrites a completed attempt', () => {
    expect(failureReasonToRecord({ currentStatus: 'completed', resolvedStatus: 'failed', statusCode: 2, description: 'FAILED' })).toBeNull();
  });

  it('keeps a blank description and non-integer code as null', () => {
    const r = failureReasonToRecord({ currentStatus: 'pending', resolvedStatus: 'invalid', statusCode: 'x', description: '   ' });
    expect(r).toMatchObject({ providerStatusCode: null, providerStatusDescription: null });
  });
});

function verifyWorld(statusCode: number, description: string, startStatus = 'pending') {
  const createdAt = new Date(Date.now() - 48 * 3_600_000);
  const attempt: RecordedPaymentAttempt = {
    id: 'attempt-1', orderId: 'order-1', merchantReference: 'GP-1', orderTrackingId: 'track-1',
    amount: 100_000, currency: 'UGX', status: startStatus, redirectUrl: null, provider: 'pesapal',
    ipnReceivedAt: null, callbackReceivedAt: null, createdAt, updatedAt: createdAt,
  };
  const recorded: Array<{ id: string; reason: FailureReasonRecord }> = [];
  const verify = new VerifyPesaPalPaymentUseCase(
    {
      findByTrackingId: async () => ({ ...attempt }),
      updatePaymentAttemptStatus: async (_id: string, patch: { status: string }) => { attempt.status = patch.status; },
      updateOrderPaymentStatusSafely: async () => true,
      recordFailureReason: async (id: string, reason: FailureReasonRecord) => { recorded.push({ id, reason }); },
    } as never,
    {
      getTransactionStatus: async () => ({ status_code: statusCode, payment_status_description: description, merchant_reference: 'GP-1', amount: 100_000, currency: 'UGX' }),
    } as never,
    { transition: async () => undefined } as never,
  );
  return { verify, recorded };
}

describe('VerifyPesaPalPaymentUseCase persists the failure reason', () => {
  it('a decline records code 2 and the description on that attempt', async () => {
    const { verify, recorded } = verifyWorld(2, ' FAILED ');
    await verify.execute({ orderTrackingId: 'track-1', merchantReference: 'GP-1', source: 'ipn' });
    expect(recorded).toHaveLength(1);
    expect(recorded[0].id).toBe('attempt-1');
    expect(recorded[0].reason).toMatchObject({ providerStatusCode: 2, providerStatusDescription: 'FAILED' });
  });

  it('a completed payment records no failure reason', async () => {
    const { verify, recorded } = verifyWorld(1, 'COMPLETED');
    await verify.execute({ orderTrackingId: 'track-1', merchantReference: 'GP-1', source: 'ipn' });
    expect(recorded).toHaveLength(0);
  });

  it('the repository write is guarded against completed attempts', () => {
    const src = readFileSync(join(__dirname, '../../apps/api/src/infrastructure/db/repositories/DrizzlePaymentAttemptRepository.ts'), 'utf8');
    const body = src.slice(src.indexOf('async recordFailureReason'), src.indexOf('async numberAttempts'));
    expect(body).toMatch(/<> 'completed'/);
    // A re-verified failed attempt keeps its first failure time.
    expect(body).toMatch(/coalesce\(\$\{paymentAttempts\.failedAt\}/);
  });
});

describe('admin queue read mapping', () => {
  it('shows a reason only for failed attempts', () => {
    const failedAt = new Date();
    expect(failureFields({ status: 'failed', providerStatusCode: 2, providerStatusDescription: 'FAILED', failedAt })).toEqual({ failureReason: 'FAILED', providerStatusCode: 2, failedAt });
    expect(failureFields({ status: 'completed', providerStatusCode: 2, providerStatusDescription: 'FAILED', failedAt })).toEqual({ failureReason: null, providerStatusCode: null, failedAt: null });
    expect(failureFields({ status: 'invalid' })).toEqual({ failureReason: null, providerStatusCode: null, failedAt: null });
  });

  it('attaches attempt N of M by id, null when unknown', () => {
    const rows = withAttemptNumbers([{ id: 'a' }, { id: 'b' }], [{ id: 'a', attemptNumber: 2, attemptsForOrder: 3 }]);
    expect(rows).toEqual([{ id: 'a', attemptNumber: 2, attemptsForOrder: 3 }, { id: 'b', attemptNumber: null, attemptsForOrder: null }]);
  });

  it('counts failure reasons by description, most frequent first', () => {
    const summary = summariseFailureReasons([
      { status: 'failed', providerStatusDescription: 'FAILED' },
      { status: 'invalid', providerStatusDescription: 'INVALID' },
      { status: 'failed', providerStatusDescription: 'FAILED' },
      { status: 'failed', providerStatusDescription: null },
      { status: 'completed', providerStatusDescription: 'FAILED' },
    ]);
    expect(summary).toEqual([
      { reason: 'FAILED', count: 2 },
      { reason: 'INVALID', count: 1 },
      { reason: 'No reason recorded', count: 1 },
    ]);
  });

  it('numbers attempts in SQL with a per-order window', () => {
    const src = readFileSync(join(__dirname, '../../apps/api/src/infrastructure/db/repositories/DrizzlePaymentAttemptRepository.ts'), 'utf8');
    expect(src).toMatch(/ROW_NUMBER\(\) OVER \(PARTITION BY order_id ORDER BY created_at, id\)/);
    expect(src).toMatch(/COUNT\(\*\) OVER \(PARTITION BY order_id\)/);
  });
});
