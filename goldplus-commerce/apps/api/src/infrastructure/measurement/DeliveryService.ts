import { createHash, randomUUID } from 'crypto';
import { sql } from 'drizzle-orm';
import type { CanonicalTelemetryEvent } from '@goldplus/shared';
import { db } from '../db/client';
import { env } from '../../config/env';
import { logger } from '../logging/logger';
import { environmentOf } from '../../domain/measurement/BusinessEvents';
import { ga4CollectHit } from '../telemetry/Ga4CollectHit';
import { adPlatform, buildAdRequest, hashEmail, hashEmailGoogle, hashPhone, hashPhonePlus } from '../advertising/AdPlatforms';
import { DrizzleAdDestinationRepository } from '../db/repositories/DrizzleAdDestinationRepository';
import { IntegrationCredentialVault } from '../seo/IntegrationCredentialVault';
import { advertisingRefused } from './AdvertisingConsentGate';

/**
 * Durable delivery of authoritative commerce events (dossier §4.4, §5; GP-DLV).
 *
 *   business_event ─router→ delivery_intent (one per sink) ─scheduler→ BullMQ job
 *   `gp-<delivery>-g<generation>` ─worker→ lease → gates → STARTED attempt →
 *   one network request → finalise under the lease.
 *
 * PostgreSQL is the source of truth; the queue only carries {deliveryId,
 * generation}. A Redis wipe loses nothing: the sweep re-enqueues due intents.
 * A request that may have reached the provider is never silently renamed
 * success or failure: it is UNKNOWN_OUTCOME until provider dedupe makes a
 * retry safe (same provider_event_id) or an operator resolves it.
 */
const rows = (r: unknown): any[] => (Array.isArray(r) ? r : ((r as { rows?: any[] })?.rows ?? []));
const ENV = () => environmentOf(process.env.NODE_ENV);
export const DELIVERY_QUEUE = 'measurement-delivery';
export const ADAPTER_VERSION = 'delivery-v1';
const LEASE = '60 seconds';
const ROUTE_BATCH = 50;
const MAX_ATTEMPTS = 8;
const HORIZON_MS = 24 * 3600_000;
/** Ad platforms reject website events older than ~7 days (Meta); GA4 hits are near-real-time. */
const MAX_EVENT_AGE_MS = 7 * 24 * 3600_000;
const adRepo = new DrizzleAdDestinationRepository();

export type SinkKey = `ga4:${'purchase' | 'refund'}` | `ad:${string}:purchase`;

/** Sinks whose provider dedupes on our provider_event_id, so a retry after an unknown outcome is safe. */
export function retryIsSafeAfterUnknown(sink: string): boolean {
  // GA4 dedupes PURCHASES on transaction_id; it does not dedupe refunds, so a
  // refund whose outcome is unknown goes to an operator, not a blind re-send
  // that could count it twice.
  if (sink === 'ga4:refund') return false;
  if (sink.startsWith('ga4:')) return true;
  const p = sink.split(':')[1];
  return ['meta', 'tiktok', 'pinterest', 'snapchat', 'microsoft_ads', 'google_ads', 'x'].includes(p);
}

/** Backoff with jitter; honours Retry-After (seconds or HTTP date). */
export function nextAttemptDelayMs(attempt: number, retryAfter: string | null, rand = Math.random()): number {
  let ra = 0;
  if (retryAfter) {
    const s = Number(retryAfter);
    ra = Number.isFinite(s) ? s * 1000 : Math.max(0, Date.parse(retryAfter) - Date.now());
    if (!Number.isFinite(ra)) ra = 0;
  }
  const base = Math.min(6 * 3600_000, 30_000 * 2 ** Math.min(attempt - 1, 20));
  return Math.max(ra, Math.floor(base * (0.8 + 0.4 * rand)));
}

