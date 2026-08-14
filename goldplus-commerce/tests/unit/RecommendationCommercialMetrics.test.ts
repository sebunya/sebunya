import { describe, expect, it } from 'vitest';

import {
  computeCommercialMetrics, computeRevenueAttribution, computeCompletedOrderConversion,
  computeRealisedCustomerValue, computeRoas, computeGrossProfitContribution,
  netAttributedRevenue, realisedLines,
  type AttributedOrderLine, type CommercialInputs,
} from '../../apps/api/src/application/recommendations/RecommendationCommercialMetrics';

/**
 * These five metrics were shown as "not available in this pass", which
 * described an unfinished implementation rather than the state of the data.
 * The tests below pin two things: the calculators produce correct numbers when
 * evidence exists, and they say precisely WHY when it does not — because a
 * missing media cost reported as a ROAS of zero is a lie an operator would act
 * on.
 */

const line = (over: Partial<AttributedOrderLine> = {}): AttributedOrderLine => ({
  orderId: 'ord-1', productId: 'prod-1', lineTotalUgx: 100_000, cogsUgx: 60_000,
  paid: true, cancelled: false, refundedUgx: 0, customerId: 'cust-1', currency: 'UGX', ...over,
});

const inputs = (over: Partial<CommercialInputs> = {}): CommercialInputs => ({
  attributedLines: [], exposures: 0, clicks: 0, attributedCompletedOrders: 0,
  mediaSpendUgx: null, customerOrderTotals: [], ...over,
});

// ── What counts as revenue (§24) ────────────────────────────────────────────

describe('only money actually received and kept counts as revenue', () => {
  it('counts a paid, uncancelled line', () => {
    expect(netAttributedRevenue([line()])).toBe(100_000);
  });

  it('excludes an unpaid line', () => {
    // A cart or started checkout is not revenue however far it progressed.
    expect(netAttributedRevenue([line({ paid: false })])).toBe(0);
  });

  it('excludes a cancelled order even when payment succeeded', () => {
    expect(netAttributedRevenue([line({ cancelled: true })])).toBe(0);
  });

  it('subtracts refunds', () => {
    expect(netAttributedRevenue([line({ refundedUgx: 30_000 })])).toBe(70_000);
  });

  it('never returns negative revenue when a refund exceeds the line', () => {
    expect(netAttributedRevenue([line({ refundedUgx: 500_000 })])).toBe(0);
  });

  it('sums across a multi-line order', () => {
    expect(netAttributedRevenue([
      line({ productId: 'a', lineTotalUgx: 50_000 }),
      line({ productId: 'b', lineTotalUgx: 25_000 }),
    ])).toBe(75_000);
  });

  it('filters realised lines consistently', () => {
    const all = [line(), line({ paid: false }), line({ cancelled: true })];
    expect(realisedLines(all)).toHaveLength(1);
  });
});

describe('revenue attribution reports why it has no number', () => {
  it('is NO_DATA when nothing was ever attributed', () => {
    const m = computeRevenueAttribution(inputs());
    expect(m.state).toBe('NO_DATA');
    expect(m.value).toBeNull();
  });

  it('is NO_DATA — not zero — when attributed lines exist but none is paid', () => {
    // This is production truth today: orders exist, none are paid.
    const m = computeRevenueAttribution(inputs({ attributedLines: [line({ paid: false })] }));
    expect(m.state).toBe('NO_DATA');
    expect(m.value).toBeNull();
    expect(m.reason).toMatch(/none belongs to a paid/i);
  });

  it('reports a real figure when paid lines exist', () => {
    const m = computeRevenueAttribution(inputs({ attributedLines: [line(), line({ productId: 'b' })] }));
    expect(m.state).toBe('OPERATIONAL_WITH_VALUE');
    expect(m.value).toBe(200_000);
  });

  it('names itself precisely rather than calling itself Revenue', () => {
    expect(computeRevenueAttribution(inputs()).label).toBe('Net attributed revenue');
  });
});

