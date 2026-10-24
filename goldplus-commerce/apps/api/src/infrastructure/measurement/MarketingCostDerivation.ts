import { sql } from 'drizzle-orm';
import { db } from '../db/client';
import { classifyTemplate } from '../notifications/messageClassification';
import { effectiveNumber, resolveUgxPerUsd, whatsappCostUgx, type FxFeedReading } from '../../domain/measurement/MeasurementConfig';
import type { MeasurementConfigPort } from '../../application/ports/measurement/MeasurementConfigPort';
import { MEDIUM_LABELS, placementChannel, type PlacementMedium } from './DrizzleMediaPlacementStore';

const rows = (r: unknown): any[] => (Array.isArray(r) ? r : ((r as { rows?: any[] })?.rows ?? []));
export const DERIVED_SOURCE = 'derived';
const KDAY = (col: string) => sql.raw(`(${col} at time zone 'Africa/Kampala')::date`);

interface CostRow { day: string; channel: string; platform: string; campaign: string; spendUgx: number; note?: string }

/**
 * Marketing costs nobody typed in (2026-10-23): the channel report and the MMM dataset read media_cost_facts, which
 * knew only ad platforms and CSV uploads. Every row below is rebuilt nightly for the last `days` days under
 * source 'derived', so it is never double-counted and always reflects the current settings:
 *  - SMS and WhatsApp: messages SENT (notification_attempts; SMS by billed parts) × the cost per unit in settings, split into
 *    marketing and transactional campaigns (messageClassification), so a reminder's cost sits beside its lift;
 *  - loyalty: points redeemed on orders at their snapshot value (the discount the programme paid for);
 *  - friend referrals: referral bonus points × the point value;
 *  - loyalty bonuses: mission, birthday, draw and verification points × the point value;
 *  - creators: commissions approved or paid, and flat fees spread evenly over the contract days.
 *  - placements (0206): slots bought on YouTube channels, radio, TV and the like, spread evenly over each
 *    placement's flight days; YouTube on its own channel, the rest as offline media.
 * Anything else paid off-platform stays a CSV upload (channel 'print', platform of choice).
 */
export class MarketingCostDerivation {
  constructor(private readonly config: MeasurementConfigPort, private readonly fxFeed: { latestFx(): Promise<FxFeedReading | null> } = { latestFx: async () => null }) {}

