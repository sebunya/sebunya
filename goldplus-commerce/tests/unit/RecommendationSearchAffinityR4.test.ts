import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { GetRecommendationsUseCase } from "../../apps/api/src/application/recommendations/GetRecommendationsUseCase";
import { ProductSignalExtractor } from "../../apps/api/src/application/recommendations/ProductSignalExtractor";
import { RecommendationScoringService } from "../../apps/api/src/application/recommendations/RecommendationScoringService";
import { CompatibilityRuleService } from "../../apps/api/src/application/recommendations/CompatibilityRuleService";
import { TrendingScoreService } from "../../apps/api/src/application/recommendations/TrendingScoreService";
import { RecommendationEligibilityService } from "../../apps/api/src/application/recommendations/RecommendationEligibilityService";
import { RecommendationDeduplicationService } from "../../apps/api/src/application/recommendations/RecommendationDeduplicationService";
import { RecommendationDiversityService } from "../../apps/api/src/application/recommendations/RecommendationDiversityService";
import { validateTrackRecommendationEventInput } from "../../apps/api/src/application/recommendations/RecommendationValidation";
import type { RecommendationProductRecord } from "../../apps/api/src/application/ports/IProductRecommendationReader";

/**
 * R4 (2026-08-06): search→recommendation convergence through ONE governed
 * interface, and lineage as a first-class report. The boundary rule under
 * test: search's aggregate tables stay identity-free; the profile's intent
 * comes from its own event stream; they meet only in engine memory.
 */

const ROOT = join(__dirname, "../..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const PRODUCTS: RecommendationProductRecord[] = [
  { id: "p1", slug: "wireless-earbuds", name: "Wireless Earbuds", categoryId: "c1", imageUrl: "https://img/1", price: 80000, stockStatus: "in_stock", stockQuantity: 10, isActive: true },
  { id: "p2", slug: "reinforced-usb-c-cable", name: "Reinforced USB-C Cable", categoryId: "c2", imageUrl: "https://img/2", price: 25000, stockStatus: "in_stock", stockQuantity: 10, isActive: true },
  { id: "p3", slug: "generic-fast-charger", name: "Generic Fast Charger", categoryId: "c2", imageUrl: "https://img/3", price: 50000, stockStatus: "in_stock", stockQuantity: 10, isActive: true },
];

function makeEngine(opts: {
  recentQueries?: string[];
  affinity?: Record<string, Array<{ productId: string; clickCount: number; conversionCount: number; impressionCount: number }>>;
}) {
  const reader = {
    async findPublicProducts(input?: { productIds?: string[]; excludeProductIds?: string[]; limit?: number }) {
      let rows = [...PRODUCTS];
      if (input?.productIds) {
        // Preserve requested order — the affinity ranking is the order.
        rows = input.productIds.map((id) => rows.find((p) => p.id === id)).filter(Boolean) as RecommendationProductRecord[];
      }
      if (input?.excludeProductIds) rows = rows.filter((p) => !input.excludeProductIds!.includes(p.id));
      return rows.slice(0, input?.limit ?? 200);
    },
    async findProductById() { return null; },
    async findProductsByIds() { return []; },
    async findBestsellerProductIds() { return []; },
    async findCompatibilityTargetIds() { return []; },
    async findRecentPaidProductIdsForProfile() { return []; },
    async findCachedRecommendations() { return null; },
    async saveCachedRecommendations() {},
  };
  const events = {
    async save() { return true; },
    async existsRecentSimilarEvent() { return false; },
    async findRecentlyViewed() { return []; },
    async findRecentlyShownProductIds() { return []; },
    async findRecentSearchQueries() { return opts.recentQueries ?? []; },
    async getTrendingEvents() { return []; },
  };
  const searchAffinity = {
    async topProductsForQuery(q: string, limit: number) {
      return (opts.affinity?.[q] ?? []).slice(0, limit);
    },
    async searchIntelligence() {
      return { topQueries: [], zeroResultQueries: [], clickedNeverConverted: [] };
    },
  };
  return new GetRecommendationsUseCase(
    reader as never,
    new ProductSignalExtractor(),
    new RecommendationScoringService(new CompatibilityRuleService()),
    new TrendingScoreService(events as never),
    new RecommendationEligibilityService(),
    new RecommendationDeduplicationService(),
    new RecommendationDiversityService(),
    { apply: async ({ candidates }: { candidates: unknown[] }) => ({ candidates }) } as never,
    events as never,
    searchAffinity as never,
  );
}

