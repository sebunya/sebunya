import { describe, expect, it } from 'vitest';
import { holdoutArm, liftSummary, waveKeyFor, MIN_ARM_SUBJECTS } from '../../apps/api/src/domain/measurement/Incrementality';

describe('holdout arms', () => {
  it('is deterministic and close to the asked share', () => {
    let held = 0;
    for (let i = 0; i < 20_000; i++) {
      const a = holdoutArm({ programme: 'win_back', waveKey: '2026-10', subjectKey: `c-${i}`, salt: 's', share: 0.1 });
      expect(a).toBe(holdoutArm({ programme: 'win_back', waveKey: '2026-10', subjectKey: `c-${i}`, salt: 's', share: 0.1 }));
      if (a === 'hold') held++;
    }
    expect(held / 20_000).toBeGreaterThan(0.085);
    expect(held / 20_000).toBeLessThan(0.115);
  });
  it('a zero share treats everyone; a different wave or salt reshuffles', () => {
    expect(holdoutArm({ programme: 'p', waveKey: 'w', subjectKey: 'x', salt: 's', share: 0 })).toBe('treat');
    const arms = new Set<string>();
    for (let i = 0; i < 200; i++) arms.add(holdoutArm({ programme: 'p', waveKey: `w${i}`, subjectKey: 'x', salt: 's', share: 0.5 }));
    expect(arms.size).toBe(2);
  });
  it('caps the share at one half so a programme can never hold most of its audience', () => {
    let held = 0;
    for (let i = 0; i < 4000; i++) if (holdoutArm({ programme: 'p', waveKey: 'w', subjectKey: `${i}`, salt: 's', share: 0.95 }) === 'hold') held++;
    expect(held / 4000).toBeLessThan(0.56);
  });
  it('waves are calendar months in UTC', () => {
    expect(waveKeyFor(new Date('2026-10-31T23:59:59Z'))).toBe('2026-10');
    expect(waveKeyFor(new Date('2026-11-01T00:00:00Z'))).toBe('2026-11');
  });
});

describe('lift summary', () => {
  it('refuses to call a lift on a thin arm', () => {
    const s = liftSummary({ subjects: 500, buyers: 40, orders: 42, revenueMinor: 4_000_000n }, { subjects: MIN_ARM_SUBJECTS - 1, buyers: 1, orders: 1, revenueMinor: 100_000n });
    expect(s.status).toBe('insufficient');
    expect(s.significant).toBe(false);
    expect(s.reason).toContain('at least 30');
  });
  it('measures a real difference and the revenue it caused', () => {
    const s = liftSummary({ subjects: 900, buyers: 90, orders: 95, revenueMinor: 9_000_000n }, { subjects: 200, buyers: 8, orders: 8, revenueMinor: 800_000n });
    expect(s.status).toBe('measured');
    expect(s.treat.conversion).toBeCloseTo(0.1);
    expect(s.hold.conversion).toBeCloseTo(0.04);
    expect(s.conversionLift).toBeCloseTo(0.06);
    expect(s.relativeLift).toBeCloseTo(1.5);
    // 10,000 per treated subject minus 4,000 per held subject, times 900 treated.
    expect(s.incrementalRevenueMinor).toBe(5_400_000n);
    expect(s.z).toBeGreaterThan(2.5);
    expect(s.significant).toBe(true);
  });
  it('no difference is not significant', () => {
    const s = liftSummary({ subjects: 1000, buyers: 50, orders: 50, revenueMinor: 5_000_000n }, { subjects: 1000, buyers: 50, orders: 50, revenueMinor: 5_000_000n });
    expect(s.status).toBe('measured');
    expect(s.pValue).toBeCloseTo(1, 5);
    expect(s.significant).toBe(false);
    expect(s.incrementalRevenueMinor).toBe(0n);
  });
});