  async derive(days = 35, now = new Date()): Promise<{ rows: number; skipped: string[]; rates: { ugxPerUsd: number; basis: string; detail: string; smsUgx: number; whatsappMarketingUgx: number; whatsappUtilityUgx: number; whatsappBasis: string } }> {
    const to = kampalaDay(now);
    const from = kampalaDay(new Date(now.getTime() - days * 86_400_000));
    const values = await this.config.values();
    const skipped: string[] = [];
    const out: CostRow[] = [];

    // Shillings per dollar: manual override, else the fed market rate plus the safety margin, else 3,800.
    const fx = resolveUgxPerUsd(values, await this.fxFeed.latestFx().catch(() => null), to);
    const smsCost = effectiveNumber(values, 'sms_cost_ugx_per_message') ?? 0;
    const wa = whatsappCostUgx(values, fx.rate);
    const rates = { ugxPerUsd: fx.rate, basis: fx.basis, detail: fx.detail, smsUgx: smsCost, whatsappMarketingUgx: wa.marketing, whatsappUtilityUgx: wa.utility, whatsappBasis: wa.basis };
    if (smsCost <= 0) skipped.push('SMS cost per message is unset');
    {
      // n = billable units: SMS parts (the adapter writes "[parts=N]" into provider_message; older rows count as
      // one part), WhatsApp messages.
      const sent = rows(await db.execute(sql`select ${KDAY('attempted_at')} as day, channel, template,
          sum(case when channel = 'sms' then coalesce(nullif(substring(provider_message from 'parts=(\\d+)'), '')::int, 1) else 1 end)::int as n
        from notification_attempts
        where status = 'SENT' and channel in ('sms', 'whatsapp') and attempted_at >= ${from}::date - interval '1 day' and attempted_at < ${to}::date + interval '2 day' group by 1, 2, 3`));
      const agg = new Map<string, CostRow>();
      for (const r of sent) {
        const klass = classifyTemplate(String(r.template));
        const cls = klass === 'TRANSACTIONAL' ? 'transactional' : klass === 'OPERATIONAL' ? 'operational' : 'marketing';
        // WhatsApp bills by template class: marketing templates at the marketing rate; order updates, codes and the
        // shop's own staff alerts at the utility rate. SMS is one price per part whatever it says. Goldie's replies
        // inside a customer-opened 24-hour window go straight to Meta, are free, and are not in this table.
        const cost = r.channel === 'sms' ? smsCost : cls === 'marketing' ? wa.marketing : wa.utility;
        if (cost <= 0) continue;
        const k = `${r.day}|${r.channel}|${cls}`;
        const row = agg.get(k) ?? { day: iso(r.day), channel: String(r.channel), platform: r.channel === 'sms' ? 'EgoSMS' : 'Meta WhatsApp', campaign: `${cls} messages`, spendUgx: 0 };
        row.spendUgx += Number(r.n) * cost;
        agg.set(k, row);
      }
      out.push(...agg.values());
    }

    const pv = rows(await db.execute(sql`select point_value_ugx from loyalty_config where singleton = 'config'`))[0];
    const pointValue = pv?.point_value_ugx ? Number(pv.point_value_ugx) : null;
    const redeemed = rows(await db.execute(sql`select ${KDAY('o.created_at')} as day, sum(r.value_ugx)::bigint as ugx from loyalty_redemptions r join orders o on o.id = r.order_id
      where r.status = 'confirmed' and o.created_at >= ${from}::date - interval '1 day' and o.created_at < ${to}::date + interval '2 day' group by 1`));
    for (const r of redeemed) out.push({ day: iso(r.day), channel: 'loyalty', platform: 'Loyalty programme', campaign: 'points redeemed', spendUgx: Number(r.ugx) });
    if (pointValue === null) skipped.push('loyalty point value is unset: referral and bonus points carry no cost');
    else {
      // The ledger carries a reason sentence, not a rule code: referral rewards start "Referral reward". Every
      // other positive earn or adjustment (order earn, missions, birthdays, scratch cards, verifications) is the
      // programme's own cost.
      const pts = rows(await db.execute(sql`select ${KDAY('created_at')} as day, case when reason like 'Referral reward%' then 'referral' else 'bonus' end as kind, sum(points)::bigint as points
        from loyalty_ledger_entries where points > 0 and type in ('earn', 'adjustment')
          and created_at >= ${from}::date - interval '1 day' and created_at < ${to}::date + interval '2 day' group by 1, 2`));
      for (const r of pts) out.push(r.kind === 'referral'
        ? { day: iso(r.day), channel: 'friend_referral', platform: 'Loyalty programme', campaign: 'referral points', spendUgx: Number(r.points) * pointValue }
        : { day: iso(r.day), channel: 'loyalty', platform: 'Loyalty programme', campaign: 'points issued', spendUgx: Number(r.points) * pointValue });
    }

    const comm = rows(await db.execute(sql`select ${KDAY('created_at')} as day, sum(commission_amount_ugx)::bigint as ugx from creator_commissions
      where status in ('approved', 'paid') and created_at >= ${from}::date - interval '1 day' and created_at < ${to}::date + interval '2 day' group by 1`));
    for (const r of comm) out.push({ day: iso(r.day), channel: 'creator', platform: 'Creators', campaign: 'commissions', spendUgx: Number(r.ugx) });
    const fees = rows(await db.execute(sql`select d::date as day, sum(flat_fee_ugx::numeric / greatest(1, (end_date - start_date + 1)))::bigint as ugx
      from creator_contracts c, generate_series(greatest(c.start_date, ${from}::date), least(c.end_date, ${to}::date), interval '1 day') d
      where c.flat_fee_ugx > 0 and c.start_date is not null and c.end_date is not null and c.status in ('active', 'paused', 'blocked') group by 1`));
    for (const r of fees) out.push({ day: iso(r.day), channel: 'creator', platform: 'Creators', campaign: 'flat fees', spendUgx: Number(r.ugx) });
    // Negotiated payments outside a contract record (0204): each agreement's amount spread evenly over its days,
    // one campaign line per creator so the channel report can say who was paid for what.
    const negotiated = rows(await db.execute(sql`select d::date as day, c.handle, n.label, sum(n.amount_ugx::numeric / (n.end_date - n.start_date + 1))::numeric as ugx
      from creator_negotiated_costs n join creators c on c.id = n.creator_id, generate_series(greatest(n.start_date, ${from}::date), least(n.end_date, ${to}::date), interval '1 day') d
      where n.deleted_at is null and n.end_date >= ${from}::date and n.start_date <= ${to}::date group by 1, 2, 3`));
    for (const r of negotiated) out.push({ day: iso(r.day), channel: 'creator', platform: 'Creators', campaign: `${String(r.handle)}: ${String(r.label)}`.slice(0, 120), spendUgx: Number(r.ugx) });

    const placements = rows(await db.execute(sql`select d::date as day, p.medium, p.outlet, p.title, (p.cost_ugx::numeric / p.flight_days) as ugx
      from media_placements p, generate_series(greatest(p.publish_date, ${from}::date), least(p.publish_date + (p.flight_days - 1), ${to}::date), interval '1 day') d
      where p.deleted_at is null and p.publish_date + (p.flight_days - 1) >= ${from}::date and p.publish_date <= ${to}::date`));
    for (const r of placements) out.push({ day: iso(r.day), channel: placementChannel(String(r.medium)), platform: MEDIUM_LABELS[String(r.medium) as PlacementMedium] ?? String(r.medium), campaign: `${String(r.outlet)}: ${String(r.title)}`.slice(0, 120), spendUgx: Number(r.ugx) });

    const keep = out.filter((r) => r.spendUgx > 0 && r.day >= from && r.day <= to);
    await db.transaction(async (tx) => {
      await tx.execute(sql`delete from media_cost_facts where source = ${DERIVED_SOURCE} and spend_date >= ${from}::date and spend_date <= ${to}::date`);
      for (const r of keep) {
        await tx.execute(sql`insert into media_cost_facts (spend_date, channel, platform, account, campaign, currency, spend_minor, tax_or_fee_minor, source, source_reference)
          values (${r.day}::date, ${r.channel}, ${r.platform}, ${r.platform}, ${r.campaign}, 'UGX', ${Math.round(r.spendUgx)}, 0, ${DERIVED_SOURCE}, 'measurement nightly')`);
      }
    });
    return { rows: keep.length, skipped, rates };
  }
}

export function kampalaDay(d: Date): string { return new Date(d.getTime() + 3 * 3600_000).toISOString().slice(0, 10); }
const iso = (v: unknown): string => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