// ── Conversion needs an unambiguous denominator (§25) ───────────────────────

describe('completed-order conversion states its denominator', () => {
  it('reports exposure and click conversion as separate metrics', () => {
    const m = computeCompletedOrderConversion(inputs({ exposures: 1000, clicks: 100, attributedCompletedOrders: 5 }));
    expect(m).toHaveLength(2);
    expect(m[0].key).toBe('exposureToCompletedOrder');
    expect(m[1].key).toBe('clickToCompletedOrder');
  });

  it('computes each rate against its own population', () => {
    const m = computeCompletedOrderConversion(inputs({ exposures: 1000, clicks: 100, attributedCompletedOrders: 5 }));
    expect(m[0].value).toBeCloseTo(0.005);
    expect(m[1].value).toBeCloseTo(0.05);
  });

  it('is NO_DATA when the population is empty, never a zero rate', () => {
    const m = computeCompletedOrderConversion(inputs({ exposures: 0, clicks: 0 }));
    expect(m[0].state).toBe('NO_DATA');
    expect(m[0].value).toBeNull();
  });

  it('reports a genuine zero when there were impressions but no orders', () => {
    const m = computeCompletedOrderConversion(inputs({ exposures: 500, clicks: 20, attributedCompletedOrders: 0 }));
    expect(m[0].state).toBe('OPERATIONAL_ZERO');
    expect(m[0].value).toBe(0);
  });
});

// ── Customer value is realised, not predicted (§26) ─────────────────────────

describe('customer value describes money already received', () => {
  it('is NO_DATA when no completed order is linked to a customer', () => {
    const m = computeRealisedCustomerValue(inputs());
    expect(m.state).toBe('NO_DATA');
    expect(m.value).toBeNull();
  });

  it('averages realised value across identified customers', () => {
    const m = computeRealisedCustomerValue(inputs({ customerOrderTotals: [
      { customerId: 'a', completedOrders: 2, totalPaidUgx: 300_000 },
      { customerId: 'b', completedOrders: 1, totalPaidUgx: 100_000 },
    ] }));
    expect(m.value).toBe(200_000);
    expect(m.sampleSize).toBe(2);
  });

  it('does not claim to predict future spend', () => {
    const m = computeRealisedCustomerValue(inputs());
    expect(m.label).toBe('Realised customer value');
    expect(m.definition).toMatch(/not a prediction/i);
  });
});

// ── ROAS requires real spend (§27) ──────────────────────────────────────────

describe('ROAS is not reported without recorded spend', () => {
  it('is MEDIA_COST_MISSING — never zero — when no spend is recorded', () => {
    // Reporting 0 here would tell an operator the campaign failed, when in
    // fact nobody has entered what it cost.
    const m = computeRoas(inputs({ attributedLines: [line()], mediaSpendUgx: null }));
    expect(m.state).toBe('MEDIA_COST_MISSING');
    expect(m.value).toBeNull();
    expect(m.reason).toMatch(/Media Costs/);
  });

  it('refuses to divide by a recorded zero spend', () => {
    const m = computeRoas(inputs({ attributedLines: [line()], mediaSpendUgx: 0 }));
    expect(m.state).toBe('INSUFFICIENT_EVIDENCE');
    expect(m.value).toBeNull();
  });

  it('computes a real ratio when both sides exist', () => {
    const m = computeRoas(inputs({ attributedLines: [line({ lineTotalUgx: 400_000 })], mediaSpendUgx: 100_000 }));
    expect(m.state).toBe('OPERATIONAL_WITH_VALUE');
    expect(m.value).toBe(4);
  });

  it('reports a genuine zero when spend exists but no revenue was realised', () => {
    const m = computeRoas(inputs({ attributedLines: [line({ paid: false })], mediaSpendUgx: 50_000 }));
    expect(m.state).toBe('OPERATIONAL_ZERO');
    expect(m.value).toBe(0);
  });
});

