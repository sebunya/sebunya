import type { HeardAboutAnswer } from '@goldplus/shared';
import { allocateInteger, collapseConsecutive, DEFAULT_RULE_POLICY, ruleWeights, type RuleMethod } from './Attribution';

/**
 * Per-order channel credit and the weekly channel report (attribution module,
 * docs/measurement/ATTRIBUTION.md). Pure: no database, no clock.
 *
 * One journey per order, built from three kinds of evidence, each labelled:
 *  - OBSERVED: landing touches recorded server-side for the order's visitor
 *    (measurement.touchpoint), including a visitor found through a WhatsApp
 *    reference code;
 *  - CODE: a creator or promo code redeemed on the order, placed as the final
 *    touch at the moment of the order (the code was typed at checkout);
 *  - DECLARED: the customer's own answer to "How did you hear about us?".
 *    Used only when there is no observed or code touch at all, and marked.
 * An order with none of the three is UNATTRIBUTED: it is shown as its own row,
 * never spread over the channels.
 */

export const JOURNEY_MODELS = ['last_click', 'first_touch', 'linear', 'time_decay', 'position_based'] as const;
export type JourneyModel = typeof JOURNEY_MODELS[number];
export const REPORT_MODELS = [...JOURNEY_MODELS, 'self_reported'] as const;
export type ReportModel = typeof REPORT_MODELS[number];
export const MODEL_VERSION = 'channel-credit-v1';
export const LOOKBACK_DAYS = 30;

const RULE_OF: Record<JourneyModel, RuleMethod> = {
  last_click: 'last_touch',
  first_touch: 'first_touch',
  linear: 'linear',
  time_decay: 'time_decay',
  position_based: 'position_based',
};

export const MODEL_LABELS: Record<ReportModel, { label: string; help: string }> = {
  last_click: { label: 'Last click', help: 'All credit to the last recorded source before the order.' },
  first_touch: { label: 'First touch', help: 'All credit to the first recorded source in the 30 days before the order.' },
  linear: { label: 'Linear', help: 'Credit shared equally across the recorded sources.' },
  time_decay: { label: 'Time decay', help: 'Recent sources count more; weight halves every 7 days.' },
  position_based: { label: 'Position-based', help: '40% first, 40% last, 20% shared by the middle.' },
  self_reported: { label: 'Customer said', help: 'Only what the customer (or staff for them) answered to "How did you hear about us?".' },
};

export function parseReportModel(v: unknown): ReportModel {
  return typeof v === 'string' && (REPORT_MODELS as readonly string[]).includes(v) ? (v as ReportModel) : 'last_click';
}

/** Report channels: the classifier's channels plus the evidence kinds above. */
export const CHANNEL_LABELS: Record<string, string> = {
  paid_search: 'Paid search',
  paid_social: 'Paid social',
  display: 'Display',
  affiliate: 'Affiliate',
  email: 'Email',
  sms: 'SMS',
  whatsapp: 'WhatsApp',
  organic_search: 'Organic search',
  organic_social: 'Organic social',
  referral: 'Referral',
  direct: 'Direct',
  other_paid: 'Other paid',
  other: 'Other',
  creator: 'Creators and influencers',
  promo_code: 'Promo codes',
  search_declared: 'Search (customer said)',
  social_declared: 'Social media (customer said)',
  word_of_mouth: 'Friends and family (customer said)',
  offline_media: 'Radio, TV and print (customer said)',
  returning_customer: 'Returning customer (customer said)',
  unattributed: 'No recorded source',
};
export const channelLabel = (c: string): string => CHANNEL_LABELS[c] ?? c;

/** Where a declared answer is filed. Ambiguous answers stay ambiguous. */
export function declaredChannel(a: HeardAboutAnswer): { channel: string; detail: string } {
  switch (a) {
    case 'search': return { channel: 'search_declared', detail: '' };
    case 'facebook': case 'instagram': case 'tiktok': return { channel: 'social_declared', detail: a };
    case 'whatsapp': return { channel: 'whatsapp', detail: 'customer said' };
    case 'creator': return { channel: 'creator', detail: 'customer said' };
    case 'friend': return { channel: 'word_of_mouth', detail: '' };
    case 'radio_tv': return { channel: 'offline_media', detail: '' };
    case 'returning': return { channel: 'returning_customer', detail: '' };
    default: return { channel: 'other', detail: 'customer said' };
  }
}

