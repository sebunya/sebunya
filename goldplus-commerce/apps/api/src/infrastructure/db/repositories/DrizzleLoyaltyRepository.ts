import { eq, asc, inArray, and, desc, sql } from 'drizzle-orm';
import { db } from '../client';
import { loyaltyAccounts, loyaltyLedgerEntries, loyaltyConfig } from '../schema/loyalty';
import {
  ILoyaltyRepository,
  AppendEntryInput,
  DebitResult,
  ReverseEntryResult,
  LoyaltyOperationsSnapshot,
} from '../../../application/ports/ILoyaltyRepository';
import {
  LoyaltyLedgerEntry,
  LoyaltyConfig,
  LoyaltyEntryType,
  DEFAULT_LOYALTY_CONFIG,
  computeBalance,
  computeExpirableEarns,
  sameLedgerCommand,
} from '../../../domain/loyalty/LoyaltyLedger';

function toDomain(row: typeof loyaltyLedgerEntries.$inferSelect): LoyaltyLedgerEntry {
  return {
    id: row.id,
    accountId: row.accountId,
    type: row.type as LoyaltyEntryType,
    points: row.points,
    orderId: row.orderId,
    reason: row.reason,
    idempotencyKey: row.idempotencyKey,
    expiresAt: row.expiresAt,
    reversedEntryId: row.reversedEntryId,
    createdAt: row.createdAt,
  };
}

async function insertEntry(tx: any, input: AppendEntryInput): Promise<{ entry: LoyaltyLedgerEntry; replay: boolean }> {
  const [inserted] = await tx
    .insert(loyaltyLedgerEntries)
    .values(input)
    .onConflictDoNothing({ target: loyaltyLedgerEntries.idempotencyKey })
    .returning();
  if (inserted) return { entry: toDomain(inserted), replay: false };
  const [existing] = await tx
    .select()
    .from(loyaltyLedgerEntries)
    .where(eq(loyaltyLedgerEntries.idempotencyKey, input.idempotencyKey))
    .limit(1);
  if (!existing || !sameLedgerCommand(toDomain(existing), input)) {
    throw new Error('LOYALTY_IDEMPOTENCY_CONFLICT');
  }
  return { entry: toDomain(existing), replay: true };
}

async function expireDueInTransaction(tx: any, accountId: string, now: Date): Promise<LoyaltyLedgerEntry[]> {
  const rows = await tx
    .select()
    .from(loyaltyLedgerEntries)
    .where(eq(loyaltyLedgerEntries.accountId, accountId))
    .orderBy(asc(loyaltyLedgerEntries.createdAt))
    .for('update');
  const due = computeExpirableEarns(rows.map(toDomain), now);
  const expired: LoyaltyLedgerEntry[] = [];
  for (const dueEarn of due) {
    const source = dueEarn.entry;
    const result = await insertEntry(tx, {
      accountId,
      type: 'expiry',
      points: -dueEarn.points,
      orderId: source.orderId,
      reason: `Expired ${dueEarn.points} unspent points from earn ${source.id}`,
      idempotencyKey: `expiry:${source.id}`,
      expiresAt: null,
      reversedEntryId: source.id,
    });
    if (!result.replay) expired.push(result.entry);
  }
  return expired;
}

export class DrizzleLoyaltyRepository implements ILoyaltyRepository {
  async findAccountByUserId(userId: string): Promise<{ id: string; userId: string } | null> {
    const row = await db.query.loyaltyAccounts.findFirst({ where: eq(loyaltyAccounts.userId, userId) });
    return row ? { id: row.id, userId: row.userId } : null;
  }

  async getOrCreateAccount(userId: string): Promise<{ id: string; userId: string }> {
    const existing = await db.query.loyaltyAccounts.findFirst({ where: eq(loyaltyAccounts.userId, userId) });
    if (existing) return { id: existing.id, userId: existing.userId };
    const [created] = await db
      .insert(loyaltyAccounts)
      .values({ userId })
      .onConflictDoNothing({ target: loyaltyAccounts.userId })
      .returning();
    if (created) return { id: created.id, userId: created.userId };
    const raced = await db.query.loyaltyAccounts.findFirst({ where: eq(loyaltyAccounts.userId, userId) });
    return { id: raced!.id, userId: raced!.userId };
  }

