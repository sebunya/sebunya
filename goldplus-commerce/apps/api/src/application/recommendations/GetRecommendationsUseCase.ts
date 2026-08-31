import type {
  GetRecommendationsInput,
  RecommendationCandidateSource,
  RecommendationEmptyReason,
  RecommendationItemDto,
  RecommendationPlacement,
  RecommendationResponseDto,
  RecommendationResponseMeta,
  RecommendationSourceReport,
  RecommendationSourceState,
} from "@goldplus/shared";
import crypto from "crypto";
import type {
  IProductRecommendationReader,
  RecommendationProductRecord,
} from "../ports/IProductRecommendationReader";
import type { IRecommendationEventRepository } from "../ports/IRecommendationEventRepository";
import { RecommendationEvent } from "../../domain/recommendations/RecommendationEvent";
import { ProductSignalExtractor } from "./ProductSignalExtractor";
import { RecommendationScoringService, TRENDING_MIN_SAMPLE } from "./RecommendationScoringService";
import { TrendingScoreService } from "./TrendingScoreService";
import { RecommendationEligibilityService } from "./RecommendationEligibilityService";
import { RecommendationDeduplicationService } from "./RecommendationDeduplicationService";
import { RecommendationDiversityService } from "./RecommendationDiversityService";
import { RecommendationRuleApplicationService, applyPinPositions } from "./RecommendationRuleApplicationService";
import {
  RECOMMENDATION_POLICY_VERSION,
  type RecommendationCandidate,
} from "../../domain/recommendations/RecommendationTypes";

const DEFAULT_LIMITS = {
  product_related: 4,
  complete_setup: 3,
  cart_addon: 3,
  home_trending: 8,
  category_popular: 8,
  recently_viewed: 6,
} as const;

/**
 * One deterministic fallback ladder per placement (R3, 2026-08-06; prompt §18).
 * The ladder is walked top-down; every attempted source reports its state; a
 * surface may be empty only after the LAST rung — and then with a typed
 * reason, never silently. `recently_viewed` is served by its own use case and
 * deliberately has no ladder here.
 */
const PLACEMENT_LADDERS: Record<RecommendationPlacement, RecommendationCandidateSource[]> = {
  product_related: [
    "EXACT_PRODUCT_COMPATIBILITY",
    "SAME_CATEGORY_ATTRIBUTE_MATCH",
    "CATEGORY_BESTSELLER",
    "GLOBAL_BESTSELLER",
    "NEW_AND_ELIGIBLE",
    "DETERMINISTIC_CATALOGUE_FALLBACK",
  ],
  complete_setup: [
    "EXACT_PRODUCT_COMPATIBILITY",
    "COMPLEMENTARY_HEURISTIC",
    "GLOBAL_BESTSELLER",
    "DETERMINISTIC_CATALOGUE_FALLBACK",
  ],
  cart_addon: [
    "EXACT_PRODUCT_COMPATIBILITY",
    "COMPLEMENTARY_HEURISTIC",
    "RECENT_PAID_ORDER_VELOCITY",
    "GLOBAL_BESTSELLER",
    "DETERMINISTIC_CATALOGUE_FALLBACK",
  ],
  home_trending: [
    "RECENT_PAID_ORDER_VELOCITY",
    "SEARCH_QUERY_AFFINITY",
    "RECENT_ENGAGEMENT_VELOCITY",
    "GLOBAL_BESTSELLER",
    "NEW_AND_ELIGIBLE",
    "DETERMINISTIC_CATALOGUE_FALLBACK",
  ],
  category_popular: [
    "CATEGORY_BESTSELLER",
    "SEARCH_QUERY_AFFINITY",
    "RECENT_ENGAGEMENT_VELOCITY",
    "SAME_CATEGORY_ATTRIBUTE_MATCH",
    "DETERMINISTIC_CATALOGUE_FALLBACK",
  ],
  recently_viewed: [],
};

