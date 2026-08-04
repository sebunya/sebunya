import { describe, it, expect } from 'vitest';
import {
  planRedemption,
  computeProRataClawback,
  budgetCapReached,
  dueExpiryNotices,
  computeBalance,
  computeExpirableEarns,
  LoyaltyLedgerEntry,
  LoyaltyProgrammeConfig,
} from '../../apps/api/src/domain/loyalty/LoyaltyLedger';

const CONFIG: LoyaltyProgrammeConfig = {
  enabled: true,
  earnRatePer1000Ugx: 10,
  expiryDays: 120,
  pointValueUgx: 20,
  redemptionMinPoints: 100,
  redemptionMaxShareBps: 5000, // 50%
  budgetCapPoints: null,
  killSwitch: false,
  guestBackfillLookbackDays: null,
  guestBackfillCapPoints: null,
};

function entry(over: Partial<LoyaltyLedgerEntry>): LoyaltyLedgerEntry {
  return {
    id: over.id ?? Math.random().toString(36).slice(2),
    accountId: 'a1',
    type: 'earn',
    points: 100,
    orderId: 'o1',
    reason: 'test',
    idempotencyKey: over.idempotencyKey ?? `k:${Math.random()}`,
    expiresAt: null,
    reversedEntryId: null,
    createdAt: new Date('2026-01-01'),
    ...over,
  };
}

describe('planRedemption (PART G)', () => {
  it('unset config refuses with REDEMPTION_UNAVAILABLE — never a default', () => {
    const r = planRedemption({
      points: 200,
      balanceAvailable: 1000,
      orderGoodsTotalUgx: 100_000,
      config: { ...CONFIG, pointValueUgx: null },
    });
    expect(r).toMatchObject({ ok: false, code: 'REDEMPTION_UNAVAILABLE' });
  });
  it('below minimum refused', () => {
    expect(planRedemption({ points: 50, balanceAvailable: 1000, orderGoodsTotalUgx: 100_000, config: CONFIG })).toMatchObject({ ok: false, code: 'BELOW_MINIMUM' });
  });
  it('insufficient balance refused', () => {
    expect(planRedemption({ points: 2000, balanceAvailable: 1000, orderGoodsTotalUgx: 1_000_000, config: CONFIG })).toMatchObject({ ok: false, code: 'INSUFFICIENT_BALANCE' });
  });
  it('max-share ceiling refused with a clear message (the margin guard)', () => {
    // 300 pts × 20 UGX = 6,000 > 50% of 10,000
    expect(planRedemption({ points: 300, balanceAvailable: 1000, orderGoodsTotalUgx: 10_000, config: CONFIG })).toMatchObject({ ok: false, code: 'EXCEEDS_MAX_SHARE' });
  });
  it('a valid partial redemption converts at the configured value', () => {
    const r = planRedemption({ points: 200, balanceAvailable: 1000, orderGoodsTotalUgx: 100_000, config: CONFIG });
    expect(r).toMatchObject({ ok: true, valueUgx: 4000, pointValueUgx: 20 });
  });
});

describe('pro-rata clawback (PART F)', () => {
  it('full refund claws the whole earn', () => {
    expect(computeProRataClawback(150, 10_000)).toBe(150);
  });
  it('partial refund claws pro rata, floored — never over-claws', () => {
    expect(computeProRataClawback(150, 5000)).toBe(75);
    expect(computeProRataClawback(101, 3333)).toBe(33);
  });
  it('degenerate shares claw nothing', () => {
    expect(computeProRataClawback(150, 0)).toBe(0);
    expect(computeProRataClawback(0, 10_000)).toBe(0);
  });
});

describe('budget cap (PART N)', () => {
  it('null cap never pauses; a reached cap pauses', () => {
    expect(budgetCapReached(1_000_000, null)).toBe(false);
    expect(budgetCapReached(999, 1000)).toBe(false);
    expect(budgetCapReached(1000, 1000)).toBe(true);
  });
});

describe('expiry notices (PART H)', () => {
  const expiresAt = new Date('2026-06-01T00:00:00Z');
  const earn = entry({ expiresAt, points: 500 });
  it('30d/7d/1d fire as the window closes, never after expiry', () => {
    expect(dueExpiryNotices(earn, new Date('2026-04-01'))).toEqual([]);
    expect(dueExpiryNotices(earn, new Date('2026-05-10'))).toEqual(['30d']);
    expect(dueExpiryNotices(earn, new Date('2026-05-26'))).toEqual(['30d', '7d']);
    expect(dueExpiryNotices(earn, new Date('2026-05-31T12:00:00Z'))).toEqual(['30d', '7d', '1d']);
    expect(dueExpiryNotices(earn, new Date('2026-06-02'))).toEqual([]);
  });
  it('non-earns and never-expiring earns warn nobody', () => {
    expect(dueExpiryNotices(entry({ type: 'redeem', points: -10 }), new Date())).toEqual([]);
    expect(dueExpiryNotices(entry({ expiresAt: null }), new Date())).toEqual([]);
  });
});

describe('FIFO + reversal-of-redeem (PART G reversal keeps original expiry)', () => {
  it('a reversed redeem re-frees the oldest earns for expiry accounting', () => {
    const now = new Date('2026-07-01');
    const earn1 = entry({ id: 'e1', points: 100, expiresAt: new Date('2026-06-01'), createdAt: new Date('2026-01-01') });
    const redeem = entry({ id: 'r1', type: 'redeem', points: -100, createdAt: new Date('2026-02-01') });
    // redeem consumed e1 fully → nothing expirable
    expect(computeExpirableEarns([earn1, redeem], now)).toHaveLength(0);
    // reversal of the redeem returns the points; e1 is past expiry → expirable again
    const reversal = entry({ id: 'v1', type: 'reversal', points: 100, reversedEntryId: 'r1', createdAt: new Date('2026-03-01') });
    const due = computeExpirableEarns([earn1, redeem, reversal], now);
    expect(due).toHaveLength(1);
    expect(due[0].entry.id).toBe('e1');
    expect(due[0].points).toBe(100);
  });
  it('balance stays derived and signed through the whole lifecycle', () => {
    const entries = [
      entry({ id: 'e1', points: 300 }),
      entry({ id: 'r1', type: 'redeem', points: -100 }),
      entry({ id: 'c1', type: 'reversal', points: -200, reversedEntryId: 'e1' }), // clawback
    ];
    const balance = computeBalance(entries, new Date());
    expect(balance.available).toBe(0);
    expect(balance.lifetimeEarned).toBe(300);
    expect(balance.lifetimeRedeemed).toBe(100);
  });
  it('a spent-then-clawed balance goes negative and the negative is carried', () => {
    const entries = [
      entry({ id: 'e1', points: 100 }),
      entry({ id: 'r1', type: 'redeem', points: -100 }),
      entry({ id: 'c1', type: 'reversal', points: -100, reversedEntryId: 'e1' }),
    ];
    expect(computeBalance(entries, new Date()).available).toBe(-100);
  });
});
