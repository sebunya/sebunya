import type { PastDelivery } from '../../domain/delivery/PlaceMemory';

/** Past delivery attempts to the same customer (by phone) in the same area as an order, excluding that order. */
export interface IPlaceMemoryReader {
  pastDeliveriesLike(orderId: string): Promise<PastDelivery[] | null>;
}
