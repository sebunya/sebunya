import { minorDigits } from './SpendFacts';

/**
 * Google Ads sales by campaign and campaign type (2026-10-17): YouTube, Search, Shopping, Performance Max, Display,
 * Demand Gen. Pure: sales and spend in, rows out.
 *
 * Every Google ad click carries a gclid (or gbraid/wbraid on iOS), which our channel report files as one "paid
 * search" row. To tell YouTube from Search, each click also keeps what Google puts on the landing URL:
 *   - `gad_campaignid` (auto-tagging adds it): joins the sale to the campaign the spend import names, and so to its
 *     campaign type (Google Ads advertising_channel_type);
 *   - `gp_net`, the ValueTrack {network} the owner adds as the account's final URL suffix (g/s Search, d Display,
 *     ytv/yts/vp YouTube, x Performance Max): the type when the campaign is not (yet) known from spend.
 * A sale with neither is "type not known", never guessed.
 */
export const GOOGLE_TYPES = ['YOUTUBE', 'SEARCH', 'SHOPPING', 'PERFORMANCE_MAX', 'DEMAND_GEN', 'DISPLAY', 'UNKNOWN'] as const;
export type GoogleType = typeof GOOGLE_TYPES[number];
export const GOOGLE_TYPE_LABEL: Record<GoogleType, string> = {
  YOUTUBE: 'YouTube', SEARCH: 'Search', SHOPPING: 'Shopping', PERFORMANCE_MAX: 'Performance Max', DEMAND_GEN: 'YouTube & Demand Gen', DISPLAY: 'Display', UNKNOWN: 'Type not known',
};

/** ValueTrack {network}: https://support.google.com/google-ads/answer/6305348 */
export function googleTypeFromNetwork(net: string | null | undefined): GoogleType | null {
  switch ((net ?? '').trim().toLowerCase()) {
    case 'g': case 's': return 'SEARCH';
    case 'd': return 'DISPLAY';
    case 'ytv': case 'yts': case 'vp': case 'gtv': return 'YOUTUBE';
    case 'x': return 'PERFORMANCE_MAX';
    default: return null;
  }
}

/** The spend import's media channel (googleChannel) → campaign type. paid_video covers VIDEO and DEMAND_GEN campaigns. */
export function googleTypeFromSpendChannel(channel: string | null | undefined): GoogleType | null {
  switch (channel) {
    case 'paid_search': return 'SEARCH';
    case 'paid_shopping': return 'SHOPPING';
    case 'paid_pmax': return 'PERFORMANCE_MAX';
    case 'paid_video': return 'DEMAND_GEN';
    case 'paid_display': return 'DISPLAY';
    default: return null;
  }
}

/** A Google campaign id as the landing URL gives it (digits only). */
export const googleCampaignIdOf = (v: unknown): string | null => (typeof v === 'string' && /^\d{1,20}$/.test(v) ? v : null);

export interface GoogleSale { orderId: string; valueUgx: number; campaignId: string | null; network: string | null }
export interface GoogleSpendRow { campaign: string; campaignLabel: string | null; channel: string; currency: string; spendMinor: number; clicks: number | null }

export interface GoogleCampaignRow {
  campaignId: string | null;
  label: string | null;
  type: GoogleType;
  /** Where the type came from: the campaign as Google reports it, the ValueTrack network on the click, or nowhere. */
  typeFrom: 'campaign' | 'network' | 'unknown';
  spend: Array<{ currency: string; spendMinor: number }>;
  clicks: number | null;
  orders: number;
  revenueUgx: number;
  /** Revenue ÷ spend in shillings: spend in UGX, or USD at the owner's stated rate; null when neither applies. */
  roas: number | null;
}

/** Shillings per US dollar the owner entered on the Google Ads card, used ONLY to state ROAS for dollar spend. */
export type UgxPerUsd = number | null;

export interface GoogleCampaignReport {
  campaigns: GoogleCampaignRow[];
  byType: Array<{ type: GoogleType; label: string; orders: number; revenueUgx: number; spend: Array<{ currency: string; spendMinor: number }>; roas: number | null }>;
  /** Google-click sales whose click did not say which campaign (clicks before 2026-10-17, or auto-tagging off). */
  salesWithoutCampaign: number;
  /** The rate dollar spend was converted at for ROAS, or null (then ROAS is stated only for shilling spend). */
  ugxPerUsd: UgxPerUsd;
}

