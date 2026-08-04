/**
 * Location search ports (location-module brief PART F).
 *
 * The repository exposes the raw match layers; LocationSearchService owns the
 * pipeline order, dedup, ranking and the 8-result cap so the whole contract is
 * unit-testable against an in-memory fake.
 */

export type LocationMatchType =
  | 'alias_exact'
  | 'area_exact'
  | 'group_exact'
  | 'prefix'
  | 'trigram'
  | 'landmark'
  | 'pickup_point';

export interface AreaSearchHit {
  kind: 'area';
  areaSlug: string;
  displayLabel: string;
  areaName: string;
  currentDistrict: string;
  deliveryZoneCode: string | null;
  postcode: string | null;
  isMetro: boolean;
  matchType: LocationMatchType;
  /** trigram similarity 0..1 for trigram hits; 1 for exact layers */
  score: number;
  /** set when the hit came through a group — the label shown is the group name */
  groupId?: string;
  groupName?: string;
  /** set when the hit came via a landmark — surfaced for provenance */
  viaLandmark?: string;
}

export interface PickupPointSearchHit {
  kind: 'pickup_point';
  pickupPointId: string;
  name: string;
  operator: string;
  areaSlug: string | null;
  district: string | null;
  matchType: 'pickup_point';
  score: number;
}

export type LocationSearchHit = AreaSearchHit | PickupPointSearchHit;

export interface ILocationSearchRepository {
  /** Exact match on normalised (folded) alias. Only selectable areas. */
  aliasExact(folded: string): Promise<AreaSearchHit[]>;
  /** Exact match on folded area name. Only selectable areas. */
  areaExact(folded: string): Promise<AreaSearchHit[]>;
  /** Exact match on folded group name — returns ONE hit per group (anchor area = first member). */
  groupExact(folded: string): Promise<AreaSearchHit[]>;
  /** Prefix on folded area/alias/group/landmark names. */
  prefix(folded: string, limit: number): Promise<AreaSearchHit[]>;
  /** Trigram similarity over ug_area.search_text + alias, above threshold. */
  trigram(folded: string, threshold: number, limit: number): Promise<AreaSearchHit[]>;
  /** Landmark name match returning the parent area. */
  landmark(folded: string, limit: number): Promise<AreaSearchHit[]>;
  /** Pickup point name match — a distinct result type. */
  pickupPoints(folded: string, limit: number): Promise<PickupPointSearchHit[]>;
}

export interface CustomerLocationContext {
  /** area slugs on the customer's saved addresses — always ranked first */
  savedAreaSlugs: ReadonlySet<string>;
  /** area slugs the customer has ordered to before */
  orderedAreaSlugs: ReadonlySet<string>;
}

export interface ILocationOrderDensityReader {
  /** Historical order count per area slug (nightly-refreshed at volume; live query while volumes are tiny). */
  densityByArea(): Promise<ReadonlyMap<string, number>>;
}

export interface ISearchMissRecorder {
  record(input: {
    rawQuery: string;
    normalisedQuery: string;
    sessionId?: string | null;
    customerId?: string | null;
    resultCount: number;
    deviceHint?: string | null;
    resolvedAreaSlug?: string | null;
    resolvedVia?: string | null;
  }): Promise<void>;
}
