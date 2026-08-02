import { describe, expect, it, vi } from 'vitest';
import {
  GetAnalyticsBreakdownUseCase,
  GetAnalyticsExceptionDrilldownUseCase,
  GetPaymentIntelligenceUseCase,
  MAX_DRILLDOWN_ROWS,
} from '../../apps/api/src/application/use-cases/analytics/PaymentIntelligenceUseCases';
import type { IAnalyticsReadRepository } from '../../apps/api/src/application/ports/IAnalyticsReadRepository';

function repo(overrides: Partial<IAnalyticsReadRepository> = {}): IAnalyticsReadRepository {
  return {
    orderAggregates: vi.fn(),
    dailyOrderBuckets: vi.fn(),
    lowStockCount: vi.fn(),
    searchDemandSummary: vi.fn(),
    sourceRecency: vi.fn(),
    paymentAggregates: vi.fn().mockResolvedValue({
      attempts: 20, confirmed: 12, failed: 5, pending: 3, unrecognised: 0,
      callbackReceived: 18, ipnReceived: 15, reconciled: 12,
      byStatus: [{ status: 'completed', count: 12 }, { status: 'failed', count: 5 }],
      byProvider: [{ provider: 'pesapal', attempts: 20, confirmed: 12 }],
    }),
    paidNotProcessingOrders: vi.fn().mockResolvedValue([
      { orderNumber: 'GP-1001', orderStatus: 'received', paymentStatus: 'paid', ageHours: 30.5, totalAmount: 120_000 },
    ]),
    ordersByDimension: vi.fn().mockResolvedValue([
      { value: 'paid', orders: 6, paidOrderValueUgx: 600_000 },
      { value: 'unpaid', orders: 4, paidOrderValueUgx: 0 },
    ]),
    ...overrides,
  } as IAnalyticsReadRepository;
}

describe('GetPaymentIntelligenceUseCase', () => {
  it('reports attempt-level success against the attempt denominator, not the order one', async () => {
    const result = await new GetPaymentIntelligenceUseCase(repo()).execute({ days: 7 });
    expect(result.attemptSuccessRate.value).toBeCloseTo(12 / 20);
    expect(result.attemptSuccessRate.denominator).toContain('payment attempts');
    expect(result.attemptSuccessRate.sampleSize).toBe(20);
    expect(result.notes[0]).toContain('not the order-level payment_success_rate');
  });

  it('counts statuses outside the reconciliation vocabulary separately and says so', async () => {
    const result = await new GetPaymentIntelligenceUseCase(repo({
      paymentAggregates: vi.fn().mockResolvedValue({
        attempts: 10, confirmed: 4, failed: 2, pending: 1, unrecognised: 3,
        callbackReceived: 5, ipnReceived: 4, reconciled: 4, byStatus: [], byProvider: [],
      }),
    })).execute({ days: 7 });
    expect(result.unrecognised).toBe(3);
    // 4 confirmed of 10 attempts — the 3 unknown are NOT counted as successes.
    expect(result.attemptSuccessRate.value).toBeCloseTo(0.4);
    expect(result.notes.join(' ')).toContain('outside the reconciliation vocabulary');
  });

  it('withholds a rate below the attempt sample floor rather than showing 0% or 100%', async () => {
    const result = await new GetPaymentIntelligenceUseCase(repo({
      paymentAggregates: vi.fn().mockResolvedValue({
        attempts: 2, confirmed: 2, failed: 0, pending: 0, unrecognised: 0,
        callbackReceived: 2, ipnReceived: 2, reconciled: 2,
        byStatus: [], byProvider: [{ provider: 'pesapal', attempts: 2, confirmed: 2 }],
      }),
    })).execute({ days: 7 });
    expect(result.attemptSuccessRate.state).toBe('INSUFFICIENT_EVIDENCE');
    expect(result.byProvider[0]!.successRate).toBeNull();
  });

  it('reports NO_DATA for an empty period and SOURCE_UNAVAILABLE when the query fails', async () => {
    const empty = await new GetPaymentIntelligenceUseCase(repo({
      paymentAggregates: vi.fn().mockResolvedValue({
        attempts: 0, confirmed: 0, failed: 0, pending: 0, unrecognised: 0,
        callbackReceived: 0, ipnReceived: 0, reconciled: 0, byStatus: [], byProvider: [],
      }),
    })).execute({ days: 7 });
    expect(empty.attemptSuccessRate.state).toBe('NO_DATA');
    expect(empty.attemptSuccessRate.value).toBeNull();

    const broken = await new GetPaymentIntelligenceUseCase(repo({
      paymentAggregates: vi.fn().mockRejectedValue(new Error('relation missing')),
    })).execute({ days: 7 });
    expect(broken.attemptSuccessRate.state).toBe('SOURCE_UNAVAILABLE');
    expect(broken.attemptSuccessRate.value).toBeNull();
  });
});

describe('GetAnalyticsBreakdownUseCase', () => {
  it('refuses a dimension outside the allowlist', async () => {
    const result = await new GetAnalyticsBreakdownUseCase(repo()).execute('customer_email', { days: 7 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('UNKNOWN_DIMENSION');
  });

  it('computes shares from the period total', async () => {
    const result = await new GetAnalyticsBreakdownUseCase(repo()).execute('payment_status', { days: 7 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.totalOrders).toBe(10);
    expect(result.data.rows[0]!.share).toBeCloseTo(0.6);
  });
});

describe('GetAnalyticsExceptionDrilldownUseCase', () => {
  it('refuses an unknown exception', async () => {
    const result = await new GetAnalyticsExceptionDrilldownUseCase(repo()).execute('everything', { days: 7 });
    expect(result.ok).toBe(false);
  });

  it('returns order numbers and states only — never customer fields', async () => {
    const result = await new GetAnalyticsExceptionDrilldownUseCase(repo()).execute('paid_not_processing', { days: 7 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const serialised = JSON.stringify(result.data).toLowerCase();
    for (const forbidden of ['customername', 'customerphone', 'customeremail', 'deliveryaddress']) {
      expect(serialised).not.toContain(forbidden);
    }
    expect(result.data.rows[0]!.orderNumber).toBe('GP-1001');
  });

  it('bounds the row limit and reports truncation honestly', async () => {
    const spy = vi.fn().mockResolvedValue([]);
    await new GetAnalyticsExceptionDrilldownUseCase(repo({ paidNotProcessingOrders: spy }))
      .execute('paid_not_processing', { days: 7, limit: 100_000 });
    expect(spy.mock.calls[0]![2]).toBe(MAX_DRILLDOWN_ROWS);

    const full = await new GetAnalyticsExceptionDrilldownUseCase(repo({
      paidNotProcessingOrders: vi.fn().mockResolvedValue([
        { orderNumber: 'GP-1', orderStatus: 'received', paymentStatus: 'paid', ageHours: 1, totalAmount: 1 },
      ]),
    })).execute('paid_not_processing', { days: 7, limit: 1 });
    expect(full.ok).toBe(true);
    if (full.ok) expect(full.data.truncated).toBe(true);
  });
});
