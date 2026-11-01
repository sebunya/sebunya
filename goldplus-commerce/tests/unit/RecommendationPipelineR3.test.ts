import { describe, it, expect, vi } from "vitest";
import { GetRecommendationsUseCase } from "../../apps/api/src/application/recommendations/GetRecommendationsUseCase";
import { ProductSignalExtractor } from "../../apps/api/src/application/recommendations/ProductSignalExtractor";
import { RecommendationScoringService } from "../../apps/api/src/application/recommendations/RecommendationScoringService";
import { CompatibilityRuleService } from "../../apps/api/src/application/recommendations/CompatibilityRuleService";
import { TrendingScoreService } from "../../apps/api/src/application/recommendations/TrendingScoreService";
import { RecommendationEligibilityService } from "../../apps/api/src/application/recommendations/RecommendationEligibilityService";
import { RecommendationDeduplicationService } from "../../apps/api/src/application/recommendations/RecommendationDeduplicationService";
import { RecommendationDiversityService } from "../../apps/api/src/application/recommendations/RecommendationDiversityService";
import type { RecommendationProductRecord } from "../../apps/api/src/application/ports/IProductRecommendationReader";

/**
 * R3 (2026-08-06): the deterministic candidate + fallback pipeline. Each block
 * pins one acceptance criterion with the production catalogue's actual shape —
 * eight products, three categories, zero rules, zero paid orders — because
 * honest tiny-data behaviour IS the requirement.
 */

const CATALOGUE: RecommendationProductRecord[] = [
  { id: "p1", slug: "wireless-earbuds", name: "Wireless Earbuds", categoryId: "cat-sound", imageUrl: "https://img/1", price: 80000, stockStatus: "in_stock", stockQuantity: 100, isActive: true, createdAt: new Date("2026-05-01") },
  { id: "p2", slug: "reinforced-usb-c-cable", name: "Reinforced USB-C Cable", categoryId: "cat-power", imageUrl: "https://img/2", price: 25000, stockStatus: "in_stock", stockQuantity: 200, isActive: true, createdAt: new Date("2026-05-02") },
  { id: "p3", slug: "usb-3-flash-drive-128gb", name: "USB 3.0 Flash Drive 128GB", categoryId: "cat-storage", imageUrl: "https://img/3", price: 60000, stockStatus: "in_stock", stockQuantity: 80, isActive: true, createdAt: new Date("2026-05-03") },
  { id: "p4", slug: "portable-audio-headset", name: "Portable Audio Headset", categoryId: "cat-sound", imageUrl: "https://img/4", price: 110000, stockStatus: "in_stock", stockQuantity: 25, isActive: true, createdAt: new Date("2026-05-04") },
  { id: "p5", slug: "heavy-duty-power-bank", name: "Heavy Duty Power Bank", categoryId: "cat-power", imageUrl: "https://img/5", price: 120000, stockStatus: "in_stock", stockQuantity: 30, isActive: true, createdAt: new Date("2026-05-05") },
  { id: "p6", slug: "car-dashboard-mount", name: "Car Dashboard Mount", categoryId: "cat-car", imageUrl: "https://img/6", price: 35000, stockStatus: "in_stock", stockQuantity: 120, isActive: true, createdAt: new Date("2026-05-06") },
  { id: "p7", slug: "bluetooth-rugged-speaker", name: "Bluetooth Rugged Speaker", categoryId: "cat-sound", imageUrl: "https://img/7", price: 150000, stockStatus: "in_stock", stockQuantity: 45, isActive: true, createdAt: new Date("2026-05-07") },
  { id: "p8", slug: "generic-fast-charger", name: "Generic Fast Charger", categoryId: "cat-power", imageUrl: "https://img/8", price: 50000, stockStatus: "in_stock", stockQuantity: 50, isActive: true, createdAt: new Date("2026-05-08") },
];

interface ReaderOverrides {
  bestsellers?: Array<{ productId: string; unitsSold: number }>;
  compatTargets?: string[];
  purchasedForProfile?: string[];
  catalogue?: RecommendationProductRecord[];
  failSources?: boolean;
}

