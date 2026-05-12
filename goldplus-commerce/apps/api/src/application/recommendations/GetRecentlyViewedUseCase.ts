import type { RecommendationResponseDto } from "@goldplus/shared";
import type { IRecommendationEventRepository } from "../ports/IRecommendationEventRepository";
import type { IProductRecommendationReader } from "../ports/IProductRecommendationReader";
import { ProductSignalExtractor } from "./ProductSignalExtractor";
import { RecommendationEligibilityService } from "./RecommendationEligibilityService";

export class GetRecentlyViewedUseCase {
  constructor(
    private readonly events: IRecommendationEventRepository,
    private readonly products: IProductRecommendationReader,
    private readonly signalExtractor: ProductSignalExtractor,
    private readonly eligibility: RecommendationEligibilityService,
  ) {}

  async execute(input: {
    anonymousId?: string;
    customerId?: string;
    limit?: number;
  }): Promise<RecommendationResponseDto> {
    const limit = input.limit ?? 6;

    if (!input.anonymousId && !input.customerId) {
      return this.empty();
    }

    const viewed = await this.events.findRecentlyViewed({
      anonymousId: input.anonymousId,
      customerId: input.customerId,
      limit,
    });

    if (viewed.length === 0) return this.empty();

    const productIds = viewed.map((item) => item.productId);
    const products = await this.products.findProductsByIds(productIds);

    const productOrder = new Map(productIds.map((id, index) => [id, index]));

    const candidates = products
      .map((product) => ({
        productId: product.id,
        slug: product.slug,
        name: product.name,
        imageUrl: product.imageUrl ?? undefined,
        price: product.price ?? undefined,
        currency: product.currency ?? undefined,
        signals: this.signalExtractor.extract(product),
        score: 100 - (productOrder.get(product.id) ?? 0),
        reasonCodes: ["RECENTLY_VIEWED" as const],
        displayReason: "Recently viewed",
      }))
      .sort((a, b) => b.score - a.score);

    const eligible = this.eligibility.filter(candidates, {
      placement: "recently_viewed",
      requireImage: true,
    });

    return {
      placement: "recently_viewed",
      items: eligible.slice(0, limit).map((candidate) => ({
        productId: candidate.productId,
        slug: candidate.slug,
        name: candidate.name,
        imageUrl: candidate.imageUrl,
        price: candidate.price,
        currency: candidate.currency,
        score: candidate.score,
        reasonCodes: candidate.reasonCodes,
        displayReason: candidate.displayReason,
      })),
      generatedAt: new Date().toISOString(),
      strategy: "rule_based_v1",
    };
  }

  private empty(): RecommendationResponseDto {
    return {
      placement: "recently_viewed",
      items: [],
      generatedAt: new Date().toISOString(),
      strategy: "rule_based_v1",
    };
  }
}