  async listEntries(accountId: string): Promise<LoyaltyLedgerEntry[]> {
    // Account merges (0086, loyalty PART I): entries are never moved — the
    // survivor's balance aggregates its own entries plus every merged source's,
    // original earn/expiry dates intact.
    const merged = (await db.execute(
      sql`select merged_account_id from loyalty_account_merges where survivor_account_id = ${accountId}`,
    )) as unknown as Array<{ merged_account_id: string }>;
    const ids = [accountId, ...merged.map((m) => m.merged_account_id)];
    const rows = await db.query.loyaltyLedgerEntries.findMany({
      where: inArray(loyaltyLedgerEntries.accountId, ids),
      orderBy: [asc(loyaltyLedgerEntries.createdAt)],
    });
    return rows.map(toDomain);
  }

  async findEntryById(entryId: string): Promise<LoyaltyLedgerEntry | null> {
    const row = await db.query.loyaltyLedgerEntries.findFirst({ where: eq(loyaltyLedgerEntries.id, entryId) });
    return row ? toDomain(row) : null;
  }

  async findEntryByIdempotencyKey(idempotencyKey: string): Promise<LoyaltyLedgerEntry | null> {
    const row = await db.query.loyaltyLedgerEntries.findFirst({ where: eq(loyaltyLedgerEntries.idempotencyKey, idempotencyKey) });
    return row ? toDomain(row) : null;
  }

