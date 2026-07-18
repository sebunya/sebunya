import { FulfilmentTaskSnapshot } from '../../../domain/fulfilment/FulfilmentTask';
import { IFulfilmentRepository } from '../../ports/IFulfilmentRepository';

/** Admin badge + single-task lookups for the fulfilment surface. */
export class GetFulfilmentOverviewUseCase {
  constructor(private readonly repo: IFulfilmentRepository) {}

  /**
   * Admin badges: unacknowledged NEW tasks ("New Orders") and active tasks past
   * their SLA deadline ("Overdue").
   */
  async badge(now: Date = new Date()): Promise<{ newOrders: number; overdue: number }> {
    const [newOrders, overdue] = await Promise.all([this.repo.countNew(), this.repo.countOverdue(now)]);
    return { newOrders, overdue };
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