/** How stale a materialized-cache row may be before the live path takes over. */
const CACHE_TTL_MS = 2 * 60 * 60 * 1000;

/** Server-side context that must never travel in the shared client input. */
export interface RecommendationServerContext {
  profileId?: string;
  /** True only on the live serving route — never for preview or materializer runs. */
  emitResponseEvent?: boolean;
  /** R8: server-assigned experiment variant (AssignRecommendationExperimentUseCase). */
  experiment?: { experimentKey: string; variantKey: string };
}

interface GatherResult {
  candidates: RecommendationCandidate[];
  reports: RecommendationSourceReport[];
}

export class GetRecommendationsUseCase {
  constructor(
    private readonly products: IProductRecommendationReader,
    private readonly signalExtractor: ProductSignalExtractor,
    private readonly scoring: RecommendationScoringService,
    private readonly trending: TrendingScoreService,
    private readonly eligibility: RecommendationEligibilityService,
    private readonly dedupe: RecommendationDeduplicationService,
    private readonly diversity: RecommendationDiversityService,
    private readonly ruleApplication: RecommendationRuleApplicationService,
    /** Server-native event writes (RECOMMENDATION_RESPONSE); absent in tests that don't care. */
    private readonly events?: IRecommendationEventRepository,
    /** The governed search evidence bridge (R4). Absent = source reports UNSUPPORTED. */
    private readonly searchAffinity?: import("../ports/ISearchAffinityReader").ISearchAffinityReader,
    /**
     * Degradation reporter (R1). The engine deliberately survives cache, rule
     * and event failures — but "non-fatal" and "silent" are different
     * decisions. Every swallowed failure lands here.
     */
    private readonly onDegraded?: (
      stage:
        | "cache_read_failed"
        | "rule_application_failed"
        | "source_failed"
        | "response_event_failed"
        | "penalty_lookup_failed",
      placement: string,
      error: unknown,
    ) => void,
  ) {}

