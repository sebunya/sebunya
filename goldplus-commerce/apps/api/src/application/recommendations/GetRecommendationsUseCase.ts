import type {
  GetRecommendationsInput,
  RecommendationItemDto,
  RecommendationResponseDto,
} from "@goldplus/shared";
import crypto from 'crypto';
import type {
  IProductRecommendationReader,
  RecommendationProductRecord,
} from "../ports/IProductRecommendationReader";
import { ProductSignalExtractor } from "./ProductSignalExtractor";
import { RecommendationScoringService } from "./RecommendationScoringService";
import { TrendingScoreService } from "./TrendingScoreService";
import { RecommendationFallbackService } from "./RecommendationFallbackService";
import { RecommendationEligibilityService } from "./RecommendationEligibilityService";
import { RecommendationDeduplicationService } from "./RecommendationDeduplicationService";
import { RecommendationDiversityService } from "./RecommendationDiversityService";
import { RecommendationRuleApplicationService } from "./RecommendationRuleApplicationService";
import type { RecommendationCandidate } from "../../domain/recommendations/RecommendationTypes";

const DEFAULT_LIMITS = {
  product_related: 4,
  complete_setup: 3,
  cart_addon: 3,
  home_trending: 8,
  category_popular: 8,
  recently_viewed: 6,
} as const;

export class GetRecommendationsUseCase {
  constructor(
    private readonly products: IProductRecommendationReader,
    private readonly signalExtractor: ProductSignalExtractor,
    private readonly scoring: RecommendationScoringService,
    private readonly trending: TrendingScoreService,
    private readonly fallback: RecommendationFallbackService,
    private readonly eligibility: RecommendationEligibilityService,
    private readonly dedupe: RecommendationDeduplicationService,
    private readonly diversity: RecommendationDiversityService,
    private readonly ruleApplication: RecommendationRuleApplicationService,
    /**
     * Degradation reporter (R1). The engine deliberately survives cache and
     * rule failures — but "non-fatal" and "silent" are different decisions.
     * Every swallowed failure is reported here so a permanently broken cache
     * or rule engine is an alert, not an invisible behaviour change.
     */
    private readonly onDegraded?: (stage: 'cache_read_failed' | 'rule_application_failed', placement: string, error: unknown) => void,
  ) {}

  async execute(input: GetRecommendationsInput): Promise<RecommendationResponseDto> {
    const limit = input.limit ?? DEFAULT_LIMITS[input.placement];
    const railRenderId = crypto.randomUUID();

    let candidates: RecommendationCandidate[] | null = null;
    const cacheKey = input.productId || input.categoryId || 'global';

    try {
      const cachedItems = await this.products.findCachedRecommendations(input.placement, cacheKey);
      if (cachedItems && cachedItems.length > 0) {
        const mapped = cachedItems.map((item: any) => ({
          productId: item.productId,
          slug: item.slug,
          name: item.name,
          imageUrl: item.imageUrl,
          price: item.price,
          currency: item.currency,
          categoryId: item.categoryId,
          categorySlug: item.categorySlug,
          createdAt: item.createdAt ? new Date(item.createdAt) : undefined,
          sortPriority: item.sortPriority,
          stockQuantity: item.stockQuantity,
          signals: item.signals || {},
          score: item.score || 0,
          reasonCodes: item.reasonCodes || [],
          ruleId: item.ruleId,
          appliedRuleIds: item.appliedRuleIds,
          displayReason: item.displayReason,
        }));

        const filtered = this.eligibility.filter(mapped, {
          placement: input.placement,
          contextProductId: input.productId,
          categoryId: input.categoryId,
          categorySlug: input.categorySlug,
          cartProductIds: input.cartProductIds,
          requireImage: true,
        });

        if (filtered.length > 0) {
          candidates = filtered;
        }
      }
    } catch (err) {
      // Survivable: fall back to live generation — but reported, never silent.
      this.onDegraded?.('cache_read_failed', input.placement, err);
    }

    if (!candidates) {
      candidates = await this.generateV1ScoredCandidates(input, limit);
    }

    // ---- Rule application ----
    // RECOMMENDATION_V2_RULES_ENABLED retired in R1 (2026-08-06). The flag
    // defaulted OFF outside dev and was never passed to the production
    // container, so the admin could author rules the live engine silently
    // ignored — authored-but-unapplied, the same trap as
    // ORDER_PAYMENT_VERIFICATION_REQUIRED. Rule application is now structural:
    // an operator's ACTIVE rule either applies or its failure is visible.
    // Failure isolation is unchanged — a throwing rule engine keeps the
    // untouched V1 candidates rather than emptying the rail.
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
    } catch (e) {
      this.onDegraded?.('rule_application_failed', input.placement, e);
    }

    // Continue with deduplication and diversity after V2 rules
    candidates = this.dedupe.dedupe(candidates);
    candidates = this.diversity.diversify(candidates, input.placement, limit);

