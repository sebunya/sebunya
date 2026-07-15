import { sql, eq, desc } from 'drizzle-orm';
import { db } from '../client';
import { searchDemandSignals } from '../schema/search';
import { ISearchDemandRepository } from '../../../application/ports/ISearchDemandRepository';
import { SearchDemandSignal, SearchDemandStatus } from '../../../domain/products/ProductSearchService';

function toDomain(row: typeof searchDemandSignals.$inferSelect): SearchDemandSignal {
  return {
    id: row.id,
    query: row.query,
    searchCount: row.searchCount,
    zeroResultCount: row.zeroResultCount,
    lastResultCount: row.lastResultCount,
    status: row.status as SearchDemandStatus,
    firstSearchedAt: row.firstSearchedAt,
    lastSearchedAt: row.lastSearchedAt,
  };
}

export class DrizzleSearchDemandRepository implements ISearchDemandRepository {
  async recordSearch(normalizedQuery: string, resultCount: number): Promise<void> {
    const isZero = resultCount === 0 ? 1 : 0;
    const now = new Date();
    await db
      .insert(searchDemandSignals)
      .values({
        query: normalizedQuery,
        searchCount: 1,
        zeroResultCount: isZero,
        lastResultCount: resultCount,
        lastSearchedAt: now,
      })
      .onConflictDoUpdate({
        target: searchDemandSignals.query,
        set: {
          searchCount: sql`${searchDemandSignals.searchCount} + 1`,
          zeroResultCount: sql`${searchDemandSignals.zeroResultCount} + ${isZero}`,
          lastResultCount: resultCount,
          lastSearchedAt: now,
          updatedAt: now,
        },
      });
  }

  async list(opts?: { status?: SearchDemandStatus; limit?: number }): Promise<SearchDemandSignal[]> {
    const limit = Math.max(1, Math.min(opts?.limit ?? 200, 500));
    const rows = await db.query.searchDemandSignals.findMany({
      where: opts?.status ? eq(searchDemandSignals.status, opts.status) : undefined,
      orderBy: [desc(searchDemandSignals.zeroResultCount), desc(searchDemandSignals.searchCount)],
      limit,
    });
    return rows.map(toDomain);
  }

  async updateStatus(id: string, status: SearchDemandStatus): Promise<SearchDemandSignal | null> {
    const [row] = await db
      .update(searchDemandSignals)
      .set({ status, updatedAt: new Date() })
      .where(eq(searchDemandSignals.id, id))
      .returning();
    return row ? toDomain(row) : null;
  }
}
