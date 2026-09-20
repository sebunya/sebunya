import { randomUUID } from 'crypto';
import os from 'os';
import { sql } from 'drizzle-orm';
import { db } from '../db/client';
import { pgJsonb } from '../db/PgParams';
import { logger } from '../logging/logger';
import { environmentOf } from '../../domain/measurement/BusinessEvents';
import { collapseConsecutive as collapse, RULE_METHODS, DEFAULT_RULE_POLICY, allocateInteger, ruleWeights, markovRemovalEffects, exactShapley, SHAPLEY_EXACT_LIMIT, type Journey, type Touch } from '../../domain/measurement/Attribution';
import type { AttributionPort, AttributionRunView, BatchRunView } from '../../application/ports/MeasurementOperations';

/**
 * Attribution batch (dossier §9, addendum 17 §2/§6). Single host: one bounded
 * analytics job at a time under measurement.analytics_lease, admitted only when
 * the host has headroom, otherwise DEFERRED_RESOURCE (never a queue pile-up).
 * Inputs are frozen per run: touchpoints (0141) + confirmed orders (0140
 * business_event) joined on the server-set visitor id (order_attribution.fp_client_id).
 */
const rows = (r: unknown): any[] => (Array.isArray(r) ? r : ((r as { rows?: any[] })?.rows ?? []));
const JOB = 'attribution';
const LOOKBACK_DAYS = 30;           // touches counted before an order
const ORDER_WINDOW_DAYS = 90;       // orders in scope
const MATURE_DAYS = 7;              // non-converting journeys must be quiet this long
const MAX_JOURNEYS = 50_000;        // bounded input; above it the run is refused, not truncated silently
const MIN_MARKOV_CONVERSIONS = 30;  // below this a chain is noise (ATTR-04)
const METHOD_VERSION = 'v1';
const RECEIPT_RETENTION_DAYS = 14;  // a browser retry never spans this

function admission(): { ok: boolean; reason: string | null; resources: Record<string, number> } {
  const cpus = os.cpus().length || 1;
  const load = os.loadavg()[0] / cpus;
  const freeMb = Math.round(os.freemem() / 1048576);
  const resources = { load1PerCpu: Math.round(load * 100) / 100, freeMemMb: freeMb, cpus };
  if (load > 0.7) return { ok: false, reason: 'CPU_BUSY', resources };
  if (freeMb < 400) return { ok: false, reason: 'MEMORY_LOW', resources };
  return { ok: true, reason: null, resources };
}

async function acquireLease(holder: string, minutes: number): Promise<boolean> {
  const r = rows(await db.execute(sql`insert into measurement.analytics_lease (name, holder, lease_until) values ('analytics', ${holder}, now() + make_interval(mins => ${minutes}))
    on conflict (name) do update set holder = excluded.holder, lease_until = excluded.lease_until where measurement.analytics_lease.lease_until < now() returning holder`));
  return r.length > 0;
}
const releaseLease = (holder: string) => db.execute(sql`update measurement.analytics_lease set lease_until = now() where name = 'analytics' and holder = ${holder}`);

interface OrderIn { orderId: string; visitor: string | null; at: Date; valueUGX: bigint }

async function loadInputs(env: string) {
  const orders: OrderIn[] = rows(await db.execute(sql`
    select e.aggregate_id as order_id, oa.fp_client_id as visitor, e.occurred_at, e.payload->>'netMerchandiseUGX' as value
    from measurement.business_event e left join order_attribution oa on oa.order_id::text = e.aggregate_id
    where e.environment = ${env} and e.event_name = 'order_confirmed' and e.occurred_at > now() - make_interval(days => ${ORDER_WINDOW_DAYS})
    order by e.occurred_at`)).map((r) => ({ orderId: String(r.order_id), visitor: r.visitor ? String(r.visitor) : null, at: new Date(r.occurred_at), valueUGX: BigInt(r.value ?? '0') }));
  const touches = rows(await db.execute(sql`
    select anonymous_id, channel, occurred_at from measurement.touchpoint
    where environment = ${env} and traffic_class = 'customer' and occurred_at > now() - make_interval(days => ${ORDER_WINDOW_DAYS + LOOKBACK_DAYS})
    order by anonymous_id, occurred_at, touch_id limit ${MAX_JOURNEYS * 20 + 1}`));
  const byVisitor = new Map<string, Touch[]>();
  for (const t of touches) {
    const k = String(t.anonymous_id);
    if (!byVisitor.has(k)) byVisitor.set(k, []);
    byVisitor.get(k)!.push({ channel: String(t.channel), at: new Date(t.occurred_at) });
  }
  return { orders, byVisitor, touchRowsCapped: touches.length > MAX_JOURNEYS * 20 };
}

