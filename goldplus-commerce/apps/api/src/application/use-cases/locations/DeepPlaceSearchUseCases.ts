/**
 * Deep place search: the layer under our gazetteer (2026-10-16).
 *
 * Spending rules, all enforced here whatever the browser does:
 *  - nothing without a configured provider ("Not configured", never simulated);
 *  - queries under 4 characters are refused (Google's own advice: wait for 3–4);
 *  - at most SESSION_SUGGEST_CAP suggestion calls per customer session;
 *  - suggestions and lookups each draw on their own month-wide budget, paced through the month and shared across
 *    replicas; a missing counter means NO call;
 *  - a place's point is kept 30 days (the terms' maximum), so a building already looked up costs nothing again;
 *  - no cache of suggestion names or addresses: the terms allow keeping place IDs and points, not other content.
 */
import type { IPlaceLocationCache, IPlaceRequestBudget, IPlaceSearchProvider, PlaceBudgetUsage, PlaceSuggestion } from '../../ports/IPlaceSearch';

export const SESSION_SUGGEST_CAP = 6;
export const PLACE_ID_PATTERN = /^[A-Za-z0-9_-]{10,300}$/;

export type DeepSearchStatus = 'ok' | 'not_configured' | 'budget_reached' | 'session_limit' | 'too_short' | 'unavailable';
export type DeepSearchResult = { status: 'ok'; places: PlaceSuggestion[] } | { status: Exclude<DeepSearchStatus, 'ok'>; places: [] };
export type DeepLocateResult =
  | { status: 'ok'; point: { lat: number; lng: number }; fromCache: boolean }
  | { status: Exclude<DeepSearchStatus, 'ok'> };

export function normaliseDeepQuery(q: string): string {
  return q.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 100);
}

const inUganda = (p: { lat: number; lng: number }) => p.lat >= -2.5 && p.lat <= 5.5 && p.lng >= 28 && p.lng <= 36.5;

export class DeepPlaceSearchUseCase {
  private readonly sessions = new Map<string, { at: number; calls: number }>();

  constructor(
    private readonly provider: IPlaceSearchProvider,
    private readonly budget: IPlaceRequestBudget,
    private readonly locations: IPlaceLocationCache,
    private readonly now: () => number = () => Date.now(),
  ) {}

  configured(): boolean {
    return this.provider.configured();
  }

  async suggest(input: { query: string; sessionToken: string }): Promise<DeepSearchResult> {
    if (!this.provider.configured()) return { status: 'not_configured', places: [] };
    const key = normaliseDeepQuery(input.query);
    if (key.length < 4) return { status: 'too_short', places: [] };
    const t = this.now();
    const session = this.sessions.get(input.sessionToken) ?? { at: t, calls: 0 };
    if (session.calls >= SESSION_SUGGEST_CAP) return { status: 'session_limit', places: [] };
    if (!(await this.budget.tryConsume('suggest'))) return { status: 'budget_reached', places: [] };
    session.calls += 1;
    this.sessions.set(input.sessionToken, session);
    this.prune(t);
    try {
      return { status: 'ok', places: await this.provider.suggest({ query: key, sessionToken: input.sessionToken }) };
    } catch {
      return { status: 'unavailable', places: [] };
    }
  }

  async locate(input: { placeId: string; sessionToken: string }): Promise<DeepLocateResult> {
    if (!this.provider.configured()) return { status: 'not_configured' };
    if (!PLACE_ID_PATTERN.test(input.placeId)) return { status: 'unavailable' };
    this.sessions.delete(input.sessionToken); // the customer chose: this search is over
    const cached = await this.locations.get(input.placeId).catch(() => null);
    if (cached && inUganda(cached)) return { status: 'ok', point: cached, fromCache: true };
    if (!(await this.budget.tryConsume('details'))) return { status: 'budget_reached' };
    try {
      const found = await this.provider.locate(input);
      if (!found || !inUganda(found)) return { status: 'unavailable' };
      await this.locations.put(input.placeId, found).catch(() => undefined);
      return { status: 'ok', point: { lat: found.lat, lng: found.lng }, fromCache: false };
    } catch {
      return { status: 'unavailable' };
    }
  }

  usage(): Promise<PlaceBudgetUsage | null> {
    return this.budget.usage();
  }

  private prune(t: number) {
    if (this.sessions.size > 5000) {
      for (const [k, v] of this.sessions) if (t - v.at > 60 * 60 * 1000) this.sessions.delete(k);
    }
  }
}
