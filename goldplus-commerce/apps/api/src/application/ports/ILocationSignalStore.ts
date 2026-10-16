import type { AreaDemandRow, LocationSignalInput } from '../../domain/locations/LocationSignals';

export interface DeliverToPlace {
  areaSlug: string | null;
  district: string;
  label: string;
  setAt: Date;
}

export interface ILocationSignalStore {
  /** The visitor's own "Deliver to", else the newest one set on any profile of the same signed-in customer. */
  deliverToForProfile(profileId: string): Promise<DeliverToPlace | null>;
  deliverToForCustomer(customerId: string): Promise<DeliverToPlace | null>;
  setDeliverTo(profileId: string, place: { areaSlug: string | null; district: string; label: string }): Promise<void>;
  /** The customer linked to a profile, and whether they have granted personalisation. */
  consentFor(profileId: string | null, customerId: string | null): Promise<{ customerId: string | null; personalisation: boolean }>;
  /** Straight-line km from a point to an area's point, when the area has one. The point is not stored. */
  kmToAreaPoint(areaSlug: string, point: { lat: number; lng: number }): Promise<number | null>;
  insert(row: {
    kind: LocationSignalInput['kind'];
    surface: LocationSignalInput['surface'];
    profileId: string | null;
    customerId: string | null;
    areaSlug: string | null;
    district: string | null;
    feeUgx: number | null;
    quoteKind: string | null;
    offerRank: number | null;
    offerKm: number | null;
    personalisation: boolean;
    pin: { lat: number; lng: number; accuracyM: number | null } | null;
  }): Promise<void>;
  /** Accurate "Locate me" pins of customers who CHOSE each area (for suggested area points). */
  chosenPins(sinceDays: number): Promise<Map<string, Array<{ lat: number; lng: number; accuracyM: number | null }>>>;
  demandByArea(sinceDays: number): Promise<AreaDemandRow[]>;
  areasConsidered(customerId: string, sinceDays: number): Promise<Array<{ label: string; times: number }>>;
  purgeOlderThan(days: number): Promise<number>;
}