/** Provider response → state (dossier §5.1, §5.4). */
export function classifyResponse(status: number | null, replyError: string | null, networkError: 'before-send' | 'after-send' | null) {
  if (networkError === 'before-send') return { kind: 'retry' as const, code: 'NETWORK_BEFORE_SEND' };
  if (networkError === 'after-send') return { kind: 'unknown' as const, code: 'TIMEOUT_AFTER_SEND' };
  if (status == null) return { kind: 'unknown' as const, code: 'NO_STATUS' };
  if (status >= 200 && status < 300) return replyError ? { kind: 'permanent' as const, code: 'SEMANTIC_FAILURE' } : { kind: 'accepted' as const, code: 'OK' };
  if (status === 401 || status === 403) return { kind: 'permanent' as const, code: 'CREDENTIALS' };
  if (status === 429) return { kind: 'retry' as const, code: 'RATE_LIMITED' };
  if (status >= 500) return { kind: 'retry' as const, code: `HTTP_${status}` };
  return { kind: 'permanent' as const, code: `HTTP_${status}` };
}

// ─── Router ──────────────────────────────────────────────────────────────────

const GA4_PURCHASE_REACHED = ['ACCEPTED', 'PROCESSED'];

/**
 * GA4 hears ONE net refund per order, whichever order the events route in.
 *
 * Money refunds are carried by their own refund_confirmed events, each with
 * its own amount. A cancellation refunds the whole order in GA4 only when no
 * money refund exists for the order: the settle step writes refund_confirmed
 * BEFORE the reversal cancels the order, so the cancellation used to add the
 * full order value on top of every refund row already sent (a 200k order
 * refunded 50k + 50k + 100k reached GA4 as 400k).
 */
export function cancellationCarriesGa4Refund(purchaseState: string | null | undefined, orderHasRefundConfirmed: boolean): boolean {
  return !!purchaseState && GA4_PURCHASE_REACHED.includes(purchaseState) && !orderHasRefundConfirmed;
}

/** A money refund reaches GA4 when its purchase did, unless a cancellation already refunded the whole order there. */
export function refundCarriesGa4Refund(purchaseState: string | null | undefined, cancellationRefundedInGa4: boolean): boolean {
  return !!purchaseState && GA4_PURCHASE_REACHED.includes(purchaseState) && !cancellationRefundedInGa4;
}

/**
 * The GA4 purchase may still reach (or may already have reached) GA4: its send
 * is in progress, its outcome is unknown, or it is waiting to retry after an
 * attempt. A cancellation routed now would cancel it or miss the refund, and
 * the router never looks at the event again, so routing waits for it to settle.
 */
export function ga4PurchaseInFlight(intent: { state?: string | null; attempt_count?: number | string | null } | null | undefined): boolean {
  if (!intent?.state) return false;
  if (intent.state === 'LEASED' || intent.state === 'UNKNOWN_OUTCOME') return true;
  return intent.state === 'RETRY_WAIT' && Number(intent.attempt_count ?? 0) > 0;
}

/**
 * A cancellation's GA4 refund carries the ORDER's value. The order_cancelled
 * payload is a status change (no money fields), so its refund used to go out
 * with value 0 and every cancelled sale stayed in GA4 revenue. The value comes
 * from the confirmation; the event id, time and transaction id stay the
 * cancellation's. Null when there is no confirmation to take it from.
 */
export function cancellationRefundEvent<T extends { payload: any }>(cancellation: T, confirmedPayload: Record<string, unknown> | null | undefined): T | null {
  if (!confirmedPayload || typeof confirmedPayload !== 'object') return null;
  return { ...cancellation, payload: { ...confirmedPayload, ...(cancellation.payload ?? {}) } };
}

