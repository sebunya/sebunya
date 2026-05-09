export type OrderStatus = 'pending' | 'processing' | 'paid' | 'failed' | 'cancelled';
export type PaymentStatus = 'unpaid' | 'pending' | 'paid' | 'failed';

export interface OrderItem {
  productId: string;
  name: string;
  price: number;
  quantity: number;
}

export class Order {
  constructor(
    public readonly id: string,
    public readonly customerId: string,
    public readonly items: OrderItem[],
    public readonly total: number,
    public readonly status: OrderStatus,
    public readonly paymentStatus: PaymentStatus,
    public readonly createdAt: Date,
    public readonly customerDetails: {
      name: string;
      email: string;
      phone: string;
      address?: string;
    }
  ) {}

  public static create(
    id: string,
    customerId: string,
    items: OrderItem[],
    customerDetails: { name: string; email: string; phone: string; address?: string }
  ): Order {
    const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
    return new Order(
      id,
      customerId,
      items,
      total,
      'pending',
      'unpaid',
      new Date(),
      customerDetails
    );
  }

  public markAsPaid(): Order {
    return new Order(
      this.id,
      this.customerId,
      this.items,
      this.total,
      'paid',
      'paid',
      this.createdAt,
      this.customerDetails
    );
  }

  public markAsFailed(): Order {
    return new Order(
      this.id,
      this.customerId,
      this.items,
      this.total,
      'failed',
      'failed',
      this.createdAt,
      this.customerDetails
    );
  }
}
