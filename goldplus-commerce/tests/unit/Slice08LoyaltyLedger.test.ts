import { describe, it, expect } from 'vitest';
import {
  computeBalance,
  computeEarnPoints,
  validateLoyaltyConfig,
  validateRedeem,
  LoyaltyLedgerEntry,
  DEFAULT_LOYALTY_CONFIG,
  MAX_POINTS_PER_ENTRY,
} from '../../apps/api/src/domain/loyalty/LoyaltyLedger';
import {
  LoyaltyProgrammeGate,
  EarnLoyaltyPointsUseCase,
  RedeemLoyaltyPointsUseCase,
  ReverseLoyaltyEntryUseCase,
  GetLoyaltyHistoryUseCase,
} from '../../apps/api/src/application/use-cases/loyalty/LoyaltyUseCases';
import { ILoyaltyRepository, AppendEntryInput } from '../../apps/api/src/application/ports/ILoyaltyRepository';
import { LoyaltyConfig } from '../../apps/api/src/domain/loyalty/LoyaltyLedger';

const now = new Date('2026-07-15T12:00:00Z');
const past = new Date('2026-01-01T00:00:00Z');
const future = new Date('2027-01-01T00:00:00Z');

const entry = (over: Partial<LoyaltyLedgerEntry>): LoyaltyLedgerEntry => ({
  id: 'e1', accountId: 'a1', type: 'earn', points: 100, orderId: 'o1', reason: 'test',
  idempotencyKey: 'k1', expiresAt: null, reversedEntryId: null, createdAt: now, ...over,
});

function fakeRepo(config: LoyaltyConfig): ILoyaltyRepository & { entries: LoyaltyLedgerEntry[] } {
  const entries: LoyaltyLedgerEntry[] = [];
  return {
    entries,
    async getOrCreateAccount(userId) { return { id: `acct-${userId}`, userId }; },
    async listEntries(accountId) { return entries.filter((e) => e.accountId === accountId); },
    async findEntryById(id) { return entries.find((e) => e.id === id) ?? null; },
    async append(input: AppendEntryInput) {
      const existing = entries.find((e) => e.idempotencyKey === input.idempotencyKey);
      if (existing) return { entry: existing, replay: true };
      const row = entry({ ...input, id: `e-${entries.length + 1}`, createdAt: new Date() });
      entries.push(row);
      return { entry: row, replay: false };
    },
    async getConfig() { return config; },
    async saveConfig(c) { return c; },
  };
}

describe('Loyalty domain (Slice 8, pure)', () => {
  it('derives balance from the ledger with expiry awareness', () => {
    const balance = computeBalance([
      entry({ points: 100, expiresAt: future }),
      entry({ id: 'e2', points: 50, expiresAt: past }), // expired earn
      entry({ id: 'e3', type: 'redeem', points: -30 }),
    ], now);
    expect(balance.available).toBe(70);
    expect(balance.pendingExpiry).toBe(50);
    expect(balance.lifetimeEarned).toBe(150);
    expect(balance.lifetimeRedeemed).toBe(30);
  });

  it('earns deterministically and respects the fraud ceiling', () => {
    const config = { enabled: true, earnRatePer1000Ugx: 5, expiryDays: 0 };
    expect(computeEarnPoints(10_500, config)).toBe(50);
    expect(computeEarnPoints(999, config)).toBe(0);
    expect(computeEarnPoints(10_000_000_000, config)).toBe(MAX_POINTS_PER_ENTRY);
    expect(computeEarnPoints(10_000, DEFAULT_LOYALTY_CONFIG)).toBe(0); // rate 0 -> no fake points
  });

  it('validates config and redemption bounds', () => {
    expect(validateLoyaltyConfig({ enabled: true, earnRatePer1000Ugx: 5.5, expiryDays: 30 }).ok).toBe(false);
    expect(validateLoyaltyConfig({ enabled: false, earnRatePer1000Ugx: 5, expiryDays: 30 }).ok).toBe(true);
    const balance = { available: 100, pendingExpiry: 0, lifetimeEarned: 100, lifetimeRedeemed: 0 };
    expect(validateRedeem(101, balance).ok).toBe(false);
    expect(validateRedeem(100, balance).ok).toBe(true);
  });
});

