import { describe, it, expect } from 'vitest';
import {
  computeBalance,
  computeExpirableEarns,
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
  ExpireLoyaltyPointsUseCase,
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
    async findAccountByUserId(userId) { return entries.some((e) => e.accountId === `acct-${userId}`) ? { id: `acct-${userId}`, userId } : null; },
    async getOrCreateAccount(userId) { return { id: `acct-${userId}`, userId }; },
    async listEntries(accountId) { return entries.filter((e) => e.accountId === accountId); },
    async findEntryById(id) { return entries.find((e) => e.id === id) ?? null; },
    async findEntryByIdempotencyKey(key) { return entries.find((e) => e.idempotencyKey === key) ?? null; },
    async append(input: AppendEntryInput) {
      const existing = entries.find((e) => e.idempotencyKey === input.idempotencyKey);
      if (existing) return { entry: existing, replay: true };
      const row = entry({ ...input, id: `e-${entries.length + 1}`, createdAt: new Date() });
      entries.push(row);
      return { entry: row, replay: false };
    },
    async appendDebitIfAvailable(input, at) {
      const existing = entries.find((e) => e.idempotencyKey === input.idempotencyKey);
      if (existing) return { ok: true, entry: existing, replay: true, expired: [] };
      const available = computeBalance(entries.filter((e) => e.accountId === input.accountId), at).available;
      if (-input.points > available) return { ok: false, code: 'INSUFFICIENT_BALANCE', available };
      const appended = await this.append(input);
      return { ok: true, ...appended, expired: [] };
    },
    async expireDue(accountId, at) {
      const expired: LoyaltyLedgerEntry[] = [];
      for (const due of computeExpirableEarns(entries.filter((e) => e.accountId === accountId), at)) {
        const source = due.entry;
        const appended = await this.append({ accountId, type: 'expiry', points: -due.points, orderId: source.orderId, reason: 'expired', idempotencyKey: `expiry:${source.id}`, expiresAt: null, reversedEntryId: source.id });
        if (!appended.replay) expired.push(appended.entry);
      }
      return expired;
    },
    async reverseEntry(entryId, reason) {
      const target = entries.find((e) => e.id === entryId);
      if (!target) return { ok: false, code: 'NOT_FOUND' };
      if (target.type === 'reversal' || target.type === 'expiry') return { ok: false, code: 'NON_REVERSIBLE' };
      const existing = entries.find((e) => e.type === 'reversal' && e.reversedEntryId === target.id);
      if (existing) return { ok: true, entry: existing, replay: true };
      const appended = await this.append({ accountId: target.accountId, type: 'reversal', points: -target.points, orderId: target.orderId, reason, idempotencyKey: `reversal:${target.id}`, expiresAt: null, reversedEntryId: target.id });
      return { ok: true, ...appended };
    },
    async getOperationsSnapshot() {
      return { accountCount: 0, entryCount: entries.length, signedBalance: entries.reduce((sum, row) => sum + row.points, 0), pendingExpiry: 0, byType: { earn: 0, redeem: 0, reversal: 0, expiry: 0, adjustment: 0 }, recentEntries: entries };
    },
    async getConfig() { return config; },
    async saveConfig(c) { return c; },
  };
}

describe('Loyalty domain (Slice 8, pure)', () => {
  it('changes balance only through ledger events and reports due expiry separately', () => {
    const balance = computeBalance([
      entry({ points: 100, expiresAt: future }),
      entry({ id: 'e2', points: 50, expiresAt: past }), // expired earn
      entry({ id: 'e3', type: 'redeem', points: -30 }),
    ], now);
    expect(balance.available).toBe(120);
    expect(balance.pendingExpiry).toBe(50);
    expect(balance.lifetimeEarned).toBe(150);
    expect(balance.lifetimeRedeemed).toBe(30);

    const formallyExpired = computeBalance([
      entry({ points: 100, expiresAt: future }),
      entry({ id: 'e2', points: 50, expiresAt: past }),
      entry({ id: 'e3', type: 'redeem', points: -30 }),
      entry({ id: 'e4', type: 'expiry', points: -50, orderId: 'o1', reversedEntryId: 'e2' }),
    ], now);
    expect(formallyExpired.available).toBe(70);
    expect(formallyExpired.pendingExpiry).toBe(0);
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

  it('expires due earns through one explicit idempotent ledger event', async () => {
    const repo = fakeRepo(activeConfig);
    const account = await repo.getOrCreateAccount('u1');
    await repo.append({ accountId: account.id, type: 'earn', points: 100, orderId: 'o1', reason: 'earn', idempotencyKey: 'earn:o1', expiresAt: past, reversedEntryId: null });
    expect(computeBalance(repo.entries, now)).toMatchObject({ available: 100, pendingExpiry: 100 });
    const useCase = new ExpireLoyaltyPointsUseCase(repo);
    expect(await useCase.execute({ accountId: account.id, now })).toHaveLength(1);
    expect(await useCase.execute({ accountId: account.id, now })).toHaveLength(0);
    expect(computeBalance(repo.entries, now)).toMatchObject({ available: 0, pendingExpiry: 0 });
  });

  it('expires only the FIFO unspent remainder of a partially redeemed earn', () => {
    const rows = [
      entry({ id: 'old', points: 100, expiresAt: past, createdAt: new Date('2025-01-01T00:00:00Z') }),
      entry({ id: 'new', points: 100, expiresAt: future, createdAt: new Date('2025-02-01T00:00:00Z') }),
      entry({ id: 'spent', type: 'redeem', points: -80, orderId: null, expiresAt: null, createdAt: new Date('2025-03-01T00:00:00Z') }),
    ];
    expect(computeExpirableEarns(rows, now).map((due) => ({ id: due.entry.id, points: due.points }))).toEqual([{ id: 'old', points: 20 }]);
    expect(computeBalance(rows, now)).toMatchObject({ available: 120, pendingExpiry: 20 });
  });

  it('does not reallocate historical redemptions after a partial expiry settles its earn', () => {
    const rows = [
      entry({ id: 'old', points: 100, expiresAt: past, createdAt: new Date('2025-01-01T00:00:00Z') }),
      entry({ id: 'new', points: 100, expiresAt: past, createdAt: new Date('2025-02-01T00:00:00Z') }),
      entry({ id: 'spent', type: 'redeem', points: -80, orderId: null, expiresAt: null, createdAt: new Date('2025-03-01T00:00:00Z') }),
      entry({ id: 'expiry-old', type: 'expiry', points: -20, orderId: 'o1', expiresAt: null, reversedEntryId: 'old', createdAt: new Date('2025-04-01T00:00:00Z') }),
    ];
    expect(computeExpirableEarns(rows, now).map((due) => ({ id: due.entry.id, points: due.points }))).toEqual([{ id: 'new', points: 100 }]);
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
