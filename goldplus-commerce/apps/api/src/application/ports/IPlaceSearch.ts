/**
 * The deep place layer (2026-10-16): buildings, malls, plots and estates our gazetteer does not hold.
 * Our own search answers first; this is consulted only when it cannot, under hard monthly budgets.
 */
export interface PlaceSuggestion {
  placeId: string;
  /** The building or place name, e.g. "Acacia Mall". Comes with the suggestion at no extra cost. */
  name: string;
  /** Where it is, e.g. "Kisementi, Kampala". */
  detail: string;
}

export interface PlacePoint {
  lat: number;
  lng: number;
}

export interface IPlaceSearchProvider {
  configured(): boolean;
  suggest(input: { query: string; sessionToken: string }): Promise<PlaceSuggestion[]>;
  /** The place's point. One request; ends the billing session begun by suggest(). */
  locate(input: { placeId: string; sessionToken: string }): Promise<PlacePoint | null>;
}

/**
 * Google bills suggestions and place lookups as separate SKUs, each with its own free monthly allowance, so each
 * has its own counter. Shared by every replica; fails CLOSED (no counter, no paid call).
 */
export type PlaceRequestKind = 'suggest' | 'details';
export interface PlaceBudgetUsage {
  month: string;
  suggest: { used: number; cap: number; today: number; todayAllowance: number };
  details: { used: number; cap: number; today: number; todayAllowance: number };
}
export interface IPlaceRequestBudget {
  tryConsume(kind: PlaceRequestKind): Promise<boolean>;
  usage(): Promise<PlaceBudgetUsage | null>;
}

/**
 * A place's point, kept for at most 30 days (Google Maps Platform terms allow latitude/longitude to be cached for
 * up to 30 consecutive days; place IDs may be kept indefinitely). A popular building costs one lookup a month.
 */
export interface IPlaceLocationCache {
  get(placeId: string): Promise<PlacePoint | null>;
  put(placeId: string, point: PlacePoint): Promise<void>;
}
