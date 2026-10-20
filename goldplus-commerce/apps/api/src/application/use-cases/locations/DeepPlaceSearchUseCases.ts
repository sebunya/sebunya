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
 *  - no cache of suggestion names or addresses: the terms allow keeping place IDs and points, not other content;
 *  - a refused key (billing, API off, IP restriction) pauses every call for PAUSE_REFUSED_MS, shared across replicas,
 *    and the reason is kept for the admin Locations page (2026-10-20: a billing hold had been invisible).
 */
import {
  PlaceProviderError,
  type IPlaceLocationCache,
  type IPlaceProviderHealthStore,
  type IPlaceRequestBudget,
  type IPlaceSearchProvider,
  type PlaceBudgetUsage,
  type PlaceProviderFault,
  type PlaceProviderHealth,
  type PlaceRequestKind,
  type PlaceSuggestion,
} from '../../ports/IPlaceSearch';

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

/** Refusals that will refuse the next customer too: wait before asking again. */
export const PAUSE_REFUSED_MS = 10 * 60 * 1000;
/** Google's per-minute rate limit: a short wait. */
export const PAUSE_RATE_LIMITED_MS = 60 * 1000;
export const PROBE_GAP_MS = 20 * 1000;
const REFUSED_REASONS = new Set(['API_KEY_INVALID', 'BILLING_DISABLED', 'SERVICE_DISABLED', 'API_KEY_IP_ADDRESS_BLOCKED', 'API_KEY_SERVICE_BLOCKED', 'PERMISSION_DENIED']);

export function pauseFor(err: PlaceProviderError): number {
  if (err.httpStatus === 429 || err.reason === 'RESOURCE_EXHAUSTED' || err.reason === 'RATE_LIMIT_EXCEEDED') return PAUSE_RATE_LIMITED_MS;
  if (err.httpStatus === 401 || err.httpStatus === 403 || REFUSED_REASONS.has(err.reason)) return PAUSE_REFUSED_MS;
  return 0; // a timeout or a 5xx is one request's bad luck
}

/** One process only; Registry passes the Redis store so both replicas share it. */
export class InMemoryPlaceProviderHealth implements IPlaceProviderHealthStore {
  private state: PlaceProviderHealth = { lastOkAt: null, lastFault: null, pausedUntil: null };
  async pausedUntil() { return this.state.pausedUntil ? Date.parse(this.state.pausedUntil) : null; }
  async recordOk(at: Date) { this.state = { ...this.state, lastOkAt: at.toISOString(), pausedUntil: null }; }
  async recordFault(fault: PlaceProviderFault, until: number | null) {
    this.state = { ...this.state, lastFault: fault, pausedUntil: until ? new Date(until).toISOString() : this.state.pausedUntil };
  }
  async read() { return this.state; }
}

const inUganda = (p: { lat: number; lng: number }) => p.lat >= -2.5 && p.lat <= 5.5 && p.lng >= 28 && p.lng <= 36.5;

export class DeepPlaceSearchUseCase {
  private readonly sessions = new Map<string, { at: number; calls: number }>();

  constructor(
    private readonly provider: IPlaceSearchProvider,
    private readonly budget: IPlaceRequestBudget,
    private readonly locations: IPlaceLocationCache,
    private readonly now: () => number = () => Date.now(),
    private readonly health: IPlaceProviderHealthStore = new InMemoryPlaceProviderHealth(),
    private readonly onFault: (fault: PlaceProviderFault, pausedMs: number) => void = () => undefined,
  ) {}

  configured(): boolean {
    return this.provider.configured();
  }

  /** Configured and not paused: whether the checkout picker should offer the building search at all. */
  async available(): Promise<boolean> {
    return this.provider.configured() && !(await this.paused());
  }

  healthReport(): Promise<PlaceProviderHealth | null> {
    return this.health.read().catch(() => null);
  }

  private async paused(): Promise<boolean> {
    const until = await this.health.pausedUntil().catch(() => null);
    return until !== null && until > this.now();
  }

