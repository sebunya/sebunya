import type {
  GetRecommendationsInput,
  RecommendationItemDto,
  RecommendationResponseDto,
} from "@goldplus/shared";
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
  ) {}

  async execute(input: GetRecommendationsInput): Promise<RecommendationResponseDto> {
    const limit = input.limit ?? DEFAULT_LIMITS[input.placement];

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

    candidates = candidates
      .filter((candidate) => candidate.score > -9999)
      .sort((a, b) => b.score - a.score);

    candidates = this.dedupe.dedupe(candidates);
    candidates = this.diversity.diversify(candidates, input.placement, limit);

    if (candidates.length === 0) {
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
      items: candidates.map((candidate) => this.toDto(candidate)),
      generatedAt: new Date().toISOString(),
      strategy: "rule_based_v1",
    };
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

  private toDto(candidate: RecommendationCandidate): RecommendationItemDto {
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
    };
  }
}
