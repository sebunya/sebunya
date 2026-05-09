import { Order, OrderItem } from '../../../domain/commerce/Order';
import { Cart } from '../../../domain/commerce/Cart';

import { ICartRepository } from './AddToCartUseCase';

export interface IOrderRepository {
  save(order: Order): Promise<void>;
  findById(id: string): Promise<Order | null>;
}

export interface CheckoutDto {
  cartId: string;
  customerId: string;
  customerDetails: {
    name: string;
    email: string;
    phone: string;
    address?: string;
  };
}

export class CheckoutUseCase {
  constructor(
    private readonly cartRepo: ICartRepository,
    private readonly orderRepo: IOrderRepository
  ) {}

  public async execute(dto: CheckoutDto): Promise<Order> {
    const cart = await this.cartRepo.findById(dto.cartId);
    if (!cart || cart.items.length === 0) {
      throw new Error('Cart is empty');
    }

    const orderId = `ord_${Math.random().toString(36).substring(2, 11)}`;
    const orderItems: OrderItem[] = cart.items.map(i => ({
      productId: i.productId,
      name: i.name,
      price: i.price,
      quantity: i.quantity
    }));

    const order = Order.create(
      orderId,
      dto.customerId,
      orderItems,
      dto.customerDetails
    );

    await this.orderRepo.save(order);
    
    // Clear cart after order creation
    await this.cartRepo.save(new Cart(dto.cartId, []));


    return order;
  }
}
