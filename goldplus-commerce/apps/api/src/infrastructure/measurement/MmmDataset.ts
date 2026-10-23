import { sql } from 'drizzle-orm';
import { db } from '../db/client';
import { environmentOf } from '../../domain/measurement/BusinessEvents';
import { reportChannelForSpend } from '../../domain/measurement/ChannelReport';
import { calendarControls } from '../../domain/measurement/UgandaCalendar';
import { readiness, toWeekly, type MmmDailyRow, type ReadinessReport } from '../../domain/measurement/MmmReadiness';
import { effectiveNumber } from '../../domain/measurement/MeasurementConfig';
import type { MeasurementConfigPort } from '../../application/ports/measurement/MeasurementConfigPort';
import { kampalaDay } from './MarketingCostDerivation';

const rows = (r: unknown): any[] => (Array.isArray(r) ? r : ((r as { rows?: any[] })?.rows ?? []));
export const MMM_WINDOW_DAYS = 400;
export const CONTROL_KEYS = ['holiday', 'school_term', 'stockout_share', 'price_index', 'momo_outage', 'delivery_fee_index', 'promo_depth'] as const;
export type ControlKey = typeof CONTROL_KEYS[number];
export const MANUAL_CONTROL_KEYS: readonly ControlKey[] = ['momo_outage', 'delivery_fee_index', 'promo_depth'];

/**
 * The media channel key the model sees. Paid platforms stay apart (a dollar on Meta and a dollar on Google are
 * different levers); everything else is the channel report's key, so sessions and spend line up.
 */
export function mmmChannelKey(channel: string, platform: string): string {
  const p = (platform ?? '').toLowerCase();
  if (/google/.test(p)) return 'google_ads';
  if (/meta|facebook|instagram/.test(p) && !/whatsapp/.test(p)) return 'meta';
  if (/tiktok/.test(p)) return 'tiktok';
  const ch = (channel ?? '').toLowerCase();
  if (['sms', 'whatsapp', 'email', 'print', 'loyalty', 'creator', 'friend_referral', 'referral', 'affiliate'].includes(ch)) return ch;
  return reportChannelForSpend(channel, platform);
}

export class MmmDataset {
  constructor(private readonly config: MeasurementConfigPort) {}

