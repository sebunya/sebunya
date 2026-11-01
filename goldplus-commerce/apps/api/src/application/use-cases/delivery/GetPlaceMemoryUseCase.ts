import type { IPlaceMemoryReader } from '../../ports/IPlaceMemoryReader';
import { summarisePlaceMemory, type PlaceMemory } from '../../../domain/delivery/PlaceMemory';

/** What earlier deliveries taught us about the place an order is going to (read-only). */
export class GetPlaceMemoryUseCase {
  constructor(private readonly reader: IPlaceMemoryReader) {}

  async execute(orderId: string): Promise<PlaceMemory | null> {
    const past = await this.reader.pastDeliveriesLike(orderId);
    return past ? summarisePlaceMemory(past) : null;
  }
}
