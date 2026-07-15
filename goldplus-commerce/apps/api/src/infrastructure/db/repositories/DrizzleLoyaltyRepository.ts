import { eq, asc } from 'drizzle-orm';
import { db } from '../client';
import { loyaltyAccounts, loyaltyLedgerEntries, loyaltyConfig } from '../schema/loyalty';
import { ILoyaltyRepository, AppendEntryInput } from '../../../application/ports/ILoyaltyRepository';
import { LoyaltyLedgerEntry, LoyaltyConfig, LoyaltyEntryType, DEFAULT_LOYALTY_CONFIG } from '../../../domain/loyalty/LoyaltyLedger';

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

export class DrizzleLoyaltyRepository implements ILoyaltyRepository {
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
    const rows = await db.query.loyaltyLedgerEntries.findMany({
      where: eq(loyaltyLedgerEntries.accountId, accountId),
      orderBy: [asc(loyaltyLedgerEntries.createdAt)],
    });
    return rows.map(toDomain);
  }

  async findEntryById(entryId: string): Promise<LoyaltyLedgerEntry | null> {
    const row = await db.query.loyaltyLedgerEntries.findFirst({ where: eq(loyaltyLedgerEntries.id, entryId) });
    return row ? toDomain(row) : null;
  }

  async append(input: AppendEntryInput): Promise<{ entry: LoyaltyLedgerEntry; replay: boolean }> {
    const [inserted] = await db
      .insert(loyaltyLedgerEntries)
      .values({
        accountId: input.accountId,
        type: input.type,
        points: input.points,
        orderId: input.orderId,
        reason: input.reason,
        idempotencyKey: input.idempotencyKey,
        expiresAt: input.expiresAt,
        reversedEntryId: input.reversedEntryId,
      })
      .onConflictDoNothing({ target: loyaltyLedgerEntries.idempotencyKey })
      .returning();
    if (inserted) return { entry: toDomain(inserted), replay: false };
    const existing = await db.query.loyaltyLedgerEntries.findFirst({
      where: eq(loyaltyLedgerEntries.idempotencyKey, input.idempotencyKey),
    });
    return { entry: toDomain(existing!), replay: true };
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
