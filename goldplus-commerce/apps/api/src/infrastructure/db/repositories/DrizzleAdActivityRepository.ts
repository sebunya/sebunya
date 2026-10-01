import { sql } from 'drizzle-orm';
import { db } from '../client';
import type { AdActivityRecord, AdActivityRepository } from '../../../application/ports/AdActivity';
import { outcomeOfIntentState, outcomeOfQueueStatus, type ActivityCount } from '../../../domain/advertising/AdActivity';

/**
 * Read-only activity for one ad platform (2026-10-01), from the two places a
 * delivery is recorded:
 *   - outbox_events, event_type AD_CONVERSION: browsing events (product view,
 *     basket add, checkout, payment step, lead), one row per platform and event;
 *   - measurement.delivery_intent, sink `ad:<platform>:purchase`: paid orders.
 * Days are the shop's (Africa/Kampala). Nothing here returns a payload, a
 * click id or a visitor id: counts, states and stored reasons only.
 */
const rowsOf = (r: unknown): any[] => (Array.isArray(r) ? r : ((r as { rows?: any[] })?.rows ?? []));
const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
const TZ = 'Africa/Kampala';
// The queue's payload is a JSON object, but rows written through some paths are
// a JSON string holding that object (production double-encodes); read both.
const PAYLOAD = sql`(case when jsonb_typeof(o.payload) = 'string' then (o.payload #>> '{}')::jsonb else o.payload end)`;
// The window's first instant, as a timestamp: comparable to the stored column directly (an index can serve it).
const startOf = (sinceDay: string) => sql`(${sinceDay}::date::timestamp at time zone ${TZ})`;
const COLUMNS = { twclid: sql`twclid`, gclid: sql`gclid`, ttclid: sql`ttclid`, fbc: sql`fbc`, epik: sql`epik`, li_fat_id: sql`li_fat_id` } as const;

export class DrizzleAdActivityRepository implements AdActivityRepository {
  async today(): Promise<string> {
    return String(rowsOf(await db.execute(sql`select to_char((now() at time zone ${TZ})::date, 'YYYY-MM-DD') as d`))[0].d);
  }

  async counts(platform: string, sinceDay: string): Promise<ActivityCount[]> {
    const browse = rowsOf(await db.execute(sql`
      select to_char((o.created_at at time zone ${TZ})::date, 'YYYY-MM-DD') as day, ${PAYLOAD} #>> '{event,event_name}' as event,
             o.status, left(o.last_error, 300) as reason, count(*)::int as n, max(coalesce(o.processed_at, o.created_at)) as last_at
      from outbox_events o
      where o.event_type = 'AD_CONVERSION' and ${PAYLOAD} ->> 'platform' = ${platform}
        and o.created_at >= ${startOf(sinceDay)}
      group by 1, 2, 3, 4`));
    const order = rowsOf(await db.execute(sql`
      select to_char((d.created_at at time zone ${TZ})::date, 'YYYY-MM-DD') as day, d.state, d.state_reason as reason,
             count(*)::int as n, max(coalesce(d.accepted_at, d.updated_at, d.created_at)) as last_at
      from measurement.delivery_intent d
      where d.sink_key = ${`ad:${platform}:purchase`} and d.created_at >= ${startOf(sinceDay)}
      group by 1, 2, 3`));
    return [
      ...browse.map((r) => ({ day: String(r.day), event: String(r.event ?? 'unknown'), outcome: outcomeOfQueueStatus(r.status), reason: r.reason ?? null, n: Number(r.n), lastAt: iso(r.last_at) })),
      ...order.map((r) => ({ day: String(r.day), event: 'purchase', outcome: outcomeOfIntentState(r.state), reason: r.reason ?? null, n: Number(r.n), lastAt: iso(r.last_at) })),
    ];
  }

  async recent(platform: string, sinceDay: string, limit: number, includeOutOfScope: boolean): Promise<AdActivityRecord[]> {
    const lim = Math.max(1, Math.min(200, Math.floor(limit)));
    // Kept in step with isOutOfScope(): the one reason that means "never this platform's to count".
    const inScopeQueue = includeOutOfScope ? sql`true` : sql`o.last_error is distinct from 'NO_X_CLICK'`;
    const inScopeIntent = includeOutOfScope ? sql`true` : sql`d.state_reason is distinct from 'NO_X_CLICK'`;
    const browse = rowsOf(await db.execute(sql`
      select coalesce(o.processed_at, o.created_at) as at, ${PAYLOAD} #>> '{event,event_name}' as event, o.status, left(o.last_error, 300) as reason,
             o.attempt_count, ${PAYLOAD} #>> '{event,ecommerce,value}' as value, ${PAYLOAD} #>> '{event,ecommerce,currency}' as currency
      from outbox_events o
      where o.event_type = 'AD_CONVERSION' and ${PAYLOAD} ->> 'platform' = ${platform}
        and o.created_at >= ${startOf(sinceDay)} and ${inScopeQueue}
      order by coalesce(o.processed_at, o.created_at) desc limit ${lim}`));
    const order = rowsOf(await db.execute(sql`
      select coalesce(d.accepted_at, d.updated_at, d.created_at) as at, d.state, d.state_reason as reason, d.attempt_count
      from measurement.delivery_intent d
      where d.sink_key = ${`ad:${platform}:purchase`} and d.created_at >= ${startOf(sinceDay)} and ${inScopeIntent}
      order by coalesce(d.accepted_at, d.updated_at, d.created_at) desc limit ${lim}`));
    const num = (v: unknown) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
    return [
      ...browse.map((r): AdActivityRecord => ({ at: iso(r.at)!, event: String(r.event ?? 'unknown'), path: 'browse', outcome: outcomeOfQueueStatus(r.status), reason: r.reason ?? null,
        attempts: Number(r.attempt_count ?? 0), value: num(r.value), currency: r.currency ?? null })),
      ...order.map((r): AdActivityRecord => ({ at: iso(r.at)!, event: 'purchase', path: 'order', outcome: outcomeOfIntentState(r.state), reason: r.reason ?? null,
        attempts: Number(r.attempt_count ?? 0), value: null, currency: null })),
    ].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)).slice(0, lim);
  }

  async arrivals(clickParam: string, sinceDay: string): Promise<Array<{ day: string; n: number }>> {
    return rowsOf(await db.execute(sql`
      select to_char((occurred_at at time zone ${TZ})::date, 'YYYY-MM-DD') as day, count(*)::int as n
      from measurement.touchpoint
      where traffic_class = 'customer' and ${clickParam} = any(click_id_types)
        and occurred_at >= ${startOf(sinceDay)}
      group by 1 order by 1`)).map((r) => ({ day: String(r.day), n: Number(r.n) }));
  }

  async recognised(column: keyof typeof COLUMNS, sinceDay: string): Promise<number> {
    const col = COLUMNS[column];
    if (!col) return 0;
    return Number(rowsOf(await db.execute(sql`
      select count(*)::int as n from first_party_identities
      where ${col} is not null and ${col} <> '' and updated_at >= ${startOf(sinceDay)}`))[0]?.n ?? 0);
  }
}
