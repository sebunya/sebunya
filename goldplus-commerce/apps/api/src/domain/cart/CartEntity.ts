export class CartEntity {
  constructor(public id: string, public items: any[]) {}
  public calculateTotal(): number {
    return this.items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  }
}