async function insertRun(method: string, status: string, policy: object, counts: { input: number; covered: number; journeys: number }, diagnostics: object) {
  const id = randomUUID();
  await db.execute(sql`insert into measurement.attribution_run (run_id, method, method_version, policy, status, input_orders, covered_orders, input_journeys, diagnostics, finished_at)
    values (${id}::uuid, ${method}, ${METHOD_VERSION}, ${pgJsonb(policy)}, ${status}, ${counts.input}, ${counts.covered}, ${counts.journeys}, ${pgJsonb(diagnostics)}, now())`);
  return id;
}

async function compute(env: string, batchStats: Record<string, unknown>) {
  const { orders, byVisitor, touchRowsCapped } = await loadInputs(env);
  if (touchRowsCapped) {
    for (const m of [...RULE_METHODS, 'markov', 'shapley']) await insertRun(m, 'DATA_INVALID', {}, { input: orders.length, covered: 0, journeys: 0 }, { reason: 'INPUT_EXCEEDS_BOUND', maxJourneys: MAX_JOURNEYS });
    return;
  }
  const lookbackMs = LOOKBACK_DAYS * 86_400_000;
    // Two tabs opened from the same place are one arrival, not two.
  const journeysFor = (o: OrderIn) => (o.visitor ? collapse((byVisitor.get(o.visitor) ?? []).filter((t) => t.at <= o.at && o.at.getTime() - t.at.getTime() <= lookbackMs)) : []);
  const unidentified = orders.filter((o) => !o.visitor).length;
  batchStats.orders = orders.length; batchStats.visitors = byVisitor.size;

  // Rule-based: one run per method; an order without a touch is UNATTRIBUTED, never spread.
  for (const method of RULE_METHODS) {
    const perChannel = new Map<string, bigint>();
    const results: Array<[string, string, number, bigint]> = [];
    let covered = 0; let unattributedUGX = 0n;
    for (const o of orders) {
      const w = ruleWeights(method, journeysFor(o), o.at, DEFAULT_RULE_POLICY);
      if (!w) { unattributedUGX += o.valueUGX; continue; }
      covered++;
      const alloc = allocateInteger(o.valueUGX, w);
      for (const [ch, v] of Object.entries(alloc)) { results.push([o.orderId, ch, w[ch], v]); perChannel.set(ch, (perChannel.get(ch) ?? 0n) + v); }
    }
    const status = !orders.length ? 'INSUFFICIENT_DATA' : covered === 0 ? 'NOT_IDENTIFIABLE' : 'COMPLETE';
    const runId = await insertRun(method, status, { ...DEFAULT_RULE_POLICY, lookbackDays: LOOKBACK_DAYS, orderWindowDays: ORDER_WINDOW_DAYS, collapseConsecutiveChannels: true },
      { input: orders.length, covered, journeys: covered }, { unattributedUGX: unattributedUGX.toString(), unidentifiedOrders: unidentified, observational: true });
    // One statement per 500 rows: a run must not become thousands of round trips
    // while it holds the single analytics lease.
    for (let i = 0; i < results.length; i += 500) {
      const chunk = results.slice(i, i + 500);
      await db.execute(sql`insert into measurement.attribution_result (run_id, order_id, channel, weight, allocated_ugx)
        select ${runId}::uuid, x->>0, x->>1, (x->>2)::numeric, (x->>3)::bigint
        from jsonb_array_elements(${pgJsonb(chunk.map(([o, ch, w, v]) => [o, ch, String(w), v.toString()]))}) as x`);
    }
    for (const [ch, v] of perChannel) await db.execute(sql`insert into measurement.attribution_channel (run_id, channel, value, detail) values (${runId}::uuid, ${ch}, ${v.toString()}, ${pgJsonb({ unit: 'UGX' })})`);
  }

  // Markov / Shapley: converting journeys + MATURE non-converting ones.
  const convertedVisitors = new Set(orders.map((o) => o.visitor).filter(Boolean) as string[]);
  const journeys: Journey[] = orders.map((o) => journeysFor(o)).filter((t) => t.length).map((t) => ({ path: t.map((x) => x.channel), converted: true }));
  const matureCut = Date.now() - MATURE_DAYS * 86_400_000;
  let censored = 0;
  for (const [v, ts] of byVisitor) {
    if (convertedVisitors.has(v)) continue;
    if (ts[ts.length - 1].at.getTime() > matureCut) { censored++; continue; }
    journeys.push({ path: collapse(ts).slice(-20).map((x) => x.channel), converted: false });
  }
  const conversions = journeys.filter((j) => j.converted).length;
  const nonConv = journeys.length - conversions;
  const diag = { conversions, nonConversions: nonConv, rightCensored: censored, removal: 'redirect_to_null', label: 'Observed Journey Contribution', observational: true };
  const policy = { lookbackDays: LOOKBACK_DAYS, matureDays: MATURE_DAYS, minConversions: MIN_MARKOV_CONVERSIONS, collapseConsecutiveChannels: true };
  if (conversions < MIN_MARKOV_CONVERSIONS || nonConv === 0) {
    for (const m of ['markov', 'shapley']) await insertRun(m, 'INSUFFICIENT_DATA', policy, { input: orders.length, covered: conversions, journeys: journeys.length }, { ...diag, reason: `needs ${MIN_MARKOV_CONVERSIONS}+ identified conversions and some mature non-converting journeys` });
    return;
  }
  try {
    const mk = markovRemovalEffects(journeys);
    const runId = await insertRun('markov', 'COMPLETE', policy, { input: orders.length, covered: conversions, journeys: journeys.length }, { ...diag, pFull: mk.full });
    for (const [ch, eff] of Object.entries(mk.effects)) await db.execute(sql`insert into measurement.attribution_channel (run_id, channel, value, detail) values (${runId}::uuid, ${ch}, ${eff}, ${pgJsonb({ unit: 'raw_removal_effect' })})`);
  } catch (err) {
    await insertRun('markov', 'NOT_IDENTIFIABLE', policy, { input: orders.length, covered: conversions, journeys: journeys.length }, { ...diag, reason: String((err as Error).message) });
  }
  // Shapley players: the top channels by journey count; the rest grouped as other_grouped.
  const freq = new Map<string, number>();
  journeys.forEach((j) => new Set(j.path).forEach((c) => freq.set(c, (freq.get(c) ?? 0) + 1)));
  const top = new Set([...freq.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, SHAPLEY_EXACT_LIMIT - 1).map(([c]) => c));
  const grouped = freq.size > SHAPLEY_EXACT_LIMIT ? journeys.map((j) => ({ ...j, path: j.path.map((c) => (top.has(c) ? c : 'other_grouped')) })) : journeys;
  try {
    const sh = exactShapley(grouped);
    const runId = await insertRun('shapley', 'COMPLETE', { ...policy, players: SHAPLEY_EXACT_LIMIT, value: 'markov_start_to_conversion' }, { input: orders.length, covered: conversions, journeys: journeys.length }, { ...diag, baseline: sh.baseline, full: sh.full });
    for (const [ch, phi] of Object.entries(sh.shapley)) await db.execute(sql`insert into measurement.attribution_channel (run_id, channel, value, detail) values (${runId}::uuid, ${ch}, ${phi}, ${pgJsonb({ unit: 'probability_share' })})`);
  } catch (err) {
    await insertRun('shapley', 'NOT_IDENTIFIABLE', policy, { input: orders.length, covered: conversions, journeys: journeys.length }, { ...diag, reason: String((err as Error).message) });
  }
}

