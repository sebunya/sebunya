import { sql } from 'drizzle-orm';
import { db } from '../db/client';
import { logger } from '../logging/logger';
import { BOU_MAX_AGE_DAYS, type FxFeedReading } from '../../domain/measurement/MeasurementConfig';

/**
 * Automated control series (2026-10-23): things that move sales, are not marketing, and that a machine can fetch
 * every night without a key. Each feed writes measurement.control_series rows with source 'feed'; a manual value
 * on the same day and key is never overwritten (the person who typed it knew something the feed did not).
 *
 *  - usd_ugx: the day's market rate, shillings per dollar. With ALLRATES_API_KEY: allratestoday.com's market quote
 *    (hourly, every day, retail level: on 2026-10-24 it was 4,420 against BoU selling 4,215 + 200). Without the key:
 *    open.er-api.com (daily, keyless, interbank level; the margin is added when USED, never when stored).
 *  - usd_ugx_bou: the Bank of Uganda selling rate (business days; the cover for the market quote, see resolveUgxPerUsd).
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
export { BOU_MAX_AGE_DAYS };
const FX_URL = 'https://open.er-api.com/v6/latest/USD';
const MARKET_URL = 'https://allratestoday.com/api/v1/rates?source=USD&target=UGX';
const MARKET_NOTE = 'allratestoday.com market quote (retail level, no margin added)';
const RAIN_URL = 'https://archive-api.open-meteo.com/v1/archive';
/**
 * AllRatesToday's mirror of the Bank of Uganda table (owner's key, 2026-10-24): the full table gives the USD/UGX
 * buying, reference (mid) and selling rates with BoU's own date. The shop BUYS dollars to pay for adverts, so the
 * rate kept is the bank's SELLING rate (owner 2026-10-24); mid and buying go into the note.
 */
const BOU_URL = 'https://allratestoday.com/api/v1/central-bank/bou/latest';
const KAMPALA = { latitude: 0.3476, longitude: 32.5825 };
const TIMEOUT_MS = 15_000;
const rows = (r: unknown): any[] => (Array.isArray(r) ? r : ((r as { rows?: any[] })?.rows ?? []));

export interface FeedResult {
  usd_ugx: { day: string; rate: number } | { error: string };
  usd_ugx_bou: { day: string; rate: number; ageDays: number } | { error: string } | { skipped: string };
  /** Market quote against BoU selling: the quote should sit a few percent above the central bank; outside 0–10 % one of the two is wrong and the nightly log says so. */
  fx_check?: { market: number; bou: number; gapPct: number; ok: boolean };
  rain_mm: { days: number; from: string; to: string } | { error: string };
}

export class ControlFeeds {
  constructor(private readonly fetchImpl: typeof fetch = fetch, private readonly allRatesKey: string | undefined = process.env.ALLRATES_API_KEY) {}

  /** The newest fed dollar rates, for resolveUgxPerUsd: the market quote first, the fresh Bank of Uganda reading as cover. */
  async latestFx(): Promise<FxFeedReading | null> {
    const bouRow = rows(await db.execute(sql`select day::text as day, value from measurement.control_series where control_key = 'usd_ugx_bou' and source = 'bou' and day >= current_date - ${BOU_MAX_AGE_DAYS}::int order by day desc limit 1`))[0];
    const bou = bouRow ? { day: String(bouRow.day), ugxPerUsd: Number(bouRow.value) } : null;
    const r = rows(await db.execute(sql`select day::text as day, value, note from measurement.control_series where control_key = 'usd_ugx' and source = 'feed' order by day desc limit 1`))[0];
    if (r) return { day: String(r.day), ugxPerUsd: Number(r.value), source: String(r.note ?? '').startsWith('allratestoday.com') ? 'market' : 'feed', ...(bou ? { cover: bou } : {}) };
    return bou ? { ...bou, source: 'bou' } : null;
  }

  /** A Bank of Uganda reading (the rate kept is what the shop pays to buy a dollar: the bank's selling rate), dated by BoU's own day. */
  async recordBou(reading: { day: string; mid: number; buying: number | null; selling: number | null; note: string }): Promise<void> {
    await db.execute(sql`insert into measurement.control_series (day, control_key, value, source, note) values (${reading.day}::date, 'usd_ugx_bou', ${reading.mid}, 'bou', ${reading.note.slice(0, 200)})
      on conflict (day, control_key) do update set value = excluded.value, note = excluded.note, updated_at = now() where measurement.control_series.source = 'bou'`);
  }

  async run(now = new Date(), windowDays = 400): Promise<FeedResult> {
    const out: FeedResult = { usd_ugx: { error: 'not run' }, usd_ugx_bou: { error: 'not run' }, rain_mm: { error: 'not run' } };
    try { out.usd_ugx = await this.fx(now); } catch (err) { out.usd_ugx = { error: String((err as Error).message ?? err).slice(0, 200) }; logger.warn({ err: (err as Error).message }, '[control-feeds] usd_ugx failed'); }
    out.usd_ugx_bou = await this.bouSafe(now);
    out.fx_check = fxCheck(out) ?? undefined;
    try { out.rain_mm = await this.rain(now, windowDays); } catch (err) { out.rain_mm = { error: String((err as Error).message ?? err).slice(0, 200) }; logger.warn({ err: (err as Error).message }, '[control-feeds] rain_mm failed'); }
    return out;
  }

