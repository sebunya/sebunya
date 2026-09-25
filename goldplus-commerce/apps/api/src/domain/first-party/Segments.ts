/**
 * Rule-based customer segments (0155). Pure: a definition is validated here
 * and evaluated here against CustomerFacts; storage, scheduling and consent
 * filtering live elsewhere.
 *
 * A segment says WHO matches a rule. It says nothing about whether anyone may
 * be contacted or advertised to: every consumer applies its own consent gate
 * (advertising: AdvertisingConsentGate; WhatsApp: whatsapp_marketing).
 */
import { CustomerFacts, classifyOrder, countedOrders, realisedSpendUgx } from './CustomerFacts';
import { paymentHabitOf, rfmForPopulation } from './CustomerTraits';
import type { RfmSegment } from '../customer-dna/Rfm';

const DAY_MS = 86_400_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type SegmentRule =
  /** Placed an order containing this category, at least N days ago. */
  | { kind: 'BOUGHT_IN_CATEGORY'; categoryId: string; moreThanDaysAgo: number }
  /** Left a basket with items, not turned into an order, updated in the last N days. */
  | { kind: 'ABANDONED_BASKET'; withinDays: number }
  /** Realised (paid or delivered) lifetime spend of at least this many UGX. */
  | { kind: 'LIFETIME_SPEND_AT_LEAST'; amountUgx: number }
  /** Has sent a bulk quote request (a BQ- reference). */
  | { kind: 'BULK_BUYER' }
  /** Placed at least N orders (default 2). */
  | { kind: 'REPEAT_BUYER'; minOrders: number }
  /** Has ordered before, but not in the last N days. */
  | { kind: 'LAPSED'; noOrderForDays: number }
  /** 0157: RFM segment (quintiles among customers who have ordered). */
  | { kind: 'RFM_SEGMENT'; segments: RfmSegment[] }
  /** 0157: how they usually pay (two thirds or more of their orders). */
  | { kind: 'PAYMENT_HABIT'; habit: 'CASH_ON_DELIVERY' | 'ONLINE' | 'MIXED' }
  /** 0157: most of their deliveries went to this district. */
  | { kind: 'DISTRICT'; district: string };

export type SegmentRuleKind = SegmentRule['kind'];

export const SEGMENT_RULE_KINDS: readonly SegmentRuleKind[] = [
  'BOUGHT_IN_CATEGORY', 'ABANDONED_BASKET', 'LIFETIME_SPEND_AT_LEAST', 'BULK_BUYER', 'REPEAT_BUYER', 'LAPSED',
  'RFM_SEGMENT', 'PAYMENT_HABIT', 'DISTRICT',
];

export const RFM_SEGMENT_NAMES: readonly RfmSegment[] = [
  'Champions', 'Loyal', 'Potential Loyalist', 'New', 'Promising', 'Needs Attention', 'At Risk', "Can't Lose", 'Hibernating', 'Lost',
];
export const PAYMENT_HABITS = ['CASH_ON_DELIVERY', 'ONLINE', 'MIXED'] as const;

/** Population-level inputs a rule may need (computed once per evaluation run). */
export interface SegmentContext {
  rfm?: Map<string, { segment: RfmSegment }>;
}

export interface SegmentDefinition {
  match: 'ALL' | 'ANY';
  rules: SegmentRule[];
}

export const MAX_RULES = 8;
const MAX_DAYS = 3650;
const MAX_UGX = 10_000_000_000;

function intIn(v: unknown, min: number, max: number): number | null {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isInteger(n) && n >= min && n <= max ? n : null;
}

