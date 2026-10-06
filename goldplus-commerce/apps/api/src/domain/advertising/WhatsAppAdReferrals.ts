import { createHmac, timingSafeEqual } from 'node:crypto';
import { sha256Hex } from './ContactNormalisation';

/**
 * Click-to-WhatsApp advert attribution (2026-10-01). Pure.
 *
 * How it works, in Meta's terms. Someone taps an advert whose button opens a
 * WhatsApp chat with the shop and sends a message. The WhatsApp Business
 * Platform's webhook delivers that message with a `referral` object naming
 * the advert and carrying Meta's click id for it, `ctwa_clid`. When a sale
 * follows, it is reported through the Conversions API as a business-messaging
 * event (`action_source: business_messaging`, `messaging_channel: whatsapp`)
 * with that click id and the WhatsApp Business Account id; that is what
 * credits the advert.
 *
 * What this module decides: whether a webhook really came from Meta, which
 * messages in it are advert referrals worth keeping, and what a sale's event
 * looks like. It keeps no message text and no phone number — the sender is
 * the SHA-256 of their number, the same hash a sale already carries.
 *
 * Sources: Meta for Developers — Webhooks (verification requests, the
 * X-Hub-Signature-256 header signed with the app secret); WhatsApp Cloud API
 * messages webhook (`messages[].referral`); Conversions API for Business
 * Messaging (required fields, supported event names).
 */

export interface WhatsAppAdReferral {
  messageId: string;
  wabaId: string;
  phoneNumberId: string | null;
  senderPhoneSha256: string;
  ctwaClid: string;
  sourceType: string | null;
  sourceId: string | null;
  sourceUrl: string | null;
  headline: string | null;
  receivedAt: Date;
}

/**
 * True when `header` is Meta's signature of exactly these bytes with this app
 * secret. Meta signs the raw request body: it must be checked before the body
 * is parsed, on the bytes as received.
 */
export function verifyWebhookSignature(rawBody: string, header: string | null | undefined, appSecret: string): boolean {
  if (!appSecret || typeof header !== 'string') return false;
  const m = /^sha256=([0-9a-f]{64})$/i.exec(header.trim());
  if (!m) return false;
  const expected = createHmac('sha256', appSecret).update(rawBody, 'utf8').digest();
  const given = Buffer.from(m[1], 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Meta's subscription check: echo the challenge only for the right mode and our own verify token. */
export function subscriptionChallenge(query: { mode?: string | null; token?: string | null; challenge?: string | null }, verifyToken: string): string | null {
  if (query.mode !== 'subscribe' || !verifyToken || typeof query.token !== 'string' || typeof query.challenge !== 'string') return null;
  const a = Buffer.from(sha256Hex(query.token)), b = Buffer.from(sha256Hex(verifyToken));
  if (!timingSafeEqual(a, b)) return null;
  // Meta sends digits; anything else is not echoed back into a response.
  return /^[A-Za-z0-9_-]{1,200}$/.test(query.challenge) ? query.challenge : null;
}

const CLICK_ID = /^[A-Za-z0-9_-]{10,512}$/;
const DIGITS = /^\d{8,15}$/;
const clip = (v: unknown, n: number): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null);

export interface ParsedWebhook {
  /** Advert referrals with a click id, for our WhatsApp Business Account. */
  referrals: WhatsAppAdReferral[];
  /** Inbound messages seen (of any kind). */
  messages: number;
  /** Messages that came from an advert but carry no click id (WhatsApp Status placements): they cannot be attributed. */
  referralsWithoutClickId: number;
  /** Entries for another WhatsApp Business Account: ignored. */
  foreignEntries: number;
}

/**
 * The advert referrals in one webhook delivery. Only `referral.ctwa_clid`,
 * the advert's id, type, link and headline, the message id and time, and a
 * hash of the sender's number are read; the message itself is not.
 */
export function parseAdReferrals(payload: unknown, wabaId: string, now: Date = new Date()): ParsedWebhook {
  const out: ParsedWebhook = { referrals: [], messages: 0, referralsWithoutClickId: 0, foreignEntries: 0 };
  const p = payload as { object?: unknown; entry?: unknown } | null;
  if (!p || p.object !== 'whatsapp_business_account' || !Array.isArray(p.entry)) return out;
  for (const entry of p.entry as Array<Record<string, any>>) {
    if (String(entry?.id ?? '') !== wabaId) { out.foreignEntries += 1; continue; }
    for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
      if (change?.field !== 'messages') continue;
      const value = change?.value ?? {};
      for (const msg of Array.isArray(value?.messages) ? value.messages : []) {
        out.messages += 1;
        const ref = msg?.referral;
        if (!ref || typeof ref !== 'object') continue;
        const clid = typeof ref.ctwa_clid === 'string' ? ref.ctwa_clid.trim() : '';
        if (!CLICK_ID.test(clid)) { out.referralsWithoutClickId += 1; continue; }
        const from = String(msg?.from ?? '').replace(/\D/g, '');
        const messageId = clip(msg?.id, 200);
        if (!DIGITS.test(from) || !messageId) continue;
        const sec = Number(msg?.timestamp);
        const stamped = Number.isFinite(sec) && sec > 0 ? new Date(sec * 1000) : now;
        // A time in the future is a clock fault, not a fact: the receipt time stands in.
        const receivedAt = stamped.getTime() > now.getTime() + 5 * 60_000 ? now : stamped;
        out.referrals.push({
          messageId, wabaId, phoneNumberId: clip(value?.metadata?.phone_number_id, 40),
          senderPhoneSha256: sha256Hex(from), ctwaClid: clid,
          sourceType: clip(ref.source_type, 20), sourceId: clip(ref.source_id, 60), sourceUrl: clip(ref.source_url, 500), headline: clip(ref.headline, 200),
          receivedAt,
        });
      }
    }
  }
  return out;
}

