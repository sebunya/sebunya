import { sql } from 'drizzle-orm';
import { db } from '../db/client';
import { logger } from '../logging/logger';
import { environmentOf } from '../../domain/measurement/BusinessEvents';
import { effectiveNumber } from '../../domain/measurement/MeasurementConfig';
import type { MeasurementConfigPort } from '../../application/ports/measurement/MeasurementConfigPort';
import { getServiceAccountToken, parseServiceAccountJson } from '../seo/adapters/GoogleServiceAccountAuth';
import { IntegrationCredentialVault } from '../seo/IntegrationCredentialVault';

const rows = (r: unknown): any[] => (Array.isArray(r) ? r : ((r as { rows?: any[] })?.rows ?? []));
export const RECONCILE_DAYS = 8;
const ALERT_TITLE = 'Measurement check: GA4 purchases.';
const RULE_NAME = 'ga4_purchase_reconciliation';

export interface Ga4DayReport { day: string; purchases: number; revenue: number }
export interface Ga4Reader { purchasesByDay(from: string, to: string): Promise<Ga4DayReport[] | { unavailable: string }> }
export interface Alarm { raise(message: string): Promise<void> }

interface SeoRepo { findConnectionWithActiveCredential(providerId: string): Promise<any>; getActiveCredential(connectionId: string): Promise<any> }

/** GA4 Data API runReport (transactions + purchaseRevenue by date); credential vault-first, then env. */
export class HttpGa4Reader implements Ga4Reader {
  constructor(private readonly seoRepo: SeoRepo, private readonly fetchImpl: typeof fetch = fetch) {}

