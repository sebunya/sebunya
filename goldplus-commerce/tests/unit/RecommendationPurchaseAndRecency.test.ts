import { describe, expect, it } from "vitest";
import { GetRecommendationsUseCase } from "../../apps/api/src/application/recommendations/GetRecommendationsUseCase";
import { ProductSignalExtractor } from "../../apps/api/src/application/recommendations/ProductSignalExtractor";
import { RecommendationScoringService } from "../../apps/api/src/application/recommendations/RecommendationScoringService";
import { CompatibilityRuleService } from "../../apps/api/src/application/recommendations/CompatibilityRuleService";
import { TrendingScoreService } from "../../apps/api/src/application/recommendations/TrendingScoreService";
import { RecommendationEligibilityService } from "../../apps/api/src/application/recommendations/RecommendationEligibilityService";
import { RecommendationDeduplicationService } from "../../apps/api/src/application/recommendations/RecommendationDeduplicationService";
import { RecommendationDiversityService } from "../../apps/api/src/application/recommendations/RecommendationDiversityService";
import type { RecommendationProductRecord } from "../../apps/api/src/application/ports/IProductRecommendationReader";

const rows: RecommendationProductRecord[] = Array.from({ length: 6 }, (_, i) => ({
  id: `p${i + 1}`, slug: `product-${i + 1}`, name: `Product ${i + 1}`, categoryId: "c1",
  imageUrl: `https://img/${i + 1}`, price: 10_000, stockStatus: "in_stock", stockQuantity: 5, isActive: true,
}));

function engine(opts: {
  bestsellers?: (input: { sinceDays?: number }) => Array<{ productId: string; unitsSold: number }>;
  purchased?: string[];
  pins?: Array<{ productId: string; position: number }>;
}) {
  const reader = {
    async findPublicProducts(input?: { productIds?: string[]; limit?: number }) {
      if (input?.productIds) return rows.filter((p) => input.productIds!.includes(p.id));
      return rows.slice(0, input?.limit ?? 200);
    },
    async findProductById() { return null; },
    async findProductsByIds(ids: string[]) { return rows.filter((p) => ids.includes(p.id)); },
    async findBestsellerProductIds(input: { sinceDays?: number }) { return opts.bestsellers?.(input) ?? []; },
    async findCompatibilityTargetIds() { return []; },
    async findRecentPaidProductIdsForProfile() { return opts.purchased ?? []; },
    async findCachedRecommendations() { return null; },
    async saveCachedRecommendations() {},
  };
  const events = {
    async save() { return true; },
    async existsRecentSimilarEvent() { return false; },
    async findRecentlyViewed() { return []; },
    async findRecentlyShownProductIds() { return []; },
    async findRecentSearchQueries() { return []; },
    async getTrendingEvents() { return []; },
  };
  return new GetRecommendationsUseCase(
    reader as never,
    new ProductSignalExtractor(),
    new RecommendationScoringService(new CompatibilityRuleService()),
    new TrendingScoreService(events as never),
    new RecommendationEligibilityService(),
    new RecommendationDeduplicationService(),
    new RecommendationDiversityService(),
    { apply: async ({ candidates }: { candidates: unknown[] }) => ({ candidates, pins: opts.pins ?? [], suppressedProductIds: [] }) } as never,
    events as never,
  );
}

describe("post-purchase suppression survives a pin", () => {
  it("a pinned product the customer just bought is not re-inserted on an add-on rail", async () => {
    const uc = engine({ purchased: ["p1"], pins: [{ productId: "p1", position: 1 }] });
    const result = await uc.execute({ placement: "cart_addon", limit: 4 }, { profileId: "prof-1" } as never);
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.items.map((i) => i.productId)).not.toContain("p1");
  });
});

describe("'Recently popular' is a 30-day claim", () => {
  it("all-time bestseller ranks never claim POPULAR_NOW", async () => {
    const uc = engine({ bestsellers: (i) => (i.sinceDays ? [] : rows.map((r, n) => ({ productId: r.id, unitsSold: 100 - n }))) });
    const result = await uc.execute({ placement: "home_trending", limit: 4 });
    expect(result.items.length).toBeGreaterThan(0);
    for (const item of result.items) expect(item.reasonCodes, item.productId).not.toContain("POPULAR_NOW");
  });

  it("30-day ranks with a real sample still claim it", async () => {
    const uc = engine({ bestsellers: () => rows.map((r, n) => ({ productId: r.id, unitsSold: 100 - n })) });
    const result = await uc.execute({ placement: "home_trending", limit: 4 });
    expect(result.items.some((i) => i.reasonCodes.includes("POPULAR_NOW"))).toBe(true);
  });
});