export async function routeBusinessEvents(): Promise<{ routed: number; intents: number }> {
  const token = randomUUID();
  const claimed = rows(await db.execute(sql`
    update measurement.event_routing set state = 'LEASED', lease_token = ${token}::uuid, lease_until = now() + interval '60 seconds'
    where event_id in (
      select event_id from measurement.event_routing
      where (state = 'PENDING' and next_attempt_at <= now()) or (state = 'LEASED' and lease_until < now())
      order by next_attempt_at limit ${ROUTE_BATCH} for update skip locked)
    returning event_id`));
  let intents = 0;
  // No catch: a failed read must not route a confirmation with only the GA4
  // sink and mark it ROUTED (its ad conversions would be lost for good). A
  // throw leaves the claimed rows LEASED; they are reclaimed after the lease.
  const live = await adRepo.active();
  for (const { event_id: eventId } of claimed) {
    try {
      intents += await db.transaction(async (tx) => {
        const ev = rows(await tx.execute(sql`select * from measurement.business_event where event_id = ${eventId}::uuid`))[0];
        const sinks: Array<{ sink: string; providerEventId: string }> = [];
        const orderNumber = ev?.payload?.orderNumber as string | undefined;
        if (ev?.event_name === 'order_confirmed') {
          if (env.ga4MeasurementId) sinks.push({ sink: 'ga4:purchase', providerEventId: `purchase:${orderNumber}` });
          for (const p of live) if (adPlatform(p.platform)?.events.purchase) sinks.push({ sink: `ad:${p.platform}:purchase`, providerEventId: String(eventId) });
        }
        if (ev?.event_name === 'order_cancelled') {
          // Withdraw this order's confirmation deliveries that have not gone out;
          // refund GA4 only if its purchase was accepted.
          const conf = rows(await tx.execute(sql`select event_id from measurement.business_event
            where aggregate_type = 'order' and aggregate_id = ${ev.aggregate_id} and event_name = 'order_confirmed' and environment = ${ev.environment}`))[0];
          if (conf) {
            // A purchase mid-send (or maybe sent) is waited for: the catch below
            // puts this event back to PENDING and routing runs again once it settles.
            const purchase = rows(await tx.execute(sql`select state, attempt_count from measurement.delivery_intent where event_id = ${conf.event_id}::uuid and sink_key = 'ga4:purchase'`))[0];
            if (ga4PurchaseInFlight(purchase)) throw new Error('PURCHASE_IN_FLIGHT');
            await tx.execute(sql`update measurement.delivery_intent set state = 'CANCELLED', state_reason = 'ORDER_CANCELLED', updated_at = now()
              where event_id = ${conf.event_id}::uuid and state in ('PENDING','RETRY_WAIT')`);
            const ga = rows(await tx.execute(sql`select state from measurement.delivery_intent where event_id = ${conf.event_id}::uuid and sink_key = 'ga4:purchase'`))[0];
            // The EVENT, not its intent: a refund written moments earlier may not be routed yet.
            const moneyRefunded = rows(await tx.execute(sql`select 1 from measurement.business_event
              where aggregate_type = 'order' and aggregate_id = ${ev.aggregate_id} and event_name = 'refund_confirmed' and environment = ${ev.environment} limit 1`)).length > 0;
            if (cancellationCarriesGa4Refund(ga?.state, moneyRefunded)) sinks.push({ sink: 'ga4:refund', providerEventId: `refund:${orderNumber}` });
          }
        }
        if (ev?.event_name === 'refund_confirmed') {
          // A partial refund to GA4 only when its purchase reached GA4, and
          // never on top of a cancellation that already refunded the order.
          const orderEvents = rows(await tx.execute(sql`select event_id, event_name from measurement.business_event
            where aggregate_type = 'order' and aggregate_id = ${ev.aggregate_id} and environment = ${ev.environment}`));
          const conf = orderEvents.find((e: any) => e.event_name === 'order_confirmed');
          const cancel = orderEvents.find((e: any) => e.event_name === 'order_cancelled');
          const ga = conf ? rows(await tx.execute(sql`select state from measurement.delivery_intent where event_id = ${conf.event_id}::uuid and sink_key = 'ga4:purchase'`))[0] : null;
          const fullRefund = cancel ? rows(await tx.execute(sql`select 1 from measurement.delivery_intent where event_id = ${cancel.event_id}::uuid and sink_key = 'ga4:refund' and state not in ('CANCELLED','SUPPRESSED')`)).length > 0 : false;
          if (refundCarriesGa4Refund(ga?.state, fullRefund)) sinks.push({ sink: 'ga4:refund', providerEventId: `refund:${ev.payload?.refundId}` });
        }
        let n = 0;
        for (const s of sinks) {
          const r = rows(await tx.execute(sql`insert into measurement.delivery_intent (delivery_id, event_id, sink_key, environment, provider_event_id, state)
            values (${randomUUID()}::uuid, ${eventId}::uuid, ${s.sink}, ${ev.environment}, ${s.providerEventId}, 'PENDING')
            on conflict do nothing returning delivery_id`));
          n += r.length;
        }
        await tx.execute(sql`update measurement.event_routing set state = 'ROUTED', routed_at = now(), lease_token = null, lease_until = null, routing_policy_version = 'route-v1'
          where event_id = ${eventId}::uuid and lease_token = ${token}::uuid`);
        return n;
      });
    } catch (err) {
      logger.warn({ eventId, err: (err as Error).message }, '[Delivery] routing failed; will retry');
      await db.execute(sql`update measurement.event_routing set state = 'PENDING', lease_token = null, lease_until = null,
        next_attempt_at = now() + interval '5 minutes', last_error_code = ${String((err as Error).message).slice(0, 120)}
        where event_id = ${eventId}::uuid and lease_token = ${token}::uuid`).catch(() => undefined);
    }
  }
  return { routed: claimed.length, intents };
}

