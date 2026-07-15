import { DeliveryZone, DeliveryZoneInput } from '../../domain/commerce/DeliveryFee';

export interface IDeliveryZoneRepository {
  /** Lookup by canonical (normalized upper-case) district name. */
  findByDistrict(district: string): Promise<DeliveryZone | null>;
  list(): Promise<DeliveryZone[]>;
  /** Insert or update the zone for a district; returns the persisted zone. */
  upsert(input: DeliveryZoneInput): Promise<DeliveryZone>;
  delete(id: string): Promise<boolean>;
}