export async function runAttributionBatch(trigger: string): Promise<{ state: string; reason: string | null; batchRunId: string }> {
  const batchRunId = randomUUID();
  const adm = admission();
  const record = (state: string, reason: string | null, stats: object) => db.execute(sql`insert into measurement.batch_run (run_id, job, state, reason, resources, stats, finished_at)
    values (${batchRunId}::uuid, ${JOB}, ${state}, ${reason}, ${pgJsonb(adm.resources)}, ${pgJsonb({ trigger, ...stats })}, now())
    on conflict (run_id) do update set state = excluded.state, reason = excluded.reason, stats = excluded.stats, finished_at = now()`);
  if (!adm.ok) { await record('DEFERRED_RESOURCE', adm.reason, {}); return { state: 'DEFERRED_RESOURCE', reason: adm.reason, batchRunId }; }
  if (!(await acquireLease(batchRunId, 15))) { await record('DEFERRED_RESOURCE', 'LEASE_HELD', {}); return { state: 'DEFERRED_RESOURCE', reason: 'LEASE_HELD', batchRunId }; }
  const stats: Record<string, unknown> = {};
  const t0 = Date.now();
  try {
    await db.execute(sql`insert into measurement.batch_run (run_id, job, state, resources, stats) values (${batchRunId}::uuid, ${JOB}, 'RUNNING', ${pgJsonb(adm.resources)}, ${pgJsonb({ trigger })})`);
    await compute(environmentOf(process.env.NODE_ENV), stats);
    // A receipt exists to answer a client's retry, not to be kept for ever.
    // Touchpoints are evidence and are never pruned here.
    const pruned = rows(await db.execute(sql`delete from measurement.collector_batch where received_at < now() - make_interval(days => ${RECEIPT_RETENTION_DAYS}) returning batch_id`));
    stats.receiptsPruned = pruned.length;
    stats.ms = Date.now() - t0;
    await record('COMPLETE', null, stats);
    return { state: 'COMPLETE', reason: null, batchRunId };
  } catch (err) {
    logger.error({ err }, '[Attribution] batch failed');
    await record('FAILED', String((err as Error).message).slice(0, 300), stats);
    return { state: 'FAILED', reason: 'see batch_run', batchRunId };
  } finally { await releaseLease(batchRunId); }
}