// ─── Scheduler + lease recovery ──────────────────────────────────────────────

/** Expired leases: STARTED-without-finish means the request may have been sent. */
export async function recoverExpiredLeases(): Promise<{ toPending: number; toUnknown: number }> {
  const expired = rows(await db.execute(sql`select delivery_id, lease_token from measurement.delivery_intent where state = 'LEASED' and lease_until < now() limit 200`));
  let toPending = 0, toUnknown = 0;
  for (const e of expired) {
    const started = rows(await db.execute(sql`select 1 from measurement.delivery_attempt where delivery_id = ${e.delivery_id}::uuid and lease_token = ${e.lease_token}::uuid and finished_at is null limit 1`)).length > 0;
    const next = started ? 'UNKNOWN_OUTCOME' : 'PENDING';
    const r = rows(await db.execute(sql`update measurement.delivery_intent set state = ${next}, state_reason = ${started ? 'LEASE_EXPIRED_AFTER_POSSIBLE_SEND' : 'LEASE_EXPIRED_BEFORE_SEND'},
      lease_token = null, lease_until = null, updated_at = now() where delivery_id = ${e.delivery_id}::uuid and state = 'LEASED' and lease_token = ${e.lease_token}::uuid returning delivery_id`));
    if (r.length) { if (started) toUnknown++; else toPending++; }
  }
  // Unknown outcomes on sinks that dedupe our provider_event_id are safe to retry.
  const unknown = rows(await db.execute(sql`select delivery_id, sink_key from measurement.delivery_intent where state = 'UNKNOWN_OUTCOME' limit 200`));
  for (const u of unknown) {
    const next = retryIsSafeAfterUnknown(u.sink_key) ? 'RETRY_WAIT' : 'QUARANTINED';
    await db.execute(sql`update measurement.delivery_intent set state = ${next}, state_reason = ${next === 'RETRY_WAIT' ? 'UNKNOWN_RETRY_SAFE_PROVIDER_DEDUPE' : 'UNKNOWN_NO_SAFE_DEDUPE'},
      next_attempt_at = now() + interval '5 minutes', updated_at = now() where delivery_id = ${u.delivery_id}::uuid and state = 'UNKNOWN_OUTCOME'`);
  }
  return { toPending, toUnknown };
}