    if (candidates.length === 0) {
      const contextProduct = input.productId
        ? await this.products.findProductById(input.productId)
        : null;

      const fallbackProducts = await this.fallback.getFallbackProducts({
        placement: input.placement,
        categoryId: input.categoryId ?? contextProduct?.categoryId ?? undefined,
        categorySlug: input.categorySlug ?? contextProduct?.categorySlug ?? undefined,
        excludeProductIds: [
          ...(input.productId ? [input.productId] : []),
          ...(input.cartProductIds ?? []),
        ],
        limit,
      });

      candidates = this.toCandidates(fallbackProducts).map((candidate) => ({
        ...candidate,
        fallbackUsed: true,
        reasonCodes: ["FALLBACK_USED"],
        displayReason: input.placement === "home_trending" ? "Popular Now" : undefined,
      }));

      candidates = this.eligibility.filter(candidates, {
        placement: input.placement,
        contextProductId: input.productId,
        categoryId: input.categoryId,
        categorySlug: input.categorySlug,
        cartProductIds: input.cartProductIds,
        requireImage: true,
      });

      candidates = this.diversity.diversify(candidates, input.placement, limit);
    }

    return {
      placement: input.placement,
      items: candidates.map((candidate) => this.toDto(candidate, railRenderId)),
      generatedAt: new Date().toISOString(),
      strategy: "rule_based_v1",
    };
  }

  public async generateV1ScoredCandidates(input: GetRecommendationsInput, limit: number): Promise<RecommendationCandidate[]> {
    const contextProduct = input.productId
      ? await this.products.findProductById(input.productId)
      : null;

    const contextSignals = contextProduct
      ? this.signalExtractor.extract(contextProduct)
      : undefined;

    const cartProducts = input.cartProductIds?.length
      ? await this.products.findProductsByIds(input.cartProductIds)
      : [];

    const cartSignals = cartProducts.map((product) => this.signalExtractor.extract(product));

    const rawCandidates = await this.generateCandidates(input, contextProduct, limit);
    const trendingScores = await this.trending.getTrendingScores();

    let candidates = this.toCandidates(rawCandidates);

    candidates = this.eligibility.filter(candidates, {
      placement: input.placement,
      contextProductId: input.productId,
      categoryId: input.categoryId,
      categorySlug: input.categorySlug,
      cartProductIds: input.cartProductIds,
      requireImage: true,
    });

    candidates = this.scoring.scoreCandidates(candidates, {
      placement: input.placement,
      sourceSignals: contextSignals,
      cartSignals,
      trendingScores,
    });

    return candidates
      .filter((candidate) => candidate.score > -9999)
      .sort((a, b) => b.score - a.score);
  }

  private async generateCandidates(
    input: GetRecommendationsInput,
    contextProduct: RecommendationProductRecord | null,
    limit: number,
  ): Promise<RecommendationProductRecord[]> {
    if (input.placement === "category_popular") {
      return this.products.findPublicProducts({
        categoryId: input.categoryId,
        categorySlug: input.categorySlug,
        limit: Math.max(limit * 4, 40),
      });
    }

    if (
      (input.placement === "product_related" || input.placement === "complete_setup") &&
      contextProduct
    ) {
      return this.products.findPublicProducts({
        categoryId: input.placement === "product_related" ? contextProduct.categoryId ?? undefined : undefined,
        excludeProductIds: [contextProduct.id],
        limit: Math.max(limit * 10, 80),
      });
    }

    if (input.placement === "cart_addon") {
      return this.products.findPublicProducts({
        excludeProductIds: input.cartProductIds ?? [],
        limit: Math.max(limit * 10, 80),
      });
    }

    if (input.placement === "home_trending") {
      return this.products.findPublicProducts({
        limit: Math.max(limit * 10, 100),
      });
    }

    return [];
  }

  private toCandidates(products: RecommendationProductRecord[]): RecommendationCandidate[] {
    return products.map((product) => ({
      productId: product.id,
      slug: product.slug,
      name: product.name,
      imageUrl: product.imageUrl ?? undefined,
      price: product.price ?? undefined,
      currency: product.currency ?? undefined,
      categoryId: product.categoryId ?? undefined,
      categorySlug: product.categorySlug ?? undefined,
      createdAt: product.createdAt ?? undefined,
      sortPriority: product.sortPriority ?? undefined,
      stockQuantity: product.stockQuantity ?? undefined,
      signals: this.signalExtractor.extract(product),
      score: 0,
      reasonCodes: [],
    }));
  }

  private toDto(candidate: RecommendationCandidate, railRenderId: string): RecommendationItemDto {
    return {
      productId: candidate.productId,
      slug: candidate.slug,
      name: candidate.name,
      imageUrl: candidate.imageUrl,
      price: candidate.price,
      currency: candidate.currency,
      score: candidate.score,
      reasonCodes: candidate.reasonCodes,
      displayReason: candidate.displayReason,
      
      // Pass 13A: Attribution
      attributionId: crypto.randomUUID(),
      ruleId: candidate.ruleId,
      appliedRuleIds: candidate.appliedRuleIds,
      reasonCode: candidate.reasonCodes?.[0], // Simplified mapping for Pass 13A
      railRenderId: railRenderId,
    };
  }
}
