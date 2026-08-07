import { sql } from 'drizzle-orm';
import { db } from '../db/client';

/**
 * Nav telemetry (§10) — its own owner, separate from hero_events and
 * recommendation_events. Validate-then-insert, never throws; rates are withheld
 * below a sample floor so a handful of events never reads as a trustworthy CTR.
 */

const rowsOf = (r: any): any[] => (Array.isArray(r) ? r : r?.rows ?? []);

const EVENT_TYPES = new Set([
  'NBA_IMPRESSION', 'NBA_CLICK', 'NBA_DISMISS',
  'SEARCH_SUGGEST_SHOWN', 'SEARCH_SUGGEST_CLICK', 'SEARCH_ZERO',
  'BATTERY_FINDER_SUBMIT', 'WHATSAPP_TAP',
  'MINICART_OPEN', 'MINICART_CHECKOUT', 'PANEL_OPEN',
]);
const SEGMENTS = new Set(['new', 'returning', 'signed_in', 'unknown']);
const TERM_TYPES = new Set(['SEARCH_ZERO', 'BATTERY_FINDER_SUBMIT']);
const MIN_FOR_RATE = 100;

export class NavTelemetryService {
  async capture(input: {
    eventType: string; itemKey: string; position: number;
    segment: string; term: string | null; profileId: string | null;
  }): Promise<{ recorded: boolean }> {
    try {
      const eventType = String(input.eventType || '').toUpperCase();
      if (!EVENT_TYPES.has(eventType)) return { recorded: false };
      const itemKey = String(input.itemKey ?? '').trim();
      // '' (keyless) OR a lowercase slug up to 32 chars
      if (!/^$|^[a-z][a-z0-9-]{1,31}$/.test(itemKey)) return { recorded: false };
      const segment = SEGMENTS.has(input.segment) ? input.segment : 'unknown';
      const position = Number.isInteger(input.position) && input.position >= 0 && input.position <= 50 ? input.position : 0;
      const term = TERM_TYPES.has(eventType) && input.term != null ? String(input.term).slice(0, 80) : null;
      const profileId = input.profileId ?? null;

      await db.execute(sql`
        insert into nav_events (event_type, item_key, position, segment, term, profile_id)
        values (${eventType}, ${itemKey}, ${position}, ${segment}, ${term}, ${profileId}::uuid)
      `);
      return { recorded: true };
    } catch {
      // telemetry must never break a page interaction
      return { recorded: false };
    }
  }

  async report(windowDays: number) {
    const days = Math.min(365, Math.max(1, Number.isFinite(windowDays) ? windowDays : 30));
    const win = sql`created_at >= now() - make_interval(days => ${days})`;
    const rate = (num: number, den: number) => (den >= MIN_FOR_RATE ? Math.round((num / den) * 10000) / 100 : null);

    const nba = rowsOf(await db.execute(sql`
      select item_key, segment,
             count(*) filter (where event_type='NBA_IMPRESSION')::int as impressions,
             count(*) filter (where event_type='NBA_CLICK')::int      as clicks,
             count(*) filter (where event_type='NBA_DISMISS')::int    as dismisses
      from nav_events where ${win} and event_type like 'NBA_%'
      group by item_key, segment order by impressions desc`));
    const suggest = rowsOf(await db.execute(sql`
      select count(*) filter (where event_type='SEARCH_SUGGEST_SHOWN')::int as shown,
             count(*) filter (where event_type='SEARCH_SUGGEST_CLICK')::int as clicks
      from nav_events where ${win} and event_type in ('SEARCH_SUGGEST_SHOWN','SEARCH_SUGGEST_CLICK')`));
    const zeroTerms = rowsOf(await db.execute(sql`
      select term, count(*)::int as n from nav_events
      where ${win} and event_type='SEARCH_ZERO' and term is not null
      group by term order by n desc limit 100`));
    const finder = rowsOf(await db.execute(sql`
      select term, count(*)::int as n from nav_events
      where ${win} and event_type='BATTERY_FINDER_SUBMIT'
      group by term order by n desc limit 100`));
    const whatsapp = rowsOf(await db.execute(sql`
      select item_key, count(*)::int as n from nav_events
      where ${win} and event_type='WHATSAPP_TAP' group by item_key order by n desc`));
    const minicart = rowsOf(await db.execute(sql`
      select count(*) filter (where event_type='MINICART_OPEN')::int as opens,
             count(*) filter (where event_type='MINICART_CHECKOUT')::int as checkouts
      from nav_events where ${win} and event_type in ('MINICART_OPEN','MINICART_CHECKOUT')`));
    const panels = rowsOf(await db.execute(sql`
      select item_key, segment, count(*)::int as n from nav_events
      where ${win} and event_type='PANEL_OPEN' group by item_key, segment order by n desc`));

    const s = suggest[0] ?? { shown: 0, clicks: 0 };
    const m = minicart[0] ?? { opens: 0, checkouts: 0 };
    return {
      windowDays: days,
      nba: nba.map((r) => ({
        itemKey: String(r.item_key), segment: String(r.segment),
        impressions: Number(r.impressions), clicks: Number(r.clicks), dismisses: Number(r.dismisses),
        ctr: rate(Number(r.clicks), Number(r.impressions)),
        dismissRate: rate(Number(r.dismisses), Number(r.impressions)),
      })),
      searchSuggest: { shown: Number(s.shown), clicks: Number(s.clicks), ctr: rate(Number(s.clicks), Number(s.shown)) },
      zeroResultTerms: zeroTerms.map((r) => ({ term: String(r.term), count: Number(r.n) })),
      batteryFinder: finder.map((r) => ({ model: r.term ? String(r.term) : '(blank)', count: Number(r.n) })),
      whatsappTaps: whatsapp.map((r) => ({ placement: String(r.item_key), count: Number(r.n) })),
      miniCart: { opens: Number(m.opens), checkouts: Number(m.checkouts), rate: rate(Number(m.checkouts), Number(m.opens)) },
      panelOpens: panels.map((r) => ({ category: String(r.item_key), segment: String(r.segment), count: Number(r.n) })),
    };
  }
}