// ── Profit is gross, and never assumes free goods (§28) ─────────────────────

describe('profit contribution never treats an unknown cost as zero', () => {
  it('computes revenue less recorded cost', () => {
    const m = computeGrossProfitContribution(inputs({ attributedLines: [line({ lineTotalUgx: 100_000, cogsUgx: 60_000 })] }));
    expect(m.state).toBe('OPERATIONAL_WITH_VALUE');
    expect(m.value).toBe(40_000);
  });

  it('refuses to report profit when NO line carries a cost', () => {
    // Assuming zero cost would report the whole selling price as profit.
    const m = computeGrossProfitContribution(inputs({ attributedLines: [line({ cogsUgx: null })] }));
    expect(m.state).toBe('PRODUCT_COST_COVERAGE_PARTIAL');
    expect(m.value).toBeNull();
  });

  it('computes from covered lines only and says how many were excluded', () => {
    const m = computeGrossProfitContribution(inputs({ attributedLines: [
      line({ productId: 'a', lineTotalUgx: 100_000, cogsUgx: 60_000 }),
      line({ productId: 'b', lineTotalUgx: 200_000, cogsUgx: null }),
    ] }));
    expect(m.state).toBe('PRODUCT_COST_COVERAGE_PARTIAL');
    expect(m.value).toBe(40_000);
    expect(m.reason).toMatch(/1 of 2/);
  });

  it('deducts refunds before subtracting cost', () => {
    const m = computeGrossProfitContribution(inputs({ attributedLines: [
      line({ lineTotalUgx: 100_000, refundedUgx: 20_000, cogsUgx: 60_000 }),
    ] }));
    expect(m.value).toBe(20_000);
  });

  it('is named gross and says what it does not deduct', () => {
    const m = computeGrossProfitContribution(inputs());
    expect(m.label).toBe('Gross profit contribution');
    expect(m.definition).toMatch(/does not deduct/i);
  });

  it('can report a genuine loss', () => {
    const m = computeGrossProfitContribution(inputs({ attributedLines: [line({ lineTotalUgx: 50_000, cogsUgx: 80_000 })] }));
    expect(m.value).toBe(-30_000);
  });
});

// ── The set as a whole ──────────────────────────────────────────────────────

describe('the full metric set is truthful against real production shape', () => {
  it('produces six metrics', () => {
    expect(computeCommercialMetrics(inputs())).toHaveLength(6);
  });

  it('reports honestly for production as it stands: events but no paid orders', () => {
    // 142,326 recommendation events, 23 orders, 0 paid, no cost records.
    const all = computeCommercialMetrics(inputs({
      exposures: 120_000, clicks: 20_000, attributedCompletedOrders: 0,
      attributedLines: [line({ paid: false })], mediaSpendUgx: null,
    }));
    const by = Object.fromEntries(all.map((m) => [m.key, m]));
    expect(by.revenueAttribution.state).toBe('NO_DATA');
    expect(by.exposureToCompletedOrder.state).toBe('OPERATIONAL_ZERO');
    expect(by.realisedCustomerValue.state).toBe('NO_DATA');
    expect(by.roas.state).toBe('MEDIA_COST_MISSING');
    expect(by.grossProfitContribution.state).toBe('NO_DATA');
    // Not one of them is a fabricated zero.
    for (const m of all) {
      if (m.state === 'NO_DATA' || m.state === 'MEDIA_COST_MISSING') expect(m.value).toBeNull();
    }
  });

  it('gives every metric a definition an operator can read', () => {
    for (const m of computeCommercialMetrics(inputs())) {
      expect(m.definition.length).toBeGreaterThan(40);
      expect(m.reason.length).toBeGreaterThan(10);
    }
  });

  it('never says a feature is unavailable in this pass', () => {
    const text = JSON.stringify(computeCommercialMetrics(inputs()));
    expect(text).not.toMatch(/not available in this pass|deferred until|phase 2/i);
  });
});