  async execute(
    input: GetRecommendationsInput,
    serverContext?: RecommendationServerContext,
  ): Promise<RecommendationResponseDto> {
    const limit = input.limit ?? DEFAULT_LIMITS[input.placement];
    const railRenderId = crypto.randomUUID();
    const requestId = crypto.randomUUID();

    // ── Stage 1: materialized cache (TTL-guarded) ────────────────────────────
    let candidates: RecommendationCandidate[] | null = null;
    let sourceReports: RecommendationSourceReport[] = [];
    const cacheKey = input.productId || input.categoryId || "global";

    try {
      const cached = await this.products.findCachedRecommendations(input.placement, cacheKey);
      if (cached && cached.items.length > 0) {
        const age = Date.now() - new Date(cached.updatedAt).getTime();
        // A future timestamp (clock skew) is treated as stale, not as fresh
        // forever — beyond a 5-minute tolerance the live ladder takes over.
        const fresh = age <= CACHE_TTL_MS && age >= -5 * 60 * 1000;
        if (fresh) {
          const mapped = cached.items.map((item) => this.reviveCachedCandidate(item));
          // R9 (M5): availability and price are re-checked against the
          // DATABASE, not against the cached blob — a product that sold out
          // after materialization must not be served for up to the TTL. One
          // indexed query; the ATP predicate lives in the reader's SQL.
          const liveRows = await this.products.findPublicProducts({
            productIds: mapped.map((c) => c.productId),
            limit: mapped.length,
          });
          // Eligibility AND the volatile display fields come from `liveRows`.
          // Filtering on them while still SERVING the cached blob's price meant
          // a price change was advertised at its old value for the whole TTL —
          // and a promotion floor computed off that stale base is a price the
          // checkout will not honour. The cache decides WHICH products; the
          // database decides what they cost.
          const liveById = new Map(liveRows.map((r) => [r.id, r]));
          const revalidated = mapped
            .filter((c) => liveById.has(c.productId))
            .map((c) => {
              const live = liveById.get(c.productId)!;
              return {
                ...c,
                price: typeof live.price === 'number' ? live.price : c.price,
                // The floor comes only from the database, never the cached blob.
                floorPriceUgx: live.floorPriceUgx ?? null,
                stockQuantity:
                  typeof live.stockQuantity === 'number' ? live.stockQuantity : c.stockQuantity,
              };
            });
          const filtered = this.eligibility.filter(revalidated, {
            placement: input.placement,
            contextProductId: input.productId,
            categoryId: input.categoryId,
            categorySlug: input.categorySlug,
            cartProductIds: input.cartProductIds,
            requireImage: true,
          });
          if (filtered.length > 0) {
            candidates = filtered;
            sourceReports = [{ source: "MATERIALIZED_CACHE", state: "SUPPORTED", candidates: filtered.length }];
          } else {
            // A fresh cache that filtered to nothing is a visible fact, and
            // the live ladder takes over.
            sourceReports.push({ source: "MATERIALIZED_CACHE", state: "SUPPORTED_WITH_LIMITATIONS", candidates: 0 });
          }
        } else {
          // A cache the cron stopped refreshing is a STALE source, not silent
          // staleness served forever — the live ladder takes over.
          sourceReports.push({ source: "MATERIALIZED_CACHE", state: "STALE", candidates: 0 });
        }
      }
    } catch (err) {
      this.onDegraded?.("cache_read_failed", input.placement, err);
      sourceReports.push({ source: "MATERIALIZED_CACHE", state: "DEGRADED", candidates: 0 });
    }

    // ── Stages 2–5: ladder gather → enrich → score (the live path) ───────────
    if (!candidates) {
      const gathered = await this.gatherAndScore(input, limit, serverContext?.profileId);
      candidates = gathered.candidates;
      sourceReports = [...sourceReports, ...gathered.reports];
    }

    // ── Stage 6: business rules (structural since R1 — apply or fail visibly) ─
    let pins: Array<{ productId: string; position: number }> = [];
    let suppressedCount = 0;
    let postRuleCandidates: RecommendationCandidate[] = candidates;
    try {
      const ruleResult = await this.ruleApplication.apply({
        placement: input.placement,
        context: {
          productId: input.productId,
          categoryId: input.categoryId,
          categorySlug: input.categorySlug,
          cartProductIds: input.cartProductIds,
        },
        candidates,
      });
      candidates = ruleResult.candidates;
      postRuleCandidates = ruleResult.candidates;
      pins = ruleResult.pins ?? [];
      suppressedCount = ruleResult.suppressedProductIds?.length ?? 0;
    } catch (e) {
      this.onDegraded?.("rule_application_failed", input.placement, e);
    }

    // ── Stage 7: repetition control (server-side, profile-based, §5A.9) ──────
    if (serverContext?.profileId && this.events) {
      try {
        const [recentlyShown, recentlyPurchased] = await Promise.all([
          this.events.findRecentlyShownProductIds({
            profileId: serverContext.profileId,
            withinHours: 24,
            limit: 100,
          }),
          this.products.findRecentPaidProductIdsForProfile(serverContext.profileId, 30),
        ]);
        const shown = new Set(recentlyShown);
        const purchased = new Set(recentlyPurchased);
        // Purchased: suppressed from accessory/related placements (they own
        // it now); penalised elsewhere. Seen-recently: a bounded penalty —
        // demotion, never disappearance, because relevance still outranks
        // novelty (§14).
        candidates = candidates
          .filter(
            (c) =>
              !(
                purchased.has(c.productId) &&
                ["product_related", "complete_setup", "cart_addon"].includes(input.placement)
              ),
          )
          .map((c) => {
            let penalty = 0;
            if (shown.has(c.productId)) penalty += 30;
            if (purchased.has(c.productId)) penalty += 50;
            return penalty > 0 ? { ...c, score: c.score - penalty } : c;
          });
      } catch (e) {
        this.onDegraded?.("penalty_lookup_failed", input.placement, e);
      }
    }

    // ── Stages 8–9: dedup, diversity, deterministic final order ──────────────
    candidates = this.dedupe.dedupe(candidates);
    candidates.sort((a, b) => b.score - a.score || a.productId.localeCompare(b.productId));
    candidates = this.diversity.diversify(candidates, input.placement, limit);
    // Pins are applied LAST (R9, proven fix): the score sort above undid the
    // rule stage's splice, so live pins were a silent no-op while the preview
    // — which never re-sorted — showed them working. One shared helper now
    // finishes the ordering on both paths.
    if (pins.length > 0) {
      candidates = applyPinPositions(candidates, pins, postRuleCandidates, limit);
    }

    // ── Stage 10: typed emptiness ────────────────────────────────────────────
    let emptyReason: RecommendationEmptyReason | undefined;
    if (candidates.length === 0) {
      emptyReason = await this.classifyEmptiness(input, sourceReports, suppressedCount);
    }

    const fallbackLevel = candidates.reduce((deepest, c) => Math.max(deepest, c.fallbackLevel ?? 0), 0);

    const meta: RecommendationResponseMeta = {
      requestId,
      policyVersion: RECOMMENDATION_POLICY_VERSION,
      fallbackLevel,
      sources: sourceReports,
      ...(emptyReason ? { emptyReason } : {}),
      ...(serverContext?.experiment ? { experiment: serverContext.experiment } : {}),
    };

    const response: RecommendationResponseDto = {
      placement: input.placement,
      items: candidates.map((candidate) => this.toDto(candidate, railRenderId)),
      generatedAt: new Date().toISOString(),
      strategy: "deterministic_v3",
      meta,
    };

    // ── Stage 13: the server-native serving fact ─────────────────────────────
    if (serverContext?.emitResponseEvent && this.events) {
      this.emitResponseEvent(input, response, serverContext).catch((e) =>
        this.onDegraded?.("response_event_failed", input.placement, e),
      );
    }

    return response;
  }

