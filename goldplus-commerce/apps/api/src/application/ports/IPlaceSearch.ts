/**
 * The deep place layer (2026-10-16): buildings, malls, plots and estates our gazetteer does not hold.
 * Our own search answers first; this is consulted only when it cannot, under a hard monthly budget.
 */
export interface PlaceSuggestion {
  placeId: string;
  /** The building or place name, e.g. "Acacia Mall". Comes with the suggestion at no extra cost. */
  name: string;
  /** Where it is, e.g. "Kisementi, Kampala". */
  detail: string;
}

export interface IPlaceSearchProvider {
  configured(): boolean;
  suggest(input: { query: string; sessionToken: string }): Promise<PlaceSuggestion[]>;
  /** The place's point. One request; ends the billing session begun by suggest(). */
  locate(input: { placeId: string; sessionToken: string }): Promise<{ lat: number; lng: number; address: string | null } | null>;
}

/** A month-wide request budget shared by every replica. Fails CLOSED: no counter, no paid call. */
export interface IMonthlyRequestBudget {
  tryConsume(): Promise<boolean>;
  used(): Promise<number | null>;
}