/** Spend in shillings: UGX as is, USD at the stated rate; null when any of it is in a currency we cannot convert. */
export function spendInUgx(spend: Array<{ currency: string; spendMinor: number }>, ugxPerUsd: UgxPerUsd): number | null {
  let total = 0;
  for (const s of spend) {
    const major = s.spendMinor / 10 ** minorDigits(s.currency);
    if (s.currency === 'UGX') total += major;
    else if (s.currency === 'USD' && ugxPerUsd != null && ugxPerUsd >= 100) total += major * ugxPerUsd;
    else return null;
  }
  return total;
}

const roasWith = (ugxPerUsd: UgxPerUsd) => (revenueUgx: number, spend: Array<{ currency: string; spendMinor: number }>): number | null => {
  if (!spend.length) return null;
  const ugx = spendInUgx(spend, ugxPerUsd);
  return ugx != null && ugx > 0 ? Math.round((revenueUgx / ugx) * 100) / 100 : null;
};

const addSpend = (into: Array<{ currency: string; spendMinor: number }>, currency: string, minor: number) => {
  const cur = into.find((s) => s.currency === currency);
  if (cur) cur.spendMinor += minor; else into.push({ currency, spendMinor: minor });
};

export function googleCampaignReport(sales: GoogleSale[], spend: GoogleSpendRow[], ugxPerUsd: UgxPerUsd = null): GoogleCampaignReport {
  const rate = ugxPerUsd != null && Number.isFinite(ugxPerUsd) && ugxPerUsd >= 100 ? ugxPerUsd : null;
  const roasOf = roasWith(rate);
  const rows = new Map<string, GoogleCampaignRow>();
  const keyOf = (id: string | null, type: GoogleType) => (id ? `id:${id}` : `none:${type}`);
  const row = (id: string | null, type: GoogleType, typeFrom: GoogleCampaignRow['typeFrom']) => {
    const k = keyOf(id, type);
    let r = rows.get(k);
    if (!r) { r = { campaignId: id, label: null, type, typeFrom, spend: [], clicks: null, orders: 0, revenueUgx: 0, roas: null }; rows.set(k, r); }
    return r;
  };
  for (const s of spend) {
    const id = googleCampaignIdOf(s.campaign.replace(/^id:/, ''));
    const t = googleTypeFromSpendChannel(s.channel);
    const r = row(id, t ?? 'UNKNOWN', t ? 'campaign' : 'unknown');
    if (t && r.typeFrom !== 'campaign') { r.type = t; r.typeFrom = 'campaign'; }
    r.label = r.label ?? s.campaignLabel;
    addSpend(r.spend, s.currency, s.spendMinor);
    if (s.clicks != null) r.clicks = (r.clicks ?? 0) + s.clicks;
  }
  let salesWithoutCampaign = 0;
  for (const s of sales) {
    const id = googleCampaignIdOf(s.campaignId);
    if (!id) salesWithoutCampaign++;
    const known = id ? rows.get(`id:${id}`) : undefined;
    const net = googleTypeFromNetwork(s.network);
    const r = known ?? row(id, net ?? 'UNKNOWN', net ? 'network' : 'unknown');
    if (r.typeFrom === 'unknown' && net) { r.type = net; r.typeFrom = 'network'; }
    r.orders += 1;
    r.revenueUgx += Math.max(0, Math.round(s.valueUgx));
  }
  const campaigns = [...rows.values()].map((r) => ({ ...r, roas: roasOf(r.revenueUgx, r.spend) }))
    .sort((a, b) => b.revenueUgx - a.revenueUgx || b.orders - a.orders || String(a.campaignId).localeCompare(String(b.campaignId)));
  const byType = GOOGLE_TYPES.map((type) => {
    const rs = campaigns.filter((c) => c.type === type);
    const sp: Array<{ currency: string; spendMinor: number }> = [];
    for (const r of rs) for (const s of r.spend) addSpend(sp, s.currency, s.spendMinor);
    const revenueUgx = rs.reduce((t, r) => t + r.revenueUgx, 0);
    return { type, label: GOOGLE_TYPE_LABEL[type], orders: rs.reduce((t, r) => t + r.orders, 0), revenueUgx, spend: sp, roas: roasOf(revenueUgx, sp) };
  }).filter((t) => t.orders > 0 || t.spend.length > 0);
  return { campaigns, byType, salesWithoutCampaign, ugxPerUsd: rate };
}