  /** Runs one provider call, keeping its outcome; any failure comes back as null. */
  private async call<T>(kind: PlaceRequestKind, run: () => Promise<T>): Promise<T | null> {
    try {
      const out = await run();
      await this.health.recordOk(new Date(this.now())).catch(() => undefined);
      return out;
    } catch (e) {
      await this.recordFailure(kind, e);
      return null;
    }
  }

  private async recordFailure(kind: PlaceRequestKind, e: unknown): Promise<PlaceProviderFault> {
    const err = e instanceof PlaceProviderError ? e : new PlaceProviderError(null, 'UNEXPECTED', String((e as Error)?.message ?? e).slice(0, 200));
    const pause = pauseFor(err);
    const fault: PlaceProviderFault = { at: new Date(this.now()).toISOString(), kind, httpStatus: err.httpStatus, reason: err.reason, detail: err.detail };
    await this.health.recordFault(fault, pause ? this.now() + pause : null).catch(() => undefined);
    this.onFault(fault, pause);
    return fault;
  }

  private lastProbeAt = 0;

  /**
   * Staff's "Check Google now" (Admin > Locations): one real suggestion request, ignoring any pause, so a fixed
   * billing hold or key shows up at once instead of after the pause and the next customer. Spends one suggestion
   * from the month's budget; at most one probe per PROBE_GAP_MS per replica.
   */
  async probe(): Promise<{ status: 'ok' | 'not_configured' | 'budget_reached' | 'too_soon' | 'refused'; suggestions?: number; fault?: PlaceProviderFault }> {
    if (!this.provider.configured()) return { status: 'not_configured' };
    const t = this.now();
    if (t - this.lastProbeAt < PROBE_GAP_MS) return { status: 'too_soon' };
    this.lastProbeAt = t;
    if (!(await this.budget.tryConsume('suggest'))) return { status: 'budget_reached' };
    try {
      const places = await this.provider.suggest({ query: 'acacia mall', sessionToken: `probe-${t.toString(36)}-staff` });
      await this.health.recordOk(new Date(this.now())).catch(() => undefined);
      return { status: 'ok', suggestions: places.length };
    } catch (e) {
      return { status: 'refused', fault: await this.recordFailure('suggest', e) };
    }
  }

  async suggest(input: { query: string; sessionToken: string }): Promise<DeepSearchResult> {
    if (!this.provider.configured()) return { status: 'not_configured', places: [] };
    const key = normaliseDeepQuery(input.query);
    if (key.length < 4) return { status: 'too_short', places: [] };
    const t = this.now();
    const session = this.sessions.get(input.sessionToken) ?? { at: t, calls: 0 };
    if (session.calls >= SESSION_SUGGEST_CAP) return { status: 'session_limit', places: [] };
    if (await this.paused()) return { status: 'unavailable', places: [] };
    if (!(await this.budget.tryConsume('suggest'))) return { status: 'budget_reached', places: [] };
    session.calls += 1;
    this.sessions.set(input.sessionToken, session);
    this.prune(t);
    const places = await this.call('suggest', () => this.provider.suggest({ query: key, sessionToken: input.sessionToken }));
    return places ? { status: 'ok', places } : { status: 'unavailable', places: [] };
  }

  async locate(input: { placeId: string; sessionToken: string }): Promise<DeepLocateResult> {
    if (!this.provider.configured()) return { status: 'not_configured' };
    if (!PLACE_ID_PATTERN.test(input.placeId)) return { status: 'unavailable' };
    this.sessions.delete(input.sessionToken); // the customer chose: this search is over
    const cached = await this.locations.get(input.placeId).catch(() => null);
    if (cached && inUganda(cached)) return { status: 'ok', point: cached, fromCache: true };
    if (await this.paused()) return { status: 'unavailable' };
    if (!(await this.budget.tryConsume('details'))) return { status: 'budget_reached' };
    const found = await this.call('details', () => this.provider.locate(input));
    if (!found || !inUganda(found)) return { status: 'unavailable' };
    await this.locations.put(input.placeId, found).catch(() => undefined);
    return { status: 'ok', point: { lat: found.lat, lng: found.lng }, fromCache: false };
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