/** Validate an untrusted definition (admin form / API body). */
export function validateSegmentDefinition(raw: unknown):
  | { ok: true; definition: SegmentDefinition }
  | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const obj = (raw ?? {}) as { match?: unknown; rules?: unknown };
  const match = obj.match === 'ANY' ? 'ANY' : obj.match === 'ALL' || obj.match === undefined ? 'ALL' : null;
  if (!match) errors.push('match must be ALL or ANY');
  if (!Array.isArray(obj.rules) || obj.rules.length === 0) {
    errors.push('at least one rule is required');
    return { ok: false, errors };
  }
  if (obj.rules.length > MAX_RULES) errors.push(`at most ${MAX_RULES} rules`);
  const rules: SegmentRule[] = [];
  obj.rules.forEach((r: any, i: number) => {
    const at = `rule ${i + 1}`;
    switch (r?.kind) {
      case 'BOUGHT_IN_CATEGORY': {
        const d = intIn(r.moreThanDaysAgo, 0, MAX_DAYS);
        if (!UUID.test(String(r.categoryId ?? ''))) errors.push(`${at}: choose a category`);
        if (d === null) errors.push(`${at}: days must be a whole number from 0 to ${MAX_DAYS}`);
        if (UUID.test(String(r.categoryId ?? '')) && d !== null) rules.push({ kind: 'BOUGHT_IN_CATEGORY', categoryId: String(r.categoryId).toLowerCase(), moreThanDaysAgo: d });
        break;
      }
      case 'ABANDONED_BASKET': {
        const d = intIn(r.withinDays, 1, 90);
        if (d === null) errors.push(`${at}: days must be a whole number from 1 to 90`);
        else rules.push({ kind: 'ABANDONED_BASKET', withinDays: d });
        break;
      }
      case 'LIFETIME_SPEND_AT_LEAST': {
        const a = intIn(r.amountUgx, 1, MAX_UGX);
        if (a === null) errors.push(`${at}: amount must be a whole number of shillings above 0`);
        else rules.push({ kind: 'LIFETIME_SPEND_AT_LEAST', amountUgx: a });
        break;
      }
      case 'BULK_BUYER':
        rules.push({ kind: 'BULK_BUYER' });
        break;
      case 'REPEAT_BUYER': {
        const m = r.minOrders === undefined || r.minOrders === '' ? 2 : intIn(r.minOrders, 2, 1000);
        if (m === null) errors.push(`${at}: minimum orders must be a whole number from 2`);
        else rules.push({ kind: 'REPEAT_BUYER', minOrders: m });
        break;
      }
      case 'LAPSED': {
        const d = intIn(r.noOrderForDays, 1, MAX_DAYS);
        if (d === null) errors.push(`${at}: days must be a whole number from 1 to ${MAX_DAYS}`);
        else rules.push({ kind: 'LAPSED', noOrderForDays: d });
        break;
      }
      case 'RFM_SEGMENT': {
        const raw = Array.isArray(r.segments) ? r.segments : typeof r.segments === 'string' ? [r.segments] : [];
        const picked = RFM_SEGMENT_NAMES.filter((n) => raw.includes(n));
        if (picked.length === 0 || picked.length !== new Set(raw).size) errors.push(`${at}: choose one or more RFM segments`);
        else rules.push({ kind: 'RFM_SEGMENT', segments: picked });
        break;
      }
      case 'PAYMENT_HABIT': {
        if (!(PAYMENT_HABITS as readonly string[]).includes(String(r.habit))) errors.push(`${at}: choose a payment habit`);
        else rules.push({ kind: 'PAYMENT_HABIT', habit: r.habit });
        break;
      }
      case 'DISTRICT': {
        const district = typeof r.district === 'string' ? r.district.trim() : '';
        if (district.length < 2 || district.length > 80) errors.push(`${at}: name a district`);
        else rules.push({ kind: 'DISTRICT', district });
        break;
      }
      default:
        errors.push(`${at}: unknown rule kind`);
    }
  });
  if (errors.length) return { ok: false, errors };
  return { ok: true, definition: { match: match!, rules } };
}