/** Due intents get a new enqueue generation and a queue job; returns what it scheduled. */
export async function scheduleDueDeliveries(enqueue: (jobId: string, data: { deliveryId: string; enqueueGeneration: number; schemaVersion: 1 }) => Promise<boolean>): Promise<number> {
  const due = rows(await db.execute(sql`
    update measurement.delivery_intent set enqueue_generation = enqueue_generation + 1, next_enqueue_at = now() + interval '2 minutes', updated_at = now()
    where delivery_id in (select delivery_id from measurement.delivery_intent
      where state in ('PENDING','RETRY_WAIT') and next_attempt_at <= now() and next_enqueue_at <= now()
      order by next_attempt_at limit 100 for update skip locked)
    returning delivery_id, enqueue_generation`));
  let n = 0;
  for (const d of due) {
    const ok = await enqueue(`gp-${d.delivery_id}-g${d.enqueue_generation}`, { deliveryId: String(d.delivery_id), enqueueGeneration: Number(d.enqueue_generation), schemaVersion: 1 }).catch(() => false);
    if (ok) n++;
  }
  return n;
}

// ─── Worker ─────────────────────────────────────────────────────────────────

async function killSwitchOn(): Promise<boolean> {
  const r = rows(await db.execute(sql`select value from measurement.control where key = 'kill_switch'`))[0];
  return r?.value === true || r?.value?.on === true;
}

/** Just-in-time identity: order contact + visitor/click context. Never queued, never logged. */
async function loadIdentity(orderId: string) {
  const o = rows(await db.execute(sql`select user_id, customer_email, customer_phone from orders where id = ${orderId}::uuid`))[0] ?? {};
  const a = rows(await db.execute(sql`select fp_client_id, client_ip, user_agent, ga_session_id, ga_session_number, click_ids from order_attribution where order_id = ${orderId}::uuid`))[0] ?? {};
  const ck: Record<string, string> = (typeof a.click_ids === 'string' ? JSON.parse(a.click_ids) : a.click_ids) ?? {};
  const netParam = ck.clickid ? 'clickid' : ck.click_id ? 'click_id' : undefined;
  return {
    user_id: o.user_id ?? undefined, fp_client_id: a.fp_client_id ?? undefined, ip_address: a.client_ip ?? undefined, user_agent: a.user_agent ?? undefined,
    ga_session_id: a.ga_session_id ?? undefined, ga_session_number: a.ga_session_number ?? undefined,
    hashed_email: hashEmail(o.customer_email), hashed_email_google: hashEmailGoogle(o.customer_email),
    hashed_phone: hashPhone(o.customer_phone), hashed_phone_plus: hashPhonePlus(o.customer_phone),
    gclid: ck.gclid, gbraid: ck.gbraid, wbraid: ck.wbraid, ttclid: ck.ttclid, twclid: ck.twclid, msclkid: ck.msclkid, sccid: ck.ScCid, epik: ck.epik,
    ...(netParam ? { network_click_id: ck[netParam], network_click_param: netParam, network_click_source: ck.src } : {}),
  };
}

/** The business event as the wire event the GA4/ad builders take. */
export function toCanonical(ev: { event_id: string; event_name: string; occurred_at: string | Date; payload: any }, sink: string, identity: Record<string, unknown>): CanonicalTelemetryEvent {
  const p = ev.payload ?? {};
  const isRefund = sink === 'ga4:refund';
  const items = (p.items ?? []).map((l: any) => ({ item_id: l.productId, item_name: l.name, price: Math.round(Number(l.netLineUGX) / Math.max(1, Number(l.quantity))), quantity: Number(l.quantity) }));
  // A partial refund carries its own amount; a cancellation refunds the order's value.
  const value = ev.event_name === 'refund_confirmed' ? Number(p.amountUGX ?? 0)
    : Number(p.netMerchandiseUGX ?? 0) + Number(p.collectedDeliveryUGX ?? 0) + Number(p.taxUGX ?? 0);
  return {
    event_name: isRefund ? 'refund' : 'purchase',
    event_id: ev.event_id,
    event_time: Math.floor(new Date(ev.occurred_at).getTime() / 1000),
    source: 'server',
    user_data: Object.fromEntries(Object.entries(identity).filter(([, v]) => v != null && v !== '')) as never,
    ecommerce: { transaction_id: p.orderNumber, value, currency: 'UGX', ...(isRefund ? {} : { items }), ...(Number(p.collectedDeliveryUGX) > 0 ? { shipping: Number(p.collectedDeliveryUGX) } : {}) },
  } as CanonicalTelemetryEvent;
}

