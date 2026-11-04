import type { OrderTrackingDto } from '@goldplus/shared';

/**
 * Baymard A6 (docs/ux/BAYMARD.md): the tracking ladder with a date on every step it has reached, and who has the
 * parcel once it is dispatched. Facts only, from the order's own event log and the fulfilment records; the ladder
 * stays "fulfilment progress, not a live map". Nothing here is a promise: an estimated arrival is shown as one.
 */
export interface IOrderTrackingRepository {
  trackingFacts(orderId: string): Promise<OrderTrackingDto | null>;
}

export class OrderTrackingUseCase {
  constructor(private readonly repo: IOrderTrackingRepository) {}

  async execute(orderId: string): Promise<OrderTrackingDto | null> {
    if (!orderId) return null;
    return await this.repo.trackingFacts(orderId).catch(() => null);
  }
}
