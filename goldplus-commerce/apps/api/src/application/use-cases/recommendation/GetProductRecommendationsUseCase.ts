import { ProductPublicDto } from '@goldplus/shared';
import { IProductRepository } from '../../ports/IProductRepository';
import { IRecommendationReadRepository, RecommendationProductContext } from '../../ports/IRecommendationReadRepository';
import { toProductPublicDto } from '../../mappers/toProductPublicDto';
import { SignalScore, RecommendationSurface, ProductCommercialContext } from '../../../domain/recommendation/RecommendationTypes';
import { surfaceConfig } from '../../../domain/recommendation/surfaceConfig';
import {
  scoreSignalCoOccurrences,
  asSignalScores,
  blendSignalScores,
  applyEligibilityFilters,
  computeScoreBreakdown,
  compareRankedCandidates,
  applyDiversityStrategy,
  priceBandOf,
  RankedCandidate,
} from '../../../domain/recommendation/RecommendationV2';

const POOL_LIMIT = 60;

export interface ProductRecommendations {
  boughtTogether: ProductPublicDto[];
  alsoViewed: ProductPublicDto[];
}

/**
 * Product-page shelves. Each signal (co-purchase / co-cart / co-view /
 * bestseller / trending) is scored SEPARATELY, then blended with
 * surface-specific weights — bought-together leans on co-purchase & co-cart,
 * also-viewed leans on co-view. Candidates are eligibility-filtered against
 * real product context (published, in stock) and resolved to public DTOs.
 */
export class GetProductRecommendationsUseCase {
  constructor(
    private readonly recs: IRecommendationReadRepository,
    private readonly products: IProductRepository
  ) {}

  async execute(input: { productId: string; categoryId?: string | null; limit?: number }): Promise<ProductRecommendations> {
    const limit = Math.max(1, Math.min(input.limit ?? 8, 20));
    const categoryId = input.categoryId ?? undefined;

    const [coPurchased, coCarted, coViewed, bestseller, trending] = await Promise.all([
      this.recs.getCoPurchased(input.productId, POOL_LIMIT),
      this.recs.getCoCarted(input.productId, POOL_LIMIT),
      this.recs.getCoViewed(input.productId, POOL_LIMIT),
      this.recs.getBestSellingProducts({ sinceDays: 90, limit: POOL_LIMIT, categoryId }),
      this.recs.getTrendingProducts({ sinceDays: 14, limit: POOL_LIMIT, categoryId }),
    ]);

    const coPurchaseSig = scoreSignalCoOccurrences('co_purchase', coPurchased.anchorSupport, coPurchased.candidates);
    const coCartSig = scoreSignalCoOccurrences('co_cart', coCarted.anchorSupport, coCarted.candidates);
    const coViewSig = scoreSignalCoOccurrences('co_view', coViewed.anchorSupport, coViewed.candidates);
    const bestsellerSig = asSignalScores('bestseller', bestseller);
    const trendingSig = asSignalScores('trending', trending);

    const [boughtTogether, alsoViewed] = await Promise.all([
      this.assemble('product_page_bought_together', input.productId, [coPurchaseSig, coCartSig, coViewSig, bestsellerSig], limit),
      this.assemble('product_page_also_viewed', input.productId, [coViewSig, coCartSig, trendingSig], limit),
    ]);

    return { boughtTogether, alsoViewed };
  }

  private async assemble(
    surface: RecommendationSurface,
    anchorProductId: string,
    signalLists: SignalScore[][],
    limit: number
  ): Promise<ProductPublicDto[]> {
    const config = surfaceConfig(surface);
    const blended = blendSignalScores(signalLists, config.weights);
    if (blended.length === 0) return [];

    const maxRelevance = blended.reduce((m, b) => Math.max(m, b.relevance), 0) || 1;
    const poolIds = blended.slice(0, POOL_LIMIT).map((b) => b.productId);

    const contextRows = await this.recs.getProductContext([anchorProductId, ...poolIds]);
    const contextById = new Map(contextRows.map((r) => [r.productId, r]));
    const commercialOf = (id: string): ProductCommercialContext | undefined => toCommercial(contextById.get(id));
    const anchorBand = priceBandOf(contextById.get(anchorProductId)?.price ?? null);

    const eligible = applyEligibilityFilters(blended, { anchorProductId, commercialOf, surface });

    const rows = await this.products.findPublicViewList({ ids: eligible.map((b) => b.productId).slice(0, POOL_LIMIT), limit: POOL_LIMIT });
    const dtoById = new Map<string, ProductPublicDto>();
    const categoryById = new Map<string, string | null>();
    for (const row of rows) {
      const dto = toProductPublicDto(row);
      dtoById.set(dto.id, dto);
      categoryById.set(dto.id, row.categoryName ?? null);
    }

    const ranked: RankedCandidate[] = eligible
      .filter((b) => dtoById.has(b.productId))
      .map((b) => ({
        productId: b.productId,
        reasonCode: b.reasonCode,
        breakdown: computeScoreBreakdown({
          relevance: b.relevance / maxRelevance,
          confidence: b.confidence,
          commercial: commercialOf(b.productId),
          intent: config.intent,
          anchorBand,
        }),
      }))
      .sort(compareRankedCandidates);

    const diversified = applyDiversityStrategy(ranked, config.diversity, {
      categoryOf: (id) => categoryById.get(id) ?? null,
    });

    return diversified.slice(0, limit).map((r) => dtoById.get(r.productId)!).filter(Boolean);
  }
}

function toCommercial(ctx: RecommendationProductContext | undefined): ProductCommercialContext | undefined {
  if (!ctx) return undefined;
  return {
    productId: ctx.productId,
    categoryId: ctx.categoryId,
    categoryName: ctx.categoryName,
    price: ctx.price,
    priceBand: priceBandOf(ctx.price),
    stockStatus: ctx.stockStatus,
    stockQty: ctx.stockQty,
    isNewArrival: ctx.isNewArrival,
    isClearance: ctx.isClearance,
    isPublished: ctx.isPublished,
  };
}