export interface ObservedTouch { touchId: string; channel: string; detail: string; at: Date }
export interface CodeTouch { kind: 'creator' | 'promo_code'; detail: string }
export type CreditBasis = 'observed' | 'declared';

/** Which code on an order counts, and as what. A creator code or a creator attribution is a creator. */
export function codeTouchFrom(r: { creator_handle?: unknown; attributed_handle?: unknown; code?: unknown; code_type?: unknown; promotion_name?: unknown } | undefined): CodeTouch | null {
  if (!r) return null;
  const handle = (r.attributed_handle ?? r.creator_handle) as string | null | undefined;
  if (handle) return { kind: 'creator', detail: String(handle).slice(0, 80) };
  if (!r.code) return null;
  // A batch of single-use codes is one campaign; naming each code would split it into hundreds of rows.
  const detail = r.code_type === 'bulk_batch' && r.promotion_name ? String(r.promotion_name) : String(r.code).toUpperCase();
  return { kind: 'promo_code', detail: detail.slice(0, 80) };
}

export interface JourneyInput {
  orderAt: Date;
  observed: ObservedTouch[];
  code: CodeTouch | null;
  declared: HeardAboutAnswer | null;
  lookbackDays?: number;
}
export interface JourneyStep { channel: string; detail: string; at: Date }
export interface OrderJourney { steps: JourneyStep[]; basis: CreditBasis | null }

export function journeyFor(input: JourneyInput): OrderJourney {
  const lookbackMs = (input.lookbackDays ?? LOOKBACK_DAYS) * 86_400_000;
  const t0 = input.orderAt.getTime();
  const inWindow = input.observed
    .filter((t) => t.at.getTime() <= t0 && t0 - t.at.getTime() <= lookbackMs)
    .sort((a, b) => a.at.getTime() - b.at.getTime() || (a.touchId < b.touchId ? -1 : a.touchId > b.touchId ? 1 : 0));
  // Two tabs opened from the same place are one arrival (the nightly models do the same).
  const steps: JourneyStep[] = collapseConsecutive(inWindow).map((t) => ({ channel: t.channel, detail: (t as ObservedTouch).detail, at: t.at }));
  if (input.code) steps.push({ channel: input.code.kind, detail: input.code.detail, at: input.orderAt });
  if (steps.length) return { steps, basis: 'observed' };
  if (input.declared) {
    const d = declaredChannel(input.declared);
    return { steps: [{ ...d, at: input.orderAt }], basis: 'declared' };
  }
  return { steps: [], basis: null };
}

export interface OrderCredit { model: ReportModel; channel: string; detail: string; weight: number; creditedUGX: bigint; basis: CreditBasis }

const KEY_SEP = '\u001f';
const keyOf = (s: { channel: string; detail: string }) => `${s.channel}${KEY_SEP}${s.detail}`;
const unkey = (k: string) => { const i = k.indexOf(KEY_SEP); return { channel: k.slice(0, i), detail: k.slice(i + 1) }; };

/**
 * Credits for one order under every model. Weights sum to 1 per model and the
 * money is split exactly (largest remainder), so no model creates or loses a
 * shilling. An order with no evidence gets no credit rows; the report files it
 * as "No recorded source".
 */
export function creditOrder(input: JourneyInput, valueUGX: bigint): OrderCredit[] {
  const out: OrderCredit[] = [];
  const journey = journeyFor(input);
  if (journey.steps.length && journey.basis) {
    const touches = journey.steps.map((s) => ({ channel: keyOf(s), at: s.at }));
    for (const model of JOURNEY_MODELS) {
      const w = ruleWeights(RULE_OF[model], touches, input.orderAt, DEFAULT_RULE_POLICY);
      if (!w) continue;
      const alloc = allocateInteger(valueUGX, w);
      for (const k of Object.keys(w).sort()) out.push({ model, ...unkey(k), weight: w[k], creditedUGX: alloc[k], basis: journey.basis });
    }
  }
  if (input.declared) {
    const d = declaredChannel(input.declared);
    out.push({ model: 'self_reported', ...d, weight: 1, creditedUGX: valueUGX, basis: 'declared' });
  }
  return out;
}