  /**
   * The ladder walk. Public shape preserved for the materializer and preview:
   * both consume scored, source-tagged candidates.
   */
  public async generateV1ScoredCandidates(
    input: GetRecommendationsInput,
    limit: number,
  ): Promise<RecommendationCandidate[]> {
    return (await this.gatherAndScore(input, limit)).candidates;
  }

  private async gatherAndScore(
    input: GetRecommendationsInput,
    limit: number,
    profileId?: string,
  ): Promise<GatherResult> {
    const ladder = PLACEMENT_LADDERS[input.placement];
    const reports: RecommendationSourceReport[] = [];

    const contextProduct = input.productId ? await this.products.findProductById(input.productId) : null;
    const contextSignals = contextProduct ? this.signalExtractor.extract(contextProduct) : undefined;
    const cartProducts = input.cartProductIds?.length
      ? await this.products.findProductsByIds(input.cartProductIds)
      : [];
    const cartSignals = cartProducts.map((product) => this.signalExtractor.extract(product));

    const excludeIds = [
      ...(contextProduct ? [contextProduct.id] : []),
      ...(input.cartProductIds ?? []),
    ];

    const pool = new Map<string, RecommendationCandidate>();
    let bestsellerRanks: Map<string, { rank: number }> | undefined;
    let bestsellerSampleSize = 0;
    let trendingRanks: Map<string, { rank: number }> | undefined;
    let trendingSampleSize = 0;

    const eligibilityContext = {
      placement: input.placement,
      contextProductId: input.productId,
      categoryId: input.categoryId,
      categorySlug: input.categorySlug,
      cartProductIds: input.cartProductIds,
      requireImage: true,
    };

    for (let level = 0; level < ladder.length; level++) {
      // Enough pool to rank from — deeper rungs stay untried (reported as such
      // by their absence; only ATTEMPTED sources appear in the report).
      if (pool.size >= Math.max(limit * 3, limit + 4)) break;

      const source = ladder[level];
      try {
        const result = await this.gatherFromSource(source, input, contextProduct, excludeIds, limit, profileId);
        reports.push({ source, state: result.state, candidates: result.products.length });

        if (source === "RECENT_PAID_ORDER_VELOCITY" || source === "GLOBAL_BESTSELLER" || source === "CATEGORY_BESTSELLER") {
          bestsellerRanks = result.bestsellerRanks ?? bestsellerRanks;
          bestsellerSampleSize = Math.max(bestsellerSampleSize, result.bestsellerSampleSize ?? 0);
        }
        if (source === "RECENT_ENGAGEMENT_VELOCITY") {
          trendingRanks = result.trendingRanks;
          trendingSampleSize = result.trendingSampleSize ?? 0;
        }

        // R9 (M1, proven): eligibility runs PER RUNG, before pool insertion —
        // the pool-size stop above counts USABLE candidates, so a shallow rung
        // full of ineligible items (no image, reserved out) can no longer
        // starve the deeper rungs whose whole job is "never empty".
        const rungCandidates = this.eligibility.filter(
          result.products.map((product) => this.toCandidate(product)),
          eligibilityContext,
        );
        let ordinal = 0;
        for (const candidate of rungCandidates) {
          if (pool.has(candidate.productId)) continue;
          pool.set(candidate.productId, {
            ...candidate,
            candidateSource: source,
            fallbackLevel: level,
            sourceOrdinal: ordinal,
            // Earlier rungs are better evidence, and each source's own
            // internal ranking (affinity by conversions, bestsellers by
            // units) is part of that evidence: a bounded prior keeps both
            // decisive when downstream components tie.
            score: (ladder.length - level) * 25 + Math.max(0, 12 - ordinal),
          });
          ordinal += 1;
        }
      } catch (err) {
        reports.push({ source, state: "DEGRADED", candidates: 0 });
        this.onDegraded?.("source_failed", input.placement, err);
      }
    }

    // Eligibility already ran per rung — the pool holds only usable candidates.
    const candidates = [...pool.values()];

    const scored = this.scoring.scoreCandidates(candidates, {
      placement: input.placement,
      sourceSignals: contextSignals,
      cartSignals,
      trendingRanks,
      trendingSampleSize,
      bestsellerRanks,
      bestsellerSampleSize,
    });

    // Scoring rebuilds score from components; re-add the ladder prior so
    // provenance stays decisive, then drop hard-negative compatibility kills.
    const withPrior = scored.map((c) => {
      const prior = (ladder.length - (c.fallbackLevel ?? 0)) * 25 + Math.max(0, 12 - (c.sourceOrdinal ?? 12));
      return c.score <= -9999 ? c : { ...c, score: c.score + prior };
    });

    return {
      candidates: withPrior
        .filter((candidate) => candidate.score > -9999)
        .sort((a, b) => b.score - a.score || a.productId.localeCompare(b.productId)),
      reports,
    };
  }

