export type StockStatus = 'in_stock' | 'low_stock' | 'out_of_stock' | 'pre_order';

export class ProductEntity {
  constructor(
    public readonly id: string,
    public readonly sku: string,
    public readonly modelNumber: string,
    public readonly name: string,
    public readonly slug: string,
    public readonly category: string,
    public readonly subcategory: string | undefined,
    public readonly shortDescription: string,
    public readonly longDescription: string,
    public readonly priceUgx: number,
    public readonly compareAtPriceUgx: number | undefined,
    public readonly stockStatus: StockStatus,
    public readonly imageUrl: string | undefined,
    public readonly features: string[],
    public readonly warrantyPeriod: string,
    public readonly verificationEligible: boolean,
    public readonly active: boolean,
    public readonly approvalStatus: 'draft' | 'approved' | 'rejected',
    public readonly isPreOrderEnabled: boolean,
    public readonly hasRetailPrice: boolean,
    public readonly hasImage: boolean,
    public readonly stockQuantity: number,
    public readonly specifications: Record<string, string | number> = {},
    /**
     * Units already committed to orders. `stock_quantity - reserved_quantity`
     * is what a customer can actually buy; the raw stock figure is on-hand,
     * which is why the storefront could offer units that were already sold.
     */
    public readonly reservedQuantity: number = 0
  ) {}

  /** What is genuinely available to a new order. Never negative. */
  public availableQuantity(): number {
    return Math.max(0, this.stockQuantity - this.reservedQuantity);
  }

  public canBePublished(): boolean {
    if (this.approvalStatus !== 'approved') return false;
    if (!this.hasRetailPrice) return false;
    if (!this.hasImage) return false;
    
    // Strict governance: Cannot publish if model number is missing
    if (this.modelNumber === 'Missing. Requires admin review.') return false;
    
    // If not pre-order, must have stock
    if (!this.isPreOrderEnabled && this.stockQuantity <= 0) return false;

    return true;
  }

  public canBeAdvertised(): boolean {
    return this.canBePublished() && this.stockQuantity > 5;
  }
}
