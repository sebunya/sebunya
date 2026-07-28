import { GetProductRecommendationsUseCase, ShelfExplanation } from '../GetProductRecommendationsUseCase';
import { GetCompleteTheSetUseCase } from '../GetCompleteTheSetUseCase';
import { RecommendationSurface } from '../../../../domain/recommendation/RecommendationTypes';

export type PreviewResult =
  | { ok: true; surface: RecommendationSurface; explanation: ShelfExplanation }
  | { ok: true; surface: 'product_page_complete_the_set'; completeTheSet: Array<{ productId: string; name: string; reason: string; reasonCode: string }> }
  | { ok: false; code: string; message: string };

const EXPLAINABLE_PRODUCT_SURFACES = new Set<RecommendationSurface>([
  'product_page_bought_together',
  'product_page_also_viewed',
]);

/**
 * The admin "why" simulator. For a given surface + anchor product it returns
 * exactly what the live shelf would show and why — ranks, score breakdowns,
 * reason codes, which merchandising rule affected each item, how many were
 * excluded, and whether the shelf will be hidden.
 */
export class PreviewRecommendationsUseCase {
  constructor(
    private readonly productRecs: GetProductRecommendationsUseCase,
    private readonly completeTheSet: GetCompleteTheSetUseCase
  ) {}

  async execute(input: { surface: RecommendationSurface; productId: string; limit?: number }): Promise<PreviewResult> {
    if (!input.productId) return { ok: false, code: 'MISSING_PRODUCT', message: 'A product id is required to preview a product-page shelf.' };
    const limit = Math.max(1, Math.min(input.limit ?? 8, 20));

    if (input.surface === 'product_page_complete_the_set') {
      const items = await this.completeTheSet.execute({ productId: input.productId, limit });
      return {
        ok: true,
        surface: 'product_page_complete_the_set',
        completeTheSet: items.map((i) => ({ productId: i.product.id, name: i.product.name, reason: i.reason, reasonCode: i.reasonCode })),
      };
    }

    if (!EXPLAINABLE_PRODUCT_SURFACES.has(input.surface)) {
      return { ok: false, code: 'UNSUPPORTED_SURFACE', message: 'Preview currently supports product-page shelves.' };
    }

    const explanation = await this.productRecs.explainShelf(input.surface, input.productId, limit);
    return { ok: true, surface: input.surface, explanation };
  }
}
