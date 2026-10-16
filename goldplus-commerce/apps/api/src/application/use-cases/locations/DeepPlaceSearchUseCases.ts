/**
 * Deep place search: the layer under our gazetteer (2026-10-16).
 *
 * Spending rules, all enforced here whatever the browser does:
 *  - nothing without a configured provider ("Not configured", never simulated);
 *  - queries under 4 characters are refused (Google's own advice: wait for 3–4);
 *  - at most SESSION_SUGGEST_CAP suggestion calls per customer session, then the last answer stands;
 *  - every paid call draws on one month-wide budget shared across replicas, and a missing counter means NO call;
 *  - no shared cache of suggestions: Google's terms let us keep place IDs, not their names or addresses. A repeat
 *    of the same query in the same session is skipped in the browser instead.
 * A pick is one locate() call that ends the session (Google bills the session's first requests, the rest free).
 */
import type { IMonthlyRequestBudget, IPlaceSearchProvider, PlaceSuggestion } from '../../ports/IPlaceSearch';

export const SESSION_SUGGEST_CAP = 6;

export type DeepSearchResult =
  | { status: 'ok'; places: PlaceSuggestion[] }
  | { status: 'not_configured' | 'budget_reached' | 'session_limit' | 'too_short' | 'unavailable'; places: [] };

export function normaliseDeepQuery(q: string): string {
  return q.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 100);
}

export class DeepPlaceSearchUseCase {
  private readonly sessions = new Map<string, { at: number; calls: number }>();

  constructor(
    private readonly provider: IPlaceSearchProvider,
    private readonly budget: IMonthlyRequestBudget,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async suggest(input: { query: string; sessionToken: string }): Promise<DeepSearchResult> {
    if (!this.provider.configured()) return { status: 'not_configured', places: [] };
    const key = normaliseDeepQuery(input.query);
    if (key.length < 4) return { status: 'too_short', places: [] };
    const t = this.now();

    const session = this.sessions.get(input.sessionToken) ?? { at: t, calls: 0 };
    if (session.calls >= SESSION_SUGGEST_CAP) return { status: 'session_limit', places: [] };
    if (!(await this.budget.tryConsume())) return { status: 'budget_reached', places: [] };
    session.calls += 1;
    this.sessions.set(input.sessionToken, session);
    this.prune(t);

    try {
      const places = await this.provider.suggest({ query: key, sessionToken: input.sessionToken });
      return { status: 'ok', places };
    } catch {
      return { status: 'unavailable', places: [] };
    }
  }

  async locate(input: { placeId: string; sessionToken: string }): Promise<
    { status: 'ok'; point: { lat: number; lng: number }; address: string | null } | { status: DeepSearchResult['status'] }
  > {
    if (!this.provider.configured()) return { status: 'not_configured' };
    if (!/^[A-Za-z0-9_-]{10,300}$/.test(input.placeId)) return { status: 'unavailable' };
    if (!(await this.budget.tryConsume())) return { status: 'budget_reached' };
    this.sessions.delete(input.sessionToken); // the session ends with this call
    try {
      const found = await this.provider.locate(input);
      if (!found || found.lat < -2.5 || found.lat > 5.5 || found.lng < 28 || found.lng > 36.5) return { status: 'unavailable' };
      return { status: 'ok', point: { lat: found.lat, lng: found.lng }, address: found.address };
    } catch {
      return { status: 'unavailable' };
    }
  }

  private prune(t: number) {
    if (this.sessions.size > 5000) {
      for (const [k, v] of this.sessions) if (t - v.at > 60 * 60 * 1000) this.sessions.delete(k);
    }
  }
}
