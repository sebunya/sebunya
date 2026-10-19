import { and, desc, eq, gte, isNotNull, isNull, sql } from 'drizzle-orm';
import { db } from '../client';
import { bulkPriceAccess } from '../schema/governance';
import type { IBulkPriceAccessRepository } from '../../../application/ports/IBulkPriceAccessRepository';
import type { AccessChallenge } from '../../../domain/quotes/BulkPriceAccess';

export class DrizzleBulkPriceAccessRepository implements IBulkPriceAccessRepository {
  async countSince(phone: string, since: Date): Promise<number> {
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(bulkPriceAccess)
      .where(and(eq(bulkPriceAccess.phone, phone), gte(bulkPriceAccess.createdAt, since)));
    return Number(row?.n ?? 0);
  }

  async create(input: { phone: string; codeHash: string; expiresAt: Date }): Promise<void> {
    await db.insert(bulkPriceAccess).values(input);
  }

  async latestOpen(phone: string): Promise<AccessChallenge | null> {
    const [row] = await db
      .select()
      .from(bulkPriceAccess)
      .where(and(eq(bulkPriceAccess.phone, phone), isNull(bulkPriceAccess.verifiedAt)))
      .orderBy(desc(bulkPriceAccess.createdAt))
      .limit(1);
    return row
      ? { id: row.id, codeHash: row.codeHash, attempts: row.attempts, expiresAt: row.expiresAt, verifiedAt: row.verifiedAt }
      : null;
  }

  async recordAttempt(id: string): Promise<number> {
    const [row] = await db
      .update(bulkPriceAccess)
      .set({ attempts: sql`${bulkPriceAccess.attempts} + 1` })
      .where(eq(bulkPriceAccess.id, id))
      .returning({ attempts: bulkPriceAccess.attempts });
    return row?.attempts ?? Number.MAX_SAFE_INTEGER;
  }

  async markVerified(id: string, at: Date): Promise<boolean> {
    const rows = await db
      .update(bulkPriceAccess)
      .set({ verifiedAt: at })
      .where(and(eq(bulkPriceAccess.id, id), isNull(bulkPriceAccess.verifiedAt)))
      .returning({ id: bulkPriceAccess.id });
    return rows.length === 1;
  }

  async listVerified(opts: { since: Date; limit: number }): Promise<Array<{ phone: string; verifiedAt: Date }>> {
    const rows = await db
      .select({ phone: bulkPriceAccess.phone, verifiedAt: bulkPriceAccess.verifiedAt })
      .from(bulkPriceAccess)
      .where(and(isNotNull(bulkPriceAccess.verifiedAt), gte(bulkPriceAccess.verifiedAt, opts.since)))
      .orderBy(desc(bulkPriceAccess.verifiedAt))
      .limit(Math.max(1, Math.min(opts.limit, 1000)));
    return rows.map((r) => ({ phone: r.phone, verifiedAt: r.verifiedAt as Date }));
  }
}
