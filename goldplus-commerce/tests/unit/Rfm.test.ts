import { describe, it, expect } from 'vitest';
import { scoreRfm, segmentFor, RfmInput } from '../../apps/api/src/domain/customer-dna/Rfm';

const now = new Date('2026-08-02T00:00:00Z');
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000);

describe('scoreRfm — quintile scoring within the population', () => {
  const pop: RfmInput[] = [
    { customerId: 'best', lastOrderAt: daysAgo(1), orderCount: 20, totalSpendUgx: 10_000_000 },
    { customerId: 'good', lastOrderAt: daysAgo(15), orderCount: 8, totalSpendUgx: 4_000_000 },
    { customerId: 'mid', lastOrderAt: daysAgo(45), orderCount: 4, totalSpendUgx: 1_500_000 },
    { customerId: 'weak', lastOrderAt: daysAgo(120), orderCount: 2, totalSpendUgx: 400_000 },
    { customerId: 'worst', lastOrderAt: daysAgo(300), orderCount: 1, totalSpendUgx: 100_000 },
  ];

  it('gives the most recent, frequent, high-spend customer the top scores', () => {
    const scores = scoreRfm(pop, now);
    const best = scores.find((s) => s.customerId === 'best')!;
    expect(best.r).toBe(5);
    expect(best.f).toBe(5);
    expect(best.m).toBe(5);
    expect(best.segment).toBe('Champions');
  });

  it('gives the least recent, least frequent, lowest-spend customer the bottom scores', () => {
    const scores = scoreRfm(pop, now);
    const worst = scores.find((s) => s.customerId === 'worst')!;
    expect(worst.r).toBe(1);
    expect(worst.f).toBe(1);
    expect(worst.segment).toBe('Lost');
  });

  it('scores a never-purchased customer honestly at the bottom (recency 1)', () => {
    const withNever = [...pop, { customerId: 'never', lastOrderAt: null, orderCount: 0, totalSpendUgx: 0 }];
    const s = scoreRfm(withNever, now).find((x) => x.customerId === 'never')!;
    expect(s.r).toBe(1);
    expect(s.recencyDays).toBeNull();
  });

  it('is deterministic', () => {
    expect(scoreRfm(pop, now)).toEqual(scoreRfm(pop, now));
  });
});

describe('segmentFor — R×F grid', () => {
  it('maps representative cells to their segments', () => {
    expect(segmentFor(5, 5)).toBe('Champions');
    expect(segmentFor(4, 3)).toBe('Potential Loyalist');
    expect(segmentFor(3, 4)).toBe('Loyal');
    expect(segmentFor(2, 5)).toBe("Can't Lose");
    expect(segmentFor(2, 2)).toBe('At Risk');
    expect(segmentFor(1, 1)).toBe('Lost');
    expect(segmentFor(4, 1)).toBe('New');
  });
});