describe('Loyalty use cases (Slice 8, dormant gating)', () => {
  const activeConfig = { enabled: true, earnRatePer1000Ugx: 10, expiryDays: 365 };

  it('refuses every mutation while the environment flag is off — the shipped state', async () => {
    const repo = fakeRepo(activeConfig);
    const gate = new LoyaltyProgrammeGate(repo, () => false);
    const earn = await new EarnLoyaltyPointsUseCase(repo, gate).execute({ userId: 'u1', orderId: 'o1', orderTotalUgx: 50_000 });
    const redeem = await new RedeemLoyaltyPointsUseCase(repo, gate).execute({ userId: 'u1', points: 10, reason: 'r', idempotencyKey: 'k1234567' });
    expect(earn.ok).toBe(false);
    expect(redeem.ok).toBe(false);
    if (!earn.ok) expect(earn.code).toBe('PROGRAMME_DISABLED');
    expect(repo.entries).toHaveLength(0);
  });

  it('also stays dormant when only the config switch is off', async () => {
    const repo = fakeRepo({ ...activeConfig, enabled: false });
    const gate = new LoyaltyProgrammeGate(repo, () => true);
    const earn = await new EarnLoyaltyPointsUseCase(repo, gate).execute({ userId: 'u1', orderId: 'o1', orderTotalUgx: 50_000 });
    expect(earn.ok).toBe(false);
  });

  it('earns idempotently per order when fully enabled', async () => {
    const repo = fakeRepo(activeConfig);
    const gate = new LoyaltyProgrammeGate(repo, () => true);
    const uc = new EarnLoyaltyPointsUseCase(repo, gate);
    const first = await uc.execute({ userId: 'u1', orderId: 'o1', orderTotalUgx: 50_000 });
    const second = await uc.execute({ userId: 'u1', orderId: 'o1', orderTotalUgx: 50_000 });
    expect(first.ok && second.ok).toBe(true);
    expect(repo.entries).toHaveLength(1);
    expect(repo.entries[0].points).toBe(500);
    expect(repo.entries[0].expiresAt).not.toBeNull();
  });

  it('rejects overdraw and requires an idempotency key on redemption', async () => {
    const repo = fakeRepo(activeConfig);
    const gate = new LoyaltyProgrammeGate(repo, () => true);
    await new EarnLoyaltyPointsUseCase(repo, gate).execute({ userId: 'u1', orderId: 'o1', orderTotalUgx: 10_000 });
    const uc = new RedeemLoyaltyPointsUseCase(repo, gate);
    expect((await uc.execute({ userId: 'u1', points: 999, reason: 'r', idempotencyKey: 'k1234567' })).ok).toBe(false);
    expect((await uc.execute({ userId: 'u1', points: 50, reason: 'r', idempotencyKey: 'short' })).ok).toBe(false);
    const good = await uc.execute({ userId: 'u1', points: 50, reason: 'r', idempotencyKey: 'k1234567' });
    expect(good.ok).toBe(true);
  });

  it('reverses entries idempotently and never reverses a reversal', async () => {
    const repo = fakeRepo(activeConfig);
    const gate = new LoyaltyProgrammeGate(repo, () => true);
    await new EarnLoyaltyPointsUseCase(repo, gate).execute({ userId: 'u1', orderId: 'o1', orderTotalUgx: 10_000 });
    const uc = new ReverseLoyaltyEntryUseCase(repo);
    const first = await uc.execute({ entryId: repo.entries[0].id, reason: 'refund' });
    const again = await uc.execute({ entryId: repo.entries[0].id, reason: 'refund' });
    expect(first.ok && again.ok).toBe(true);
    expect(repo.entries).toHaveLength(2); // idempotent
    expect(repo.entries[1].points).toBe(-100);
    const noNo = await uc.execute({ entryId: repo.entries[1].id, reason: 'oops' });
    expect(noNo.ok).toBe(false);
  });

  it('history is readable while dormant and reports programmeActive=false', async () => {
    const repo = fakeRepo(activeConfig);
    const gate = new LoyaltyProgrammeGate(repo, () => false);
    const history = await new GetLoyaltyHistoryUseCase(repo, gate).execute({ userId: 'u1' });
    expect(history.programmeActive).toBe(false);
    expect(history.balance.available).toBe(0);
    expect(history.entries).toEqual([]);
  });
});
