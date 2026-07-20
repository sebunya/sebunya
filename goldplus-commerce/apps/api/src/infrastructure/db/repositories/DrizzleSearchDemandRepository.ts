import { sql, eq, desc, and, gte, gt, inArray } from 'drizzle-orm';
import { db } from '../client';
import { searchDemandSignals, searchProductInsights } from '../schema/search';
import { products } from '../schema/products';
import { ISearchDemandRepository } from '../../../application/ports/ISearchDemandRepository';
import {
  SearchDemandSignal,
  SearchDemandStatus,
  SearchInsightsOverview,
  SearchInteractionType,
  MIN_SEARCH_INSIGHT_VOLUME,
  boundedRate,
} from '../../../domain/products/ProductSearchService';

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
  async recordSearch(normalizedQuery: string, resultCount: number, rankedProductIds: string[] = []): Promise<void> {
    const isZero = resultCount === 0 ? 1 : 0;
    const now = new Date();
    await db.transaction(async (tx) => {
      await tx
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
      if (rankedProductIds.length === 0) return;
      const existingProducts = await tx.select({ id: products.id }).from(products).where(inArray(products.id, rankedProductIds));
      const allowed = new Set(existingProducts.map((row) => row.id));
      for (const [index, productId] of rankedProductIds.entries()) {
        if (!allowed.has(productId)) continue;
        const rank = index + 1;
        await tx.insert(searchProductInsights).values({
          query: normalizedQuery,
          productId,
          impressionCount: 1,
          rankSum: rank,
          lastRank: rank,
          lastObservedAt: now,
        }).onConflictDoUpdate({
          target: [searchProductInsights.query, searchProductInsights.productId],
          set: {
            impressionCount: sql`${searchProductInsights.impressionCount} + 1`,
            rankSum: sql`${searchProductInsights.rankSum} + ${rank}`,
            lastRank: rank,
            lastObservedAt: now,
            updatedAt: now,
          },
        });
      }
    });
  }

  async recordInteraction(input: { normalizedQuery: string; productId: string; rank: number; type: SearchInteractionType }): Promise<{ recorded: boolean }> {
    const now = new Date();
    const [row] = input.type === 'click'
      ? await db.update(searchProductInsights).set({
          clickCount: sql`${searchProductInsights.clickCount} + 1`,
          lastRank: input.rank,
          lastObservedAt: now,
          updatedAt: now,
        }).where(and(
          eq(searchProductInsights.query, input.normalizedQuery),
          eq(searchProductInsights.productId, input.productId),
          gt(searchProductInsights.impressionCount, searchProductInsights.clickCount),
        )).returning({ id: searchProductInsights.id })
      : await db.update(searchProductInsights).set({
          conversionCount: sql`${searchProductInsights.conversionCount} + 1`,
          lastRank: input.rank,
          lastObservedAt: now,
          updatedAt: now,
        }).where(and(
          eq(searchProductInsights.query, input.normalizedQuery),
          eq(searchProductInsights.productId, input.productId),
          gt(searchProductInsights.clickCount, searchProductInsights.conversionCount),
        )).returning({ id: searchProductInsights.id });
    return { recorded: Boolean(row) };
  }

  async list(opts?: { status?: SearchDemandStatus; limit?: number }): Promise<SearchDemandSignal[]> {
    const limit = Math.max(1, Math.min(opts?.limit ?? 200, 500));
    const rows = await db.query.searchDemandSignals.findMany({
      where: opts?.status
        ? and(eq(searchDemandSignals.status, opts.status), gte(searchDemandSignals.searchCount, MIN_SEARCH_INSIGHT_VOLUME))
        : gte(searchDemandSignals.searchCount, MIN_SEARCH_INSIGHT_VOLUME),
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

  async getInsights(limit = 100): Promise<SearchInsightsOverview> {
    const boundedLimit = Math.max(1, Math.min(limit, 200));
    const [queryTotals] = await db.select({
      searches: sql<number>`coalesce(sum(${searchDemandSignals.searchCount}), 0)::int`,
      zero: sql<number>`coalesce(sum(${searchDemandSignals.zeroResultCount}), 0)::int`,
    }).from(searchDemandSignals);
    const [productTotals] = await db.select({
      impressions: sql<number>`coalesce(sum(${searchProductInsights.impressionCount}), 0)::int`,
      clicks: sql<number>`coalesce(sum(${searchProductInsights.clickCount}), 0)::int`,
      conversions: sql<number>`coalesce(sum(${searchProductInsights.conversionCount}), 0)::int`,
    }).from(searchProductInsights);
    const rankingRows = await db.select({
      query: searchProductInsights.query,
      productId: searchProductInsights.productId,
      productName: products.name,
      impressions: searchProductInsights.impressionCount,
      clicks: searchProductInsights.clickCount,
      conversions: searchProductInsights.conversionCount,
      rankSum: searchProductInsights.rankSum,
      lastRank: searchProductInsights.lastRank,
    }).from(searchProductInsights)
      .innerJoin(searchDemandSignals, eq(searchDemandSignals.query, searchProductInsights.query))
      .innerJoin(products, eq(products.id, searchProductInsights.productId))
      .where(and(
        gte(searchDemandSignals.searchCount, MIN_SEARCH_INSIGHT_VOLUME),
        gte(searchProductInsights.impressionCount, MIN_SEARCH_INSIGHT_VOLUME),
      ))
      .orderBy(desc(searchProductInsights.conversionCount), desc(searchProductInsights.clickCount), desc(searchProductInsights.impressionCount))
      .limit(boundedLimit);
    const synonymsResult: any = await db.execute(sql`
      select a.query, b.query candidate, p.name shared_product_name,
        least(a.click_count, b.click_count)::int evidence_clicks
      from search_product_insights a
      join search_product_insights b on a.product_id = b.product_id and a.query < b.query
      join search_demand_signals da on da.query = a.query
      join search_demand_signals dbs on dbs.query = b.query
      join products p on p.id = a.product_id
      where da.search_count >= ${MIN_SEARCH_INSIGHT_VOLUME}
        and dbs.search_count >= ${MIN_SEARCH_INSIGHT_VOLUME}
        and a.click_count >= 2 and b.click_count >= 2
      order by evidence_clicks desc, a.query asc, b.query asc
      limit ${boundedLimit}
    `);
    const searches = queryTotals?.searches ?? 0;
    const zero = queryTotals?.zero ?? 0;
    const impressions = productTotals?.impressions ?? 0;
    const clicks = productTotals?.clicks ?? 0;
    const conversions = productTotals?.conversions ?? 0;
    return {
      minimumReportedSearches: MIN_SEARCH_INSIGHT_VOLUME,
      totalSearches: searches,
      zeroResultSearches: zero,
      zeroResultRate: boundedRate(zero, searches),
      impressions,
      clicks,
      addToCartConversions: conversions,
      clickThroughRate: boundedRate(clicks, impressions),
      addToCartRate: boundedRate(conversions, clicks),
      demand: await this.list({ limit: boundedLimit }),
      ranking: rankingRows.map((row) => ({
        query: row.query,
        productId: row.productId,
        productName: row.productName,
        impressions: row.impressions,
        clicks: row.clicks,
        addToCartConversions: row.conversions,
        averageObservedRank: Math.round((row.rankSum / row.impressions) * 100) / 100,
        lastObservedRank: row.lastRank,
        clickThroughRate: boundedRate(row.clicks, row.impressions),
        addToCartRate: boundedRate(row.conversions, row.clicks),
      })),
      synonymCandidates: (synonymsResult.rows ?? synonymsResult).map((row: any) => ({
        query: row.query,
        candidate: row.candidate,
        sharedProductName: row.shared_product_name,
        evidenceClicks: Number(row.evidence_clicks),
        status: 'EVIDENCE_ONLY' as const,
      })),
    };
  }
}
