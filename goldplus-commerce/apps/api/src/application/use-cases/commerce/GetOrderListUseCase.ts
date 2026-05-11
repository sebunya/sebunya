import { Order } from '../../../domain/commerce/Order';

export interface IOrderReadOnlyRepository {
  findAll(): Promise<Order[]>;
}

export class GetOrderListUseCase {
  constructor(
    private readonly orderRepo: IOrderReadOnlyRepository
  ) {}

  public async execute(): Promise<Order[]> {
    return await this.orderRepo.findAll();
  }
}
