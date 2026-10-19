import { and, desc, eq, gte, isNotNull, isNull, sql } from 'drizzle-orm';
import { db } from '../client';
import { bulkPriceAccess } from '../schema/governance';
import type { IBulkPriceAccessRepository } from '../../../application/ports/IBulkPriceAccessRepository';
import type { AccessChallenge, AccessMethod } from '../../../domain/quotes/BulkPriceAccess';

export class DrizzleBulkPriceAccessRepository implements IBulkPriceAccessRepository {
  async countSince(phone: string, since: Date): Promise<number> {
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(bulkPriceAccess)
      .where(and(eq(bulkPriceAccess.phone, phone), eq(bulkPriceAccess.method, 'code'), gte(bulkPriceAccess.createdAt, since)));
    return Number(row?.n ?? 0);
  }

  async countUses(phone: string): Promise<number> {
    const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(bulkPriceAccess).where(eq(bulkPriceAccess.phone, phone));
    return Number(row?.n ?? 0);
  }

  async recordFirstVisit(phone: string, at: Date): Promise<void> {
    // No code exists; the hash column holds a marker no typed code can match.
    await db.insert(bulkPriceAccess).values({ phone, codeHash: 'first-visit', expiresAt: at, verifiedAt: at, method: 'first_visit', createdAt: at });
  }

  async create(input: { phone: string; codeHash: string; expiresAt: Date }): Promise<void> {
    await db.insert(bulkPriceAccess).values(input);
  }

  async latestOpen(phone: string): Promise<AccessChallenge | null> {
    const [row] = await db
      .select()
      .from(bulkPriceAccess)
      .where(and(eq(bulkPriceAccess.phone, phone), isNull(bulkPriceAccess.verifiedAt), eq(bulkPriceAccess.method, 'code')))
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

  async listVerified(opts: { since: Date; limit: number }): Promise<Array<{ phone: string; verifiedAt: Date; method: AccessMethod }>> {
    const rows = await db
      .select({ phone: bulkPriceAccess.phone, verifiedAt: bulkPriceAccess.verifiedAt, method: bulkPriceAccess.method })
      .from(bulkPriceAccess)
      .where(and(isNotNull(bulkPriceAccess.verifiedAt), gte(bulkPriceAccess.verifiedAt, opts.since)))
      .orderBy(desc(bulkPriceAccess.verifiedAt))
      .limit(Math.max(1, Math.min(opts.limit, 1000)));
    return rows.map((r) => ({ phone: r.phone, verifiedAt: r.verifiedAt as Date, method: r.method === 'first_visit' ? 'first_visit' : 'code' }));
  }
}
