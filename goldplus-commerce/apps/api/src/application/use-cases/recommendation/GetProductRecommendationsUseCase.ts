import { ProductPublicDto } from '@goldplus/shared';
import { IProductRepository } from '../../ports/IProductRepository';
import { IRecommendationReadRepository, RecommendationProductContext } from '../../ports/IRecommendationReadRepository';
import {
  IMerchandisingRuleRepository,
  IRecommendationSurfaceConfigRepository,
} from '../../ports/IRecommendationAdminRepositories';
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
import { applyMerchandisingRules, MerchandisingEffect } from '../../../domain/recommendation/AdminMerchandising';

const POOL_LIMIT = 60;

export interface ProductRecommendations {
  boughtTogether: ProductPublicDto[];
  alsoViewed: ProductPublicDto[];
}

/** Rich per-shelf result used by the preview/"why" simulator. */
export interface ShelfExplanation {
  surface: RecommendationSurface;
  title: string;
  enabled: boolean;
  hidden: boolean;
  hiddenReason: string | null;
  items: Array<{
    productId: string;
    name: string;
    rank: number;
    finalScore: number;
    reasonCode: string;
    pinned: boolean;
    breakdown: RankedCandidate['breakdown'];
  }>;
  merchandisingEffects: MerchandisingEffect[];
  excludedCount: number;
}

export class GetProductRecommendationsUseCase {
  constructor(
    private readonly recs: IRecommendationReadRepository,
    private readonly products: IProductRepository,
    private readonly merch: IMerchandisingRuleRepository,
    private readonly surfaceConfigs: IRecommendationSurfaceConfigRepository
  ) {}

  async execute(input: { productId: string; categoryId?: string | null; limit?: number }): Promise<ProductRecommendations> {
    const limit = Math.max(1, Math.min(input.limit ?? 8, 20));
    const [bought, viewed] = await Promise.all([
      this.buildShelf('product_page_bought_together', input.productId, input.categoryId ?? null, limit),
      this.buildShelf('product_page_also_viewed', input.productId, input.categoryId ?? null, limit),
    ]);
    return { boughtTogether: bought.products, alsoViewed: viewed.products };
  }

  /** Preview entry point: same pipeline, but returns the full explanation. */
  async explainShelf(surface: RecommendationSurface, productId: string, limit = 8): Promise<ShelfExplanation> {
    const shelf = await this.buildShelf(surface, productId, null, limit);
    return shelf.explanation;
  }

  private async gatherSignals(surface: RecommendationSurface, productId: string, categoryId: string | null): Promise<SignalScore[][]> {
    const [coPurchased, coCarted, coViewed, bestseller, trending] = await Promise.all([
      this.recs.getCoPurchased(productId, POOL_LIMIT),
      this.recs.getCoCarted(productId, POOL_LIMIT),
      this.recs.getCoViewed(productId, POOL_LIMIT),
      this.recs.getBestSellingProducts({ sinceDays: 90, limit: POOL_LIMIT, categoryId: categoryId ?? undefined }),
      this.recs.getTrendingProducts({ sinceDays: 14, limit: POOL_LIMIT, categoryId: categoryId ?? undefined }),
    ]);
    const coPurchaseSig = scoreSignalCoOccurrences('co_purchase', coPurchased.anchorSupport, coPurchased.candidates);
    const coCartSig = scoreSignalCoOccurrences('co_cart', coCarted.anchorSupport, coCarted.candidates);
    const coViewSig = scoreSignalCoOccurrences('co_view', coViewed.anchorSupport, coViewed.candidates);
    const bestsellerSig = asSignalScores('bestseller', bestseller);
    const trendingSig = asSignalScores('trending', trending);
    return surface === 'product_page_also_viewed'
      ? [coViewSig, coCartSig, trendingSig]
      : [coPurchaseSig, coCartSig, coViewSig, bestsellerSig];
  }