function makeReader(overrides: ReaderOverrides = {}) {
  const catalogue = overrides.catalogue ?? CATALOGUE;
  return {
    calls: [] as string[],
    async findPublicProducts(input?: {
      categoryId?: string;
      productIds?: string[];
      excludeProductIds?: string[];
      limit?: number;
      orderBy?: string;
    }) {
      if (overrides.failSources) throw new Error("db down");
      let rows = [...catalogue];
      if (input?.categoryId) rows = rows.filter((p) => p.categoryId === input.categoryId);
      if (input?.productIds) rows = rows.filter((p) => input.productIds!.includes(p.id));
      if (input?.excludeProductIds) rows = rows.filter((p) => !input.excludeProductIds!.includes(p.id));
      rows =
        input?.orderBy === "newest"
          ? rows.sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0))
          : rows.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
      return rows.slice(0, input?.limit ?? 200);
    },
    async findProductById(id: string) {
      return catalogue.find((p) => p.id === id) ?? null;
    },
    async findProductsByIds(ids: string[]) {
      return catalogue.filter((p) => ids.includes(p.id));
    },
    async findBestsellerProductIds() {
      return overrides.bestsellers ?? [];
    },
    async findCompatibilityTargetIds() {
      return overrides.compatTargets ?? [];
    },
    async findRecentPaidProductIdsForProfile() {
      return overrides.purchasedForProfile ?? [];
    },
    async findCachedRecommendations() {
      return null;
    },
    async saveCachedRecommendations() {},
  };
}

const emptyEventRepo = {
  async save() {
    return true;
  },
  async existsRecentSimilarEvent() {
    return false;
  },
  async findRecentlyViewed() {
    return [];
  },
  async findRecentlyShownProductIds() {
    return [] as string[];
  },
  async getTrendingEvents() {
    return [];
  },
};

function makeEngine(reader = makeReader(), events = emptyEventRepo, ruleCandidatesPassthrough = true) {
  const degradations: Array<{ stage: string; placement: string }> = [];
  const savedEvents: unknown[] = [];
  const eventRepo = {
    ...events,
    async save(e: unknown) {
      savedEvents.push(e);
      return true;
    },
  };
  const engine = new GetRecommendationsUseCase(
    reader as never,
    new ProductSignalExtractor(),
    new RecommendationScoringService(new CompatibilityRuleService()),
    new TrendingScoreService(eventRepo as never),
    new RecommendationEligibilityService(),
    new RecommendationDeduplicationService(),
    new RecommendationDiversityService(),
    {
      apply: ruleCandidatesPassthrough
        ? async ({ candidates }: { candidates: unknown[] }) => ({ candidates })
        : async () => {
            throw new Error("rules exploded");
          },
    } as never,
    eventRepo as never,
    undefined,
    (stage, placement) => degradations.push({ stage, placement }),
  );
  return { engine, degradations, savedEvents };
}

describe("AC1 — zero rules, eligible inventory, NEVER empty", () => {
  it.each(["home_trending", "product_related", "cart_addon", "complete_setup", "category_popular"] as const)(
    "%s returns products with no rules, no paid orders and no behavioural sample",
    async (placement) => {
      const { engine } = makeEngine();
      // complete_setup anchors on the charger: compatibility is REQUIRED
      // there, and the charger→cable pair is a known-good mapping. The
      // honest-empty case (an anchor with no compatible accessories) is
      // pinned separately below.
      const result = await engine.execute({
        placement,
        productId: placement === "product_related" ? "p6" : placement === "complete_setup" ? "p8" : undefined,
        categoryId: placement === "category_popular" ? "cat-power" : undefined,
        cartProductIds: placement === "cart_addon" ? ["p5"] : undefined,
      });
      expect(result.items.length, placement).toBeGreaterThan(0);
      expect(result.strategy).toBe("deterministic_v3");
      expect(result.meta?.policyVersion).toBe("det-v3");
    },
  );
});