  private async gatherFromSource(
    source: RecommendationCandidateSource,
    input: GetRecommendationsInput,
    contextProduct: RecommendationProductRecord | null,
    excludeIds: string[],
    limit: number,
    profileId?: string,
  ): Promise<{
    products: RecommendationProductRecord[];
    state: RecommendationSourceState;
    bestsellerRanks?: Map<string, { rank: number }>;
    bestsellerSampleSize?: number;
    trendingRanks?: Map<string, { rank: number }>;
    trendingSampleSize?: number;
  }> {
    const fetchLimit = Math.max(limit * 3, 12);

    switch (source) {
      case "EXACT_PRODUCT_COMPATIBILITY": {
        if (!contextProduct) return { products: [], state: "UNSUPPORTED" };
        const targetIds = await this.products.findCompatibilityTargetIds(contextProduct.id, fetchLimit);
        if (targetIds.length === 0) return { products: [], state: "INSUFFICIENT_SAMPLE" };
        const products = await this.products.findPublicProducts({
          productIds: targetIds,
          excludeProductIds: excludeIds,
          limit: fetchLimit,
        });
        return { products, state: "SUPPORTED" };
      }

      case "COMPLEMENTARY_HEURISTIC": {
        // Text-derived compatibility (the existing extractor) — real signal,
        // honestly labelled as limited: it infers from names, not from a
        // curated mapping.
        if (!contextProduct && !(input.cartProductIds?.length)) return { products: [], state: "UNSUPPORTED" };
        const products = await this.products.findPublicProducts({
          excludeProductIds: excludeIds,
          limit: fetchLimit,
        });
        return { products, state: "SUPPORTED_WITH_LIMITATIONS" };
      }

      case "SAME_CATEGORY_ATTRIBUTE_MATCH": {
        const categoryId = input.categoryId ?? contextProduct?.categoryId ?? undefined;
        const categorySlug = input.categorySlug;
        if (!categoryId && !categorySlug) return { products: [], state: "UNSUPPORTED" };
        const products = await this.products.findPublicProducts({
          categoryId,
          categorySlug,
          excludeProductIds: excludeIds,
          limit: fetchLimit,
        });
        return { products, state: "SUPPORTED" };
      }

      case "RECENT_PAID_ORDER_VELOCITY":
      case "CATEGORY_BESTSELLER":
      case "GLOBAL_BESTSELLER": {
        const bestsellerCategoryId =
          source === "CATEGORY_BESTSELLER"
            ? input.categoryId ?? contextProduct?.categoryId ?? undefined
            : undefined;
        // A category bestseller WITHOUT a category is not a global bestseller
        // in disguise — it is an unanswerable question (R9 m12).
        if (source === "CATEGORY_BESTSELLER" && !bestsellerCategoryId && !input.categorySlug) {
          return { products: [], state: "UNSUPPORTED" };
        }
        const rows = await this.products.findBestsellerProductIds({
          categoryId: bestsellerCategoryId,
          sinceDays: source === "RECENT_PAID_ORDER_VELOCITY" ? 30 : undefined,
          limit: fetchLimit,
        });
        if (rows.length === 0) return { products: [], state: "INSUFFICIENT_SAMPLE" };
        const products = await this.products.findPublicProducts({
          productIds: rows.map((r) => r.productId),
          excludeProductIds: excludeIds,
          limit: fetchLimit,
        });
        const ranks = new Map(rows.map((r, i) => [r.productId, { rank: i + 1 }]));
        return {
          products,
          state: "SUPPORTED",
          bestsellerRanks: ranks,
          bestsellerSampleSize: rows.reduce((sum, r) => sum + r.unitsSold, 0),
        };
      }

      case "RECENT_ENGAGEMENT_VELOCITY": {
        const { byProduct, sampleSize } = await this.trending.getTrendingSignals();
        if (sampleSize < TRENDING_MIN_SAMPLE) {
          return { products: [], state: "INSUFFICIENT_SAMPLE", trendingSampleSize: sampleSize };
        }
        const orderedIds = [...byProduct.entries()]
          .sort((a, b) => a[1].rank - b[1].rank)
          .map(([id]) => id)
          .filter((id) => !excludeIds.includes(id))
          .slice(0, fetchLimit);
        if (orderedIds.length === 0) return { products: [], state: "INSUFFICIENT_SAMPLE", trendingSampleSize: sampleSize };
        const products = await this.products.findPublicProducts({
          productIds: orderedIds,
          limit: fetchLimit,
        });
        const trendingRanks = new Map([...byProduct.entries()].map(([id, s]) => [id, { rank: s.rank }]));
        return { products, state: "SUPPORTED", trendingRanks, trendingSampleSize: sampleSize };
      }

      case "SEARCH_QUERY_AFFINITY": {
        // The two evidence streams meet HERE and only here: the profile's own
        // recent search intent (its event stream) selects rows from search's
        // identity-free aggregates. No join ever touches the search tables
        // with an identity (§10).
        if (!this.searchAffinity || !this.events) return { products: [], state: "UNSUPPORTED" };
        if (!profileId) return { products: [], state: "INSUFFICIENT_SAMPLE" };
        const queries = await this.events.findRecentSearchQueries({ profileId, withinDays: 14, limit: 3 });
        if (queries.length === 0) return { products: [], state: "INSUFFICIENT_SAMPLE" };
        const affinityLists = await Promise.all(
          queries.map((q) => this.searchAffinity!.topProductsForQuery(q, fetchLimit)),
        );
        const orderedIds: string[] = [];
        for (const list of affinityLists) {
          for (const row of list) {
            if (!orderedIds.includes(row.productId) && !excludeIds.includes(row.productId)) {
              orderedIds.push(row.productId);
            }
          }
        }
        if (orderedIds.length === 0) return { products: [], state: "INSUFFICIENT_SAMPLE" };
        const products = await this.products.findPublicProducts({
          productIds: orderedIds.slice(0, fetchLimit),
          limit: fetchLimit,
        });
        return { products, state: "SUPPORTED" };
      }

      case "NEW_AND_ELIGIBLE": {
        const products = await this.products.findPublicProducts({
          excludeProductIds: excludeIds,
          limit: fetchLimit,
          orderBy: "newest",
        });
        return { products, state: products.length > 0 ? "SUPPORTED" : "INSUFFICIENT_SAMPLE" };
      }

      case "DETERMINISTIC_CATALOGUE_FALLBACK": {
        const products = await this.products.findPublicProducts({
          excludeProductIds: excludeIds,
          limit: fetchLimit,
          orderBy: "stable",
        });
        return { products, state: "SUPPORTED" };
      }

      case "CURATED_DEFAULT":
      case "MATERIALIZED_CACHE":
      default:
        // CURATED_DEFAULT arrives with rules (PIN) downstream; the cache is
        // stage 1, never a ladder rung.
        return { products: [], state: "UNSUPPORTED" };
    }
  }

