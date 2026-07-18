import { FulfilmentTaskSnapshot } from '../../../domain/fulfilment/FulfilmentTask';
import { IFulfilmentRepository } from '../../ports/IFulfilmentRepository';

/** Admin badge + single-task lookups for the fulfilment surface. */
export class GetFulfilmentOverviewUseCase {
  constructor(private readonly repo: IFulfilmentRepository) {}

  /** Number of unacknowledged NEW tasks — the admin "New Orders" badge. */
  async badge(): Promise<{ newOrders: number }> {
    const newOrders = await this.repo.countNew();
    return { newOrders };
  }

  async byId(id: string): Promise<FulfilmentTaskSnapshot | null> {
    if (!id) return null;
    return this.repo.findById(id);
  }

  async byOrderId(orderId: string): Promise<FulfilmentTaskSnapshot | null> {
    if (!orderId) return null;
    return this.repo.findByOrderId(orderId);
  }
}
