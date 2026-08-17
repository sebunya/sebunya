import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { UpdateRecommendationRuleUseCase } from "../../apps/api/src/application/recommendations/UpdateRecommendationRuleUseCase";
import { RollbackRecommendationRuleUseCase } from "../../apps/api/src/application/recommendations/RollbackRecommendationRuleUseCase";
import { RecommendationRuleValidationService } from "../../apps/api/src/application/recommendations/RecommendationRuleValidationService";
import { RecommendationRuleConflictService } from "../../apps/api/src/application/recommendations/RecommendationRuleConflictService";
import {
  RecommendationRuleApplicationService,
  applyPinPositions,
} from "../../apps/api/src/application/recommendations/RecommendationRuleApplicationService";
import { GetRecommendationsUseCase } from "../../apps/api/src/application/recommendations/GetRecommendationsUseCase";
import { ProductSignalExtractor } from "../../apps/api/src/application/recommendations/ProductSignalExtractor";
import { RecommendationScoringService } from "../../apps/api/src/application/recommendations/RecommendationScoringService";
import { CompatibilityRuleService } from "../../apps/api/src/application/recommendations/CompatibilityRuleService";
import { TrendingScoreService } from "../../apps/api/src/application/recommendations/TrendingScoreService";
import { RecommendationEligibilityService } from "../../apps/api/src/application/recommendations/RecommendationEligibilityService";
import { RecommendationDeduplicationService } from "../../apps/api/src/application/recommendations/RecommendationDeduplicationService";
import { RecommendationDiversityService } from "../../apps/api/src/application/recommendations/RecommendationDiversityService";
import type { RecommendationRule } from "../../apps/api/src/domain/recommendations/RecommendationRuleTypes";
import type { RecommendationProductRecord } from "../../apps/api/src/application/ports/IProductRecommendationReader";

/**
 * R9 (2026-08-06): the hostile review's PROVEN findings, each pinned so it
 * stays closed. Two adversarial reviewers executed reproductions against the
 * real classes before these fixes — every block here re-runs the attack.
 */

