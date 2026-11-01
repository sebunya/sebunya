import { and, asc, desc, eq, gt, sql } from "drizzle-orm";
import { db } from "../client";
import { searchDemandSignals, searchProductInsights } from "../schema/search";
import type {
  ISearchAffinityReader,
  SearchAffinityProduct,
  SearchIntelligence,
} from "../../../application/ports/ISearchAffinityReader";

export class DrizzleSearchAffinityReader implements ISearchAffinityReader {
  async topProductsForQuery(normalizedQuery: string, limit: number): Promise<SearchAffinityProduct[]> {
    if (!normalizedQuery) return [];
    return db
      .select({
        productId: searchProductInsights.productId,
        clickCount: searchProductInsights.clickCount,
        conversionCount: searchProductInsights.conversionCount,
        impressionCount: searchProductInsights.impressionCount,
      })
      .from(searchProductInsights)
      .where(and(eq(searchProductInsights.query, normalizedQuery), gt(searchProductInsights.clickCount, 0)))
      .orderBy(
        desc(searchProductInsights.conversionCount),
        desc(searchProductInsights.clickCount),
        asc(searchProductInsights.productId),
      )
      .limit(limit);
  }

  async searchIntelligence(limit: number): Promise<SearchIntelligence> {
    const [topQueries, zeroResultQueries, clickedNeverConverted] = await Promise.all([
      db
        .select({
          query: searchDemandSignals.query,
          searchCount: searchDemandSignals.searchCount,
          lastResultCount: searchDemandSignals.lastResultCount,
        })
        .from(searchDemandSignals)
        .orderBy(desc(searchDemandSignals.searchCount), asc(searchDemandSignals.query))
        .limit(limit),
      db
        .select({
          query: searchDemandSignals.query,
          searchCount: searchDemandSignals.searchCount,
          zeroResultCount: searchDemandSignals.zeroResultCount,
        })
        .from(searchDemandSignals)
        .where(gt(searchDemandSignals.zeroResultCount, 0))
        .orderBy(desc(searchDemandSignals.zeroResultCount), asc(searchDemandSignals.query))
        .limit(limit),
      db
        .select({
          query: searchProductInsights.query,
          clickCount: searchProductInsights.clickCount,
          productId: searchProductInsights.productId,
        })
        .from(searchProductInsights)
        .where(and(gt(searchProductInsights.clickCount, 0), eq(searchProductInsights.conversionCount, 0)))
        .orderBy(desc(searchProductInsights.clickCount), asc(searchProductInsights.query))
        .limit(limit),
    ]);

    return { topQueries, zeroResultQueries, clickedNeverConverted };
  }
}
