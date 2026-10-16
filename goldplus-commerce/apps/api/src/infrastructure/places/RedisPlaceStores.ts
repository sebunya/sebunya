/**
 * Redis-backed stores for the deep place layer, shared by both api replicas. Both fail CLOSED / empty:
 * no Redis means no paid call and no cached point.
 */
import Redis from 'ioredis';
import type { IPlaceLocationCache, IPlaceRequestBudget, PlaceBudgetUsage, PlacePoint, PlaceRequestKind } from '../../application/ports/IPlaceSearch';
import { logger } from '../logging/logger';

/** Google Maps Platform terms: latitude/longitude may be cached for up to 30 consecutive calendar days. */
export const PLACE_POINT_TTL_SECONDS = 30 * 24 * 60 * 60;

let shared: Redis | null = null;
function connect(url: string | undefined = process.env.REDIS_URL): Redis | null {
  if (shared) return shared;
  if (!url) return null;
  try {
    shared = new Redis(url, { connectTimeout: 1000, commandTimeout: 300, maxRetriesPerRequest: 1, enableOfflineQueue: true });
    shared.on('error', (err) => logger.warn({ err: err.message }, 'PLACES_REDIS_ERROR'));
    return shared;
  } catch {
    return null;
  }
}

function capFromEnv(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/**
 * Today's allowance: what is left of the month, spread over the days left (Kampala time), times two so a busy
 * day is not starved, never below a small floor. A burst (a bot, a bad deploy) can spend a day, not the month.
 */
export function dailyAllowance(input: { cap: number; usedBeforeToday: number; daysLeftIncludingToday: number }): number {
  const left = Math.max(0, input.cap - input.usedBeforeToday);
  if (left === 0) return 0;
  return Math.min(left, Math.max(50, Math.ceil((left / Math.max(1, input.daysLeftIncludingToday)) * 2)));
}

function kampalaDay(now: Date): { month: string; day: string; daysLeftIncludingToday: number } {
  const eat = new Date(now.getTime() + 3 * 60 * 60 * 1000);
  const y = eat.getUTCFullYear();
  const m = eat.getUTCMonth();
  const d = eat.getUTCDate();
  const daysInMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const month = `${y}-${String(m + 1).padStart(2, '0')}`;
  return { month, day: `${month}-${String(d).padStart(2, '0')}`, daysLeftIncludingToday: daysInMonth - d + 1 };
}

export class RedisPlaceRequestBudget implements IPlaceRequestBudget {
  constructor(
    private readonly caps: Record<PlaceRequestKind, number> = {
      // Google's free monthly allowance is 10,000 for each SKU (Autocomplete Requests; Place Details Essentials),
      // read from developers.google.com/maps/billing-and-pricing/pricing on 2026-10-16. 9,500 leaves headroom
      // for the requests Google counts that we cannot see (retries, a request in flight at month end).
      suggest: capFromEnv('GOOGLE_PLACES_AUTOCOMPLETE_MONTHLY_CAP', 9500),
      details: capFromEnv('GOOGLE_PLACES_DETAILS_MONTHLY_CAP', 9500),
    },
    private readonly clock: () => Date = () => new Date(),
    private readonly redis: () => Redis | null = connect,
  ) {}

  async tryConsume(kind: PlaceRequestKind): Promise<boolean> {
    const c = this.redis();
    if (!c) return false;
    const { month, day, daysLeftIncludingToday } = kampalaDay(this.clock());
    const mKey = `places:${kind}:${month}`;
    const dKey = `places:${kind}:${day}`;
    try {
      const [mUsed, dUsed] = (await c.mget(mKey, dKey)).map((v) => Number(v ?? 0));
      const allowance = dailyAllowance({ cap: this.caps[kind], usedBeforeToday: mUsed - dUsed, daysLeftIncludingToday });
      if (mUsed >= this.caps[kind] || dUsed >= allowance) {
        logger.warn({ kind, monthUsed: mUsed, todayUsed: dUsed, allowance }, 'PLACES_BUDGET_REFUSED');
        return false;
      }
      const res = await c.multi().incr(mKey).expire(mKey, 40 * 24 * 60 * 60).incr(dKey).expire(dKey, 3 * 24 * 60 * 60).exec();
      return Array.isArray(res) && res.every(([err]) => !err);
    } catch {
      return false;
    }
  }

  async usage(): Promise<PlaceBudgetUsage | null> {
    const c = this.redis();
    if (!c) return null;
    const { month, day, daysLeftIncludingToday } = kampalaDay(this.clock());
    try {
      const [sm, sd, dm, dd] = (await c.mget(`places:suggest:${month}`, `places:suggest:${day}`, `places:details:${month}`, `places:details:${day}`)).map((v) => Number(v ?? 0));
      const one = (kind: PlaceRequestKind, used: number, today: number) => ({
        used,
        cap: this.caps[kind],
        today,
        todayAllowance: dailyAllowance({ cap: this.caps[kind], usedBeforeToday: used - today, daysLeftIncludingToday }),
      });
      return { month, suggest: one('suggest', sm, sd), details: one('details', dm, dd) };
    } catch {
      return null;
    }
  }
}

export class RedisPlaceLocationCache implements IPlaceLocationCache {
  constructor(private readonly redis: () => Redis | null = connect) {}

  async get(placeId: string): Promise<PlacePoint | null> {
    const c = this.redis();
    if (!c) return null;
    const raw = await c.get(`places:point:${placeId}`).catch(() => null);
    if (!raw) return null;
    const [lat, lng] = raw.split(',').map(Number);
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  }

  async put(placeId: string, point: PlacePoint): Promise<void> {
    const c = this.redis();
    if (!c) return;
    // EX, set once: re-reading never extends a point past 30 days from when Google gave it to us.
    await c.set(`places:point:${placeId}`, `${point.lat.toFixed(6)},${point.lng.toFixed(6)}`, 'EX', PLACE_POINT_TTL_SECONDS, 'NX').catch(() => undefined);
  }
}