export function evaluateRule(rule: SegmentRule, f: CustomerFacts, now: Date, ctx: SegmentContext = {}): boolean {
  const t = now.getTime();
  switch (rule.kind) {
    case 'BOUGHT_IN_CATEGORY': {
      const cutoff = t - rule.moreThanDaysAgo * DAY_MS;
      return f.orders.some((o) => classifyOrder(o).counted && o.placedAt.getTime() <= cutoff && o.categoryIds.map((c) => c.toLowerCase()).includes(rule.categoryId));
    }
    case 'ABANDONED_BASKET': {
      const since = t - rule.withinDays * DAY_MS;
      return f.abandonedBaskets.some((b) => b.itemCount > 0 && b.updatedAt.getTime() >= since && b.updatedAt.getTime() <= t);
    }
    case 'LIFETIME_SPEND_AT_LEAST':
      return realisedSpendUgx(f) >= rule.amountUgx;
    case 'BULK_BUYER':
      return f.bulkQuotes.length > 0;
    case 'REPEAT_BUYER':
      return countedOrders(f).length >= rule.minOrders;
    case 'LAPSED': {
      const orders = countedOrders(f);
      if (orders.length === 0) return false;
      const last = orders[orders.length - 1].placedAt.getTime();
      return t - last > rule.noOrderForDays * DAY_MS;
    }
    case 'RFM_SEGMENT': {
      const s = ctx.rfm?.get(f.canonicalCustomerId)?.segment;
      return !!s && rule.segments.includes(s);
    }
    case 'PAYMENT_HABIT':
      return paymentHabitOf(countedOrders(f).map((o) => o.paymentMethod ?? null))?.habit === rule.habit;
    case 'DISTRICT': {
      const districts = countedOrders(f).map((o) => o.district?.trim().toLowerCase()).filter((d): d is string => !!d);
      if (districts.length === 0) return false;
      const want = rule.district.toLowerCase();
      return districts.filter((d) => d === want).length * 2 > districts.length;
    }
  }
}

export function evaluateSegment(def: SegmentDefinition, f: CustomerFacts, now: Date, ctx: SegmentContext = {}): boolean {
  if (def.rules.length === 0) return false;
  return def.match === 'ALL' ? def.rules.every((r) => evaluateRule(r, f, now, ctx)) : def.rules.some((r) => evaluateRule(r, f, now, ctx));
}

/** The population inputs a set of definitions needs (RFM only when a rule uses it). */
export function segmentContextFor(defs: SegmentDefinition[], facts: CustomerFacts[], now: Date): SegmentContext {
  const needsRfm = defs.some((d) => d.rules.some((r) => r.kind === 'RFM_SEGMENT'));
  return needsRfm ? { rfm: rfmForPopulation(facts, now) } : {};
}

/** Members of a segment, in stable order. */
export function segmentMembers(def: SegmentDefinition, facts: CustomerFacts[], now: Date, ctx?: SegmentContext): string[] {
  const context = ctx ?? segmentContextFor([def], facts, now);
  return facts.filter((f) => evaluateSegment(def, f, now, context)).map((f) => f.canonicalCustomerId).sort();
}

/** Human description of a rule, for the admin list. */
export function describeRule(rule: SegmentRule, categoryName?: (id: string) => string | undefined): string {
  switch (rule.kind) {
    case 'BOUGHT_IN_CATEGORY': return `Bought in ${categoryName?.(rule.categoryId) ?? 'a category'} ${rule.moreThanDaysAgo} or more days ago`;
    case 'ABANDONED_BASKET': return `Left a basket in the last ${rule.withinDays} day${rule.withinDays === 1 ? '' : 's'}`;
    case 'LIFETIME_SPEND_AT_LEAST': return `Paid or delivered spend of at least UGX ${rule.amountUgx.toLocaleString('en-UG')}`;
    case 'BULK_BUYER': return 'Has sent a bulk quote request';
    case 'REPEAT_BUYER': return `Placed ${rule.minOrders} or more orders`;
    case 'LAPSED': return `Has ordered, but not in the last ${rule.noOrderForDays} days`;
    case 'RFM_SEGMENT': return `RFM segment is ${rule.segments.join(' or ')}`;
    case 'PAYMENT_HABIT': return rule.habit === 'CASH_ON_DELIVERY' ? 'Usually pays cash on delivery' : rule.habit === 'ONLINE' ? 'Usually pays online' : 'Pays both ways';
    case 'DISTRICT': return `Most deliveries go to ${rule.district}`;
  }
}

/** A stable key from a name: lower-case, dashes, 3–64 characters. */
export function segmentKeyFromName(name: string): string | null {
  const key = name.trim().toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
  return key.length >= 3 ? key : null;
}
