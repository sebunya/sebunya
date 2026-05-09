export class InventoryAudit {
  constructor(
    public readonly id: string,
    public readonly productId: string,
    public readonly dealerId: string | 'admin',
    public readonly changeAmount: number,
    public readonly previousQuantity: number,
    public readonly newQuantity: number,
    public readonly reason: string,
    public readonly timestamp: Date
  ) {}

  public static log(
    id: string,
    productId: string,
    dealerId: string | 'admin',
    changeAmount: number,
    previousQuantity: number,
    reason: string
  ): InventoryAudit {
    return new InventoryAudit(
      id,
      productId,
      dealerId,
      changeAmount,
      previousQuantity,
      previousQuantity + changeAmount,
      reason,
      new Date()
    );
  }
}
