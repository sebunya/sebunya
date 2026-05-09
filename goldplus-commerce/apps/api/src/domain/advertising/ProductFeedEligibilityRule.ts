import { ProductEntity } from '../products/ProductEntity';

export class ProductFeedEligibilityRule {
  public evaluate(product: ProductEntity): { isEligible: boolean; reason?: string } {
    if (!(product as any).isFeedEligible) {
      return { isEligible: false, reason: 'Product is explicitly marked as not feed eligible.' };
    }

    if (!product.canBeAdvertised()) {
      return { isEligible: false, reason: 'Product fails core advertising requirements (e.g., missing price, stock < 5, or missing image).' };
    }

    if (product.categoryId === 'other-category-id-placeholder') { // Replace with actual check
      return { isEligible: false, reason: 'Products in the "Other" category are restricted from advertising.' };
    }

    return { isEligible: true };
  }
}