describe("AC1's honest boundary — compatibility placements refuse to fake fit", () => {
  it("complete_setup for a car mount is EMPTY with NO_COMPATIBLE_PRODUCTS — earbuds do not 'complete' a mount", async () => {
    const { engine } = makeEngine();
    const result = await engine.execute({ placement: "complete_setup", productId: "p6" });
    expect(result.items).toHaveLength(0);
    expect(result.meta?.emptyReason).toBe("NO_COMPATIBLE_PRODUCTS");
  });
});

describe("AC2 — insufficient primary evidence falls through WITH the reason recorded", () => {
  it("home_trending with no paid orders and no engagement reports INSUFFICIENT_SAMPLE and still serves", async () => {
    const { engine } = makeEngine();
    const result = await engine.execute({ placement: "home_trending" });

    const bySource = Object.fromEntries((result.meta?.sources ?? []).map((s) => [s.source, s.state]));
    expect(bySource.RECENT_PAID_ORDER_VELOCITY).toBe("INSUFFICIENT_SAMPLE");
    expect(bySource.RECENT_ENGAGEMENT_VELOCITY).toBe("INSUFFICIENT_SAMPLE");
    expect(result.items.length).toBeGreaterThan(0);
    // What actually served came from deeper, honest rungs.
    expect(result.items.every((i) => ["NEW_AND_ELIGIBLE", "DETERMINISTIC_CATALOGUE_FALLBACK", "GLOBAL_BESTSELLER"].includes(i.candidateSource ?? ""))).toBe(true);
  });

  it("with real paid evidence, bestsellers lead and are ranked by units sold", async () => {
    const reader = makeReader({
      bestsellers: [
        { productId: "p5", unitsSold: 9 },
        { productId: "p2", unitsSold: 4 },
      ],
    });
    const { engine } = makeEngine(reader);
    const result = await engine.execute({ placement: "home_trending", limit: 4 });
    expect(result.items[0].productId).toBe("p5");
    expect(result.items[0].candidateSource).toBe("RECENT_PAID_ORDER_VELOCITY");
    expect(result.meta?.sources.find((s) => s.source === "RECENT_PAID_ORDER_VELOCITY")?.state).toBe("SUPPORTED");
  });
});

describe("AC4 — emptiness is typed, never silent", () => {
  it("an empty catalogue yields CATALOGUE_EMPTY with zero items", async () => {
    const { engine } = makeEngine(makeReader({ catalogue: [] }));
    const result = await engine.execute({ placement: "home_trending" });
    expect(result.items).toHaveLength(0);
    expect(result.meta?.emptyReason).toBe("CATALOGUE_EMPTY");
  });

  it("every source down yields DEPENDENCY_UNAVAILABLE, not a 500 (AC10/AC11)", async () => {
    const { engine, degradations } = makeEngine(makeReader({ failSources: true }));
    const result = await engine.execute({ placement: "home_trending" });
    expect(result.items).toHaveLength(0);
    expect(result.meta?.emptyReason).toBe("DEPENDENCY_UNAVAILABLE");
    expect(degradations.some((d) => d.stage === "source_failed")).toBe(true);
  });
});