export const CTWA_WINDOW_DEFAULT_DAYS = 7;
/** How long after the advert chat a sale is still credited to it: the owner's setting, 1 to 28 days, 7 when unset. */
export function ctwaWindowDays(raw: unknown): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= 28 ? n : CTWA_WINDOW_DEFAULT_DAYS;
}

/** When a web click id (fbc: fb.1.<ms>.<fbclid>) was first observed, or null. */
export function metaClickTime(fbc: unknown): number | null {
  const m = typeof fbc === 'string' ? /^fb\.[0-9]\.(\d{10,13})\./.exec(fbc) : null;
  if (!m) return null;
  const n = Number(m[1]);
  return m[1].length <= 10 ? n * 1000 : n;
}

/**
 * One sale, one claim. A buyer may have both clicked a Meta web advert and
 * chatted from a WhatsApp advert; the LATER of the two is the one the sale is
 * reported against, exactly as the last ad click wins everywhere else here.
 */
export function messagingClickWins(fbc: unknown, referralAt: Date): boolean {
  const web = metaClickTime(fbc);
  return web == null || referralAt.getTime() >= web;
}

/** Events the Conversions API accepts for business messaging (Meta's list). */
export const BUSINESS_MESSAGING_EVENTS = ['Purchase', 'LeadSubmitted', 'InitiateCheckout', 'AddToCart', 'ViewContent', 'OrderCreated', 'OrderShipped', 'OrderDelivered', 'OrderCanceled', 'OrderReturned', 'CartAbandoned', 'QualifiedLead', 'RatingProvided', 'ReviewProvided'] as const;

/**
 * A sale reported against a Click-to-WhatsApp advert, as Meta documents it.
 * user_data carries the two identifiers Meta asks for and nothing else: the
 * click id already names the person to Meta.
 */
export function businessMessagingPurchase(input: { eventId: string; eventTimeSec: number; valueUgx: number; currency?: string; orderNumber?: string | null; wabaId: string; ctwaClid: string }): Record<string, unknown> {
  return {
    event_name: 'Purchase', event_time: input.eventTimeSec, event_id: input.eventId,
    action_source: 'business_messaging', messaging_channel: 'whatsapp',
    user_data: { whatsapp_business_account_id: input.wabaId, ctwa_clid: input.ctwaClid },
    custom_data: { currency: input.currency ?? 'UGX', value: input.valueUgx, ...(input.orderNumber ? { order_id: input.orderNumber } : {}) },
  };
}

/** The webhook secrets the owner saves, as one JSON bundle. Returns what is wrong, or null. */
export function ctwaSecretProblem(secret: string): string | null {
  let o: Record<string, unknown>;
  try { o = JSON.parse(secret); } catch { return 'The webhook secrets must be JSON: {"appSecret":"…","verifyToken":"…"}.'; }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return 'The webhook secrets must be a JSON object.';
  if (typeof o.appSecret !== 'string' || !/^[0-9a-f]{32}$/i.test(o.appSecret.trim())) return 'appSecret must be the Meta app\'s App Secret (32 letters and digits, from App settings > Basic).';
  if (typeof o.verifyToken !== 'string' || !/^[\x21-\x7e]{16,128}$/.test(o.verifyToken.trim())) return 'verifyToken must be 16 to 128 characters with no spaces: a phrase you choose and also type into Meta\'s webhook settings.';
  if (o.accessToken !== undefined && (typeof o.accessToken !== 'string' || o.accessToken.trim().length < 20)) return 'accessToken, when given, must be a Meta access token.';
  return null;
}

export interface CtwaSecrets { appSecret: string; verifyToken: string; accessToken: string | null }
export function parseCtwaSecrets(secret: string): CtwaSecrets | null {
  if (ctwaSecretProblem(secret)) return null;
  const o = JSON.parse(secret) as Record<string, string>;
  return { appSecret: o.appSecret.trim(), verifyToken: o.verifyToken.trim(), accessToken: typeof o.accessToken === 'string' && o.accessToken.trim() ? o.accessToken.trim() : null };
}