  /** Empty is a diagnosis, never a shrug (§17). */
  private async classifyEmptiness(
    input: GetRecommendationsInput,
    reports: RecommendationSourceReport[],
    suppressedCount: number,
  ): Promise<RecommendationEmptyReason> {
    if (input.placement === "recently_viewed") return "NO_ELIGIBLE_PRODUCTS";
    if (reports.some((r) => r.state === "DEGRADED")) return "DEPENDENCY_UNAVAILABLE";
    try {
      const anyEligible = await this.products.findPublicProducts({ limit: 1 });
      if (anyEligible.length === 0) return "CATALOGUE_EMPTY";
    } catch {
      return "DEPENDENCY_UNAVAILABLE";
    }
    // R9: ALL_SUPPRESSED is claimed only when rules ACTUALLY suppressed
    // something — "some source returned candidates" also covers eligibility
    // drops, and the old order misfiled a fully-suppressed setup rail as
    // NO_COMPATIBLE_PRODUCTS.
    if (suppressedCount > 0) return "ALL_SUPPRESSED";
    if (input.placement === "complete_setup") return "NO_COMPATIBLE_PRODUCTS";
    return "NO_ELIGIBLE_PRODUCTS";
  }

  private async emitResponseEvent(
    input: GetRecommendationsInput,
    response: RecommendationResponseDto,
    serverContext: RecommendationServerContext,
  ): Promise<void> {
    if (!this.events) return;
    const event = RecommendationEvent.create({
      eventType: "RECOMMENDATION_RESPONSE",
      producer: "api-engine",
      profileId: serverContext.profileId,
      placement: input.placement,
      productId: input.productId,
      categoryId: input.categoryId,
      railRenderId: response.items[0]?.railRenderId,
      metadata: {
        requestId: response.meta?.requestId,
        policyVersion: response.meta?.policyVersion,
        fallbackLevel: response.meta?.fallbackLevel,
        emptyReason: response.meta?.emptyReason,
        sources: response.meta?.sources.map((s) => `${s.source}:${s.state}:${s.candidates}`),
        experiment: response.meta?.experiment,
        items: response.items.map((item, rank) => ({
          id: item.productId,
          rank: rank + 1,
          src: item.candidateSource,
        })),
      },
    });
    await this.events.save(event);
  }