  /** Rebuilds measurement.mmm_daily for the window and writes the calendar + measured controls. */
  async rebuild(now = new Date(), days = MMM_WINDOW_DAYS): Promise<{ days: number; rows: number; notes: string[] }> {
    const env = environmentOf(process.env.NODE_ENV);
    const to = kampalaDay(new Date(now.getTime() - 86_400_000)); // yesterday: today is incomplete
    const from = kampalaDay(new Date(now.getTime() - days * 86_400_000));
    const notes: string[] = [];
    const values = await this.config.values();
    const fallbackRate = effectiveNumber(values, 'ugx_per_usd');
    const rates = new Map<string, number>();
    for (const r of rows(await db.execute(sql`select platform, config->>'ugxPerUsd' as rate from ad_destinations`))) {
      const n = Number(r.rate); if (Number.isFinite(n) && n > 0) rates.set(String(r.platform), n);
    }
    const rateFor = (platform: string): number | null => {
      const p = platform.toLowerCase();
      const key = /google/.test(p) ? 'google_ads' : /meta|facebook/.test(p) ? 'meta' : /tiktok/.test(p) ? 'tiktok' : null;
      return (key && rates.get(key)) || fallbackRate;
    };

    type Cell = { spend: number; impressions: number | null; clicks: number | null; sessions: number; orders: number; revenue: number };
    const cells = new Map<string, Cell>();
    const cell = (day: string, channel: string): Cell => {
      const k = `${day}|${channel}`;
      let c = cells.get(k);
      if (!c) { c = { spend: 0, impressions: null, clicks: null, sessions: 0, orders: 0, revenue: 0 }; cells.set(k, c); }
      return c;
    };

    let usdLeftOut = 0;
    for (const r of rows(await db.execute(sql`select spend_date::text as day, channel, platform, currency, sum(spend_minor + tax_or_fee_minor)::bigint as spend, sum(clicks)::bigint as clicks, sum(impressions)::bigint as impressions
      from media_cost_facts where spend_date >= ${from}::date and spend_date <= ${to}::date group by 1, 2, 3, 4`))) {
      const key = mmmChannelKey(String(r.channel), String(r.platform));
      let ugx: number | null = null;
      if (r.currency === 'UGX') ugx = Number(r.spend);
      else if (r.currency === 'USD') { const rate = rateFor(String(r.platform)); if (rate) ugx = Math.round(Number(r.spend) / 100 * rate); else usdLeftOut += Number(r.spend); }
      else notes.push(`${r.currency} spend on ${r.platform} left out (only UGX and USD are understood)`);
      if (ugx === null) continue;
      const c = cell(String(r.day), key);
      c.spend += ugx;
      if (r.impressions != null) c.impressions = (c.impressions ?? 0) + Number(r.impressions);
      if (r.clicks != null) c.clicks = (c.clicks ?? 0) + Number(r.clicks);
    }
    if (usdLeftOut > 0) notes.push(`USD ${(usdLeftOut / 100).toFixed(2)} of spend left out: set "Shillings per US dollar" in measurement settings or on the platform's advertising form`);

    for (const r of rows(await db.execute(sql`select (occurred_at at time zone 'Africa/Kampala')::date::text as day, channel, count(distinct anonymous_id)::int as sessions
      from measurement.touchpoint where environment = ${env} and traffic_class = 'customer' and occurred_at >= ${from}::date - interval '1 day' and occurred_at < ${to}::date + interval '2 day' group by 1, 2`))) {
      if (r.day < from || r.day > to) continue;
      cell(String(r.day), String(r.channel)).sessions += Number(r.sessions);
    }

    // Sales under last click; an order with no recorded source is its own line, never spread.
    for (const r of rows(await db.execute(sql`
      with sales as (
        select o.id, (o.created_at at time zone 'Africa/Kampala')::date::text as day, greatest(o.total_amount - coalesce(o.delivery_fee, 0), 0)::bigint as goods
        from orders o where o.status not in ('cancelled','failed','delivery_failed') and (o.payment_method is distinct from 'pesapal' or o.payment_status = 'paid')
          and o.created_at >= ${from}::date - interval '1 day' and o.created_at < ${to}::date + interval '2 day'
      ), credited as (
        select s.day, c.channel, count(distinct s.id)::int as orders, sum(c.credited_ugx)::bigint as revenue
        from sales s join measurement.order_channel_credit c on c.order_id = s.id and c.model = 'last_click' group by 1, 2
      ), uncredited as (
        select s.day, 'unattributed' as channel, count(*)::int as orders, sum(s.goods)::bigint as revenue
        from sales s where not exists (select 1 from measurement.order_channel_credit c where c.order_id = s.id and c.model = 'last_click') group by 1
      )
      select * from credited union all select * from uncredited`))) {
      if (r.day < from || r.day > to) continue;
      const c = cell(String(r.day), String(r.channel));
      c.orders += Number(r.orders); c.revenue += Number(r.revenue);
    }

    await db.transaction(async (tx) => {
      await tx.execute(sql`delete from measurement.mmm_daily where day >= ${from}::date and day <= ${to}::date`);
      for (const [k, c] of cells) {
        const [day, channel] = k.split('|');
        await tx.execute(sql`insert into measurement.mmm_daily (day, channel, spend_minor, impressions, clicks, sessions, orders, revenue_minor, built_at)
          values (${day}::date, ${channel}, ${c.spend}, ${c.impressions}, ${c.clicks}, ${c.sessions}, ${c.orders}, ${c.revenue}, ${now})`);
      }
      // Calendar controls for every day in the window; measured controls for yesterday only (no history to invent).
      for (let t = new Date(`${from}T00:00:00Z`).getTime(); t <= new Date(`${to}T00:00:00Z`).getTime(); t += 86_400_000) {
        const day = new Date(t).toISOString().slice(0, 10);
        const cal = calendarControls(day);
        await tx.execute(sql`insert into measurement.control_series (day, control_key, value, source, note) values (${day}::date, 'holiday', ${cal.holiday}, 'calendar', ${cal.holiday_name}), (${day}::date, 'school_term', ${cal.school_term}, 'calendar', null)
          on conflict (day, control_key) do update set value = excluded.value, note = excluded.note, updated_at = now() where measurement.control_series.source = 'calendar'`);
      }
      const stock = rows(await tx.execute(sql`select count(*)::int as n, count(*) filter (where stock_status <> 'in_stock')::int as out_n, avg(price_ugx) filter (where has_retail_price and price_ugx > 0) as avg_price
        from products where active and approval_status = 'approved'`))[0];
      if (stock && Number(stock.n) > 0) {
        await tx.execute(sql`insert into measurement.control_series (day, control_key, value, source, note) values (${to}::date, 'stockout_share', ${Number(stock.out_n) / Number(stock.n)}, 'measured', ${`${stock.out_n} of ${stock.n} listed products not in stock`})
          on conflict (day, control_key) do update set value = excluded.value, note = excluded.note, updated_at = now() where measurement.control_series.source = 'measured'`);
        if (stock.avg_price) await tx.execute(sql`insert into measurement.control_series (day, control_key, value, source, note) values (${to}::date, 'price_index', ${Number(stock.avg_price)}, 'measured', 'mean retail price, UGX')
          on conflict (day, control_key) do update set value = excluded.value, note = excluded.note, updated_at = now() where measurement.control_series.source = 'measured'`);
      }
    });
    return { days: Math.round((new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86_400_000) + 1, rows: cells.size, notes };
  }

  async dailyRows(from?: string, to?: string): Promise<MmmDailyRow[]> {
    const r = rows(await db.execute(sql`select day::text as day, channel, spend_minor, orders, revenue_minor, impressions, clicks, sessions from measurement.mmm_daily
      where (${from ?? null}::date is null or day >= ${from ?? null}::date) and (${to ?? null}::date is null or day <= ${to ?? null}::date) order by day, channel`));
    return r.map((x) => ({ day: String(x.day), channel: String(x.channel), spendMinor: Number(x.spend_minor), orders: Number(x.orders), revenueMinor: Number(x.revenue_minor), impressions: x.impressions == null ? null : Number(x.impressions), clicks: x.clicks == null ? null : Number(x.clicks), sessions: Number(x.sessions) }));
  }

  async readiness(): Promise<ReadinessReport & { builtAt: string | null; firstDay: string | null; lastDay: string | null }> {
    const daily = await this.dailyRows();
    const meta = rows(await db.execute(sql`select max(built_at) as built_at, min(day)::text as first_day, max(day)::text as last_day from measurement.mmm_daily`))[0];
    return { ...readiness(toWeekly(daily)), builtAt: meta?.built_at ? new Date(meta.built_at).toISOString() : null, firstDay: meta?.first_day ?? null, lastDay: meta?.last_day ?? null };
  }

  /** daily.csv and controls.csv exactly as ops/mmm/goldplus_mmm/contract.py reads them. */
  async exportCsv(from?: string, to?: string): Promise<{ daily: string; controls: string }> {
    const daily = await this.dailyRows(from, to);
    const esc = (v: unknown) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const d = ['date,channel,spend_ugx,impressions,clicks,sessions,orders,revenue_ugx', ...daily.map((r: any) => [r.day, r.channel, r.spendMinor, r.impressions ?? '', r.clicks ?? '', r.sessions, r.orders, r.revenueMinor].map(esc).join(','))].join('\n');
    const c = rows(await db.execute(sql`select day::text as day, control_key, value from measurement.control_series
      where (${from ?? null}::date is null or day >= ${from ?? null}::date) and (${to ?? null}::date is null or day <= ${to ?? null}::date) order by day, control_key`));
    const controls = ['date,key,value', ...c.map((r) => [r.day, r.control_key, Number(r.value)].map(esc).join(','))].join('\n');
    return { daily: d + '\n', controls: controls + '\n' };
  }

  async listControls(days = 60): Promise<Array<{ day: string; key: string; value: number; source: string; note: string | null }>> {
    const r = rows(await db.execute(sql`select day::text as day, control_key, value, source, note from measurement.control_series where day >= current_date - ${days}::int order by day desc, control_key`));
    return r.map((x) => ({ day: String(x.day), key: String(x.control_key), value: Number(x.value), source: String(x.source), note: x.note ?? null }));
  }

  async setManualControl(input: { day: string; key: string; value: number; note: string | null; actorId: string }): Promise<{ ok: true } | { ok: false; message: string }> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.day)) return { ok: false, message: 'Give the day as YYYY-MM-DD.' };
    if (!(MANUAL_CONTROL_KEYS as readonly string[]).includes(input.key)) return { ok: false, message: `"${input.key}" is not a control you can type in (${MANUAL_CONTROL_KEYS.join(', ')}).` };
    if (!Number.isFinite(input.value)) return { ok: false, message: 'The value must be a number.' };
    await db.execute(sql`insert into measurement.control_series (day, control_key, value, source, note, updated_by, updated_at) values (${input.day}::date, ${input.key}, ${input.value}, 'manual', ${input.note}, ${input.actorId}::uuid, now())
      on conflict (day, control_key) do update set value = excluded.value, note = excluded.note, source = 'manual', updated_by = excluded.updated_by, updated_at = now()`);
    return { ok: true };
  }
}