  private async buildShelf(
    surface: RecommendationSurface,
    anchorProductId: string,
    categoryId: string | null,
    limitDefault: number
  ): Promise<{ products: ProductPublicDto[]; explanation: ShelfExplanation }> {
    const staticConfig = surfaceConfig(surface);
    const published = await this.surfaceConfigs.findPublished(surface);

    const enabled = published ? published.enabled : true;
    const title = published?.title ?? staticConfig.intent;
    const limit = published?.limit ?? limitDefault;
    const minItems = published?.minItems ?? 0;
    const weights =
      published && Object.keys(published.signalWeights).length > 0 ? published.signalWeights : staticConfig.weights;
    const maxPerCategory = published?.maxPerCategory ?? staticConfig.diversity.maxPerCategory;

    if (!enabled) {
      return {
        products: [],
        explanation: { surface, title, enabled: false, hidden: true, hiddenReason: 'surface_disabled', items: [], merchandisingEffects: [], excludedCount: 0 },
      };
    }

    const signalLists = await this.gatherSignals(surface, anchorProductId, categoryId);
    const blended = blendSignalScores(signalLists, weights);
    const maxRelevance = blended.reduce((m, b) => Math.max(m, b.relevance), 0) || 1;

    const activeRules = await this.merch.listActiveForSurface(surface, new Date());
    const pinIds = activeRules.filter((r) => r.action === 'pin' && r.productId).map((r) => r.productId!);
    const poolIds = unique([...blended.slice(0, POOL_LIMIT).map((b) => b.productId), ...pinIds]);

    const contextRows = await this.recs.getProductContext([anchorProductId, ...poolIds]);
    const contextById = new Map(contextRows.map((r) => [r.productId, r]));
    const commercialOf = (id: string): ProductCommercialContext | undefined => toCommercial(contextById.get(id));
    const anchorBand = priceBandOf(contextById.get(anchorProductId)?.price ?? null);

    const eligible = applyEligibilityFilters(blended, { anchorProductId, commercialOf, surface });
    const excludedCount = blended.length - eligible.length;

    const rows = await this.products.findPublicViewList({ ids: poolIds, limit: POOL_LIMIT });
    const dtoById = new Map<string, ProductPublicDto>();
    const categoryNameById = new Map<string, string | null>();
    for (const row of rows) {
      const dto = toProductPublicDto(row);
      dtoById.set(dto.id, dto);
      categoryNameById.set(dto.id, row.categoryName ?? null);
    }
    const categoryOf = (id: string) => contextById.get(id)?.categoryId ?? categoryNameById.get(id) ?? null;
    const isSafe = (id: string) => {
      const ctx = contextById.get(id);
      return dtoById.has(id) && ctx?.isPublished !== false && ctx?.stockStatus !== 'out_of_stock' && ctx?.stockStatus !== 'discontinued';
    };

    const ranked: RankedCandidate[] = eligible
      .filter((b) => dtoById.has(b.productId))
      .map((b) => ({
        productId: b.productId,
        reasonCode: b.reasonCode,
        breakdown: computeScoreBreakdown({
          relevance: b.relevance / maxRelevance,
          confidence: b.confidence,
          commercial: commercialOf(b.productId),
          intent: staticConfig.intent,
          anchorBand,
        }),
      }))
      .sort(compareRankedCandidates);

    // Apply admin merchandising (pin/boost/bury/exclude) with safety.
    const merchResult = applyMerchandisingRules(ranked, activeRules, { categoryOf, isSafe, now: new Date() });
    const diversified = applyDiversityStrategy(merchResult.ranked, { maxPerCategory: maxPerCategory ?? undefined }, { categoryOf });

    // Pinned items first (already safety-checked), then algorithmic tail.
    const pinnedSet = new Set(merchResult.pinnedProductIds);
    const finalOrder = [...merchResult.pinnedProductIds, ...diversified.map((r) => r.productId)].slice(0, limit);
    const products = finalOrder.map((id) => dtoById.get(id)).filter((d): d is ProductPublicDto => !!d);

    const hidden = published?.hideIfBelowMinItems ? products.length < minItems : false;
    const breakdownById = new Map(ranked.map((r) => [r.productId, r]));

    const explanation: ShelfExplanation = {
      surface,
      title,
      enabled: true,
      hidden,
      hiddenReason: hidden ? 'below_min_items' : null,
      items: finalOrder.map((id, i) => {
        const rc = breakdownById.get(id);
        return {
          productId: id,
          name: dtoById.get(id)?.name ?? id,
          rank: i + 1,
          finalScore: rc?.breakdown.finalScore ?? 0,
          reasonCode: pinnedSet.has(id) ? 'manual_merchandising' : rc?.reasonCode ?? 'fallback_popular',
          pinned: pinnedSet.has(id),
          breakdown: rc?.breakdown ?? computeScoreBreakdown({ relevance: 0, confidence: 0, intent: staticConfig.intent }),
        };
      }),
      merchandisingEffects: merchResult.effects,
      excludedCount,
    };

    return { products: hidden ? [] : products, explanation };
  }
}

function unique(ids: string[]): string[] {
  return [...new Set(ids)];
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
