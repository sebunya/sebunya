import { describe, expect, it } from 'vitest';
import {
  pointsForPaidAmount,
  summariseLedger,
  tierForLifetimePoints,
  UGX_PER_POINT,
} from '../../apps/api/src/domain/loyalty/Loyalty';
import { AwardOrderLoyaltyPointsUseCase } from '../../apps/api/src/application/use-cases/loyalty/AwardOrderLoyaltyPointsUseCase';
import { GetLoyaltySummaryUseCase } from '../../apps/api/src/application/use-cases/loyalty/GetLoyaltySummaryUseCase';
import {
  ILoyaltyLedgerRepository,
  ILoyaltyOrderLookup,
  LoyaltyLedgerEntry,
  LoyaltyOrderTarget,
  NewLoyaltyLedgerEntry,
} from '../../apps/api/src/application/ports/ILoyaltyLedgerRepository';
import { LoyaltyReason } from '../../apps/api/src/domain/loyalty/Loyalty';

class InMemoryLoyaltyLedger implements ILoyaltyLedgerRepository {
  public entries: LoyaltyLedgerEntry[] = [];

  async append(entry: NewLoyaltyLedgerEntry): Promise<LoyaltyLedgerEntry> {
    const persisted: LoyaltyLedgerEntry = {
      ...entry,
      id: `led-${this.entries.length + 1}`,
      createdAt: new Date(),
    };
    this.entries.push(persisted);
    return persisted;
  }

  async findByOrderAndReason(orderId: string, reason: LoyaltyReason): Promise<LoyaltyLedgerEntry | null> {
    return this.entries.find((e) => e.orderId === orderId && e.reason === reason) ?? null;
  }

  async listForUser(userId: string, limit: number): Promise<LoyaltyLedgerEntry[]> {
    return this.entries.filter((e) => e.userId === userId).slice(0, limit);
  }
}

class StubOrderLookup implements ILoyaltyOrderLookup {
  constructor(private readonly orders: Record<string, LoyaltyOrderTarget>) {}
  async findLoyaltyTarget(orderId: string): Promise<LoyaltyOrderTarget | null> {
    return this.orders[orderId] ?? null;
  }
}

describe('loyalty domain rules', () => {
  it('earns 1 point per 1000 UGX, flooring remainders', () => {
    expect(pointsForPaidAmount(UGX_PER_POINT)).toBe(1);
    expect(pointsForPaidAmount(2999)).toBe(2);
    expect(pointsForPaidAmount(999)).toBe(0);
    expect(pointsForPaidAmount(0)).toBe(0);
    expect(pointsForPaidAmount(-5000)).toBe(0);
    expect(pointsForPaidAmount(2500.5 as unknown as number)).toBe(0);
  });

  it('maps lifetime points to tiers', () => {
    expect(tierForLifetimePoints(0)).toBe('MEMBER');
    expect(tierForLifetimePoints(999)).toBe('MEMBER');
    expect(tierForLifetimePoints(1000)).toBe('SILVER');
    expect(tierForLifetimePoints(4999)).toBe('SILVER');
    expect(tierForLifetimePoints(5000)).toBe('GOLD');
  });

  it('summarises balance from earn and redemption entries', () => {
    const summary = summariseLedger([{ points: 1200 }, { points: -200 }, { points: 100 }]);
    expect(summary.balance).toBe(1100);
    expect(summary.lifetimeEarned).toBe(1300);
    expect(summary.tier).toBe('SILVER');
  });
});

describe('AwardOrderLoyaltyPointsUseCase', () => {
  const orderId = '11111111-1111-1111-1111-111111111111';

  it('awards points once and treats repeats as replays (webhook idempotency)', async () => {
    const ledger = new InMemoryLoyaltyLedger();
    const lookup = new StubOrderLookup({
      [orderId]: { orderId, userId: 'user-1', totalAmount: 250_000 },
    });
    const uc = new AwardOrderLoyaltyPointsUseCase(ledger, lookup);

    const first = await uc.execute({ orderId });
    expect(first.ok).toBe(true);
    if (first.ok) {
      expect(first.replay).toBe(false);
      expect(first.entry.points).toBe(250);
    }

    const second = await uc.execute({ orderId });
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.replay).toBe(true);
    expect(ledger.entries).toHaveLength(1);
  });

  it('fails cleanly when the order does not exist', async () => {
    const uc = new AwardOrderLoyaltyPointsUseCase(new InMemoryLoyaltyLedger(), new StubOrderLookup({}));
    const result = await uc.execute({ orderId: 'missing' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('ORDER_NOT_FOUND');
  });

  it('does not write ledger entries for sub-threshold amounts', async () => {
    const ledger = new InMemoryLoyaltyLedger();
    const lookup = new StubOrderLookup({
      [orderId]: { orderId, userId: null, totalAmount: 500 },
    });
    const uc = new AwardOrderLoyaltyPointsUseCase(ledger, lookup);
    const result = await uc.execute({ orderId });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('NO_POINTS');
    expect(ledger.entries).toHaveLength(0);
  });

  it('keeps guest orders attributable by order even without a user', async () => {
    const ledger = new InMemoryLoyaltyLedger();
    const lookup = new StubOrderLookup({
      [orderId]: { orderId, userId: null, totalAmount: 10_000 },
    });
    const result = await new AwardOrderLoyaltyPointsUseCase(ledger, lookup).execute({ orderId });
    expect(result.ok).toBe(true);
    expect(ledger.entries[0].userId).toBeNull();
    expect(ledger.entries[0].orderId).toBe(orderId);
  });
});

describe('GetLoyaltySummaryUseCase', () => {
  it('returns balance, tier, and recent entries for a user', async () => {
    const ledger = new InMemoryLoyaltyLedger();
    await ledger.append({ userId: 'user-1', orderId: 'o1', points: 1200, reason: 'ORDER_PAID', description: null });
    await ledger.append({ userId: 'user-1', orderId: null, points: -100, reason: 'REDEMPTION', description: null });
    await ledger.append({ userId: 'someone-else', orderId: 'o2', points: 999, reason: 'ORDER_PAID', description: null });

    const summary = await new GetLoyaltySummaryUseCase(ledger).execute('user-1');
    expect(summary.balance).toBe(1100);
    expect(summary.lifetimeEarned).toBe(1200);
    expect(summary.tier).toBe('SILVER');
    expect(summary.recent).toHaveLength(2);
  });
});
