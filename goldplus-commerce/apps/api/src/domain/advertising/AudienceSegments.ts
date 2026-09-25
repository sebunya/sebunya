import { normaliseEmail, phoneDigitsE164 } from './ContactNormalisation';

/**
 * Audience segments built from REAL orders (docs/advertising/README.md,
 * "Audiences"). Pure: orders in, people out.
 *
 * A buyer is a person, not an order: orders that share a user account, an
 * email or a phone number are one person (union-find over those keys), so a
 * customer who bought three times is one list member with three orders.
 *
 * A qualifying order is one that became a sale: delivered or completed, or
 * paid and not cancelled/failed. A placed-but-unpaid order is not a buyer.
 */

export const AUDIENCE_SEGMENTS = ['past_buyers', 'recent_buyers', 'high_value'] as const;
export type AudienceSegment = typeof AUDIENCE_SEGMENTS[number];

export interface SegmentInfo {
  key: AudienceSegment;
  label: string;
  purpose: string;
  /** Google Customer Match membership life span (days, max 540). */
  membershipDays: number;
}

export const SEGMENT_INFO: Record<AudienceSegment, SegmentInfo> = {
  past_buyers: { key: 'past_buyers', label: 'Past buyers', purpose: 'Everyone who has bought. Use for retention, or as the seed for a lookalike audience.', membershipDays: 540 },
  recent_buyers: { key: 'recent_buyers', label: 'Recent buyers (exclusion)', purpose: 'Bought in the last N days. Add as an EXCLUSION so ads are not shown to someone who has just bought.', membershipDays: 30 },
  high_value: { key: 'high_value', label: 'High-value seed', purpose: 'The buyers with the highest lifetime spend. Use as a lookalike seed.', membershipDays: 540 },
};

export interface BuyerOrder {
  orderId: string;
  userId: string | null;
  email: string | null;
  phone: string | null;
  fpClientId: string | null;
  totalUgx: number;
  purchasedAt: Date;
  status: string;
  paymentStatus: string;
  /**
   * Browsers and accounts the first-party identity graph ties to this order's
   * customer (customer_identity_links). Consent subjects only: they decide who
   * is left out, never who counts as the same person.
   */
  linkedFpClientIds?: string[];
  linkedUserIds?: string[];
}

export interface Buyer {
  key: string;
  /** Every account and browser of this person (own and identity-graph linked): the consent subjects. */
  userIds: string[];
  fpClientIds: string[];
  emails: string[];
  phones: string[];
  orderIds: string[];
  orderCount: number;
  lifetimeUgx: number;
  lastPurchaseAt: Date;
}

export interface SegmentPolicy {
  /** recent_buyers window. */
  recentDays: number;
  /** high_value: lifetime spend at or above this (UGX). When null, the top share is used. */
  highValueMinUgx: number | null;
  /** high_value when no threshold is set: the top fraction of buyers by lifetime spend. */
  highValueTopShare: number;
}

export const DEFAULT_SEGMENT_POLICY: SegmentPolicy = { recentDays: 30, highValueMinUgx: null, highValueTopShare: 0.2 };

export function isQualifyingOrder(o: Pick<BuyerOrder, 'status' | 'paymentStatus'>): boolean {
  if (o.status === 'delivered' || o.status === 'completed') return true;
  return o.paymentStatus === 'paid' && o.status !== 'cancelled' && o.status !== 'failed';
}

/** Groups qualifying orders into people. Deterministic: the output is sorted by key. */
export function groupBuyers(orders: BuyerOrder[]): Buyer[] {
  const qualifying = orders.filter(isQualifyingOrder);
  const parent = qualifying.map((_, i) => i);
  const find = (i: number): number => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const union = (a: number, b: number) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb); };
  const firstSeen = new Map<string, number>();
  qualifying.forEach((o, i) => {
    const keys = [o.userId ? `u:${o.userId}` : null, normaliseEmail(o.email) ? `e:${normaliseEmail(o.email)}` : null, phoneDigitsE164(o.phone) ? `p:${phoneDigitsE164(o.phone)}` : null].filter((k): k is string => !!k);
    for (const k of keys) {
      const seen = firstSeen.get(k);
      if (seen === undefined) firstSeen.set(k, i); else union(i, seen);
    }
  });
  const groups = new Map<number, BuyerOrder[]>();
  qualifying.forEach((o, i) => { const r = find(i); groups.set(r, [...(groups.get(r) ?? []), o]); });
  const uniq = (xs: Array<string | null>) => [...new Set(xs.filter((x): x is string => !!x))].sort();
  const buyers = [...groups.values()].map((os): Buyer => {
    const emails = uniq(os.map((o) => normaliseEmail(o.email)));
    const phones = uniq(os.map((o) => phoneDigitsE164(o.phone)));
    const ownUserIds = uniq(os.map((o) => o.userId));
    const userIds = uniq([...ownUserIds, ...os.flatMap((o) => o.linkedUserIds ?? [])]);
    return {
      key: ownUserIds[0] ? `u:${ownUserIds[0]}` : phones[0] ? `p:${phones[0]}` : emails[0] ? `e:${emails[0]}` : `o:${os[0].orderId}`,
      userIds, fpClientIds: uniq([...os.map((o) => o.fpClientId), ...os.flatMap((o) => o.linkedFpClientIds ?? [])]), emails, phones,
      orderIds: uniq(os.map((o) => o.orderId)), orderCount: os.length,
      lifetimeUgx: os.reduce((s, o) => s + Math.max(0, Math.round(o.totalUgx)), 0),
      lastPurchaseAt: new Date(Math.max(...os.map((o) => o.purchasedAt.getTime()))),
    };
  });
  return buyers.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/** The members of one segment. */
export function selectSegment(buyers: Buyer[], segment: AudienceSegment, policy: SegmentPolicy = DEFAULT_SEGMENT_POLICY, now: Date = new Date()): Buyer[] {
  if (segment === 'past_buyers') return buyers;
  if (segment === 'recent_buyers') {
    const since = now.getTime() - Math.max(1, policy.recentDays) * 86_400_000;
    return buyers.filter((b) => b.lastPurchaseAt.getTime() >= since);
  }
  if (policy.highValueMinUgx != null) return buyers.filter((b) => b.lifetimeUgx >= policy.highValueMinUgx!);
  if (buyers.length === 0) return [];
  const share = Math.min(1, Math.max(0.01, policy.highValueTopShare));
  const n = Math.max(1, Math.ceil(buyers.length * share));
  const ranked = [...buyers].sort((a, b) => b.lifetimeUgx - a.lifetimeUgx || (a.key < b.key ? -1 : 1));
  // Ties at the cut are all in: two buyers who spent the same are not split arbitrarily.
  const cut = ranked[n - 1].lifetimeUgx;
  return ranked.filter((b) => b.lifetimeUgx >= cut);
}

/** Owner-entered policy values, validated; anything unreadable falls back to the default. */
export function parseSegmentPolicy(cfg: Record<string, string | undefined>): SegmentPolicy {
  const days = Number(cfg.recentDays);
  const min = cfg.highValueMinUgx != null && cfg.highValueMinUgx !== '' ? Number(cfg.highValueMinUgx) : NaN;
  return {
    recentDays: Number.isInteger(days) && days >= 1 && days <= 540 ? days : DEFAULT_SEGMENT_POLICY.recentDays,
    highValueMinUgx: Number.isInteger(min) && min > 0 ? min : null,
    highValueTopShare: DEFAULT_SEGMENT_POLICY.highValueTopShare,
  };
}
