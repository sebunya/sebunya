export interface ProductFinderPriceEvidence {
  productId: string;
  canonicalPriceUgx: number;
  finalPriceUgx: number;
  appliedPromotionVersions: Array<{
    definitionId: string;
    versionId: string;
    versionNumber: number;
  }>;
}

export interface ProductFinderPricingReader {
  simulateProducts(productIds: string[]): Promise<ProductFinderPriceEvidence[]>;
}