/** A sale, for this report: not cancelled or failed, and an online order only once paid. */
export function countsAsSale(o: { status: string; paymentStatus: string; paymentMethod: string | null }): boolean {
  if (['cancelled', 'failed', 'delivery_failed'].includes(o.status)) return false;
  if (['refunded', 'reversed'].includes(o.paymentStatus)) return false;
  if (o.paymentMethod === 'pesapal' && o.paymentStatus !== 'paid') return false;
  return true;
}

/** Revenue credited to channels: the goods, not the delivery fee. */
export function goodsValueUGX(totalUGX: number, deliveryFeeUGX: number): bigint {
  return BigInt(Math.max(0, Math.round(totalUGX) - Math.max(0, Math.round(deliveryFeeUGX))));
}

// ── Weeks: Monday 00:00 in Kampala (UTC+3 all year, no daylight saving) ──────
const KAMPALA_MS = 3 * 3600_000;
const DAY_MS = 86_400_000;

export function weekStartKampala(d: Date): string {
  const local = new Date(d.getTime() + KAMPALA_MS);
  const dow = (local.getUTCDay() + 6) % 7; // Monday = 0
  const monday = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - dow * DAY_MS);
  return monday.toISOString().slice(0, 10);
}

/** The last `count` weeks, oldest first, ending with the week containing `now`. */
export function reportWeeks(now: Date, count: number): string[] {
  const n = Math.min(52, Math.max(1, Math.floor(count)));
  const current = Date.parse(`${weekStartKampala(now)}T00:00:00Z`);
  return Array.from({ length: n }, (_, i) => new Date(current - (n - 1 - i) * 7 * DAY_MS).toISOString().slice(0, 10));
}

/** The instant range the weeks cover: [first Monday 00:00 Kampala, the Monday after the last). */
export function weeksRange(weeks: string[]): { from: Date; to: Date } {
  const first = Date.parse(`${weeks[0]}T00:00:00Z`) - KAMPALA_MS;
  const last = Date.parse(`${weeks[weeks.length - 1]}T00:00:00Z`) - KAMPALA_MS;
  return { from: new Date(first), to: new Date(last + 7 * DAY_MS) };
}

// ── The weekly channel report ────────────────────────────────────────────────
export interface SaleRow { orderId: string; orderAt: Date; revenueUGX: bigint }
export interface CreditRow { orderId: string; channel: string; detail: string; weight: number; creditedUGX: bigint; basis: CreditBasis }
export interface SpendRow { weekStart: string; channel: string; spendUGX: bigint }
export type SpendInput =
  | { status: 'NOT_AVAILABLE'; excludedCurrencies?: string[] }
  | { status: 'AVAILABLE'; rows: SpendRow[]; excludedCurrencies?: string[] };

/**
 * The report channel a media-spend row belongs to. It must be the channel the
 * CLICKS from that spend land in, or ROAS divides one channel's sales by another's
 * cost: every Google Ads click carries a gclid, which the landing classifier files
 * as paid search whatever the campaign type (display, video, PMax, Shopping).
 */
export function reportChannelForSpend(mediaChannel: string, platform: string): string {
  const ch = (mediaChannel ?? '').toLowerCase();
  const p = (platform ?? '').toLowerCase();
  if (/google|microsoft|bing/.test(p)) return 'paid_search';
  if (ch === 'paid_social' || /meta|facebook|instagram|tiktok|snap|pinterest|linkedin|twitter|\bx\b/.test(p)) return 'paid_social';
  if (['paid_search', 'paid_shopping', 'paid_pmax'].includes(ch)) return 'paid_search';
  if (['paid_display', 'paid_video', 'display'].includes(ch)) return 'display';
  if (ch === 'affiliate') return 'affiliate';
  return 'other_paid';
}