/** Nightly window 23:00–03:00 UTC (02:00–06:00 Kampala), once per 20h; deferrals retry next tick. */
export async function maybeRunScheduledAttribution(): Promise<void> {
  const h = new Date().getUTCHours();
  if (!(h >= 23 || h < 3)) return;
  const recent = rows(await db.execute(sql`select 1 from measurement.batch_run where job = ${JOB} and state in ('COMPLETE','RUNNING') and started_at > now() - interval '20 hours' limit 1`));
  if (recent.length) return;
  const lastDeferred = rows(await db.execute(sql`select 1 from measurement.batch_run where job = ${JOB} and state = 'DEFERRED_RESOURCE' and started_at > now() - interval '15 minutes' limit 1`));
  if (lastDeferred.length) return;
  const r = await runAttributionBatch('schedule');
  logger.info(r, '[Attribution] scheduled batch');
}

export class PgAttributionPort implements AttributionPort {
  async latest() {
    const runs = rows(await db.execute(sql`select distinct on (method) run_id, method, status, input_orders, covered_orders, input_journeys, started_at, finished_at, diagnostics
      from measurement.attribution_run order by method, started_at desc`));
    const out: AttributionRunView[] = [];
    for (const r of runs) {
      const ch = rows(await db.execute(sql`select channel, value, detail from measurement.attribution_channel where run_id = ${r.run_id}::uuid order by value desc`));
      out.push({ runId: r.run_id, method: r.method, status: r.status, inputOrders: r.input_orders, coveredOrders: r.covered_orders, inputJourneys: r.input_journeys,
        startedAt: new Date(r.started_at).toISOString(), finishedAt: r.finished_at ? new Date(r.finished_at).toISOString() : null, diagnostics: r.diagnostics ?? {},
        channels: ch.map((c) => ({ channel: c.channel, value: Number(c.value), detail: c.detail ?? {} })) });
    }
    const batches: BatchRunView[] = rows(await db.execute(sql`select run_id, job, state, reason, started_at, finished_at, stats from measurement.batch_run where job = ${JOB} order by started_at desc limit 10`))
      .map((b) => ({ runId: b.run_id, job: b.job, state: b.state, reason: b.reason, startedAt: new Date(b.started_at).toISOString(), finishedAt: b.finished_at ? new Date(b.finished_at).toISOString() : null, stats: b.stats ?? {} }));
    // Why a number is zero matters as much as the number: measurement records
    // sales only from the day it started, so an empty model is not a broken one.
    const cov = rows(await db.execute(sql`select count(*)::int n, min(recorded_at) first_at,
      count(*) filter (where event_name = 'order_confirmed' and occurred_at > now() - make_interval(days => ${ORDER_WINDOW_DAYS}))::int confirmed
      from measurement.business_event where environment = ${environmentOf(process.env.NODE_ENV)}`))[0];
    return { runs: out, batches, coverage: { businessEvents: cov?.n ?? 0, firstEventAt: cov?.first_at ? new Date(cov.first_at).toISOString() : null, confirmedOrders90d: cov?.confirmed ?? 0 } };
  }
  runNow(trigger: string) { return runAttributionBatch(trigger); }
}