describe("AC7/AC6/AC8 — exclusions and uniqueness hold through the ladder", () => {
  it("the PDP anchor never recommends itself, even from the catalogue fallback", async () => {
    const { engine } = makeEngine();
    const result = await engine.execute({ placement: "product_related", productId: "p6" });
    expect(result.items.map((i) => i.productId)).not.toContain("p6");
  });

  it("cart items never come back as add-ons, and no product appears twice", async () => {
    const { engine } = makeEngine();
    const result = await engine.execute({ placement: "cart_addon", cartProductIds: ["p2", "p5"] });
    const ids = result.items.map((i) => i.productId);
    expect(ids).not.toContain("p2");
    expect(ids).not.toContain("p5");
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("determinism — same input, same output, byte for byte", () => {
  it("two runs of the same request produce identical rankings", async () => {
    const { engine } = makeEngine();
    const [a, b] = await Promise.all([
      engine.execute({ placement: "home_trending", limit: 6 }),
      engine.execute({ placement: "home_trending", limit: 6 }),
    ]);
    expect(a.items.map((i) => i.productId)).toEqual(b.items.map((i) => i.productId));
  });
});

describe("rule failure keeps the rail alive and reported (AC10)", () => {
  it("a throwing rule engine serves the pre-rule ranking and reports the degradation", async () => {
    const { engine, degradations } = makeEngine(makeReader(), emptyEventRepo, false);
    const result = await engine.execute({ placement: "home_trending" });
    expect(result.items.length).toBeGreaterThan(0);
    expect(degradations.some((d) => d.stage === "rule_application_failed")).toBe(true);
  });
});

describe("repetition control is server-side (§5A.9)", () => {
  it("recently-seen products are demoted, recently-purchased are suppressed from accessory placements", async () => {
    const reader = makeReader({ purchasedForProfile: ["p8"] });
    const eventRepo = {
      ...emptyEventRepo,
      async findRecentlyShownProductIds() {
        return ["p2"];
      },
    };
    const { engine } = makeEngine(reader, eventRepo);

    const related = await engine.execute(
      { placement: "product_related", productId: "p6", limit: 8 },
      { profileId: "profile-1" },
    );
    // p8 was purchased 30d ago: gone from the accessory placement entirely.
    expect(related.items.map((i) => i.productId)).not.toContain("p8");

    const withoutProfile = await engine.execute({ placement: "product_related", productId: "p6", limit: 8 });
    const rankOf = (items: typeof related.items, id: string) => items.findIndex((i) => i.productId === id);
    // p2 was seen in the last 24h: still present (demotion, not disappearance)
    // but ranked no better than its unpenalised run.
    expect(rankOf(related.items, "p2")).toBeGreaterThanOrEqual(rankOf(withoutProfile.items, "p2"));
    expect(related.items.map((i) => i.productId)).toContain("p2");
  });
});

describe("the server-native serving fact (stage 13)", () => {
  it("the live route emits one RECOMMENDATION_RESPONSE with sources, fallback level and ranked items", async () => {
    const { engine, savedEvents } = makeEngine();
    await engine.execute({ placement: "home_trending", limit: 4 }, { profileId: "profile-9", emitResponseEvent: true });
    await new Promise((r) => setImmediate(r));

    expect(savedEvents).toHaveLength(1);
    const event = savedEvents[0] as { eventType: string; producer: string; profileId: string; metadata: Record<string, unknown> };
    expect(event.eventType).toBe("RECOMMENDATION_RESPONSE");
    expect(event.producer).toBe("api-engine");
    expect(event.profileId).toBe("profile-9");
    expect(Array.isArray(event.metadata.items)).toBe(true);
    expect((event.metadata.items as unknown[]).length).toBeGreaterThan(0);
    expect(typeof event.metadata.policyVersion).toBe("string");
  });

  it("preview/materializer runs (no emit flag) write NO response events", async () => {
    const { engine, savedEvents } = makeEngine();
    await engine.execute({ placement: "home_trending" });
    await new Promise((r) => setImmediate(r));
    expect(savedEvents).toHaveLength(0);
  });
});

describe("popularity honesty — no trend without a sample (§5.3)", () => {
  it("below the minimum engagement sample, nothing claims POPULAR_NOW", async () => {
    const { engine } = makeEngine();
    const result = await engine.execute({ placement: "home_trending" });
    for (const item of result.items) {
      expect(item.reasonCodes.includes("POPULAR_NOW") && item.candidateSource === "RECENT_ENGAGEMENT_VELOCITY").toBe(false);
    }
  });
});

describe("the stale cache is a fallthrough, not an answer", () => {
  it("a cache row older than the TTL is reported STALE and the live ladder serves", async () => {
    const reader = makeReader();
    (reader as { findCachedRecommendations: () => Promise<unknown> }).findCachedRecommendations = async () => ({
      items: [{ productId: "p1", slug: "wireless-earbuds", name: "Wireless Earbuds", score: 5, reasonCodes: [] }],
      updatedAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
    });
    const { engine } = makeEngine(reader);
    const result = await engine.execute({ placement: "home_trending" });
    expect(result.meta?.sources.find((s) => s.source === "MATERIALIZED_CACHE")?.state).toBe("STALE");
    expect(result.items.length).toBeGreaterThan(1);
  });
});