  private async credential(): Promise<{ json: string; propertyId: string } | { unavailable: string }> {
    let json: string | null = null; let propertyId = '';
    try {
      const connection = await this.seoRepo.findConnectionWithActiveCredential('google-analytics-4');
      if (connection) {
        const credential = await this.seoRepo.getActiveCredential(connection.id);
        const vault = IntegrationCredentialVault.fromEnv();
        if (credential && vault) {
          const secret = vault.decrypt<Record<string, unknown>>(credential.ciphertext);
          json = typeof secret.serviceAccountJson === 'string' ? secret.serviceAccountJson : secret.serviceAccountJson ? JSON.stringify(secret.serviceAccountJson) : null;
          propertyId = String((connection.config ?? {}).propertyId ?? connection.property_ref ?? connection.propertyRef ?? '');
        }
      }
    } catch (err) { logger.warn({ err: (err as Error).message }, '[ga4-reconcile] vault credential unavailable; trying env'); }
    if (!json) json = (process.env.GA4_SERVICE_ACCOUNT_JSON ?? '').trim() || null;
    if (!propertyId) propertyId = (process.env.GA4_PROPERTY_ID ?? '').trim();
    propertyId = propertyId.replace(/^properties\//, '');
    if (!json) return { unavailable: 'No GA4 service-account credential (vault connection google-analytics-4 or GA4_SERVICE_ACCOUNT_JSON).' };
    if (!propertyId) return { unavailable: 'No GA4 property id (connection config propertyId or GA4_PROPERTY_ID).' };
    return { json, propertyId };
  }

  async purchasesByDay(from: string, to: string) {
    const cred = await this.credential();
    if ('unavailable' in cred) return cred;
    let token: string;
    try { token = await getServiceAccountToken(parseServiceAccountJson(cred.json), 'https://www.googleapis.com/auth/analytics.readonly'); }
    catch (err) { return { unavailable: `GA4 credential refused: ${(err as Error).message}`.slice(0, 300) }; }
    const res = await this.fetchImpl(`https://analyticsdata.googleapis.com/v1beta/properties/${cred.propertyId}:runReport`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000),
      body: JSON.stringify({ dateRanges: [{ startDate: from, endDate: to }], dimensions: [{ name: 'date' }], metrics: [{ name: 'transactions' }, { name: 'purchaseRevenue' }], limit: 400 }),
    });
    if (!res.ok) return { unavailable: `GA4 runReport failed (HTTP ${res.status}). Is the service account a Viewer on property ${cred.propertyId}?` };
    const body = await res.json() as { rows?: Array<{ dimensionValues: Array<{ value: string }>; metricValues: Array<{ value: string }> }> };
    return (body.rows ?? []).map((r) => { const d = r.dimensionValues[0].value; return { day: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`, purchases: Number(r.metricValues[0].value), revenue: Math.round(Number(r.metricValues[1].value)) }; });
  }
}

/**
 * Nightly GA4-versus-shop reconciliation (2026-10-23). Per Kampala day: the purchases we SENT GA4 (delivery_intent
 * ga4:purchase accepted or processed), the sales the shop confirmed, and what GA4 reports. Two questions, two
 * statuses: coverage (how many confirmed sales ever reached GA4: orders with no browser identity never do) and
 * agreement (of the ones sent, how many GA4 kept). Agreement under tolerance raises an alarm; coverage is shown.
 */
export class Ga4Reconciliation {
  constructor(private readonly config: MeasurementConfigPort, private readonly ga4: Ga4Reader, private readonly alarm: Alarm) {}

  async run(now = new Date()): Promise<{ days: number; alarms: number; unavailable: string | null }> {
    const env = environmentOf(process.env.NODE_ENV);
    const tol = (effectiveNumber(await this.config.values(), 'ga4_reconciliation_tolerance_pct') ?? 20) / 100;
    const to = kday(new Date(now.getTime() - 86_400_000));
    const from = kday(new Date(now.getTime() - RECONCILE_DAYS * 86_400_000));
    const shop = rows(await db.execute(sql`
      select (e.occurred_at at time zone 'Africa/Kampala')::date::text as day,
             count(distinct e.event_id)::int as confirmed,
             count(distinct e.event_id) filter (where d.state in ('ACCEPTED', 'PROCESSED'))::int as sent,
             coalesce(sum((e.payload->>'netMerchandiseUGX')::bigint + coalesce((e.payload->>'collectedDeliveryUGX')::bigint, 0)) filter (where d.state in ('ACCEPTED', 'PROCESSED')), 0)::bigint as sent_revenue
      from measurement.business_event e left join measurement.delivery_intent d on d.event_id = e.event_id and d.sink_key = 'ga4:purchase'
      where e.environment = ${env} and e.event_name = 'order_confirmed' and e.occurred_at >= ${from}::date - interval '1 day' and e.occurred_at < ${to}::date + interval '2 day'
      group by 1`));
    const ga = await this.ga4.purchasesByDay(from, to);
    const unavailable = 'unavailable' in ga ? ga.unavailable : null;
    const gaBy = new Map<string, Ga4DayReport>('unavailable' in ga ? [] : ga.map((g) => [g.day, g]));
    let alarms = 0; let days = 0;
    const problems: string[] = [];
    for (let t = new Date(`${from}T00:00:00Z`).getTime(); t <= new Date(`${to}T00:00:00Z`).getTime(); t += 86_400_000) {
      const day = new Date(t).toISOString().slice(0, 10);
      const s = shop.find((x) => x.day === day) ?? { confirmed: 0, sent: 0, sent_revenue: 0 };
      const g = gaBy.get(day);
      const sent = Number(s.sent), confirmed = Number(s.confirmed);
      let status = 'ok'; let delta: number | null = null; let message: string | null = null;
      if (unavailable) { status = 'unknown'; message = unavailable.slice(0, 300); }
      else if (sent === 0) { status = confirmed > 0 ? 'no_identity' : 'ok'; message = confirmed > 0 ? `${confirmed} confirmed sale(s), none sent to GA4 (no browser identity)` : null; }
      else {
        const got = g?.purchases ?? 0;
        delta = Math.round(((got - sent) / sent) * 10000) / 100;
        if (got < sent * (1 - tol)) { status = 'alarm'; message = `GA4 reports ${got} purchase(s) for ${sent} sent (${confirmed} confirmed)`; alarms++; problems.push(`${day}: ${message}`); }
        else if (got > sent * (1 + tol)) { status = 'warn'; message = `GA4 reports ${got} purchase(s) for ${sent} sent: something else is sending purchases`; }
      }
      await db.execute(sql`insert into measurement.reconciliation (day, source, external_orders, external_revenue_minor, shop_orders, shop_revenue_minor, delta_pct, status, message, computed_at)
        values (${day}::date, 'ga4', ${g?.purchases ?? null}, ${g?.revenue ?? null}, ${sent}, ${String(s.sent_revenue ?? 0)}, ${delta}, ${status}, ${message}, ${now})
        on conflict (day, source) do update set external_orders = excluded.external_orders, external_revenue_minor = excluded.external_revenue_minor, shop_orders = excluded.shop_orders, shop_revenue_minor = excluded.shop_revenue_minor,
          delta_pct = excluded.delta_pct, status = excluded.status, message = excluded.message, computed_at = excluded.computed_at`);
      days++;
    }
    // Yesterday alone can lag (GA4 reports fill in for up to 48 hours); alarm only on a day at least two days old.
    const stale = problems.filter((p) => p.slice(0, 10) < kday(new Date(now.getTime() - 2 * 86_400_000)));
    if (stale.length) await this.alarm.raise(`${ALERT_TITLE} ${stale.join('; ')}`.slice(0, 200));
    return { days, alarms, unavailable };
  }

  async latest(days = RECONCILE_DAYS + 20) {
    const r = rows(await db.execute(sql`select day::text as day, external_orders, external_revenue_minor, shop_orders, shop_revenue_minor, delta_pct, status, message, computed_at
      from measurement.reconciliation where source = 'ga4' and day >= current_date - ${days}::int order by day desc`));
    const coverage = rows(await db.execute(sql`select count(distinct e.event_id)::int as confirmed, count(distinct e.event_id) filter (where d.state in ('ACCEPTED','PROCESSED'))::int as sent,
      count(distinct e.event_id) filter (where d.state = 'SUPPRESSED' and d.state_reason = 'IDENTITY_UNAVAILABLE')::int as no_identity
      from measurement.business_event e left join measurement.delivery_intent d on d.event_id = e.event_id and d.sink_key = 'ga4:purchase'
      where e.environment = ${environmentOf(process.env.NODE_ENV)} and e.event_name = 'order_confirmed' and e.occurred_at >= now() - interval '30 days'`))[0];
    return { days: r.map((x) => ({ day: String(x.day), ga4Purchases: x.external_orders == null ? null : Number(x.external_orders), ga4RevenueUGX: x.external_revenue_minor == null ? null : Number(x.external_revenue_minor), sent: Number(x.shop_orders), sentRevenueUGX: Number(x.shop_revenue_minor), deltaPct: x.delta_pct == null ? null : Number(x.delta_pct), status: String(x.status), message: x.message ?? null, computedAt: new Date(x.computed_at).toISOString() })),
      coverage30d: { confirmed: Number(coverage?.confirmed ?? 0), sent: Number(coverage?.sent ?? 0), noIdentity: Number(coverage?.no_identity ?? 0) } };
  }
}

/** Alarm: a log line, a Care Desk urgent task (one a day), and a row in the data-quality alerts the control tower lists. */
export function careDeskAlarm(care: { lastTitled(prefix: string): Promise<{ status: string; createdAt: Date } | null>; openTask(i: { kind: 'urgent'; title: string; openedBy: string; urgent: boolean }): Promise<unknown> }): Alarm {
  return {
    async raise(message) {
      logger.error({ message }, 'ALERT GA4_RECONCILIATION');
      try {
        const rule = rows(await db.execute(sql`select id from measurement_data_quality_rules where name = ${RULE_NAME} limit 1`))[0]
          ?? rows(await db.execute(sql`insert into measurement_data_quality_rules (name, event_match, condition, severity, enabled) values (${RULE_NAME}, 'purchase', '{"check":"ga4_vs_sent"}'::jsonb, 'HIGH', true) returning id`))[0];
        if (rule) await db.execute(sql`insert into measurement_data_quality_alerts (rule_id, alert_message, status) values (${rule.id}::uuid, ${message}, 'open')`);
      } catch (err) { logger.warn({ err: (err as Error).message }, '[ga4-reconcile] could not record the data-quality alert'); }
      const last = await care.lastTitled(ALERT_TITLE);
      if (last && (last.status === 'open' || Date.now() - last.createdAt.getTime() < 20 * 3600_000)) return;
      await care.openTask({ kind: 'urgent', title: message, openedBy: 'measurement-nightly', urgent: true });
    },
  };
}

const kday = (d: Date) => new Date(d.getTime() + 3 * 3600_000).toISOString().slice(0, 10);