type Built = { url: string; method: 'GET' | 'POST'; headers: Record<string, string>; body?: string; replyError?: (t: string) => string | null };

async function buildRequest(sink: string, canonical: CanonicalTelemetryEvent): Promise<{ req: Built | null; suppress?: string; defer?: string }> {
  if (sink.startsWith('ga4:')) {
    const id = (env.ga4MeasurementId ?? '').trim();
    if (!/^G-[A-Z0-9]+$/.test(id)) return { req: null, defer: 'CREDENTIALS_MISSING' };
    const hit = ga4CollectHit(canonical, id);
    if (!hit) return { req: null, suppress: 'IDENTITY_UNAVAILABLE' };
    const ud = canonical.user_data ?? {};
    return { req: { url: `${env.metricsInternalUrl}/g/collect?${hit.toString()}`, method: 'POST', headers: {
      'X-Telemetry-Source': 'goldplus-delivery', ...(ud.user_agent ? { 'User-Agent': ud.user_agent } : {}), ...(ud.ip_address ? { 'X-Forwarded-For': ud.ip_address } : {}) } } };
  }
  const platform = sink.split(':')[1];
  const def = adPlatform(platform);
  const dest = (await adRepo.active()).find((d) => d.platform === platform);
  if (!def || !dest) return { req: null, suppress: 'DESTINATION_OFF' };
  let secret = '';
  if (def.secretLabel) {
    const vault = IntegrationCredentialVault.fromEnv();
    if (!vault || !dest.secretEnc) return { req: null, defer: 'CREDENTIALS_MISSING' };
    try { secret = String(vault.decrypt<{ apiKey: string }>(dest.secretEnc).apiKey ?? ''); } catch { return { req: null, defer: 'CREDENTIALS_UNVERIFIED' }; }
  }
  const r = buildAdRequest(platform, canonical, dest.config, secret);
  if (!r) return { req: null, suppress: 'IDENTITY_UNAVAILABLE' };
  const auth = def.authorize ? await def.authorize(r, dest.config, secret) : {};
  return { req: { url: r.url, method: r.method ?? 'POST', headers: { ...r.headers, ...auth }, body: r.method === 'GET' ? undefined : JSON.stringify(r.body),
    replyError: def.replyError ? (t) => { try { return def.replyError!(JSON.parse(t)); } catch { return null; } } : undefined } };
}

async function finish(deliveryId: string, token: string, state: string, reason: string, extra: { nextAt?: Date; accepted?: boolean } = {}) {
  await db.execute(sql`update measurement.delivery_intent set state = ${state}, state_reason = ${reason}, lease_token = null, lease_until = null, updated_at = now(),
    next_attempt_at = ${extra.nextAt ? sql`${extra.nextAt.toISOString()}::timestamptz` : sql`next_attempt_at`},
    accepted_at = ${extra.accepted ? sql`now()` : sql`accepted_at`}
    where delivery_id = ${deliveryId}::uuid and state = 'LEASED' and lease_token = ${token}::uuid`);
}

