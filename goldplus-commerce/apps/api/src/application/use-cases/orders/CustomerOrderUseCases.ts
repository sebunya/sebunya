import { ICustomerOrderRepository } from '../../ports/ICustomerOrderRepository';
import { OrderDetailDto, OrderSummaryDto } from '@goldplus/shared';

export class ListMyOrdersUseCase {
  constructor(private readonly orders: ICustomerOrderRepository) {}
  execute(userId: string): Promise<OrderSummaryDto[]> {
    return this.orders.listForUser(userId);
  }
}

export type GetMyOrderResult =
  | { ok: true; order: OrderDetailDto }
  | { ok: false; code: 'NOT_FOUND' };

export class GetMyOrderUseCase {
  constructor(private readonly orders: ICustomerOrderRepository) {}

  async execute(orderId: string, userId: string): Promise<GetMyOrderResult> {
    const trimmed = (orderId ?? '').trim();
    if (!trimmed) return { ok: false, code: 'NOT_FOUND' };
    const order = await this.orders.findByIdForUser(trimmed, userId);
    return order ? { ok: true, order } : { ok: false, code: 'NOT_FOUND' };
  }
}
