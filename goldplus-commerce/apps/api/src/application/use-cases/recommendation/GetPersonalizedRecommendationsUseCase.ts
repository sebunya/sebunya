import { ProductPublicDto } from '@goldplus/shared';
import { IProductRepository } from '../../ports/IProductRepository';
import { IRecommendationReadRepository, RecommendationIdentity } from '../../ports/IRecommendationReadRepository';
import { toProductPublicDto } from '../../mappers/toProductPublicDto';
import {
  scoreCoOccurrences,
  rankPersonalized,
  finalizeRecommendations,
  blendWithFallback,
  PersonalizationSource,
  ScoredProduct,
} from '../../../domain/recommendation/Recommendation';
import { RecommendationReasonCode } from '../../../domain/recommendation/RecommendationTypes';

const MAX_ANCHORS = 12;
const SIMILAR_PER_ANCHOR = 20;
const POOL_LIMIT = 60;
const MAX_PER_CATEGORY = 3;

export interface PersonalizedRecommendation {
  product: ProductPublicDto;
  reason: string | null;
  reasonCode: RecommendationReasonCode;
}

export interface PersonalizedConsent {
  personalization: boolean;
}

/** Derives a structured reason code from the (controlled) reason text. */
function reasonCodeFor(reason: string | null | undefined): RecommendationReasonCode {
  const t = (reason ?? '').toLowerCase();
  if (t.startsWith('because you bought')) return 'because_purchased';
  if (t.startsWith('because you added')) return 'because_carted';
  if (t.startsWith('because you viewed')) return 'because_viewed';
  if (t.startsWith('based on items you bought')) return 'because_purchased';
  if (t.startsWith('based on items you added')) return 'because_carted';
  if (t.startsWith('based on items you viewed')) return 'because_viewed';
  if (t.startsWith('trending')) return 'trending_now';
  return 'fallback_popular';
}

/**
 * "Recommended for you" — aggregates the person's recent interactions
 * (weighted by type and recency), pulls normalised similar items for
 * each, ranks the union, excludes what they already bought, enforces
 * category diversity, and falls back to trending for cold-start users.
 */
export class GetPersonalizedRecommendationsUseCase {
  constructor(
    private readonly recs: IRecommendationReadRepository,
    private readonly products: IProductRepository
  ) {}

  async execute(input: {
    identity: RecommendationIdentity;
    limit?: number;
    consent?: PersonalizedConsent;
  }): Promise<PersonalizedRecommendation[]> {
    const limit = Math.max(1, Math.min(input.limit ?? 12, 30));

    const hasIdentity = !!(input.identity.userId || input.identity.visitorId);
    const personalizationAllowed = (input.consent?.personalization ?? true) && hasIdentity;

    // No consent or no identity -> non-personalised popular products only.
    if (!personalizationAllowed) {
      const popular = await this.recs.getBestSellingProducts({ sinceDays: 90, limit: POOL_LIMIT });
      const trending = await this.recs.getTrendingProducts({ sinceDays: 14, limit: POOL_LIMIT });
      const merged = blendWithFallback(
        popular.map((p) => ({ productId: p.productId, score: p.score, reason: 'Popular right now' })),
        trending.map((p) => ({ productId: p.productId, score: p.score, reason: 'Trending now' })),
        { limit: POOL_LIMIT }
      );
      return this.resolve(merged, limit, new Set());
    }

    const [interactions, purchasedIds] = await Promise.all([
      this.recs.getRecentInteractions(input.identity, MAX_ANCHORS),
      this.recs.getPurchasedProductIds(input.identity),
    ]);

    const exclude = new Set<string>(purchasedIds);
    for (const it of interactions) exclude.add(it.productId); // don't recommend the seed items back

    // Build a personalisation source per recent interaction.
    const sources: PersonalizationSource[] = [];
    if (interactions.length > 0) {
      const similarResults = await Promise.all(
        interactions.map((it) => this.recs.getSimilarForAnchor(it.productId, SIMILAR_PER_ANCHOR))
      );
      interactions.forEach((it, i) => {
        const r = similarResults[i];
        sources.push({
          anchorProductId: it.productId,
          anchorName: it.productName ?? undefined,
          kind: it.kind,
          ageDays: it.ageDays,
          similar: scoreCoOccurrences(r.anchorSupport, r.candidates),
        });
      });
    }

    const personalized = rankPersonalized(sources);

    // Cold-start / gap-fill from trending.
    const popular = await this.recs.getPopularProducts({ sinceDays: 30, limit: POOL_LIMIT });
    const fallback: ScoredProduct[] = popular.map((p) => ({ productId: p.productId, score: p.score, reason: 'Trending now' }));
    const blended = blendWithFallback(personalized, fallback, { limit: POOL_LIMIT, excludeIds: exclude });

    return this.resolve(blended, limit, exclude);
  }

  private async resolve(scored: ScoredProduct[], limit: number, exclude: Set<string>): Promise<PersonalizedRecommendation[]> {
    if (scored.length === 0) return [];
    const poolIds = scored.slice(0, POOL_LIMIT).map((s) => s.productId);
    const rows = await this.products.findPublicViewList({ ids: poolIds, limit: POOL_LIMIT });

    const dtoById = new Map<string, ProductPublicDto>();
    const categoryById = new Map<string, string | null>();
    const reasonById = new Map<string, string | undefined>();
    for (const s of scored) reasonById.set(s.productId, s.reason);
    for (const row of rows) {
      const dto = toProductPublicDto(row);
      dtoById.set(dto.id, dto);
      categoryById.set(dto.id, row.categoryName ?? null);
    }

    const resolvable = scored.filter((s) => dtoById.has(s.productId));
    const final = finalizeRecommendations(resolvable, {
      limit,
      excludeIds: exclude,
      categoryOf: (id) => categoryById.get(id) ?? null,
      maxPerCategory: MAX_PER_CATEGORY,
    });

    return final
      .map((s) => {
        const product = dtoById.get(s.productId);
        if (!product) return null;
        const reason = reasonById.get(s.productId) ?? null;
        return { product, reason, reasonCode: reasonCodeFor(reason) };
      })
      .filter((x): x is PersonalizedRecommendation => x !== null);
  }
}
