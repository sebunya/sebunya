import { Order, OrderItem, BuyerType } from '../../../domain/commerce/Order';

export interface IOrderRepository {
  save(order: Order): Promise<void>;
  findById(id: string): Promise<Order | null>;
}

export interface CheckoutDto {
  customerDetails: {
    name: string;
    email?: string;
    phone: string;
    deliveryArea: string;
    deliveryAddress: string;
  };
  buyerType: BuyerType;
  items: Array<{
    productId: string;
    sku: string;
    name: string;
    price: number;
    quantity: number;
  }>;
}

export class CheckoutUseCase {
  constructor(
    private readonly orderRepo: IOrderRepository
  ) {}

  public async execute(dto: CheckoutDto): Promise<Order> {
    if (!dto.items || dto.items.length === 0) {
      throw new Error('Cannot process empty checkout');
    }

    const orderId = crypto.randomUUID();
    
    const orderItems: OrderItem[] = dto.items.map(i => ({
      productId: i.productId,
      sku: i.sku,
      name: i.name,
      price: i.price,
      quantity: i.quantity
    }));

    const order = Order.create(
      orderId,
      dto.customerDetails,
      dto.buyerType,
      orderItems,
      0 // Phase 1: Free delivery / manually calculated later
    );

    await this.orderRepo.save(order);

    return order;
  }
}
