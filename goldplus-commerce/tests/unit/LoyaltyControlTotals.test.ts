import { describe, it, expect } from 'vitest';
import {
  ReconcileLoyaltyControlTotalsUseCase,
  deriveControlTotals,
  businessDateEndUtc,
  type ILoyaltyControlTotalsRepository,
  type LedgerEntryForTotals,
  type LoyaltyControlTotals,
} from '../../apps/api/src/application/use-cases/loyalty/ReconcileLoyaltyControlTotalsUseCase';

const DATE = '2026-07-29';

const entry = (
  over: Partial<LedgerEntryForTotals> & { createdAt: string },
): LedgerEntryForTotals => ({
  accountId: 'acct-1',
  type: 'earn',
  points: 100,
  ...over,
  createdAt: new Date(over.createdAt),
});

class FakeRepo implements ILoyaltyControlTotalsRepository {
  snapshots = new Map<string, LoyaltyControlTotals>();
  constructor(private readonly entries: LedgerEntryForTotals[] = []) {}

  async entriesUpTo(end: Date) {
    return this.entries.filter((e) => e.createdAt.getTime() <= end.getTime());
  }
  async findSnapshot(businessDate: string) {
    return this.snapshots.get(businessDate) ?? null;
  }
  async saveSnapshot(totals: LoyaltyControlTotals) {
    this.snapshots.set(totals.businessDate, totals);
    return totals;
  }
}

describe('control total derivation', () => {
  it('counts only entries created on the date, but carries the balance forward', () => {
    // The classic control-total error is mixing a day's movement with the
    // outstanding position: a day can have zero movement while liability is large.
    const totals = deriveControlTotals(DATE, [
      entry({ createdAt: '2026-07-27T10:00:00Z', points: 500 }),
      entry({ createdAt: '2026-07-29T09:00:00Z', points: 100 }),
    ]);
    expect(totals.entryCount).toBe(1);
    expect(totals.earnPoints).toBe(100);
    expect(totals.closingBalance).toBe(600);
  });

  it('breaks the day down by entry type', () => {
    const totals = deriveControlTotals(DATE, [
      entry({ createdAt: `${DATE}T01:00:00Z`, type: 'earn', points: 500 }),
      entry({ createdAt: `${DATE}T02:00:00Z`, type: 'redeem', points: -200 }),
      entry({ createdAt: `${DATE}T03:00:00Z`, type: 'reversal', points: -100 }),
      entry({ createdAt: `${DATE}T04:00:00Z`, type: 'expiry', points: -50 }),
      entry({ createdAt: `${DATE}T05:00:00Z`, type: 'adjustment', points: 25 }),
    ]);
    expect(totals).toMatchObject({
      entryCount: 5,
      earnPoints: 500,
      redeemPoints: -200,
      reversalPoints: -100,
      expiryPoints: -50,
      adjustmentPoints: 25,
      closingBalance: 175,
    });
  });

  it('includes the whole final millisecond of the day', () => {
    expect(businessDateEndUtc(DATE).toISOString()).toBe('2026-07-29T23:59:59.999Z');
    const totals = deriveControlTotals(DATE, [
      entry({ createdAt: '2026-07-29T23:59:59.999Z', points: 10 }),
    ]);
    expect(totals.entryCount).toBe(1);
  });

  it('excludes the first millisecond of the next day', () => {
    const totals = deriveControlTotals(DATE, [
      entry({ createdAt: '2026-07-30T00:00:00.000Z', points: 10 }),
    ]);
    expect(totals.entryCount).toBe(0);
    expect(totals.closingBalance).toBe(0);
  });

  it('counts accounts holding a non-zero balance, not accounts with entries', () => {
    // An account that earned and fully redeemed holds no liability.
    const totals = deriveControlTotals(DATE, [
      entry({ accountId: 'a', createdAt: `${DATE}T01:00:00Z`, points: 100 }),
      entry({ accountId: 'a', createdAt: `${DATE}T02:00:00Z`, type: 'redeem', points: -100 }),
      entry({ accountId: 'b', createdAt: `${DATE}T03:00:00Z`, points: 50 }),
    ]);
    expect(totals.accountsWithBalance).toBe(1);
    expect(totals.closingBalance).toBe(50);
  });

  it('produces an all-zero snapshot for a day with no activity', () => {
    const totals = deriveControlTotals(DATE, []);
    expect(totals).toMatchObject({ entryCount: 0, closingBalance: 0, accountsWithBalance: 0 });
  });
});

