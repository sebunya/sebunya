/**
 * WhatsApp marketing consent (0155) — a purpose of its own.
 *
 * `whatsapp_marketing` on the `whatsapp` channel is separate from every other
 * purpose, including the generic `marketing_offers_campaigns`: a yes to offers
 * by email or SMS is never a yes to WhatsApp, and the reverse. It is OFF by
 * default (no record = not opted in) and is granted only by the customer
 * themselves, signed in, ticking an unticked box next to the exact words
 * below. Each grant or withdrawal is an immutable consent event with an
 * integrity hash, plus evidence of what was shown and to which number.
 *
 * TRANSACTIONAL WhatsApp (order, delivery and account messages) is not gated
 * by this purpose: `mayReceiveWhatsAppMessage` says so in code, so a refusal
 * of offers can never stop an order update. Meta's opt-in rules
 * (developers.facebook.com/docs/whatsapp/overview/getting-opt-in): state that
 * the person is opting in to messages, and name the business.
 */
import { createHash } from 'node:crypto';
import type { ConsentState } from './ConsentFoundation';

export const WHATSAPP_MARKETING_PURPOSE = 'whatsapp_marketing' as const;
export const WHATSAPP_CHANNEL = 'whatsapp' as const;
export const WHATSAPP_MARKETING_COPY_VERSION = 'whatsapp-marketing-v1';
export const WHATSAPP_MARKETING_SOURCE_SURFACE = 'account_preference_centre_whatsapp';
/** The exact words beside the checkbox. Changing them needs a new copy version (and migration row). */
export const WHATSAPP_MARKETING_COPY =
  'Yes, send me occasional offers and product news from GoldPlus on WhatsApp, at the phone number on my account. I can switch this off here at any time, or reply STOP.';

export function whatsappMarketingCopyHash(copy: string = WHATSAPP_MARKETING_COPY): string {
  return createHash('sha256').update(copy, 'utf8').digest('hex');
}

export type WhatsAppMarketingStatus = 'OPTED_IN' | 'NOT_OPTED_IN' | 'WITHDRAWN' | 'BLOCKED';

/** No record, or anything that is not an explicit grant, is NOT opted in. */
export function whatsappMarketingStatus(state: ConsentState | null | undefined): WhatsAppMarketingStatus {
  if (state === 'granted') return 'OPTED_IN';
  if (state === 'withdrawn') return 'WITHDRAWN';
  if (state === 'blocked_by_policy') return 'BLOCKED';
  return 'NOT_OPTED_IN';
}

export type WhatsAppChangeRequest = 'granted' | 'withdrawn';

export type WhatsAppChangeRefusal =
  | 'CONFIRMATION_REQUIRED'
  | 'PHONE_REQUIRED'
  | 'SIGNED_IN_ACCOUNT_REQUIRED'
  | 'BLOCKED_BY_POLICY'
  | 'COPY_VERSION_MISMATCH';

/**
 * Decide a change. A grant needs the ticked box, the current copy version, a
 * signed-in account and a Ugandan phone on it. A withdrawal always succeeds
 * (it may be a no-op), because saying no must never be harder than saying yes.
 */
export function planWhatsAppMarketingChange(input: {
  current: ConsentState | null;
  requested: WhatsAppChangeRequest;
  confirmationTicked: boolean;
  copyVersionId: string | null;
  signedInAccount: boolean;
  phoneE164: string | null;
}):
  | { ok: true; next: ConsentState; eventType: string; noOp: boolean }
  | { ok: false; reason: WhatsAppChangeRefusal } {
  if (input.requested === 'withdrawn') {
    return { ok: true, next: 'withdrawn', eventType: 'whatsapp_marketing_withdrawn', noOp: input.current === 'withdrawn' };
  }
  if (!input.signedInAccount) return { ok: false, reason: 'SIGNED_IN_ACCOUNT_REQUIRED' };
  if (input.current === 'blocked_by_policy') return { ok: false, reason: 'BLOCKED_BY_POLICY' };
  if (!input.confirmationTicked) return { ok: false, reason: 'CONFIRMATION_REQUIRED' };
  if (input.copyVersionId !== WHATSAPP_MARKETING_COPY_VERSION) return { ok: false, reason: 'COPY_VERSION_MISMATCH' };
  if (!input.phoneE164) return { ok: false, reason: 'PHONE_REQUIRED' };
  return { ok: true, next: 'granted', eventType: 'whatsapp_marketing_granted', noOp: input.current === 'granted' };
}

/**
 * The marketing gate: a grant covers the number it was given for. If the
 * account's phone changed since, the new number was never opted in.
 */
export function mayReceiveWhatsAppMarketing(input: {
  state: ConsentState | null | undefined;
  consentedPhoneHash: string | null | undefined;
  currentPhoneHash: string | null | undefined;
}): { allowed: boolean; reason: string } {
  if (input.state !== 'granted') return { allowed: false, reason: 'NOT_OPTED_IN' };
  if (!input.currentPhoneHash) return { allowed: false, reason: 'NO_PHONE' };
  // A grant without evidence of which number it covered sends nothing.
  if (!input.consentedPhoneHash) return { allowed: false, reason: 'NO_OPT_IN_EVIDENCE' };
  if (input.consentedPhoneHash !== input.currentPhoneHash) return { allowed: false, reason: 'PHONE_CHANGED_SINCE_OPT_IN' };
  return { allowed: true, reason: 'OPTED_IN' };
}

export type WhatsAppMessageCategory = 'TRANSACTIONAL' | 'MARKETING';

/** Transactional messages are never gated by the marketing purpose. */
export function mayReceiveWhatsAppMessage(input: {
  category: WhatsAppMessageCategory;
  marketing: { allowed: boolean; reason: string };
}): { allowed: boolean; reason: string } {
  if (input.category === 'TRANSACTIONAL') return { allowed: true, reason: 'TRANSACTIONAL_NOT_GATED_BY_MARKETING_CONSENT' };
  return input.marketing;
}

/** +256•••••4567 */
export function maskE164(e164: string): string {
  return e164.length > 7 ? `${e164.slice(0, 4)}•••••${e164.slice(-4)}` : '••••';
}
