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

/**
 * Why the provider refused (2026-10-20). Google answers a refused key with HTTP 403 and an ErrorInfo reason such as
 * BILLING_DISABLED or API_KEY_IP_ADDRESS_BLOCKED; until then every refusal was swallowed as "unavailable" and the
 * cause could only be found by calling Google from the server by hand.
 */
export class PlaceProviderError extends Error {
  constructor(
    readonly httpStatus: number | null,
    /** Google's ErrorInfo reason, else its status (PERMISSION_DENIED), else TIMEOUT / NETWORK / HTTP_<n>. */
    readonly reason: string,
    /** Google's own sentence, trimmed. Never carries the key. */
    readonly detail: string,
  ) {
    super(`PLACES_${httpStatus ?? 'NO_RESPONSE'}_${reason}`);
    this.name = 'PlaceProviderError';
  }
}

export interface PlaceProviderFault {
  at: string;
  kind: PlaceRequestKind;
  httpStatus: number | null;
  reason: string;
  detail: string;
}
export interface PlaceProviderHealth {
  lastOkAt: string | null;
  lastFault: PlaceProviderFault | null;
  /** While set, no request goes to the provider: a refused key is refused for every customer alike. */
  pausedUntil: string | null;
}
/** Shared by both replicas, so one refusal pauses both and the admin page reads the same answer from either. */
export interface IPlaceProviderHealthStore {
  pausedUntil(): Promise<number | null>;
  recordOk(at: Date): Promise<void>;
  recordFault(fault: PlaceProviderFault, pauseUntilMs: number | null): Promise<void>;
  read(): Promise<PlaceProviderHealth | null>;
}