  private reviveCachedCandidate(item: unknown): RecommendationCandidate {
    const record = item as Record<string, unknown>;
    return {
      productId: record.productId as string,
      slug: record.slug as string,
      name: record.name as string,
      imageUrl: (record.imageUrl as string) ?? undefined,
      price: (record.price as number) ?? undefined,
      currency: (record.currency as string) ?? undefined,
      categoryId: (record.categoryId as string) ?? undefined,
      categorySlug: (record.categorySlug as string) ?? undefined,
      createdAt: record.createdAt ? new Date(record.createdAt as string) : undefined,
      sortPriority: (record.sortPriority as number) ?? undefined,
      stockQuantity: (record.stockQuantity as number) ?? undefined,
      signals: (record.signals as RecommendationCandidate["signals"]) || ({} as RecommendationCandidate["signals"]),
      score: (record.score as number) || 0,
      reasonCodes: (record.reasonCodes as RecommendationCandidate["reasonCodes"]) || [],
      ruleId: (record.ruleId as string) ?? undefined,
      appliedRuleIds: (record.appliedRuleIds as string[]) ?? undefined,
      displayReason: (record.displayReason as string) ?? undefined,
      candidateSource:
        (record.candidateSource as RecommendationCandidate["candidateSource"]) ?? "MATERIALIZED_CACHE",
      fallbackLevel: (record.fallbackLevel as number) ?? 0,
    };
  }

