import { normaliseWhatsAppRef } from '@goldplus/shared';
/**
 * Offline conversions (docs/advertising/README.md, "Offline conversions").
 * Pure decisions; the use case applies them and the gateway sends.
 *
 * Sources:
 *  - COD_DELIVERED: a pay-on-delivery order the rider handed over (the
 *    authoritative `order_delivered` business event, payment method offline).
 *  - ADMIN_SALE: a phone or WhatsApp sale an admin recorded by hand.
 *
 * Deduplication against online events: a COD order already reached (or is
 * still on its way to) a platform as an online Purchase when it was placed
 * (decision D-006). The offline conversion for it is then NOT sent
 * (DUPLICATE_ONLINE). When it is sent, it carries the SAME event id and order
 * id as the online purchase would have, so the platform's own dedupe also
 * catches a race.
 */

export const OFFLINE_PLATFORMS = ['google_ads', 'meta', 'tiktok'] as const;
export type OfflinePlatform = typeof OFFLINE_PLATFORMS[number];
export type OfflineSource = 'COD_DELIVERED' | 'ADMIN_SALE';
export type OfflineChannel = 'PHONE' | 'WHATSAPP';

/**
 * Delivery-intent states in which the online purchase has reached the
 * platform, or may have, or still will: an offline copy would count the sale twice.
 */
const ONLINE_REACHED_OR_PENDING = new Set(['ACCEPTED', 'PROCESSED', 'PENDING', 'LEASED', 'RETRY_WAIT', 'UNKNOWN_OUTCOME', 'QUARANTINED']);

export function onlinePurchaseCoversSale(intentState: string | null | undefined): boolean {
  return !!intentState && ONLINE_REACHED_OR_PENDING.has(intentState);
}

/**
 * Meta's documented action_source for the way the sale happened
 * (Conversions API server-event parameters): a phone sale is `phone_call`, a
 * WhatsApp chat sale is `chat`, a cash-on-delivery hand-over in person is
 * `physical_store`.
 */
export function metaActionSource(source: OfflineSource, channel: OfflineChannel | null): 'physical_store' | 'phone_call' | 'chat' {
  if (source === 'COD_DELIVERED') return 'physical_store';
  return channel === 'WHATSAPP' ? 'chat' : 'phone_call';
}

/** How long before a sale an advert click may be and still be the click that led to it (the networks' own windows). */
export const REF_CLICK_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * The advert click a referenced WhatsApp sale is credited to: the click ids on
 * the record of the visitor the code was issued to, when that click happened
 * BEFORE the sale and no more than 30 days before it. A click made after the
 * sale did not lead to it; an older one is outside every network's window.
 */
export function refClickIds(record: { clickedAt: Date | string | null; ids: Record<string, string | null | undefined> } | null, saleAt: Date): Record<string, string> {
  if (!record?.clickedAt) return {};
  const at = new Date(record.clickedAt).getTime();
  if (!Number.isFinite(at) || at > saleAt.getTime() || saleAt.getTime() - at > REF_CLICK_MAX_AGE_MS) return {};
  return Object.fromEntries(Object.entries(record.ids).filter(([, v]) => typeof v === 'string' && v.length > 0)) as Record<string, string>;
}

/** How old an offline conversion may be when it is sent (days). */
export const SEND_WINDOW_DAYS: Record<OfflinePlatform, number> = {
  // Meta: event_time may be up to 7 days before it is sent.
  meta: 7,
  // TikTok Events API: the same 7-day window as its web events.
  tiktok: 7,
  // Google Ads: an imported click conversion must be within 90 days of the click.
  google_ads: 90,
};

export function withinSendWindow(platform: OfflinePlatform, occurredAt: Date, now: Date = new Date()): boolean {
  return now.getTime() - occurredAt.getTime() <= SEND_WINDOW_DAYS[platform] * 86_400_000 && occurredAt.getTime() <= now.getTime() + 5 * 60_000;
}

export const MAX_OFFLINE_ATTEMPTS = 5;
const BACKOFF_MS = [60_000, 10 * 60_000, 60 * 60_000, 6 * 3600_000];

/** After a failed send: retry later, or give up (a 4xx other than 429 will not fix itself). */
export function afterFailure(attempt: number, httpStatus: number | null): { state: 'PENDING' | 'FAILED'; delayMs: number } {
  const permanent = httpStatus != null && httpStatus >= 400 && httpStatus < 500 && httpStatus !== 429;
  if (permanent || attempt >= MAX_OFFLINE_ATTEMPTS) return { state: 'FAILED', delayMs: 0 };
  return { state: 'PENDING', delayMs: BACKOFF_MS[Math.min(attempt - 1, BACKOFF_MS.length - 1)] };
}

export interface OfflineSaleInput {
  channel: string;
  occurredAt: string;
  valueUgx: unknown;
  orderNumber?: string | null;
  email?: string | null;
  phone?: string | null;
  note?: string | null;
  /** The "Ref GP-XXXXXX" code in the customer's WhatsApp message, as staff typed it. */
  whatsappRef?: string | null;
}

/** An admin-recorded sale's validation: the reasons it cannot be recorded, or none. */
export function offlineSaleErrors(i: OfflineSaleInput, now: Date = new Date()): string[] {
  const e: string[] = [];
  if (i.channel !== 'PHONE' && i.channel !== 'WHATSAPP') e.push('Choose phone or WhatsApp.');
  const t = Date.parse(i.occurredAt);
  if (Number.isNaN(t)) e.push('Enter when the sale happened.');
  else if (t > now.getTime() + 5 * 60_000) e.push('The sale cannot be in the future.');
  const v = Number(i.valueUgx);
  if (!Number.isInteger(v) || v <= 0 || v > 1_000_000_000) e.push('Enter the sale value in whole UGX.');
  const hasContact = !!String(i.email ?? '').trim() || !!String(i.phone ?? '').trim();
  const typedRef = String(i.whatsappRef ?? '').trim();
  const ref = typedRef ? normaliseWhatsAppRef(typedRef) : null;
  if (typedRef && !ref) e.push('The reference code is "GP-" and six characters, as it appears after "Ref" in the customer\'s first message.');
  if (!hasContact && !String(i.orderNumber ?? '').trim() && !ref) e.push('Enter the customer\'s phone or email, the order number, or the reference code from their WhatsApp message: without one no platform can match the sale.');
  if (String(i.note ?? '').length > 300) e.push('Keep the note under 300 characters.');
  return e;
}

/** Whether the platform has anything to match this sale on (a click id of its own, or a hashed contact). */
export function hasMatchKey(platform: OfflinePlatform, ctx: { clickIds: Record<string, string>; hashes: { emailSha256: string | null; emailGoogleSha256: string | null; phoneDigitsSha256: string | null; phonePlusSha256: string | null } }): boolean {
  const c = ctx.clickIds, h = ctx.hashes;
  if (platform === 'google_ads') return !!(c.gclid || c.gbraid || c.wbraid || h.emailGoogleSha256 || h.phonePlusSha256);
  if (platform === 'meta') return !!(c.fbc || h.emailSha256 || h.phoneDigitsSha256);
  return !!(c.ttclid || h.emailSha256 || h.phonePlusSha256);
}
