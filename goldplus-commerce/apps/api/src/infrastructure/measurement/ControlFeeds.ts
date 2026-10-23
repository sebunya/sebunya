import { sql } from 'drizzle-orm';
import { db } from '../db/client';
import { logger } from '../logging/logger';
import type { FxFeedReading } from '../../domain/measurement/MeasurementConfig';

/**
 * Automated control series (2026-10-23): things that move sales, are not marketing, and that a machine can fetch
 * every night without a key. Each feed writes measurement.control_series rows with source 'feed'; a manual value
 * on the same day and key is never overwritten (the person who typed it knew something the feed did not).
 *
 *  - usd_ugx: the day's market rate, shillings per dollar, from open.er-api.com (daily, keyless, no terms beyond
 *    attribution). The safety margin is added when the rate is USED (resolveUgxPerUsd), never when stored, so the
 *    stored series stays the market rate.
 *  - rain_mm: daily rainfall in Kampala (0.3476 N, 32.5825 E) from Open-Meteo's archive (keyless, free for this
 *    volume). Rain keeps people off the road and out of the shop; a model without it would credit the weather to
 *    whatever campaign ran that week. Backfilled over the whole MMM window on the first run.
 *
 * Not automated, on purpose: load-shedding hours and competitor promotions have no public feed for Uganda; they
 * stay manual keys (power_outage, competitor_promo) on the admin page. Fuel pump prices likewise (no API; the
 * global crude price is not the Kampala pump price). A feed that fails writes nothing and says so in the nightly
 * stats; no reading is ever invented.
 */
export const FEED_CONTROL_KEYS = ['usd_ugx', 'rain_mm'] as const;
const FX_URL = 'https://open.er-api.com/v6/latest/USD';
const RAIN_URL = 'https://archive-api.open-meteo.com/v1/archive';
const KAMPALA = { latitude: 0.3476, longitude: 32.5825 };
const TIMEOUT_MS = 15_000;
const rows = (r: unknown): any[] => (Array.isArray(r) ? r : ((r as { rows?: any[] })?.rows ?? []));

export interface FeedResult { usd_ugx: { day: string; rate: number } | { error: string }; rain_mm: { days: number; from: string; to: string } | { error: string } }

export class ControlFeeds {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  /** The newest fed dollar rate, for resolveUgxPerUsd. */
  async latestFx(): Promise<FxFeedReading | null> {
    const r = rows(await db.execute(sql`select day::text as day, value from measurement.control_series where control_key = 'usd_ugx' and source = 'feed' order by day desc limit 1`))[0];
    return r ? { day: String(r.day), ugxPerUsd: Number(r.value) } : null;
  }

  async run(now = new Date(), windowDays = 400): Promise<FeedResult> {
    const out: FeedResult = { usd_ugx: { error: 'not run' }, rain_mm: { error: 'not run' } };
    try { out.usd_ugx = await this.fx(now); } catch (err) { out.usd_ugx = { error: String((err as Error).message ?? err).slice(0, 200) }; logger.warn({ err: (err as Error).message }, '[control-feeds] usd_ugx failed'); }
    try { out.rain_mm = await this.rain(now, windowDays); } catch (err) { out.rain_mm = { error: String((err as Error).message ?? err).slice(0, 200) }; logger.warn({ err: (err as Error).message }, '[control-feeds] rain_mm failed'); }
    return out;
  }

  private async fx(now: Date): Promise<{ day: string; rate: number }> {
    const res = await this.fetchImpl(FX_URL, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`open.er-api.com answered HTTP ${res.status}`);
    const json = await res.json() as { result?: string; rates?: Record<string, number>; time_last_update_unix?: number };
    const rate = Number(json?.rates?.UGX);
    if (json?.result !== 'success' || !Number.isFinite(rate) || rate < 1000 || rate > 20000) throw new Error(`open.er-api.com gave no usable UGX rate (${String(json?.rates?.UGX)})`);
    // The feed's own "last update" day (UTC), not ours: a reading is dated by the market day it describes.
    const day = (json.time_last_update_unix ? new Date(json.time_last_update_unix * 1000) : now).toISOString().slice(0, 10);
    await db.execute(sql`insert into measurement.control_series (day, control_key, value, source, note) values (${day}::date, 'usd_ugx', ${rate}, 'feed', 'open.er-api.com, market rate without margin')
      on conflict (day, control_key) do update set value = excluded.value, note = excluded.note, updated_at = now() where measurement.control_series.source = 'feed'`);
    return { day, rate };
  }

  private async rain(now: Date, windowDays: number): Promise<{ days: number; from: string; to: string }> {
    // The archive lags about five days; ask up to yesterday and accept what comes back. First run backfills the
    // whole window; later runs refresh the last 14 days (late corrections) and anything still missing.
    const have = rows(await db.execute(sql`select count(*)::int as n from measurement.control_series where control_key = 'rain_mm' and source = 'feed' and day >= current_date - ${windowDays}::int`))[0];
    const span = Number(have?.n ?? 0) > windowDays / 2 ? 14 : windowDays;
    const to = new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10);
    const from = new Date(now.getTime() - span * 86_400_000).toISOString().slice(0, 10);
    const url = `${RAIN_URL}?latitude=${KAMPALA.latitude}&longitude=${KAMPALA.longitude}&start_date=${from}&end_date=${to}&daily=precipitation_sum&timezone=Africa%2FKampala`;
    const res = await this.fetchImpl(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`open-meteo answered HTTP ${res.status}`);
    const json = await res.json() as { daily?: { time?: string[]; precipitation_sum?: Array<number | null> } };
    const time = json?.daily?.time ?? [];
    const mm = json?.daily?.precipitation_sum ?? [];
    if (!time.length) throw new Error('open-meteo returned no days');
    let n = 0;
    await db.transaction(async (tx) => {
      for (let i = 0; i < time.length; i++) {
        const v = mm[i];
        if (v === null || v === undefined || !Number.isFinite(Number(v))) continue; // not yet in the archive: leave the day empty
        await tx.execute(sql`insert into measurement.control_series (day, control_key, value, source, note) values (${time[i]}::date, 'rain_mm', ${Number(v)}, 'feed', 'Open-Meteo archive, Kampala, mm')
          on conflict (day, control_key) do update set value = excluded.value, updated_at = now() where measurement.control_series.source = 'feed'`);
        n++;
      }
    });
    return { days: n, from, to };
  }
}