describe('reconciliation', () => {
  const traceId = 'trace-recon';

  it('creates the snapshot the first time a date is closed', async () => {
    const repo = new FakeRepo([entry({ createdAt: `${DATE}T01:00:00Z`, points: 300 })]);
    const result = await new ReconcileLoyaltyControlTotalsUseCase(repo).execute({
      businessDate: DATE,
      traceId,
    });
    expect(result.status).toBe('SNAPSHOT_CREATED');
    if (result.status !== 'SNAPSHOT_CREATED') return;
    expect(result.totals.closingBalance).toBe(300);
  });

  it('reconciles when the ledger is unchanged — the append-only guarantee', async () => {
    const repo = new FakeRepo([entry({ createdAt: `${DATE}T01:00:00Z`, points: 300 })]);
    const useCase = new ReconcileLoyaltyControlTotalsUseCase(repo);
    await useCase.execute({ businessDate: DATE, traceId });

    // Re-deriving a closed date must reproduce the stored figure forever.
    const again = await useCase.execute({ businessDate: DATE, traceId });
    expect(again.status).toBe('RECONCILED');
  });

  it('stays reconciled when LATER activity is appended — the past cannot move', async () => {
    const entries = [entry({ createdAt: `${DATE}T01:00:00Z`, points: 300 })];
    const repo = new FakeRepo(entries);
    const useCase = new ReconcileLoyaltyControlTotalsUseCase(repo);
    await useCase.execute({ businessDate: DATE, traceId });

    entries.push(entry({ createdAt: '2026-07-30T10:00:00Z', points: 999 }));
    const again = await useCase.execute({ businessDate: DATE, traceId });
    expect(again.status).toBe('RECONCILED');
  });

  it('reports a DISCREPANCY when history changed, naming every field', async () => {
    const entries = [entry({ createdAt: `${DATE}T01:00:00Z`, points: 300 })];
    const repo = new FakeRepo(entries);
    const useCase = new ReconcileLoyaltyControlTotalsUseCase(repo);
    await useCase.execute({ businessDate: DATE, traceId });

    // Simulate the thing 0050 exists to prevent: a past entry mutated.
    entries[0] = entry({ createdAt: `${DATE}T01:00:00Z`, points: 999 });

    const result = await useCase.execute({ businessDate: DATE, traceId });
    expect(result.status).toBe('DISCREPANCY');
    if (result.status !== 'DISCREPANCY') return;

    const fields = result.differences.map((d) => d.field);
    expect(fields).toContain('earnPoints');
    expect(fields).toContain('closingBalance');
    expect(result.stored.closingBalance).toBe(300);
    expect(result.derived.closingBalance).toBe(999);
  });

  it('detects a DELETED historical entry', async () => {
    const entries = [
      entry({ createdAt: `${DATE}T01:00:00Z`, points: 300 }),
      entry({ createdAt: `${DATE}T02:00:00Z`, points: 200 }),
    ];
    const repo = new FakeRepo(entries);
    const useCase = new ReconcileLoyaltyControlTotalsUseCase(repo);
    await useCase.execute({ businessDate: DATE, traceId });

    entries.pop();
    const result = await useCase.execute({ businessDate: DATE, traceId });
    expect(result.status).toBe('DISCREPANCY');
    if (result.status === 'DISCREPANCY') {
      expect(result.differences.map((d) => d.field)).toContain('entryCount');
    }
  });

  it('does NOT overwrite the stored snapshot when it finds a discrepancy', async () => {
    // Overwriting would destroy the only evidence that something changed, which is
    // the whole reason the snapshot is immutable.
    const entries = [entry({ createdAt: `${DATE}T01:00:00Z`, points: 300 })];
    const repo = new FakeRepo(entries);
    const useCase = new ReconcileLoyaltyControlTotalsUseCase(repo);
    await useCase.execute({ businessDate: DATE, traceId });

    entries[0] = entry({ createdAt: `${DATE}T01:00:00Z`, points: 1 });
    await useCase.execute({ businessDate: DATE, traceId });

    expect(repo.snapshots.get(DATE)!.closingBalance).toBe(300);
  });
});
