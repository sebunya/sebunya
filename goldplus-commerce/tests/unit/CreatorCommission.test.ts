import { describe, expect, it } from 'vitest';
import { computeCommission, computeWithholding, primaryMechanism, attributionConfidence } from '../../apps/api/src/domain/creators/Commission';

describe('U4 commission maths', () => {
  it('commissionable revenue excludes delivery fee and tax', () => {
    const r = computeCommission({ grossRevenueUgx: 120_000, deliveryFeeUgx: 10_000, taxUgx: 0, commissionRateBps: 1000 });
    expect(r.commissionableRevenueUgx).toBe(110_000);
    expect(r.commissionAmountUgx).toBe(11_000); // 10% of 110,000
  });
  it('applies the commission cap', () => {
    const r = computeCommission({ grossRevenueUgx: 1_000_000, deliveryFeeUgx: 0, taxUgx: 0, commissionRateBps: 2000, commissionCapUgx: 50_000 });
    expect(r.commissionAmountUgx).toBe(50_000); // capped from 200,000
  });
});

describe('U4 withholding tax (AC8)', () => {
  it('gross minus withholding equals net for every rate', () => {
    for (const rate of [0, 600, 1000, 1500]) {
      const w = computeWithholding(90_000, rate);
      expect(w.netAmountUgx).toBe(w.grossAmountUgx - w.withholdingTaxUgx);
    }
    expect(computeWithholding(100_000, 600).withholdingTaxUgx).toBe(6_000);
  });
});

describe('U4 attribution precedence', () => {
  it('code beats link beats survey', () => {
    expect(primaryMechanism(['survey', 'link', 'code'])).toBe('code');
    expect(primaryMechanism(['survey', 'link'])).toBe('link');
    expect(primaryMechanism(['survey'])).toBe('survey');
    expect(primaryMechanism([])).toBeNull();
  });
  it('maps mechanism to confidence', () => {
    expect(attributionConfidence('code')).toBe('high');
    expect(attributionConfidence('link')).toBe('medium');
    expect(attributionConfidence('survey')).toBe('low');
  });
});
