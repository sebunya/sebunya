import { describe, expect, it, vi } from 'vitest';
import { EvaluateTiersUseCase } from '../../apps/api/src/application/use-cases/loyalty/LoyaltyProgrammeUseCases';
import {
  computeBalance,
  computeLifetimePoints,
  LIFETIME_POINTS_SQL,
  type LoyaltyLedgerEntry,
} from '../../apps/api/src/domain/loyalty/LoyaltyLedger';

let seq = 0;
const entry = (
  type: LoyaltyLedgerEntry['type'],
  points: number,
  idempotencyKey: string,
  reversedEntryId: string | null = null,
): LoyaltyLedgerEntry => ({
  id: `e${++seq}`, accountId: 'a', type, points, orderId: null, reason: '', idempotencyKey,
  expiresAt: null, reversedEntryId, createdAt: new Date(2026, 9, 1, 0, 0, seq),
});

describe('lifetime points: every point credited, from any source', () => {
  it('counts orders, referrals, missions, scans, birthday, scratch cards, counterfeit reports, phone verification and manual credits', () => {
    const entries = [
      entry('earn', 500, 'earn:o1'),
      entry('adjustment', 200, 'referral:r1:referrer'),
      entry('adjustment', 300, 'mission:refer_three:u1'),
      entry('adjustment', 25, 'verify:CODE1'),
      entry('adjustment', 150, 'birthday:u1:2026'),
      entry('adjustment', 40, 'draw:t1'),
      entry('adjustment', 250, 'counterfeit:rep1'),
      entry('adjustment', 100, 'phoneverify:u1'),
      entry('adjustment', 75, 'adjust:goodwill-0001'),
    ];
    expect(computeLifetimePoints(entries)).toBe(1640);
  });

  it('is not reduced by spending or by expiry', () => {
    const earn = entry('earn', 1000, 'earn:o1');
    const entries = [earn, entry('redeem', -600, 'redeem:o2'), entry('expiry', -400, 'expiry:x', earn.id)];
    expect(computeLifetimePoints(entries)).toBe(1000);
  });

  it('is reduced when a credit is reversed (refund clawback, fraud reversal)', () => {
    const earn = entry('earn', 1000, 'earn:o1');
    const mission = entry('adjustment', 300, 'mission:five_deliveries:u1');
    const entries = [earn, mission, entry('reversal', -400, `reversal:${earn.id}:400`, earn.id), entry('reversal', -300, 'reversal:m', mission.id)];
    expect(computeLifetimePoints(entries)).toBe(600);
  });

  it('is reduced by a negative manual correction', () => {
    expect(computeLifetimePoints([entry('earn', 1000, 'earn:o1'), entry('adjustment', -250, 'adjust:fix-0001')])).toBe(750);
  });

  it('does not grow when a redemption is reversed (the points come back to spend, not to the level)', () => {
    const redeem = entry('redeem', -500, 'redeem:o2');
    const entries = [entry('earn', 1000, 'earn:o1'), redeem, entry('reversal', 500, `reversal:${redeem.id}`, redeem.id)];
    expect(computeLifetimePoints(entries)).toBe(1000);
  });

  it('never goes below zero', () => {
    expect(computeLifetimePoints([entry('adjustment', -50, 'adjust:fix-0002')])).toBe(0);
  });

  it('is what the account page shows as lifetime earned', () => {
    const b = computeBalance([entry('earn', 500, 'earn:o1'), entry('adjustment', 25, 'verify:CODE2'), entry('redeem', -100, 'redeem:o3')], new Date(2026, 9, 6));
    expect(b.lifetimeEarned).toBe(525);
    expect(b.lifetimeRedeemed).toBe(100);
    expect(b.available).toBe(425);
  });

  it('the SQL twin follows the same rule', () => {
    expect(LIFETIME_POINTS_SQL).toContain("le.type in ('earn','adjustment')");
    expect(LIFETIME_POINTS_SQL).toContain("le.type = 'reversal' and rt.type in ('earn','adjustment')");
    expect(LIFETIME_POINTS_SQL).toMatch(/^greatest\(0,/);
  });
});

describe('tiers follow lifetime points', () => {
  const TIERS = [
    { code: 'T1', name: 'Member', rank: 1, thresholdLifetimePoints: 0 },
    { code: 'T2', name: 'Silver', rank: 2, thresholdLifetimePoints: 2_500 },
  ];
  const run = async (entries: LoyaltyLedgerEntry[], currentTier: string | null) => {
    const assign = vi.fn();
    const notify = vi.fn(async () => undefined);
    const uc = new EvaluateTiersUseCase(
      { mergedInto: async () => null, listEntries: async () => entries } as never,
      { listAccountIds: async () => [{ accountId: 'a', userId: 'u' }] } as never,
      { activeTiers: async () => TIERS, currentAssignment: async () => (currentTier ? { tierCode: currentTier } : null), assign } as never,
      notify,
    );
    await uc.execute();
    return { assigned: assign.mock.calls.map((c) => c[1]), notified: notify.mock.calls.map((c) => (c as unknown as [{ tierCode: string }])[0].tierCode) };
  };

  it('referral, mission and other non-order points can lift a customer to the next level, and the move up is announced', async () => {
    const entries = [entry('earn', 2_000, 'earn:o1'), entry('adjustment', 300, 'mission:refer_three:u'), entry('adjustment', 200, 'referral:r:referrer')];
    expect(await run(entries, 'T1')).toEqual({ assigned: ['T2'], notified: ['T2'] });
  });

  it('a level whose points were reversed is lowered quietly, never with a "welcome" message', async () => {
    const earn = entry('earn', 3_000, 'earn:o1');
    const entries = [earn, entry('reversal', -1_000, `reversal:${earn.id}:1000`, earn.id)];
    expect(await run(entries, 'T2')).toEqual({ assigned: ['T1'], notified: [] });
  });

  it('spending points never lowers a level', async () => {
    const entries = [entry('earn', 3_000, 'earn:o1'), entry('redeem', -2_000, 'redeem:o2')];
    expect(await run(entries, 'T2')).toEqual({ assigned: [], notified: [] });
  });
});
