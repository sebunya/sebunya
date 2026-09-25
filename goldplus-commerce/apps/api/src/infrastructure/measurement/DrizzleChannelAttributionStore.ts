import { sql } from 'drizzle-orm';
import { parseHeardAbout } from '@goldplus/shared';
import { db } from '../db/client';
import { pgJsonb } from '../db/PgParams';
import { environmentOf } from '../../domain/measurement/BusinessEvents';
import { codeTouchFrom, reportChannelForSpend, type CreditBasis, type OrderCredit, type ReportModel, type SpendInput } from '../../domain/measurement/ChannelReport';
import type { ChannelAttributionStore, ChannelSpendSource, OrderAttributionFacts, SaleFacts, SourceReportRow } from '../../application/ports/measurement/ChannelAttribution';

/**
 * PostgreSQL side of the attribution module (migration 0156). Touches are the
 * collector's (measurement.touchpoint, 0141); links, credits, self-reports and
 * WhatsApp references are this module's own tables. Nothing here reads or
 * writes raw click ids or personal data.
 */
const rows = (r: unknown): any[] => (Array.isArray(r) ? r : ((r as { rows?: any[] })?.rows ?? []));
const env = () => environmentOf(process.env.NODE_ENV);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class DrizzleChannelAttributionStore implements ChannelAttributionStore {
  async loadOrder(orderId: string): Promise<OrderAttributionFacts | null> {
    if (!UUID.test(orderId)) return null;
    const o = rows(await db.execute(sql`
      select o.id, o.order_number, o.created_at, o.status, o.payment_status, o.payment_method, o.total_amount, o.delivery_fee, oa.fp_client_id
      from orders o left join order_attribution oa on oa.order_id = o.id
      where o.id = ${orderId}::uuid`))[0];
    if (!o) return null;
    const touches = rows(await db.execute(sql`
      select t.touch_id, t.channel, coalesce(nullif(t.source, ''), t.referrer_host, '') as detail, t.occurred_at
      from measurement.order_touch_link l join measurement.touchpoint t on t.touch_id = l.touch_id
      where l.order_id = ${orderId}::uuid
      order by t.occurred_at, t.touch_id`));
    const code = rows(await db.execute(sql`
      select
        (select c.handle from creator_attributions a join creators c on c.id = a.creator_id
          where a.order_id = ${orderId}::uuid and a.is_primary limit 1) as attributed_handle,
        cr.handle as creator_handle, cc.code, cc.code_type, pd.name as promotion_name
      from (select 1) as one
      left join lateral (
        select r.coupon_id from coupon_redemptions r
        where r.order_id = ${orderId}::uuid and not r.was_reversed order by r.redeemed_at limit 1
      ) red on true
      left join coupon_codes cc on cc.id = red.coupon_id
      left join creators cr on cr.id = cc.assigned_to_creator_id
      left join promotion_definitions pd on pd.id = cc.promotion_definition_id`))[0];
    const reports = rows(await db.execute(sql`
      select reported_by, answer, whatsapp_ref, note, created_at from measurement.order_source_report
      where order_id = ${orderId}::uuid order by created_at desc, report_id desc limit 50`));
    return {
      orderId: String(o.id),
      orderNumber: String(o.order_number),
      orderAt: new Date(o.created_at),
      status: String(o.status),
      paymentStatus: String(o.payment_status),
      paymentMethod: o.payment_method ? String(o.payment_method) : null,
      totalUGX: Number(o.total_amount ?? 0),
      deliveryFeeUGX: Number(o.delivery_fee ?? 0),
      visitorId: o.fp_client_id ? String(o.fp_client_id) : null,
      observed: touches.map((t) => ({ touchId: String(t.touch_id), channel: String(t.channel), detail: String(t.detail ?? '').slice(0, 120), at: new Date(t.occurred_at) })),
      code: codeTouchFrom(code),
      reports: reports.map((r): SourceReportRow => ({
        reportedBy: r.reported_by === 'admin' ? 'admin' : 'customer',
        answer: parseHeardAbout(r.answer),
        whatsappRef: r.whatsapp_ref ? String(r.whatsapp_ref) : null,
        note: r.note ? String(r.note) : null,
        createdAt: new Date(r.created_at),
      })),
    };
  }

  async linkVisitorTouches(input: { orderId: string; visitorId: string; orderAt: Date; lookbackDays: number; method: 'visitor' | 'whatsapp_ref' }): Promise<number> {
    const r = rows(await db.execute(sql`
      insert into measurement.order_touch_link (order_id, touch_id, link_method)
      select ${input.orderId}::uuid, t.touch_id, ${input.method}
      from measurement.touchpoint t
      where t.environment = ${env()} and t.anonymous_id = ${input.visitorId} and t.traffic_class = 'customer'
        and t.occurred_at <= ${input.orderAt.toISOString()}::timestamptz
        and t.occurred_at > ${input.orderAt.toISOString()}::timestamptz - make_interval(days => ${input.lookbackDays})
      on conflict (order_id, touch_id) do nothing
      returning touch_id`));
    return r.length;
  }

  async replaceCredits(orderId: string, credits: OrderCredit[], modelVersion: string): Promise<void> {
    await db.transaction(async (tx) => {
      await tx.execute(sql`delete from measurement.order_channel_credit where order_id = ${orderId}::uuid`);
      if (!credits.length) return;
      await tx.execute(sql`
        insert into measurement.order_channel_credit (order_id, model, channel, detail, weight, credited_ugx, basis, model_version)
        select ${orderId}::uuid, x->>'model', x->>'channel', x->>'detail', (x->>'weight')::numeric, (x->>'credited')::bigint, x->>'basis', ${modelVersion}
        from jsonb_array_elements(${pgJsonb(credits.map((c) => ({ model: c.model, channel: c.channel, detail: c.detail, weight: String(c.weight), credited: c.creditedUGX.toString(), basis: c.basis })))}) as x`);
    });
  }

  async recordSourceReport(input: { orderId: string; reportedBy: 'customer' | 'admin'; answer: string | null; whatsappRef: string | null; note: string | null; actorId: string | null }): Promise<void> {
    const actor = input.actorId && UUID.test(input.actorId) ? input.actorId : null;
    await db.execute(sql`
      insert into measurement.order_source_report (order_id, reported_by, answer, whatsapp_ref, note, actor_id)
      values (${input.orderId}::uuid, ${input.reportedBy}, ${input.answer}, ${input.whatsappRef}, ${input.note}, ${actor}::uuid)`);
  }

  async findWhatsAppRef(code: string): Promise<{ visitorId: string; issuedAt: Date } | null> {
    const r = rows(await db.execute(sql`
      select anonymous_id, issued_at from measurement.whatsapp_ref
      where code = ${code} and environment = ${env()} and traffic_class = 'customer'`))[0];
    return r ? { visitorId: String(r.anonymous_id), issuedAt: new Date(r.issued_at) } : null;
  }

  async orderIdsPlacedBetween(from: Date, to: Date, limit: number): Promise<string[]> {
    return rows(await db.execute(sql`
      select id from orders where created_at >= ${from.toISOString()}::timestamptz and created_at < ${to.toISOString()}::timestamptz
      order by created_at desc limit ${limit}`)).map((r) => String(r.id));
  }

  async salesBetween(from: Date, to: Date): Promise<SaleFacts[]> {
    return rows(await db.execute(sql`
      select id, created_at, status, payment_status, payment_method, total_amount, delivery_fee from orders
      where created_at >= ${from.toISOString()}::timestamptz and created_at < ${to.toISOString()}::timestamptz`))
      .map((r) => ({ orderId: String(r.id), orderAt: new Date(r.created_at), status: String(r.status), paymentStatus: String(r.payment_status),
        paymentMethod: r.payment_method ? String(r.payment_method) : null, totalUGX: Number(r.total_amount ?? 0), deliveryFeeUGX: Number(r.delivery_fee ?? 0) }));
  }

  async creditsBetween(model: ReportModel, from: Date, to: Date) {
    return rows(await db.execute(sql`
      select c.order_id, c.channel, c.detail, c.weight, c.credited_ugx, c.basis
      from measurement.order_channel_credit c join orders o on o.id = c.order_id
      where c.model = ${model} and o.created_at >= ${from.toISOString()}::timestamptz and o.created_at < ${to.toISOString()}::timestamptz`))
      .map((r) => ({ orderId: String(r.order_id), channel: String(r.channel), detail: String(r.detail ?? ''), weight: Number(r.weight),
        creditedUGX: BigInt(r.credited_ugx ?? 0), basis: (r.basis === 'declared' ? 'declared' : 'observed') as CreditBasis }));
  }

  async creditsForOrder(orderId: string) {
    if (!UUID.test(orderId)) return [];
    return rows(await db.execute(sql`
      select model, channel, detail, weight, credited_ugx, basis, computed_at from measurement.order_channel_credit
      where order_id = ${orderId}::uuid order by model, credited_ugx desc, channel`))
      .map((r) => ({ model: String(r.model), channel: String(r.channel), detail: String(r.detail ?? ''), weight: Number(r.weight),
        creditedUGX: BigInt(r.credited_ugx ?? 0), basis: (r.basis === 'declared' ? 'declared' : 'observed') as CreditBasis, computedAt: new Date(r.computed_at) }));
  }
}