  /** The market quote on its own (the 1 pm tick); never throws. */
  async fxSafe(now = new Date()): Promise<FeedResult['usd_ugx']> {
    try { return await this.fx(now); } catch (err) { logger.warn({ err: (err as Error).message }, '[control-feeds] usd_ugx failed'); return { error: String((err as Error).message ?? err).slice(0, 200) }; }
  }

  private async fx(now: Date): Promise<{ day: string; rate: number }> {
    const key = (this.allRatesKey ?? '').trim();
    if (key) return this.marketQuote(now, key);
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

  /** allratestoday.com's USD/UGX market quote (hourly, every day), dated by the Kampala day of its own timestamp. */
  private async marketQuote(now: Date, key: string): Promise<{ day: string; rate: number }> {
    const res = await this.fetchImpl(MARKET_URL, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { Accept: 'application/json', Authorization: `Bearer ${key}` } });
    if (!res.ok) throw new Error(`allratestoday.com answered HTTP ${res.status}`);
    const json = await res.json() as Array<{ rate?: number; source?: string; target?: string; time?: string }>;
    const row = Array.isArray(json) ? json.find((r) => r.source === 'USD' && r.target === 'UGX') : undefined;
    const rate = Number(row?.rate);
    if (!row || !Number.isFinite(rate) || rate < 1000 || rate > 20000) throw new Error(`allratestoday.com gave no usable USD/UGX market quote (${JSON.stringify(json).slice(0, 120)})`);
    const at = row.time && Number.isFinite(Date.parse(row.time)) ? new Date(row.time) : now;
    const day = kampalaDay(at);
    await db.execute(sql`insert into measurement.control_series (day, control_key, value, source, note) values (${day}::date, 'usd_ugx', ${rate}, 'feed', ${`${MARKET_NOTE}; quoted ${at.toISOString()}`.slice(0, 200)})
      on conflict (day, control_key) do update set value = excluded.value, note = excluded.note, updated_at = now() where measurement.control_series.source = 'feed'`);
    return { day, rate };
  }

  /** The Bank of Uganda reading on its own (the 1 pm tick); never throws. */
  async bouSafe(now = new Date()): Promise<FeedResult['usd_ugx_bou']> {
    try { return await this.bou(now); } catch (err) { logger.warn({ err: (err as Error).message }, '[control-feeds] usd_ugx_bou failed'); return { error: String((err as Error).message ?? err).slice(0, 200) }; }
  }

  private async bou(now: Date): Promise<{ day: string; rate: number; ageDays: number } | { skipped: string }> {
    const key = (this.allRatesKey ?? '').trim();
    if (!key) return { skipped: 'ALLRATES_API_KEY is not set: the Bank of Uganda rate is not fetched' };
    const res = await this.fetchImpl(BOU_URL, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { Accept: 'application/json', Authorization: `Bearer ${key}` } });
    if (!res.ok) throw new Error(`allratestoday.com answered HTTP ${res.status}`);
    const json = await res.json() as { bank?: string; rate_date?: string; rates?: Array<{ base?: string; quote?: string; type?: string; value?: number }> };
    if (json?.bank !== 'bou' || !Array.isArray(json?.rates)) throw new Error('allratestoday.com gave something other than the BoU table');
    const usd = json.rates.filter((r) => r.base === 'USD' && r.quote === 'UGX');
    const pick = (t: string): number | null => { const v = Number(usd.find((r) => r.type === t)?.value); return Number.isFinite(v) && v >= 1000 && v <= 20000 ? v : null; };
    const selling = pick('sell'), mid = pick('reference'), buying = pick('buy');
    const rate = selling ?? mid;
    if (rate === null) throw new Error(`allratestoday.com gave no usable BoU USD/UGX selling or reference rate (${JSON.stringify(usd)})`);
    const day = String(json?.rate_date ?? '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error(`allratestoday.com gave no rate_date (${day})`);
    const ageDays = Math.round((Date.parse(`${kampalaDay(now)}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / 86_400_000);
    if (ageDays > BOU_MAX_AGE_DAYS) throw new Error(`BoU reading dated ${day} is ${ageDays} days old; not kept`);
    await this.recordBou({ day, mid: rate, buying, selling, note: `Bank of Uganda ${selling !== null ? 'selling' : 'reference'} rate via allratestoday.com, BoU date ${day}${mid !== null ? `; mid ${mid}` : ''}${buying !== null ? `; buying ${buying}` : ''}` });
    return { day, rate, ageDays };
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

/** The market quote should sit a few percent above the Bank of Uganda selling rate (the bank spread); 0–10 % is sane. */
export function fxCheck(out: Pick<FeedResult, 'usd_ugx' | 'usd_ugx_bou'>): FeedResult['fx_check'] | null {
  if (!('rate' in out.usd_ugx) || !('rate' in out.usd_ugx_bou)) return null;
  const market = out.usd_ugx.rate, bou = out.usd_ugx_bou.rate;
  const gapPct = Math.round(((market - bou) / bou) * 1000) / 10;
  const ok = gapPct >= 0 && gapPct <= 10;
  if (!ok) logger.warn({ market, bou, gapPct }, '[control-feeds] market quote and Bank of Uganda selling rate disagree beyond the bank spread; check both sources');
  return { market, bou, gapPct, ok };
}

const kampalaDay = (d: Date): string => new Date(d.getTime() + 3 * 3600_000).toISOString().slice(0, 10);
