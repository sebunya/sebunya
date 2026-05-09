export class ProductEntity {
  constructor(
    public readonly id: string,
    public readonly sku: string,
    public readonly modelNumber: string,
    public readonly name: string,
    public readonly categoryId: string,
    public readonly approvalStatus: 'draft' | 'approved' | 'rejected',
    public readonly isPreOrderEnabled: boolean,
    public readonly hasRetailPrice: boolean,
    public readonly hasImage: boolean,
    public readonly stockQuantity: number,
    public readonly specifications: Record<string, string | number> = {}
  ) {}

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
