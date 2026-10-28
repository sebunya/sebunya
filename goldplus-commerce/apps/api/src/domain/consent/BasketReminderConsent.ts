/**
 * Basket reminders (0210): a purpose of its own, on the SMS channel.
 *
 * A signed-in shopper who leaves items in their basket can be texted once about
 * it, but only if THEY asked for it: an unticked box at sign-up, or in My
 * preferences, beside the exact words below. It is off by default, separate
 * from WhatsApp offers and from every other purpose, granted only by the
 * customer, and withdrawn with one click. Each grant or withdrawal is an
 * immutable consent event with evidence of the words shown and the number.
 *
 * The reminder is MARKETING in the outbound governance (it is not about an
 * order the customer placed), so it is refused for want of this consent and a
 * recorded STOP outranks a grant.
 */
import { createHash } from 'node:crypto';
import type { ConsentState } from './ConsentFoundation';
import { mayReceiveWhatsAppMarketing } from './WhatsAppMarketingConsent';

export const BASKET_REMINDERS_PURPOSE = 'basket_reminders' as const;
export const BASKET_REMINDERS_CHANNEL = 'sms' as const;
export const BASKET_REMINDERS_COPY_VERSION = 'basket-reminders-v1';
export const BASKET_REMINDERS_SURFACES = {
  registration: 'registration_basket_reminders',
  preferenceCentre: 'account_preference_centre_basket_reminders',
} as const;
export type BasketReminderSurface = keyof typeof BASKET_REMINDERS_SURFACES;

/** The exact words beside the checkbox. Changing them needs a new copy version (and migration row). */
export const BASKET_REMINDERS_COPY =
  'Yes, text me if I leave something in my basket, at the phone number on my account. At most one text a week. I can switch this off in My preferences at any time.';

export function basketRemindersCopyHash(copy: string = BASKET_REMINDERS_COPY): string {
  return createHash('sha256').update(copy, 'utf8').digest('hex');
}

export type BasketReminderStatus = 'OPTED_IN' | 'NOT_OPTED_IN' | 'WITHDRAWN' | 'BLOCKED';

export function basketReminderStatus(state: ConsentState | null | undefined): BasketReminderStatus {
  if (state === 'granted') return 'OPTED_IN';
  if (state === 'withdrawn') return 'WITHDRAWN';
  if (state === 'blocked_by_policy') return 'BLOCKED';
  return 'NOT_OPTED_IN';
}

export type BasketReminderChangeRefusal = 'CONFIRMATION_REQUIRED' | 'PHONE_REQUIRED' | 'SIGNED_IN_ACCOUNT_REQUIRED' | 'BLOCKED_BY_POLICY' | 'COPY_VERSION_MISMATCH';

/** A grant needs the ticked box, the current wording, a signed-in account and a phone. A withdrawal always succeeds. */
export function planBasketReminderChange(input: {
  current: ConsentState | null;
  requested: 'granted' | 'withdrawn';
  confirmationTicked: boolean;
  copyVersionId: string | null;
  signedInAccount: boolean;
  phoneE164: string | null;
}): { ok: true; next: ConsentState; eventType: string; noOp: boolean } | { ok: false; reason: BasketReminderChangeRefusal } {
  if (input.requested === 'withdrawn') {
    return { ok: true, next: 'withdrawn', eventType: 'basket_reminders_withdrawn', noOp: input.current === 'withdrawn' || input.current === null };
  }
  if (!input.signedInAccount) return { ok: false, reason: 'SIGNED_IN_ACCOUNT_REQUIRED' };
  if (input.current === 'blocked_by_policy') return { ok: false, reason: 'BLOCKED_BY_POLICY' };
  if (!input.confirmationTicked) return { ok: false, reason: 'CONFIRMATION_REQUIRED' };
  if (input.copyVersionId !== BASKET_REMINDERS_COPY_VERSION) return { ok: false, reason: 'COPY_VERSION_MISMATCH' };
  if (!input.phoneE164) return { ok: false, reason: 'PHONE_REQUIRED' };
  return { ok: true, next: 'granted', eventType: 'basket_reminders_granted', noOp: input.current === 'granted' };
}

/** A grant covers the number it was given for; a changed phone is not opted in. Same rule as WhatsApp offers. */
export const mayReceiveBasketReminder = mayReceiveWhatsAppMarketing;