export interface WeekCell { weekStart: string; orders: number; revenueUGX: string; spendUGX: string | null }
export interface ChannelLine {
  channel: string;
  label: string;
  orders: number;
  revenueUGX: string;
  declaredOrders: number;
  /** null = no spend recorded for this channel (or no spend data at all). */
  spendUGX: string | null;
  /** Revenue ÷ spend; null when there is no spend to divide by. */
  roas: number | null;
  /** Spend ÷ orders; null without spend or without orders. */
  costPerOrderUGX: string | null;
  trend: WeekCell[];
}
export interface WeeklyChannelReport {
  model: ReportModel;
  modelLabel: string;
  weeks: string[];
  from: string;
  to: string;
  spendStatus: 'NOT_AVAILABLE' | 'AVAILABLE';
  /** Spend held in other currencies: named, never converted into UGX. */
  spendExcludedCurrencies: string[];
  sales: number;
  empty: boolean;
  channels: ChannelLine[];
  totals: { orders: number; revenueUGX: string; spendUGX: string | null; roas: number | null; costPerOrderUGX: string | null };
  weekly: WeekCell[];
  /** Creators and promo codes by name, so influencer sales sit next to ads. */
  creatorsAndCodes: Array<{ channel: string; detail: string; orders: number; revenueUGX: string }>;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const ratio = (num: bigint, den: bigint): number | null => (den > 0n ? round2(Number(num) / Number(den)) : null);
const perOrder = (spend: bigint | null, orders: number): string | null =>
  spend !== null && spend > 0n && orders > 0 ? String(Math.round(Number(spend) / orders)) : null;

export function buildWeeklyChannelReport(input: {
  model: ReportModel;
  weeks: string[];
  sales: SaleRow[];
  credits: CreditRow[];
  spend: SpendInput;
}): WeeklyChannelReport {
  const { weeks, model } = input;
  const weekSet = new Set(weeks);
  const saleById = new Map(input.sales.map((s) => [s.orderId, s]));
  type Acc = { orders: number; revenue: bigint; declared: number; byWeek: Map<string, { orders: number; revenue: bigint }> };
  const acc = new Map<string, Acc>();
  const bucket = (ch: string) => {
    if (!acc.has(ch)) acc.set(ch, { orders: 0, revenue: 0n, declared: 0, byWeek: new Map() });
    return acc.get(ch)!;
  };
  const add = (ch: string, week: string, orders: number, revenue: bigint, declared: boolean) => {
    const a = bucket(ch);
    a.orders += orders; a.revenue += revenue; if (declared) a.declared += orders;
    const w = a.byWeek.get(week) ?? { orders: 0, revenue: 0n };
    w.orders += orders; w.revenue += revenue; a.byWeek.set(week, w);
  };
  const details = new Map<string, { channel: string; detail: string; orders: number; revenue: bigint }>();
  const credited = new Set<string>();
  for (const c of input.credits) {
    const sale = saleById.get(c.orderId);
    if (!sale) continue; // cancelled, unpaid or outside the window: not a sale here
    const week = weekStartKampala(sale.orderAt);
    if (!weekSet.has(week)) continue;
    credited.add(c.orderId);
    add(c.channel, week, c.weight, c.creditedUGX, c.basis === 'declared');
    if ((c.channel === 'creator' || c.channel === 'promo_code') && c.detail) {
      const k = `${c.channel}${KEY_SEP}${c.detail}`;
      const d = details.get(k) ?? { channel: c.channel, detail: c.detail, orders: 0, revenue: 0n };
      d.orders += c.weight; d.revenue += c.creditedUGX; details.set(k, d);
    }
  }
  let salesInWeeks = 0;
  for (const s of input.sales) {
    const week = weekStartKampala(s.orderAt);
    if (!weekSet.has(week)) continue;
    salesInWeeks++;
    if (!credited.has(s.orderId)) add('unattributed', week, 1, s.revenueUGX, false);
  }

  const spendBy = new Map<string, Map<string, bigint>>();
  if (input.spend.status === 'AVAILABLE') {
    for (const r of input.spend.rows) {
      if (!weekSet.has(r.weekStart)) continue;
      if (!spendBy.has(r.channel)) spendBy.set(r.channel, new Map());
      const m = spendBy.get(r.channel)!;
      m.set(r.weekStart, (m.get(r.weekStart) ?? 0n) + r.spendUGX);
      bucket(r.channel); // a channel with spend and no sale still shows
    }
  }
  const spendTotal = (ch: string): bigint | null => {
    const m = spendBy.get(ch);
    return m ? [...m.values()].reduce((a, b) => a + b, 0n) : null;
  };

  const channels: ChannelLine[] = [...acc.entries()].map(([channel, a]) => {
    const spend = spendTotal(channel);
    return {
      channel,
      label: channelLabel(channel),
      orders: round2(a.orders),
      revenueUGX: a.revenue.toString(),
      declaredOrders: round2(a.declared),
      spendUGX: spend === null ? null : spend.toString(),
      roas: spend === null ? null : ratio(a.revenue, spend),
      costPerOrderUGX: perOrder(spend, a.orders),
      trend: weeks.map((wk) => {
        const w = a.byWeek.get(wk);
        const s = spendBy.get(channel)?.get(wk);
        return { weekStart: wk, orders: round2(w?.orders ?? 0), revenueUGX: (w?.revenue ?? 0n).toString(), spendUGX: s === undefined ? null : s.toString() };
      }),
    };
  }).sort((x, y) => (x.channel === 'unattributed' ? 1 : y.channel === 'unattributed' ? -1 : Number(BigInt(y.revenueUGX) - BigInt(x.revenueUGX)) || y.orders - x.orders || (x.channel < y.channel ? -1 : 1)));

  const revenueTotal = channels.reduce((s, c) => s + BigInt(c.revenueUGX), 0n);
  const spendAll = input.spend.status === 'AVAILABLE' ? [...spendBy.keys()].reduce((s, ch) => s + (spendTotal(ch) ?? 0n), 0n) : null;
  const weekly: WeekCell[] = weeks.map((wk) => {
    let orders = 0; let revenue = 0n; let spend: bigint | null = input.spend.status === 'AVAILABLE' ? 0n : null;
    for (const c of channels) {
      const cell = c.trend.find((t) => t.weekStart === wk)!;
      orders += cell.orders; revenue += BigInt(cell.revenueUGX);
      if (spend !== null && cell.spendUGX !== null) spend += BigInt(cell.spendUGX);
    }
    return { weekStart: wk, orders: round2(orders), revenueUGX: revenue.toString(), spendUGX: spend === null ? null : spend.toString() };
  });
  const range = weeksRange(weeks);
  return {
    model,
    modelLabel: MODEL_LABELS[model].label,
    weeks,
    from: range.from.toISOString(),
    to: range.to.toISOString(),
    spendStatus: input.spend.status,
    spendExcludedCurrencies: input.spend.excludedCurrencies ?? [],
    sales: salesInWeeks,
    empty: salesInWeeks === 0 && spendBy.size === 0,
    channels,
    totals: {
      orders: salesInWeeks,
      revenueUGX: revenueTotal.toString(),
      spendUGX: spendAll === null ? null : spendAll.toString(),
      roas: spendAll === null ? null : ratio(revenueTotal, spendAll),
      costPerOrderUGX: perOrder(spendAll, salesInWeeks),
    },
    weekly,
    creatorsAndCodes: [...details.values()]
      .map((d) => ({ channel: d.channel, detail: d.detail, orders: round2(d.orders), revenueUGX: d.revenue.toString() }))
      .sort((a, b) => Number(BigInt(b.revenueUGX) - BigInt(a.revenueUGX)) || (a.detail < b.detail ? -1 : 1)),
  };
}

/**
 * CSV rows (header first). Empty values are written as the words the page
 * shows ("No spend data", "No data"), never as 0: a zero would be a claim.
 */
export function channelReportCsvRows(r: WeeklyChannelReport): string[][] {
  const noSpend = r.spendStatus === 'NOT_AVAILABLE' ? 'No spend data' : 'No spend recorded';
  const rows: string[][] = [['model', 'week_start', 'channel', 'channel_label', 'credited_orders', 'revenue_ugx', 'spend_ugx', 'roas', 'cost_per_order_ugx']];
  if (r.empty) {
    rows.push([r.model, '', '', 'No data', '', '', '', '', '']);
    return rows;
  }
  for (const c of r.channels) {
    for (const t of c.trend) {
      if (t.orders === 0 && t.spendUGX === null && BigInt(t.revenueUGX) === 0n) continue;
      const spend = t.spendUGX === null ? null : BigInt(t.spendUGX);
      rows.push([
        r.model, t.weekStart, c.channel, c.label, String(t.orders), t.revenueUGX,
        spend === null ? noSpend : spend.toString(),
        spend === null ? 'No data' : String(ratio(BigInt(t.revenueUGX), spend) ?? 'No data'),
        spend === null ? 'No data' : (perOrder(spend, t.orders) ?? 'No data'),
      ]);
    }
  }
  return rows;
}
