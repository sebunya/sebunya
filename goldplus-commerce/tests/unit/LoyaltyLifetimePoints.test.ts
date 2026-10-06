import { describe, expect, it } from 'vitest';
import { computeBalance, countsTowardLifetime, LIFETIME_POINTS_FILTER_SQL, type LoyaltyLedgerEntry } from '../../apps/api/src/domain/loyalty/LoyaltyLedger';

const entry = (type: LoyaltyLedgerEntry['type'], points: number, idempotencyKey: string): LoyaltyLedgerEntry => ({
  id: idempotencyKey, accountId: 'a', type, points, orderId: null, reason: '', idempotencyKey,
  expiresAt: null, reversedEntryId: null, createdAt: new Date('2026-10-01'),
});

describe('lifetime points (what tiers are assigned by)', () => {
  it('count order earns, referral rewards and mission bonuses', () => {
    expect(countsTowardLifetime(entry('earn', 500, 'order:o1'))).toBe(true);
    expect(countsTowardLifetime(entry('adjustment', 200, 'referral:r1:referrer'))).toBe(true);
    expect(countsTowardLifetime(entry('adjustment', 100, 'referral:r1:referee'))).toBe(true);
    expect(countsTowardLifetime(entry('adjustment', 300, 'mission:refer_three:u1'))).toBe(true);
  });

  it('do not count scans, birthdays, draws, redemptions or negative adjustments', () => {
    expect(countsTowardLifetime(entry('adjustment', 25, 'scan:u1:x'))).toBe(false);
    expect(countsTowardLifetime(entry('adjustment', 150, 'birthday:u1:2026'))).toBe(false);
    expect(countsTowardLifetime(entry('redeem', -500, 'redeem:o2'))).toBe(false);
    expect(countsTowardLifetime(entry('adjustment', -200, 'mission:x:u1'))).toBe(false);
  });

  it('shows on the account page as lifetime earned', () => {
    const b = computeBalance([entry('earn', 500, 'order:o1'), entry('adjustment', 300, 'mission:refer_three:u1'), entry('adjustment', 25, 'scan:u1:x')], new Date('2026-10-06'));
    expect(b.lifetimeEarned).toBe(800);
    expect(b.available).toBe(825);
  });

  it('the SQL twin names the same two key prefixes', () => {
    expect(LIFETIME_POINTS_FILTER_SQL).toContain("'referral:%'");
    expect(LIFETIME_POINTS_FILTER_SQL).toContain("'mission:%'");
  });
});