  private toCandidate(product: RecommendationProductRecord): RecommendationCandidate {
    return {
      productId: product.id,
      slug: product.slug,
      name: product.name,
      imageUrl: product.imageUrl ?? undefined,
      price: product.price ?? undefined,
      floorPriceUgx: product.floorPriceUgx ?? null,
      currency: product.currency ?? undefined,
      categoryId: product.categoryId ?? undefined,
      categorySlug: product.categorySlug ?? undefined,
      createdAt: product.createdAt ?? undefined,
      sortPriority: product.sortPriority ?? undefined,
      stockQuantity: product.stockQuantity ?? undefined,
      signals: this.signalExtractor.extract(product),
      score: 0,
      reasonCodes: [],
    };
  }

  private toDto(candidate: RecommendationCandidate, railRenderId: string): RecommendationItemDto {
    return {
      productId: candidate.productId,
      slug: candidate.slug,
      name: candidate.name,
      imageUrl: candidate.imageUrl,
      price: candidate.price,
      floorPriceUgx: candidate.floorPriceUgx ?? null,
      currency: candidate.currency,
      score: candidate.score,
      reasonCodes: candidate.reasonCodes,
      displayReason: candidate.displayReason,

      attributionId: crypto.randomUUID(),
      ruleId: candidate.ruleId,
      appliedRuleIds: candidate.appliedRuleIds,
      reasonCode: candidate.reasonCodes?.[0],
      railRenderId,

      candidateSource: candidate.candidateSource,
      fallbackLevel: candidate.fallbackLevel,
      // Every served item passed the ATP predicate in SQL on THIS request
      // (live rungs and the revalidated cache path both) — saying "confirm
      // availability" for stock the engine just verified was an underclaim.
      // The quantity is the row's own number; without one, no claim is made.
      ...(typeof candidate.stockQuantity === "number" && candidate.stockQuantity > 0
        ? { availability: { kind: "in_stock" as const, quantity: candidate.stockQuantity } }
        : {}),
    };
  }
}