  async append(input: AppendEntryInput): Promise<{ entry: LoyaltyLedgerEntry; replay: boolean }> {
    return db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`loyalty:${input.accountId}`}, 0))`);
      return insertEntry(tx, input);
    });
  }

  async appendDebitIfAvailable(input: AppendEntryInput, now: Date): Promise<DebitResult> {
    return db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`loyalty:${input.accountId}`}, 0))`);
      const [existing] = await tx.select().from(loyaltyLedgerEntries)
        .where(eq(loyaltyLedgerEntries.idempotencyKey, input.idempotencyKey)).limit(1);
      if (existing) {
        if (!sameLedgerCommand(toDomain(existing), input)) return { ok: false, code: 'IDEMPOTENCY_CONFLICT' };
        return { ok: true, entry: toDomain(existing), replay: true, expired: [] };
      }
      const expired = await expireDueInTransaction(tx, input.accountId, now);
      const rows = await tx.select().from(loyaltyLedgerEntries)
        .where(eq(loyaltyLedgerEntries.accountId, input.accountId)).orderBy(asc(loyaltyLedgerEntries.createdAt));
      const available = computeBalance(rows.map(toDomain), now).available;
      if (-input.points > available) return { ok: false, code: 'INSUFFICIENT_BALANCE', available };
      try {
        const appended = await insertEntry(tx, input);
        return { ok: true, ...appended, expired };
      } catch (error) {
        if ((error as Error).message === 'LOYALTY_IDEMPOTENCY_CONFLICT') return { ok: false, code: 'IDEMPOTENCY_CONFLICT' };
        throw error;
      }
    });
  }

  async expireDue(accountId: string, now: Date): Promise<LoyaltyLedgerEntry[]> {
    return db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`loyalty:${accountId}`}, 0))`);
      return expireDueInTransaction(tx, accountId, now);
    });
  }

  async reverseEntry(entryId: string, reason: string): Promise<ReverseEntryResult> {
    return db.transaction(async (tx) => {
      const [initial] = await tx.select().from(loyaltyLedgerEntries)
        .where(eq(loyaltyLedgerEntries.id, entryId)).limit(1);
      if (!initial) return { ok: false, code: 'NOT_FOUND' };
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`loyalty:${initial.accountId}`}, 0))`);
      const [target] = await tx.select().from(loyaltyLedgerEntries)
        .where(eq(loyaltyLedgerEntries.id, entryId)).limit(1).for('update');
      if (!target) return { ok: false, code: 'NOT_FOUND' };
      if (target.type === 'reversal' || target.type === 'expiry') return { ok: false, code: 'NON_REVERSIBLE' };
      const [settlement] = await tx.select().from(loyaltyLedgerEntries).where(and(
        eq(loyaltyLedgerEntries.reversedEntryId, target.id),
        sql`${loyaltyLedgerEntries.type} in ('expiry', 'reversal')`,
      )).limit(1);
      if (settlement?.type === 'expiry') return { ok: false, code: 'ALREADY_REVERSED' };
      const input: AppendEntryInput = {
        accountId: target.accountId,
        type: 'reversal',
        points: -target.points,
        orderId: target.orderId,
        reason: reason.slice(0, 300) || `Reversal of ${target.type}`,
        idempotencyKey: `reversal:${target.id}`,
        expiresAt: null,
        reversedEntryId: target.id,
      };
      try {
        const appended = await insertEntry(tx, input);
        return { ok: true, ...appended };
      } catch (error) {
        if ((error as Error).message === 'LOYALTY_IDEMPOTENCY_CONFLICT') return { ok: false, code: 'IDEMPOTENCY_CONFLICT' };
        throw error;
      }
    });
  }

  async getOperationsSnapshot(input: { now: Date; limit: number }): Promise<LoyaltyOperationsSnapshot> {
    const [accounts] = await db.select({ value: sql<number>`count(*)::int` }).from(loyaltyAccounts);
    const [totals] = await db.select({
      count: sql<number>`count(*)::int`,
      balance: sql<number>`coalesce(sum(${loyaltyLedgerEntries.points}), 0)::int`,
    }).from(loyaltyLedgerEntries);
    const typeRows = await db.select({ type: loyaltyLedgerEntries.type, count: sql<number>`count(*)::int` })
      .from(loyaltyLedgerEntries).groupBy(loyaltyLedgerEntries.type);
    const allEntries = await db.select().from(loyaltyLedgerEntries).orderBy(asc(loyaltyLedgerEntries.createdAt));
    const recent = await db.select().from(loyaltyLedgerEntries)
      .orderBy(desc(loyaltyLedgerEntries.createdAt)).limit(Math.max(1, Math.min(input.limit, 200)));
    const byType = { earn: 0, redeem: 0, reversal: 0, expiry: 0, adjustment: 0 };
    for (const row of typeRows) if (row.type in byType) byType[row.type as LoyaltyEntryType] = row.count;
    return {
      accountCount: accounts?.value ?? 0,
      entryCount: totals?.count ?? 0,
      signedBalance: totals?.balance ?? 0,
      pendingExpiry: computeBalance(allEntries.map(toDomain), input.now).pendingExpiry,
      byType,
      recentEntries: recent.map(toDomain),
    };
  }

  async getConfig(): Promise<LoyaltyConfig> {
    const row = await db.query.loyaltyConfig.findFirst();
    if (!row) return DEFAULT_LOYALTY_CONFIG;
    return { enabled: row.enabled, earnRatePer1000Ugx: row.earnRatePer1000Ugx, expiryDays: row.expiryDays };
  }

  async saveConfig(config: LoyaltyConfig): Promise<LoyaltyConfig> {
    const row = await db.query.loyaltyConfig.findFirst();
    if (row) {
      const [updated] = await db
        .update(loyaltyConfig)
        .set({ enabled: config.enabled, earnRatePer1000Ugx: config.earnRatePer1000Ugx, expiryDays: config.expiryDays, updatedAt: new Date() })
        .where(eq(loyaltyConfig.id, row.id))
        .returning();
      return { enabled: updated.enabled, earnRatePer1000Ugx: updated.earnRatePer1000Ugx, expiryDays: updated.expiryDays };
    }
    const [created] = await db.insert(loyaltyConfig).values(config).returning();
    return { enabled: created.enabled, earnRatePer1000Ugx: created.earnRatePer1000Ugx, expiryDays: created.expiryDays };
  }
}