export async function deliverOne(deliveryId: string, generation: number, fetchImpl: typeof fetch = fetch): Promise<string> {
  const token = randomUUID();
  const claimed = rows(await db.execute(sql`update measurement.delivery_intent set state = 'LEASED', lease_token = ${token}::uuid, lease_until = now() + ${LEASE}::interval, updated_at = now()
    where delivery_id = ${deliveryId}::uuid and enqueue_generation = ${generation} and state in ('PENDING','RETRY_WAIT') and next_attempt_at <= now()
    returning *`))[0];
  if (!claimed) return 'NOT_CLAIMED'; // stale generation, terminal, or not due: no send
  const ev = rows(await db.execute(sql`select * from measurement.business_event where event_id = ${claimed.event_id}::uuid`))[0];
  const sink = String(claimed.sink_key);

  // Gates (dossier §3.5): environment, kill switch, age, attempt horizon, consent (D-002).
  if (ev.environment !== ENV() || (ENV() !== 'production' && process.env.MEASUREMENT_ALLOW_NONPROD_DELIVERY !== 'true')) { await finish(deliveryId, token, 'SUPPRESSED', 'ENVIRONMENT_MISMATCH'); return 'SUPPRESSED'; }
  if (await killSwitchOn()) { await finish(deliveryId, token, 'RETRY_WAIT', 'KILL_SWITCH', { nextAt: new Date(Date.now() + 5 * 60_000) }); return 'HELD'; }
  const age = Date.now() - new Date(ev.occurred_at).getTime();
  if (sink.startsWith('ad:') && age > MAX_EVENT_AGE_MS) { await finish(deliveryId, token, 'SUPPRESSED', 'EXPIRED_EVENT'); return 'SUPPRESSED'; }
  // Budget and horizon count from the last operator replay (0141), if any.
  const attemptsSince = Number(claimed.attempt_count) - Number(claimed.attempts_at_replay ?? 0);
  const horizonFrom = new Date(claimed.replayed_at ?? claimed.created_at).getTime();
  if (attemptsSince >= MAX_ATTEMPTS || Date.now() - horizonFrom > HORIZON_MS) { await finish(deliveryId, token, 'DEAD_LETTER', 'RETRY_BUDGET_EXHAUSTED'); return 'DEAD_LETTER'; }
  const identity = await loadIdentity(String(ev.aggregate_id));
  if (sink.startsWith('ad:')) {
    // The shared D-002 gate (no expiry on a refusal). An unreadable consent
    // state defers the send; it used to count as "no refusal" and send.
    let refused: boolean;
    try { refused = await advertisingRefused({ userId: identity.user_id, fpClientId: identity.fp_client_id }); } catch {
      await finish(deliveryId, token, 'RETRY_WAIT', 'CONSENT_LOOKUP_FAILED', { nextAt: new Date(Date.now() + 5 * 60_000) }); return 'DEFERRED';
    }
    if (refused) { await finish(deliveryId, token, 'SUPPRESSED', 'CONSENT_DENIED'); return 'SUPPRESSED'; }
  }

  let source = ev;
  if (sink === 'ga4:refund' && ev.event_name === 'order_cancelled') {
    const confirmed = rows(await db.execute(sql`select payload from measurement.business_event
      where aggregate_type = 'order' and aggregate_id = ${ev.aggregate_id} and event_name = 'order_confirmed' and environment = ${ev.environment} limit 1`))[0];
    const withValue = cancellationRefundEvent(ev, typeof confirmed?.payload === 'string' ? JSON.parse(confirmed.payload) : confirmed?.payload);
    // Never a refund of 0: without the confirmed totals there is nothing true to send.
    if (!withValue) { await finish(deliveryId, token, 'SUPPRESSED', 'NO_CONFIRMED_VALUE'); return 'SUPPRESSED'; }
    source = withValue;
  }

  const canonical = toCanonical(source, sink, identity);
  let built: Awaited<ReturnType<typeof buildRequest>>;
  try { built = await buildRequest(sink, canonical); } catch (err) {
    const status = (err as { status?: number }).status;
    await finish(deliveryId, token, status && status < 500 ? 'DEAD_LETTER' : 'RETRY_WAIT', `BUILD:${String((err as Error).message).slice(0, 80)}`, { nextAt: new Date(Date.now() + 15 * 60_000) });
    return 'BUILD_FAILED';
  }
  if (built.suppress) { await finish(deliveryId, token, 'SUPPRESSED', built.suppress); return 'SUPPRESSED'; }
  if (built.defer || !built.req) { await finish(deliveryId, token, 'RETRY_WAIT', built.defer ?? 'DEPENDENCY_UNAVAILABLE', { nextAt: new Date(Date.now() + 30 * 60_000) }); return 'DEFERRED'; }
  const req = built.req;

  // STARTED marker: committed BEFORE the network call (dossier §5.3 step 6).
  const attemptId = randomUUID();
  const digest = createHash('sha256').update(`${req.method} ${new URL(req.url).origin}${new URL(req.url).pathname} ${req.body ?? ''}`).digest('hex');
  const attemptNo = await db.transaction(async (tx) => {
    const r = rows(await tx.execute(sql`update measurement.delivery_intent set attempt_count = attempt_count + 1, updated_at = now()
      where delivery_id = ${deliveryId}::uuid and state = 'LEASED' and lease_token = ${token}::uuid returning attempt_count`))[0];
    if (!r) return 0;
    await tx.execute(sql`insert into measurement.delivery_attempt (attempt_id, delivery_id, attempt_no, lease_token, adapter_version, started_at, outcome, safe_payload_sha256)
      values (${attemptId}::uuid, ${deliveryId}::uuid, ${Number(r.attempt_count)}, ${token}::uuid, ${ADAPTER_VERSION}, now(), 'STARTED', ${digest})`);
    return Number(r.attempt_count);
  });
  if (!attemptNo) return 'LEASE_LOST'; // no STARTED marker → no network call

  let status: number | null = null, text = '', retryAfter: string | null = null, net: 'before-send' | 'after-send' | null = null;
  try {
    const res = await fetchImpl(req.url, { method: req.method, headers: req.headers, body: req.body, redirect: 'manual', signal: AbortSignal.timeout(10_000) });
    status = res.status; retryAfter = res.headers.get('retry-after'); text = await res.text().catch(() => '');
  } catch (err) {
    // A connection refused/DNS failure never reached the provider; a timeout may have.
    const code = (err as { cause?: { code?: string } })?.cause?.code;
    net = code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'EAI_AGAIN' ? 'before-send' : 'after-send';
  }
  const replyError = status != null && status < 300 && req.replyError ? req.replyError(text) : null;
  const c = classifyResponse(status, replyError, net);
  const safeCode = c.code === 'OK' ? null : `${c.code}${replyError ? `: ${replyError.slice(0, 120)}` : ''}`;
  await db.transaction(async (tx) => {
    await tx.execute(sql`update measurement.delivery_attempt set finished_at = now(), outcome = ${c.kind.toUpperCase()}, http_status = ${status}, provider_code = ${safeCode},
      retry_after_at = ${retryAfter ? sql`now() + ${`${Math.min(86400, Math.max(0, Number(retryAfter) || 60))} seconds`}::interval` : sql`null`}
      where attempt_id = ${attemptId}::uuid`);
  });
  const platform = sink.startsWith('ad:') ? sink.split(':')[1] : null;
  if (c.kind === 'accepted') { await finish(deliveryId, token, 'ACCEPTED', 'OK', { accepted: true }); if (platform) await adRepo.recordResult(platform, true).catch(() => undefined); return 'ACCEPTED'; }
  if (platform) await adRepo.recordResult(platform, false, `${c.code}${status ? ` (HTTP ${status})` : ''}`).catch(() => undefined);
  if (c.kind === 'unknown') { await finish(deliveryId, token, 'UNKNOWN_OUTCOME', c.code); return 'UNKNOWN_OUTCOME'; }
  if (c.kind === 'retry' && attemptNo - Number(claimed.attempts_at_replay ?? 0) < MAX_ATTEMPTS) { await finish(deliveryId, token, 'RETRY_WAIT', c.code, { nextAt: new Date(Date.now() + nextAttemptDelayMs(attemptNo, retryAfter)) }); return 'RETRY_WAIT'; }
  await finish(deliveryId, token, 'DEAD_LETTER', c.code);
  logger.warn({ deliveryId, sink, code: c.code, status }, '[Delivery] dead-lettered');
  return 'DEAD_LETTER';
}
