export interface CartItem {
  productId: string;
  name: string;
  price: number;
  quantity: number;
}

export class Cart {
  constructor(
    public readonly id: string,
    public readonly items: CartItem[] = []
  ) {}

  public getTotal(): number {
    return this.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  }

  public addItem(item: CartItem): Cart {
    const existing = this.items.find(i => i.productId === item.productId);
    if (existing) {
      return new Cart(
        this.id,
        this.items.map(i => i.productId === item.productId 
          ? { ...i, quantity: i.quantity + item.quantity } 
          : i
        )
      );
    }
    return new Cart(this.id, [...this.items, item]);
  }

  public updateQuantity(productId: string, quantity: number): Cart {
    if (quantity <= 0) return this.removeItem(productId);
    return new Cart(
      this.id,
      this.items.map(i => i.productId === productId ? { ...i, quantity } : i)
    );
  }

  public removeItem(productId: string): Cart {
    return new Cart(this.id, this.items.filter(i => i.productId !== productId));
  }
}
