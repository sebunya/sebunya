export class ProductComparisonService {
  compare(productIds: string[]) {
    if (productIds.length < 2) throw new Error("Need at least 2 products to compare");
    return [];
  }
}
