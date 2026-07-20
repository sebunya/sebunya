import { EvaluateCartPricingUseCase } from "../../application/use-cases/pricing/EvaluateCartPricingUseCase";
import {
  ProductFinderPriceEvidence,
  ProductFinderPricingReader,
} from "../../application/ports/product-finder/ProductFinderPricingReader";

export class PricingProductFinderReader implements ProductFinderPricingReader {
  constructor(private readonly pricing: EvaluateCartPricingUseCase) {}

  async simulateProducts(
    productIds: string[],
  ): Promise<ProductFinderPriceEvidence[]> {
    return Promise.all(
      [...new Set(productIds)].map(async (productId) => {
        const quote = await this.pricing.execute({
          items: [{ productId, quantity: 1 }],
          persist: false,
        });
        const line = quote.lines[0];
        return {
          productId,
          canonicalPriceUgx: line.canonicalUnitPriceUgx,
          finalPriceUgx: line.finalSubtotalUgx,
          appliedPromotionVersions: quote.appliedPromotionVersions,
        };
      }),
    );
  }
}
