import { OrderDetailDto, OrderSummaryDto } from '@goldplus/shared';

export interface ICustomerOrderRepository {
  listForUser(userId: string): Promise<OrderSummaryDto[]>;
  findByIdForUser(orderId: string, userId: string): Promise<OrderDetailDto | null>;
}