/**
 * Spend comes from the ONE canonical media-spend table, `media_cost_facts`
 * (0102; filled by the advertising module's imports, 0154). UGX rows only: a
 * total across currencies is not a number, so other currencies are named, not
 * converted. No UGX row in the window = "No spend data", never a zero.
 */
export class PgChannelSpendSource implements ChannelSpendSource {
  async weeklySpend(from: Date, to: Date): Promise<SpendInput> {
    const present = rows(await db.execute(sql`select to_regclass('public.media_cost_facts') is not null as present`))[0];
    if (!present?.present) return { status: 'NOT_AVAILABLE' };
    // spend_date is a Kampala calendar day; weeks start on Monday, as the report's do.
    const fromDay = new Date(from.getTime() + 3 * 3600_000).toISOString().slice(0, 10);
    const toDay = new Date(to.getTime() + 3 * 3600_000).toISOString().slice(0, 10);
    const r = rows(await db.execute(sql`
      select to_char(date_trunc('week', spend_date::timestamp), 'YYYY-MM-DD') as week_start, channel, platform, currency,
             sum(spend_minor + tax_or_fee_minor)::text as spend
      from media_cost_facts
      where spend_date >= ${fromDay}::date and spend_date < ${toDay}::date
      group by 1, 2, 3, 4`));
    const ugx = r.filter((x) => String(x.currency).toUpperCase() === 'UGX');
    const excludedCurrencies = [...new Set(r.map((x) => String(x.currency).toUpperCase()).filter((c) => c !== 'UGX'))].sort();
    if (!ugx.length) return { status: 'NOT_AVAILABLE', excludedCurrencies };
    return {
      status: 'AVAILABLE',
      excludedCurrencies,
      rows: ugx.map((x) => ({ weekStart: String(x.week_start), channel: reportChannelForSpend(String(x.channel), String(x.platform)), spendUGX: BigInt(x.spend ?? '0') })),
    };
  }
}
