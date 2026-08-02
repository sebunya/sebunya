import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PERMISSIONS } from '../../packages/shared/src/permissions';
import {
  GetAnalyticsMetricSeriesUseCase,
  GetAnalyticsOverviewUseCase,
} from '../../apps/api/src/application/use-cases/analytics/CommerceAnalyticsUseCases';
import type { IAnalyticsReadRepository } from '../../apps/api/src/application/ports/IAnalyticsReadRepository';

const registry = vi.hoisted(() => ({
  getAnalyticsOverviewUseCase: { execute: vi.fn() },
  getAnalyticsMetricSeriesUseCase: { execute: vi.fn() },
  getAnalyticsDataQualityUseCase: { execute: vi.fn() },
  getPaymentIntelligenceUseCase: { execute: vi.fn() },
  getAnalyticsBreakdownUseCase: { execute: vi.fn() },
  getAnalyticsExceptionDrilldownUseCase: { execute: vi.fn() },
}));

vi.mock('../../apps/api/src/infrastructure/Registry', () => ({
  Registry: { getInstance: () => registry },
}));

vi.mock('../../apps/api/src/interfaces/http/middleware/auth', () => ({
  authMiddleware: async (c: any, next: any) => {
    const auth = c.req.header('Authorization');
    if (!auth) return c.json({ success: false }, 401);
    const permissions = auth === 'Bearer analytics'
      ? [PERMISSIONS.ANALYTICS_READ]
      : auth === 'Bearer all'
        ? Object.values(PERMISSIONS)
        : [];
    c.set('user', { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', permissions });
    await next();
  },
}));

import app from '../../apps/api/src/interfaces/http/app';

describe('Commerce Analytics protected API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    registry.getAnalyticsOverviewUseCase.execute.mockResolvedValue({ generatedAt: 'x', period: {}, actions: [] });
    registry.getAnalyticsMetricSeriesUseCase.execute.mockResolvedValue({ ok: true, data: { points: [] } });
    registry.getAnalyticsDataQualityUseCase.execute.mockResolvedValue({ sources: [] });
    registry.getPaymentIntelligenceUseCase.execute.mockResolvedValue({ attempts: 0 });
    registry.getAnalyticsBreakdownUseCase.execute.mockResolvedValue({ ok: true, data: { rows: [] } });
    registry.getAnalyticsExceptionDrilldownUseCase.execute.mockResolvedValue({ ok: true, data: { rows: [] } });
  });

  it('requires authentication and the exact analytics.read permission', async () => {
    expect((await app.request('/admin/analytics/overview')).status).toBe(401);
    expect((await app.request('/admin/analytics/overview', { headers: { Authorization: 'Bearer none' } })).status).toBe(403);
    expect((await app.request('/admin/analytics/overview', { headers: { Authorization: 'Bearer analytics' } })).status).toBe(200);
  });

  it('protects every analytics endpoint, not only the overview', async () => {
    for (const path of [
      '/admin/analytics/metrics/orders/series',
      '/admin/analytics/quality',
      '/admin/analytics/actions',
      '/admin/analytics/catalogue',
      '/admin/analytics/payments',
      '/admin/analytics/breakdowns/payment_status',
      '/admin/analytics/exceptions/paid_not_processing',
    ]) {
      expect((await app.request(path)).status, path).toBe(401);
      expect((await app.request(path, { headers: { Authorization: 'Bearer none' } })).status, path).toBe(403);
    }
  });

  it('rejects malformed period input before reaching the use case', async () => {
    const response = await app.request('/admin/analytics/overview?startDate=01-08-2026', {
      headers: { Authorization: 'Bearer analytics' },
    });
    expect(response.status).toBe(400);
    expect(registry.getAnalyticsOverviewUseCase.execute).not.toHaveBeenCalled();
  });

  it('rejects out-of-bounds day windows', async () => {
    const response = await app.request('/admin/analytics/overview?days=4000', {
      headers: { Authorization: 'Bearer analytics' },
    });
    expect(response.status).toBe(400);
  });

  it('maps reversed periods to a client error, not a 500', async () => {
    registry.getAnalyticsOverviewUseCase.execute.mockRejectedValue(new Error('END_BEFORE_START'));
    const response = await app.request('/admin/analytics/overview?startDate=2026-08-03&endDate=2026-08-02', {
      headers: { Authorization: 'Bearer analytics' },
    });
    expect(response.status).toBe(400);
  });

  it('returns 404 for a metric that is not in the catalogue', async () => {
    registry.getAnalyticsMetricSeriesUseCase.execute.mockResolvedValue({
      ok: false,
      code: 'UNKNOWN_METRIC',
      message: 'no such metric',
    });
    const response = await app.request('/admin/analytics/metrics/nonsense/series', {
      headers: { Authorization: 'Bearer analytics' },
    });
    expect(response.status).toBe(404);
  });

  it('returns 404 for a dimension or exception outside the allowlist', async () => {
    registry.getAnalyticsBreakdownUseCase.execute.mockResolvedValue({ ok: false, code: 'UNKNOWN_DIMENSION', message: 'no' });
    expect((await app.request('/admin/analytics/breakdowns/customer_email', { headers: { Authorization: 'Bearer analytics' } })).status).toBe(404);
    registry.getAnalyticsExceptionDrilldownUseCase.execute.mockResolvedValue({ ok: false, code: 'UNKNOWN_EXCEPTION', message: 'no' });
    expect((await app.request('/admin/analytics/exceptions/everything', { headers: { Authorization: 'Bearer analytics' } })).status).toBe(404);
  });

  it('rejects a non-positive drilldown limit', async () => {
    const response = await app.request('/admin/analytics/exceptions/paid_not_processing?limit=0', { headers: { Authorization: 'Bearer analytics' } });
    expect(response.status).toBe(400);
    expect(registry.getAnalyticsExceptionDrilldownUseCase.execute).not.toHaveBeenCalled();
  });

  it('serves the canonical catalogue', async () => {
    const response = await app.request('/admin/analytics/catalogue', {
      headers: { Authorization: 'Bearer analytics' },
    });
    expect(response.status).toBe(200);
    const body: any = await response.json();
    expect(body.success).toBe(true);
    expect(body.data.some((d: any) => d.key === 'paid_order_value')).toBe(true);
  });
});

