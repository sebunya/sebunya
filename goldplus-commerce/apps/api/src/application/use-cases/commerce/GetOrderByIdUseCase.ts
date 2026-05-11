import { Order } from '../../../domain/commerce/Order';
import { IOrderRepository } from './CheckoutUseCase';

export class GetOrderByIdUseCase {
  constructor(
    private readonly orderRepo: IOrderRepository
  ) {}

  public async execute(orderId: string): Promise<Order | null> {
    if (!orderId) {
      throw new Error('Order ID is required');
    }
    
    return await this.orderRepo.findById(orderId);
  }
}
