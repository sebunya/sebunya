import { ProductPublicDto } from '@goldplus/shared';
import { IProductRepository } from '../../ports/IProductRepository';
import { IRecommendationReadRepository } from '../../ports/IRecommendationReadRepository';
import { ICompatibilityRuleRepository } from '../../ports/IRecommendationAdminRepositories';
import { toProductPublicDto } from '../../mappers/toProductPublicDto';
import { scoreSignalCoOccurrences, blendSignalScores } from '../../../domain/recommendation/RecommendationV2';
import { surfaceConfig } from '../../../domain/recommendation/surfaceConfig';

const POOL_LIMIT = 40;

export interface CompleteTheSetItem {
  product: ProductPublicDto;
  reason: string;
  reasonCode: 'compatible_accessory' | 'frequently_bought_together';
}

/**
 * "Complete Your Setup" — heavily driven by admin compatibility rules.
 * Explicit accessory mappings come first (charger → cable, power bank →
 * charger, etc.); only when there aren't enough does it fall back to
 * behavioural COMPLEMENTS (co-cart / co-purchase). It never fills the shelf
 * with random same-category substitutes, and never shows incompatible items.
 */
export class GetCompleteTheSetUseCase {
  constructor(
    private readonly recs: IRecommendationReadRepository,
    private readonly compat: ICompatibilityRuleRepository,
    private readonly products: IProductRepository
  ) {}

  async execute(input: { productId: string; limit?: number }): Promise<CompleteTheSetItem[]> {
    const limit = Math.max(1, Math.min(input.limit ?? 6, 12));
    const now = new Date();

    const [anchorCtx] = await this.recs.getProductContext([input.productId]);
    const categoryId = anchorCtx?.categoryId ?? null;

    const rules = await this.compat.listActiveForAnchor({ productId: input.productId, categoryId, now });

    const incompatible = new Set<string>();
    const accessoryOrder: Array<{ productId: string; reason: string }> = [];
    for (const r of rules) {
      if (!r.candidateProductId) continue; // category-candidate expansion is a future enhancement
      if (r.relationship === 'incompatible') {
        incompatible.add(r.candidateProductId);
        continue;
      }
      accessoryOrder.push({ productId: r.candidateProductId, reason: r.reasonText || 'Works with this product' });
    }

    const exclude = new Set<string>([input.productId, ...incompatible]);
    const reasonById = new Map<string, { text: string; code: CompleteTheSetItem['reasonCode'] }>();

    const orderedIds: string[] = [];
    for (const a of accessoryOrder) {
      if (exclude.has(a.productId) || reasonById.has(a.productId)) continue;
      reasonById.set(a.productId, { text: a.reason, code: 'compatible_accessory' });
      orderedIds.push(a.productId);
    }

    // Behavioural COMPLEMENT fallback (never substitutes).
    if (orderedIds.length < limit) {
      const [coCarted, coPurchased] = await Promise.all([
        this.recs.getCoCarted(input.productId, POOL_LIMIT),
        this.recs.getCoPurchased(input.productId, POOL_LIMIT),
      ]);
      const config = surfaceConfig('product_page_complete_the_set');
      const blended = blendSignalScores(
        [
          scoreSignalCoOccurrences('co_cart', coCarted.anchorSupport, coCarted.candidates),
          scoreSignalCoOccurrences('co_purchase', coPurchased.anchorSupport, coPurchased.candidates),
        ],
        config.weights
      );
      for (const b of blended) {
        if (exclude.has(b.productId) || reasonById.has(b.productId)) continue;
        reasonById.set(b.productId, { text: 'Frequently bought together', code: 'frequently_bought_together' });
        orderedIds.push(b.productId);
      }
    }

    if (orderedIds.length === 0) return [];

    const rows = await this.products.findPublicViewList({ ids: orderedIds.slice(0, POOL_LIMIT), limit: POOL_LIMIT });
    const dtoById = new Map(rows.map((row) => [row.entity.id, toProductPublicDto(row)]));

    const items: CompleteTheSetItem[] = [];
    for (const id of orderedIds) {
      const product = dtoById.get(id);
      const reason = reasonById.get(id);
      if (!product || !reason) continue;
      items.push({ product, reason: reason.text, reasonCode: reason.code });
      if (items.length >= limit) break;
    }
    return items;
  }
}