function stubRepo(overrides: Partial<IAnalyticsReadRepository> = {}): IAnalyticsReadRepository {
  return {
    orderAggregates: vi.fn().mockResolvedValue({
      orders: 10, paidOrders: 6, paidOrderValueUgx: 600_000, grossOrderValueUgx: 900_000,
      discountValueUgx: 20_000, deliveryFeeValueUgx: 30_000, failedPayments: 2,
      completedOrders: 5, cancelledOrders: 1,
    }),
    dailyOrderBuckets: vi.fn().mockResolvedValue([
      { day: '2026-08-01', orders: 4, paidOrders: 2, paidOrderValueUgx: 200_000 },
    ]),
    lowStockCount: vi.fn().mockResolvedValue(3),
    searchDemandSummary: vi.fn().mockResolvedValue({ totalSearches: 50, zeroResultSearches: 10, lastSignalAt: new Date() }),
    sourceRecency: vi.fn().mockResolvedValue({ lastOrderAt: new Date(), lastPaymentAttemptAt: new Date(), lastSearchSignalAt: new Date() }),
    ...overrides,
  };
}

describe('GetAnalyticsOverviewUseCase', () => {
  it('builds catalogue metrics from bounded aggregates', async () => {
    const useCase = new GetAnalyticsOverviewUseCase(stubRepo(), async () => ({
      open: 0, criticalHigh: 2, stale: 0, unassigned: 0, resolvedToday: 0,
      byCategory: {}, bySeverity: {}, byOwner: [], avgAcknowledgementHours: null, avgResolutionHours: null,
    }));
    const result = await useCase.execute({ startDate: '2026-08-01', endDate: '2026-08-02' });
    expect(result.contractVersion).toBe('commerce-analytics-v2');
    expect(result.period.timezone).toBe('Africa/Kampala');
    const paid = result.metrics.find((m) => m.key === 'paid_order_value');
    expect(paid?.value).toBe(600_000);
    const failure = result.metrics.find((m) => m.key === 'payment_failure_rate');
    expect(failure?.value).toBeCloseTo(0.2);
    expect(failure?.assessment).toBe('FLAT');
    // Decision insights become an action through the shared rules.
    expect(result.actions.some((a) => a.source === 'decision_intelligence')).toBe(true);
  });

  it('degrades an unavailable source without failing the overview or faking zeros', async () => {
    const useCase = new GetAnalyticsOverviewUseCase(
      stubRepo({ searchDemandSummary: vi.fn().mockRejectedValue(new Error('relation missing')) }),
      async () => { throw new Error('decisions down'); },
    );
    const result = await useCase.execute({ startDate: '2026-08-01', endDate: '2026-08-02' });
    const zeroResult = result.metrics.find((m) => m.key === 'search_zero_result_rate');
    expect(zeroResult?.state).toBe('SOURCE_UNAVAILABLE');
    expect(zeroResult?.value).toBeNull();
    expect(result.quality.status).not.toBe('HEALTHY');
    expect(result.quality.warnings.join(' ')).toContain('search');
    expect(result.actions.some((a) => a.source === 'decision_intelligence')).toBe(false);
  });

  it('zero-fills missing Kampala days in the trend', async () => {
    const useCase = new GetAnalyticsOverviewUseCase(stubRepo(), async () => ({
      open: 0, criticalHigh: 0, stale: 0, unassigned: 0, resolvedToday: 0,
      byCategory: {}, bySeverity: {}, byOwner: [], avgAcknowledgementHours: null, avgResolutionHours: null,
    }));
    const result = await useCase.execute({ startDate: '2026-08-01', endDate: '2026-08-03' });
    expect(result.trend.map((p) => p.day)).toEqual(['2026-08-01', '2026-08-02', '2026-08-03']);
    expect(result.trend[1]!.orders).toBe(0);
    expect(result.trend[1]!.paidOrderValueUgx).toBe(0);
  });
});

describe('GetAnalyticsMetricSeriesUseCase', () => {
  it('refuses metrics outside the catalogue and outside series support', async () => {
    const useCase = new GetAnalyticsMetricSeriesUseCase(stubRepo());
    expect((await useCase.execute('made_up', {})).ok).toBe(false);
    const unsupported = await useCase.execute('low_stock_products', {});
    expect(unsupported.ok).toBe(false);
    if (!unsupported.ok) expect(unsupported.code).toBe('UNSUPPORTED_METRIC');
  });

  it('returns a zero-filled daily series for supported metrics', async () => {
    const useCase = new GetAnalyticsMetricSeriesUseCase(stubRepo());
    const result = await useCase.execute('paid_order_value', { startDate: '2026-08-01', endDate: '2026-08-02' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.points).toEqual([
        { day: '2026-08-01', value: 200_000 },
        { day: '2026-08-02', value: 0 },
      ]);
    }
  });
});
