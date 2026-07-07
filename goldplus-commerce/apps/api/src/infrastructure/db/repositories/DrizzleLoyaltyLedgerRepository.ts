import { and, desc, eq } from 'drizzle-orm';
import { db } from '../client';
import { loyaltyLedger } from '../schema/engagement';
import { orders } from '../schema/commerce';
import {
  ILoyaltyLedgerRepository,
  ILoyaltyOrderLookup,
  LoyaltyLedgerEntry,
  LoyaltyOrderTarget,
  NewLoyaltyLedgerEntry,
} from '../../../application/ports/ILoyaltyLedgerRepository';
import { LoyaltyReason } from '../../../domain/loyalty/Loyalty';

function rowToEntry(row: typeof loyaltyLedger.$inferSelect): LoyaltyLedgerEntry {
  return {
    id: row.id,
    userId: row.userId ?? null,
    orderId: row.orderId ?? null,
    points: row.points,
    reason: row.reason as LoyaltyReason,
    description: row.description ?? null,
    createdAt: row.createdAt,
  };
}

export class DrizzleLoyaltyLedgerRepository implements ILoyaltyLedgerRepository {
  async append(entry: NewLoyaltyLedgerEntry): Promise<LoyaltyLedgerEntry> {
    const [row] = await db
      .insert(loyaltyLedger)
      .values({
        userId: entry.userId,
        orderId: entry.orderId,
        points: entry.points,
        reason: entry.reason,
        description: entry.description,
      })
      .returning();
    return rowToEntry(row);
  }

  async findByOrderAndReason(orderId: string, reason: LoyaltyReason): Promise<LoyaltyLedgerEntry | null> {
    const row = await db.query.loyaltyLedger.findFirst({
      where: and(eq(loyaltyLedger.orderId, orderId), eq(loyaltyLedger.reason, reason)),
    });
    return row ? rowToEntry(row) : null;
  }

  async listForUser(userId: string, limit: number): Promise<LoyaltyLedgerEntry[]> {
    const capped = Math.min(Math.max(1, limit), 500);
    const rows = await db.query.loyaltyLedger.findMany({
      where: eq(loyaltyLedger.userId, userId),
      orderBy: [desc(loyaltyLedger.createdAt)],
      limit: capped,
    });
    return rows.map(rowToEntry);
  }
}

export class DrizzleLoyaltyOrderLookup implements ILoyaltyOrderLookup {
  async findLoyaltyTarget(orderId: string): Promise<LoyaltyOrderTarget | null> {
    const row = await db.query.orders.findFirst({ where: eq(orders.id, orderId) });
    if (!row) return null;
    return {
      orderId: row.id,
      userId: row.userId ?? null,
      totalAmount: row.totalAmount,
    };
  }
}
