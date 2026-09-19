import { sql } from 'drizzle-orm';
import { db } from '../client';
import { pgJsonb, pgUuidArray } from '../PgParams';
import type { AttemptRow, DeliveryRow, DeliveryState, DeliverySummary, MeasurementOperationsRepository } from '../../../application/ports/MeasurementOperations';

const rows = (r: unknown): any[] => (Array.isArray(r) ? r : ((r as { rows?: any[] })?.rows ?? []));
const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
const mapRow = (r: any): DeliveryRow => ({
  deliveryId: String(r.delivery_id), eventId: String(r.event_id), eventName: String(r.event_name), orderNumber: r.order_number ?? null,
  sink: String(r.sink_key), state: r.state as DeliveryState, reason: r.state_reason ?? null, attempts: Number(r.attempt_count ?? 0), replayCount: Number(r.replay_count ?? 0),
  createdAt: iso(r.created_at) as string, updatedAt: iso(r.updated_at) as string, nextAttemptAt: iso(r.next_attempt_at) as string,
  acceptedAt: iso(r.accepted_at), occurredAt: iso(r.occurred_at) as string,
});
const SELECT = sql`select i.*, e.event_name, e.occurred_at, e.payload->>'orderNumber' as order_number
  from measurement.delivery_intent i join measurement.business_event e using (event_id)`;

export class DrizzleMeasurementOperationsRepository implements MeasurementOperationsRepository {
  async summary(): Promise<DeliverySummary> {
    const [states, sinks, due, unrouted, wf, conf, kill, ev] = await Promise.all([
      db.execute(sql`select state, count(*)::int n from measurement.delivery_intent group by state`),
      db.execute(sql`select sink_key, state, count(*)::int n from measurement.delivery_intent group by sink_key, state order by sink_key, state`),
      db.execute(sql`select extract(epoch from (now() - min(next_attempt_at)))/60 m from measurement.delivery_intent where state in ('PENDING','RETRY_WAIT') and next_attempt_at <= now()`),
      db.execute(sql`select count(*)::int n from measurement.event_routing where state <> 'ROUTED'`),
      db.execute(sql`select count(*)::int n from measurement.write_failure where resolved_at is null`),
      db.execute(sql`select count(*)::int n from measurement.event_conflict`),
      db.execute(sql`select value, reason, updated_at from measurement.control where key = 'kill_switch'`),
      db.execute(sql`select count(*)::int total, count(*) filter (where recorded_at > now() - interval '24 hours')::int d from measurement.business_event`),
    ]);
    const k = rows(kill)[0];
    const m = rows(due)[0]?.m;
    return {
      byState: Object.fromEntries(rows(states).map((r) => [r.state, r.n])),
      bySink: rows(sinks).map((r) => ({ sink: r.sink_key, state: r.state, n: r.n })),
      oldestDueMinutes: m == null ? null : Math.round(Number(m)),
      unroutedEvents: rows(unrouted)[0]?.n ?? 0, writeFailures: rows(wf)[0]?.n ?? 0, eventConflicts: rows(conf)[0]?.n ?? 0,
      killSwitch: { on: k?.value === true || k?.value?.on === true, reason: k?.reason ?? null, updatedAt: iso(k?.updated_at) },
      events: { total: rows(ev)[0]?.total ?? 0, last24h: rows(ev)[0]?.d ?? 0 },
    };
  }
  async list(f: { states?: DeliveryState[]; sink?: string; limit: number; before?: string }) {
    const r = rows(await db.execute(sql`${SELECT}
      where ${f.states ? sql`i.state in (select jsonb_array_elements_text(${pgJsonb(f.states)}))` : sql`true`}
        and ${f.sink ? sql`i.sink_key = ${f.sink}` : sql`true`}
        and ${f.before ? sql`i.created_at < ${f.before}::timestamptz` : sql`true`}
      order by i.created_at desc limit ${f.limit}`));
    return r.map(mapRow);
  }
  async get(id: string) {
    const r = rows(await db.execute(sql`${SELECT} where i.delivery_id = ${id}::uuid`))[0];
    if (!r) return null;
    const att = rows(await db.execute(sql`select attempt_no, started_at, finished_at, outcome, http_status, provider_code from measurement.delivery_attempt
      where delivery_id = ${id}::uuid order by attempt_no`)).map((a): AttemptRow => ({ attemptNo: a.attempt_no, startedAt: iso(a.started_at) as string,
      finishedAt: iso(a.finished_at), outcome: a.outcome, httpStatus: a.http_status ?? null, providerCode: a.provider_code ?? null }));
    const p = r.payload ?? {};
    // Safe event view: amounts, identifiers and line summaries — no customer contact.
    const event = { eventName: r.event_name, occurredAt: iso(r.occurred_at), orderNumber: p.orderNumber ?? null, netMerchandiseUGX: p.netMerchandiseUGX ?? null,
      collectedDeliveryUGX: p.collectedDeliveryUGX ?? null, amountUGX: p.amountUGX ?? null, confirmationBasis: p.confirmationBasis ?? null,
      items: Array.isArray(p.items) ? p.items.map((l: any) => ({ sku: l.sku, quantity: l.quantity, netLineUGX: l.netLineUGX })) : undefined };
    return { ...mapRow(r), attemptsList: att, event };
  }
  async getMany(ids: string[]) {
    return rows(await db.execute(sql`${SELECT} where i.delivery_id = any(${pgUuidArray(ids)})`)).map(mapRow);
  }
  async replay(ids: string[]) {
    const r = rows(await db.execute(sql`update measurement.delivery_intent set state = 'RETRY_WAIT', state_reason = 'OPERATOR_REPLAY', next_attempt_at = now(), next_enqueue_at = now(),
      replay_count = replay_count + 1, attempts_at_replay = attempt_count, replayed_at = now(), updated_at = now()
      where delivery_id = any(${pgUuidArray(ids)}) and state in ('DEAD_LETTER','QUARANTINED','UNKNOWN_OUTCOME','SUPPRESSED') returning delivery_id`));
    return r.length;
  }
  async setState(ids: string[], from: readonly DeliveryState[], to: 'QUARANTINED' | 'CANCELLED', reason: string) {
    const r = rows(await db.execute(sql`update measurement.delivery_intent set state = ${to}, state_reason = ${reason}, updated_at = now()
      where delivery_id = any(${pgUuidArray(ids)}) and state in (select jsonb_array_elements_text(${pgJsonb([...from])})) returning delivery_id`));
    return r.length;
  }
  async setKillSwitch(on: boolean, reason: string, actorId: string | null) {
    const UUIDRE = /^[0-9a-f-]{36}$/i;
    await db.execute(sql`insert into measurement.control (key, value, reason, updated_by, updated_at)
      values ('kill_switch', ${pgJsonb(on)}, ${reason}, ${actorId && UUIDRE.test(actorId) ? sql`${actorId}::uuid` : sql`null`}, now())
      on conflict (key) do update set value = excluded.value, reason = excluded.reason, updated_by = excluded.updated_by, updated_at = now()`);
  }
}