const ROOT = join(__dirname, "../..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

// ─── B1: the two-person SUPPRESS gate, both proven bypass vectors ───────────

function ruleFixture(over: Partial<RecommendationRule> = {}): RecommendationRule {
  return {
    id: "r1",
    name: "Boost power banks",
    type: "BOOST",
    status: "ACTIVE",
    priority: 100,
    placement: "home_trending",
    targetType: "PRODUCT",
    targetValue: "27b396dd-55c1-4181-9772-aec1bf4a3dcf",
    conditions: {},
    action: { type: "BOOST", boostScore: 25 },
    createdBy: "admin-1",
    createdAt: new Date("2026-08-01"),
    updatedAt: new Date("2026-08-01"),
    ...over,
  } as RecommendationRule;
}

function ruleRepos(existing: RecommendationRule) {
  const audits: string[] = [];
  return {
    ruleRepo: {
      async findById() {
        return existing;
      },
      async update(_id: string, patch: RecommendationRule) {
        return patch;
      },
      async findActiveRulesForPlacement() {
        return [];
      },
    },
    auditRepo: {
      async record(e: { action: string }) {
        audits.push(e.action);
      },
      async findByRuleId() {
        return [
          { id: "a1", action: "UPDATED", before: ruleFixture({ type: "SUPPRESS", action: { type: "SUPPRESS" } }) },
        ];
      },
    },
    audits,
  };
}

describe("B1 — one admin can no longer arm a suppression through the side doors", () => {
  it("vector 1 (PROVEN pre-fix): editing a live BOOST into a SUPPRESS is refused", async () => {
    const { ruleRepo, auditRepo } = ruleRepos(ruleFixture());
    const useCase = new UpdateRecommendationRuleUseCase(
      ruleRepo as never,
      auditRepo as never,
      new RecommendationRuleValidationService(),
      new RecommendationRuleConflictService(),
    );
    const result = await useCase.execute({
      id: "r1",
      updates: { type: "SUPPRESS", targetType: "PRODUCT", targetValue: ruleFixture().targetValue, action: { type: "SUPPRESS" } } as never,
      performedBy: "admin-1",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect((result.errors ?? []).join(" ")).toContain("cannot be edited into a suppression");
  });

  it("a DRAFT may still change type — activation is where the second admin comes in", async () => {
    const { ruleRepo, auditRepo } = ruleRepos(ruleFixture({ status: "DRAFT" }));
    const useCase = new UpdateRecommendationRuleUseCase(
      ruleRepo as never,
      auditRepo as never,
      new RecommendationRuleValidationService(),
      new RecommendationRuleConflictService(),
    );
    const result = await useCase.execute({
      id: "r1",
      updates: { type: "SUPPRESS", targetType: "PRODUCT", targetValue: ruleFixture().targetValue, action: { type: "SUPPRESS" } } as never,
      performedBy: "admin-1",
    });
    expect(result.ok).toBe(true);
  });

  it("vector 2 (PROVEN pre-fix): a SUPPRESS before-image can NEVER come back through rollback", async () => {
    const { ruleRepo, auditRepo } = ruleRepos(ruleFixture());
    const useCase = new RollbackRecommendationRuleUseCase(
      ruleRepo as never,
      auditRepo as never,
      new RecommendationRuleValidationService(),
    );
    const result = await useCase.execute({ ruleId: "r1", auditLogId: "a1", performedBy: "admin-1" });
    // Type is pinned; a before-image whose remaining fields cohere restores
    // with the CURRENT type, and one that no longer validates is refused.
    // Either way, the one impossible outcome is a SUPPRESS re-arming.
    if (result.ok) {
      expect(result.rule.type).toBe("BOOST");
      expect(result.rule.status).toBe("ACTIVE");
    } else {
      expect(result.code).toBe("VALIDATION_FAILED");
    }
  });

  it("a benign rollback (name/priority) works and still keeps type and lifecycle pinned", async () => {
    const { ruleRepo, auditRepo } = ruleRepos(ruleFixture());
    (auditRepo as { findByRuleId: () => Promise<unknown[]> }).findByRuleId = async () => [
      { id: "a2", action: "UPDATED", before: { name: "Original name", priority: 7 } },
    ];
    const useCase = new RollbackRecommendationRuleUseCase(
      ruleRepo as never,
      auditRepo as never,
      new RecommendationRuleValidationService(),
    );
    const result = await useCase.execute({ ruleId: "r1", auditLogId: "a2", performedBy: "admin-2" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rule.name).toBe("Original name");
      expect(result.rule.priority).toBe(7);
      expect(result.rule.type).toBe("BOOST");
      expect(result.rule.status).toBe("ACTIVE");
    }
  });
});

// ─── B2: pins survive the final sort, identically on live and preview ───────

describe("B2 — PIN is no longer a silent no-op (proven divergence)", () => {
  const CATALOGUE: RecommendationProductRecord[] = Array.from({ length: 6 }, (_, i) => ({
    id: `p${i + 1}`,
    slug: `product-${i + 1}`,
    name: `Product ${String.fromCharCode(65 + i)}`,
    categoryId: `c${(i % 3) + 1}`,
    imageUrl: `https://img/${i + 1}`,
    price: 10_000 * (i + 1),
    stockStatus: "in_stock",
    stockQuantity: 10,
    isActive: true,
  }));

  function engineWithPin(pinnedId: string, position: number) {
    const reader = {
      async findPublicProducts(input?: { productIds?: string[]; excludeProductIds?: string[]; limit?: number }) {
        let rows = [...CATALOGUE];
        if (input?.productIds) rows = rows.filter((p) => input.productIds!.includes(p.id));
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
      async findRecentSearchQueries() { return []; },
      async getTrendingEvents() { return []; },
    };
    const rule = ruleFixture({
      type: "PIN",
      targetValue: pinnedId,
      action: { type: "PIN", pinPosition: position },
    });
    const ruleApplication = new RecommendationRuleApplicationService(
      { async findActiveRulesForPlacement() { return [rule]; } } as never,
      new RecommendationEligibilityService(),
      new RecommendationRuleConflictService(),
    );
    return new GetRecommendationsUseCase(
      reader as never,
      new ProductSignalExtractor(),
      new RecommendationScoringService(new CompatibilityRuleService()),
      new TrendingScoreService(events as never),
      new RecommendationEligibilityService(),
      new RecommendationDeduplicationService(),
      new RecommendationDiversityService(),
      ruleApplication,
      events as never,
    );
  }

  it("a pinned product holds position 1 in the LIVE response, through the score sort", async () => {
    // p6 sorts last alphabetically and carries no score advantage — without
    // the fix, the final sort buried it and the pin silently did nothing.
    const engine = engineWithPin("p6", 1);
    const result = await engine.execute({ placement: "home_trending", limit: 4 });
    expect(result.items[0].productId).toBe("p6");
    expect(result.items[0].ruleId).toBe("r1");
  });

  it("applyPinPositions is shared by the live engine and the preview — one final ordering", () => {
    const engine = read("apps/api/src/application/recommendations/GetRecommendationsUseCase.ts");
    const preview = read("apps/api/src/application/recommendations/PreviewRecommendationRulesUseCase.ts");
    for (const src of [engine, preview]) {
      expect(src).toContain("applyPinPositions(");
      expect(src).toContain("b.score - a.score || a.productId.localeCompare(b.productId)");
    }
  });

  it("the helper re-inserts a diversity-cut pinned item and never drops a pin for a non-pin", () => {
    const items = [{ productId: "a" }, { productId: "b" }, { productId: "c" }];
    const all = [...items, { productId: "pinned" }];
    const result = applyPinPositions(items, [{ productId: "pinned", position: 2 }], all, 3);
    expect(result.map((i) => i.productId)).toEqual(["a", "pinned", "b"]);
  });
});

// ─── B-P1: fabricated popularity stays dead ─────────────────────────────────

describe("B-P1 — POPULAR_NOW cannot be fabricated anywhere (proven pre-fix)", () => {
  it("zero-evidence fallback items carry FALLBACK_USED or NEW_ARRIVAL — never POPULAR_NOW, in ANY field", async () => {
    const reader = {
      async findPublicProducts(input?: { productIds?: string[]; excludeProductIds?: string[]; limit?: number; orderBy?: string }) {
        const rows: RecommendationProductRecord[] = Array.from({ length: 4 }, (_, i) => ({
          id: `p${i + 1}`,
          slug: `product-${i + 1}`,
          name: `Product ${i + 1}`,
          categoryId: "c1",
          imageUrl: `https://img/${i + 1}`,
          price: 10_000,
          stockStatus: "in_stock",
          stockQuantity: 5,
          isActive: true,
        }));
        if (input?.productIds) return rows.filter((p) => input.productIds!.includes(p.id));
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
      async findRecentSearchQueries() { return []; },
      async getTrendingEvents() { return []; },
    };
    const engine = new GetRecommendationsUseCase(
      reader as never,
      new ProductSignalExtractor(),
      new RecommendationScoringService(new CompatibilityRuleService()),
      new TrendingScoreService(events as never),
      new RecommendationEligibilityService(),
      new RecommendationDeduplicationService(),
      new RecommendationDiversityService(),
      { apply: async ({ candidates }: { candidates: unknown[] }) => ({ candidates, pins: [], suppressedProductIds: [] }) } as never,
      events as never,
    );
    const result = await engine.execute({ placement: "home_trending", limit: 4 });
    expect(result.items.length).toBeGreaterThan(0);
    for (const item of result.items) {
      expect(item.reasonCodes, item.productId).not.toContain("POPULAR_NOW");
      expect(item.reasonCode).not.toBe("POPULAR_NOW");
      expect(item.displayReason ?? "").not.toMatch(/popular/i);
    }
  });

  it("a single sold unit scores its bestseller rank but cannot CLAIM popularity", () => {
    const scoring = new RecommendationScoringService(new CompatibilityRuleService());
    const candidate = {
      productId: "p1",
      slug: "product-1",
      name: "Product 1",
      signals: new ProductSignalExtractor().extract({ id: "p1", slug: "product-1", name: "Product 1" } as never),
      score: 0,
      reasonCodes: [],
    };
    const scored = scoring.scoreCandidates([candidate as never], {
      placement: "home_trending",
      bestsellerRanks: new Map([["p1", { rank: 1 }]]),
      bestsellerSampleSize: 1,
    });
    expect(scored[0].score).toBeGreaterThan(0);
    expect(scored[0].reasonCodes).not.toContain("POPULAR_NOW");

    const claimed = scoring.scoreCandidates([{ ...candidate, reasonCodes: [] } as never], {
      placement: "home_trending",
      bestsellerRanks: new Map([["p1", { rank: 1 }]]),
      bestsellerSampleSize: 50,
    });
    expect(claimed[0].reasonCodes).toContain("POPULAR_NOW");
  });
});

// ─── M1: the ladder never starves on ineligible shallow rungs ───────────────

describe("M1 — per-rung eligibility (proven latent empty rail)", () => {
  it("a shallow rung full of image-less products no longer blocks the catalogue fallback", async () => {
    const imageless: RecommendationProductRecord[] = Array.from({ length: 12 }, (_, i) => ({
      id: `x${i}`,
      slug: `ximage-less-${i}`,
      name: `Imageless ${i}`,
      categoryId: "c1",
      imageUrl: null,
      price: 10_000,
      stockStatus: "in_stock",
      stockQuantity: 5,
      isActive: true,
    }));
    const imaged: RecommendationProductRecord[] = Array.from({ length: 4 }, (_, i) => ({
      id: `p${i}`,
      slug: `imaged-${i}`,
      name: `Imaged ${i}`,
      categoryId: "c2",
      imageUrl: `https://img/${i}`,
      price: 10_000,
      stockStatus: "in_stock",
      stockQuantity: 5,
      isActive: true,
    }));
    const anchor: RecommendationProductRecord = {
      id: "anchor",
      slug: "anchor",
      name: "Anchor",
      categoryId: "c1",
      imageUrl: "https://img/a",
      price: 10_000,
      stockStatus: "in_stock",
      stockQuantity: 5,
      isActive: true,
    };
    const reader = {
      async findPublicProducts(input?: { categoryId?: string; productIds?: string[]; excludeProductIds?: string[]; limit?: number; orderBy?: string }) {
        // Mirrors the real reader's deterministic (name, id) ordering.
        let rows = [...imageless, ...imaged].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
        if (input?.categoryId) rows = rows.filter((p) => p.categoryId === input.categoryId);
        if (input?.productIds) rows = rows.filter((p) => input.productIds!.includes(p.id));
        if (input?.excludeProductIds) rows = rows.filter((p) => !input.excludeProductIds!.includes(p.id));
        return rows.slice(0, input?.limit ?? 200);
      },
      async findProductById(id: string) { return id === "anchor" ? anchor : null; },
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
      async findRecentSearchQueries() { return []; },
      async getTrendingEvents() { return []; },
    };
    const engine = new GetRecommendationsUseCase(
      reader as never,
      new ProductSignalExtractor(),
      new RecommendationScoringService(new CompatibilityRuleService()),
      new TrendingScoreService(events as never),
      new RecommendationEligibilityService(),
      new RecommendationDeduplicationService(),
      new RecommendationDiversityService(),
      { apply: async ({ candidates }: { candidates: unknown[] }) => ({ candidates, pins: [], suppressedProductIds: [] }) } as never,
      events as never,
    );
    // Pre-fix: the same-category rung's 12 image-less rows filled the pool
    // cap, eligibility then killed them all, and the response was empty with
    // emptyReason ALL_SUPPRESSED — blaming a rule that did not exist.
    const result = await engine.execute({ placement: "product_related", productId: "anchor", limit: 4 });
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.meta?.emptyReason).toBeUndefined();
  });
});

// ─── The measurement layer stays trustworthy ────────────────────────────────

describe("the evidence stream cannot be quietly poisoned", () => {
  it("trending aggregates whitelist real engagement types and group on the coalesced product key", () => {
    const repo = read("apps/api/src/infrastructure/db/repositories/DrizzleRecommendationEventRepository.ts");
    const block = repo.slice(repo.indexOf("getTrendingEvents"));
    expect(block).toContain('"PRODUCT_VIEWED"');
    expect(block).toContain('"RECOMMENDATION_CLICKED"');
    expect(block).not.toContain('"RECOMMENDATION_RESPONSE"');
    expect(repo).toContain("coalesce(${recommendationEvents.recommendationProductId}, ${recommendationEvents.productId})");
  });

  it("behaviour aggregates exclude the engine's own server-native rows", () => {
    const repo = read("apps/api/src/infrastructure/db/repositories/DrizzleRecommendationAnalyticsRepository.ts");
    expect(repo).toContain("not in ('RECOMMENDATION_RESPONSE', 'RECOMMENDATION_ERROR')");
  });

  it("the identity stitch runs AFTER event validation, shape-checked", () => {
    const route = read("apps/api/src/interfaces/http/routes/recommendations.ts");
    const executeIdx = route.indexOf("trackRecommendationEventUseCase.execute");
    const stitchIdx = route.indexOf("observeAnonymousId");
    expect(executeIdx).toBeGreaterThan(-1);
    expect(stitchIdx).toBeGreaterThan(executeIdx);
    expect(route).toContain("/^anon_[a-zA-Z0-9_-]{12,150}$/");
  });

  it("the dedupe fast-path never runs identity-free (proven global-dedupe fix)", () => {
    const useCase = read("apps/api/src/application/recommendations/TrackRecommendationEventUseCase.ts");
    expect(useCase).toContain("const hasIdentity = Boolean(valid.anonymousId || valid.customerId || origin.profileId)");
    expect(useCase).toContain("hasIdentity && valid.eventType");
  });

  it("recommendation endpoints have their own rate-limit family", () => {
    const policy = read("apps/api/src/domain/security/PublicEndpointPolicy.ts");
    expect(policy).toContain("'recommendations': { family: 'recommendations'");
    expect(policy).toContain("isUnder(path, '/recommendations')");
  });

  it("the relay refuses oversized bodies BEFORE buffering and forwards the client address", () => {
    const relay = read("apps/web/src/pages/api/rec/[...path].ts");
    const declaredIdx = relay.indexOf("content-length");
    const bufferIdx = relay.indexOf("await request.text()");
    expect(declaredIdx).toBeGreaterThan(-1);
    expect(declaredIdx).toBeLessThan(bufferIdx);
    expect(relay).toContain("Buffer.byteLength(raw");
    expect(relay).toContain('headers["X-Forwarded-For"]');
  });

  it("login and registration ROTATE the visit token — a planted cookie is never the one that gets linked", () => {
    for (const page of ["apps/web/src/pages/login.astro", "apps/web/src/pages/register.astro"]) {
      const src = read(page);
      expect(src, page).toContain("mintSignedVisitToken");
      expect(src, page).toContain("rotatedToken");
      expect(src, page).not.toContain("Astro.cookies.get('gp_visit')");
    }
  });
});

// ─── B5: the materialized cache decides WHICH products, never what they cost ──

describe("B5 — a cached rail serves the live price, not the price it froze", () => {
  const STALE = 110_000;
  const LIVE = 175_000;

  function engineWithCache(cachedPrice: number, livePrice: number) {
    const live: RecommendationProductRecord = {
      id: "p1",
      slug: "portable-audio-headset",
      name: "Portable Audio Headset",
      categoryId: "c1",
      imageUrl: "https://img/1",
      price: livePrice,
      stockStatus: "in_stock",
      stockQuantity: 12,
      isActive: true,
    };
    const reader = {
      async findPublicProducts() { return [live]; },
      async findProductById() { return null; },
      async findProductsByIds() { return []; },
      async findBestsellerProductIds() { return []; },
      async findCompatibilityTargetIds() { return []; },
      async findRecentPaidProductIdsForProfile() { return []; },
      async findCachedRecommendations() {
        return {
          // The blob the cron materialized BEFORE the price change.
          items: [{
            productId: "p1",
            slug: "portable-audio-headset",
            name: "Portable Audio Headset",
            imageUrl: "https://img/1",
            price: cachedPrice,
            categoryId: "c1",
            stockQuantity: 12,
            signals: { isActive: true, isVisible: true, isInStock: true, categoryId: "c1" },
            score: 10,
            reasonCodes: [],
          }],
          updatedAt: new Date(),
        };
      },
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
      new RecommendationRuleApplicationService(
        { async findActiveRulesForPlacement() { return []; } } as never,
        new RecommendationEligibilityService(),
        new RecommendationRuleConflictService(),
      ),
      events as never,
    );
  }

  it("re-reads the price from the database instead of serving the frozen one", async () => {
    // The rail was advertising a price the catalogue no longer had, for the
    // whole cache TTL — and a percentage promotion computed off that stale
    // base lands below the floor the checkout enforces.
    const result = await engineWithCache(STALE, LIVE).execute({ placement: "home_trending", limit: 4 });
    // Prove the CACHED path actually served this — otherwise the assertion
    // below is satisfied by the live ladder and proves nothing.
    expect(result.meta.sources.map((s: any) => s.source)).toContain("MATERIALIZED_CACHE");
    expect(result.meta.sources.find((s: any) => s.source === "MATERIALIZED_CACHE")!.state).toBe("SUPPORTED");
    const item = result.items.find((i) => i.productId === "p1");
    expect(item).toBeDefined();
    expect(item!.price).toBe(LIVE);
    expect(item!.price).not.toBe(STALE);
  });

  it("still serves the cached rail (the fix refreshes, it does not discard)", async () => {
    const result = await engineWithCache(LIVE, LIVE).execute({ placement: "home_trending", limit: 4 });
    expect(result.items.map((i) => i.productId)).toContain("p1");
  });
});