describe("SEARCH_QUERY_AFFINITY — intent meets evidence, honestly", () => {
  it("a profile that searched 'charger' sees clicked-for-charger products lead the home rail", async () => {
    const engine = makeEngine({
      recentQueries: ["charger"],
      affinity: {
        charger: [
          { productId: "p3", clickCount: 7, conversionCount: 2, impressionCount: 20 },
          { productId: "p2", clickCount: 3, conversionCount: 0, impressionCount: 15 },
        ],
      },
    });
    const result = await engine.execute({ placement: "home_trending", limit: 3 }, { profileId: "prof-1" });
    expect(result.meta?.sources.find((s) => s.source === "SEARCH_QUERY_AFFINITY")?.state).toBe("SUPPORTED");
    expect(result.items[0].productId).toBe("p3");
    expect(result.items[0].candidateSource).toBe("SEARCH_QUERY_AFFINITY");
  });

  it("no profile → INSUFFICIENT_SAMPLE, never a context-free guess dressed as affinity", async () => {
    const engine = makeEngine({ affinity: { charger: [{ productId: "p3", clickCount: 7, conversionCount: 2, impressionCount: 20 }] } });
    const result = await engine.execute({ placement: "home_trending", limit: 3 });
    expect(result.meta?.sources.find((s) => s.source === "SEARCH_QUERY_AFFINITY")?.state).toBe("INSUFFICIENT_SAMPLE");
  });

  it("recent searches with no click evidence → INSUFFICIENT_SAMPLE (evidence, not echo)", async () => {
    const engine = makeEngine({ recentQueries: ["mount"], affinity: {} });
    const result = await engine.execute({ placement: "home_trending", limit: 3 }, { profileId: "prof-1" });
    expect(result.meta?.sources.find((s) => s.source === "SEARCH_QUERY_AFFINITY")?.state).toBe("INSUFFICIENT_SAMPLE");
    expect(result.items.length).toBeGreaterThan(0);
  });
});

describe("the governed boundary holds", () => {
  it("the affinity reader never selects identity columns — the search tables have none to leak", () => {
    const src = read("apps/api/src/infrastructure/db/repositories/DrizzleSearchAffinityReader.ts");
    for (const forbidden of ["anonymousId", "customerId", "profileId", "recommendation_events", "identity"]) {
      expect(src).not.toContain(forbidden);
    }
  });

  it("the recommendation side never WRITES search truth", () => {
    const src = read("apps/api/src/infrastructure/db/repositories/DrizzleSearchAffinityReader.ts");
    expect(src).not.toMatch(/\.insert\(|\.update\(|\.delete\(/);
  });

  it("shop search emits the profile-attached fact server-side, without a fabricated shared anonymous id", () => {
    const shop = read("apps/web/src/pages/shop.astro");
    expect(shop).toContain("PRODUCT_SEARCHED");
    expect(shop).toContain("x-gp-visit");
    expect(shop).not.toContain("anon_server_side");
  });
});

describe("server identity satisfies event validation (R4)", () => {
  it("a payload with neither anonymousId nor customerId passes WHEN the transport resolved a profile", () => {
    const payload = { eventType: "PRODUCT_SEARCHED", searchQuery: "charger" };
    expect(() => validateTrackRecommendationEventInput(payload)).toThrow();
    expect(() => validateTrackRecommendationEventInput(payload, { hasServerIdentity: true })).not.toThrow();
  });
});

describe("lineage is a typed report, not a vibe (§21, AC22)", () => {
  it("the SQL classifies without mutating: historic rows keep their NULLs, orphans are counted not deleted", () => {
    const repo = read("apps/api/src/infrastructure/db/repositories/DrizzleRecommendationAnalyticsRepository.ts");
    expect(repo).toContain("getLineageReport");
    expect(repo).toContain("schema_version is null");
    expect(repo).toContain("orphan_clicks");
    // Read-only by construction: the report must never write.
    const lineageBlock = repo.slice(repo.indexOf("getLineageReport"), repo.indexOf("getSummaryMetrics"));
    expect(lineageBlock).not.toMatch(/insert|update |delete /i);
  });

  it("the lineage and search-intelligence panels are behind recommendations.read", () => {
    const routes = read("apps/api/src/interfaces/http/routes/admin/recommendations.ts");
    expect(routes).toContain('routes.get("/analytics/lineage", requirePermissions([PERMISSIONS.RECOMMENDATIONS_READ])');
    expect(routes).toContain('routes.get("/analytics/search-intelligence", requirePermissions([PERMISSIONS.RECOMMENDATIONS_READ])');
  });
});
