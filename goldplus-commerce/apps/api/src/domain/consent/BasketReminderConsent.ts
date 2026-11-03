/**
 * Basket reminders (0210): a purpose of its own, on the SMS channel.
 *
 * ON BY DEFAULT since 2026-11-03 (owner decision: "we are an e-commerce
 * website and are in the business of selling online, so we market without a
 * consent step"). A signed-in shopper who leaves items in their basket is
 * texted once about it, at most once a week, at the number on their account,
 * unless THEY switched it off: one click in My preferences, or a STOP against
 * the number. No box is shown at sign-up; nothing has to be ticked.
 *
 * What stays: the weekly cap, quiet hours, the holdout, and the rule that the
 * number must be known to reach its owner (verified by code, or an order of
 * the account was delivered to it), so a mistyped sign-up number is never
 * texted a stranger's basket. Every switch-off and switch-on is still an
 * immutable consent event with evidence, so "off" is honoured for good.
 *
 * The reminder is MARKETING in the outbound governance; since the same date
 * the governance permits marketing by default and a recorded STOP outranks it.
 */
import { createHash } from 'node:crypto';
import type { ConsentState } from './ConsentFoundation';

export const BASKET_REMINDERS_PURPOSE = 'basket_reminders' as const;
export const BASKET_REMINDERS_CHANNEL = 'sms' as const;
export const BASKET_REMINDERS_COPY_VERSION = 'basket-reminders-v1';
export const BASKET_REMINDERS_SURFACES = {
  registration: 'registration_basket_reminders',
  preferenceCentre: 'account_preference_centre_basket_reminders',
} as const;
export type BasketReminderSurface = keyof typeof BASKET_REMINDERS_SURFACES;

/** The words shown beside the switch in My preferences (kept at v1: they are still true). */
export const BASKET_REMINDERS_COPY =
  'Yes, text me if I leave something in my basket, at the phone number on my account. At most one text a week. I can switch this off in My preferences at any time.';

export function basketRemindersCopyHash(copy: string = BASKET_REMINDERS_COPY): string {
  return createHash('sha256').update(copy, 'utf8').digest('hex');
}

/** ON_BY_DEFAULT: the customer never touched the switch; OPTED_IN: they switched it on again after an off. */
export type BasketReminderStatus = 'ON_BY_DEFAULT' | 'OPTED_IN' | 'WITHDRAWN' | 'BLOCKED';

export function basketReminderStatus(state: ConsentState | null | undefined): BasketReminderStatus {
  if (state === 'granted') return 'OPTED_IN';
  if (state === 'withdrawn') return 'WITHDRAWN';
  if (state === 'blocked_by_policy') return 'BLOCKED';
  return 'ON_BY_DEFAULT';
}

export type BasketReminderChangeRefusal = 'PHONE_REQUIRED' | 'SIGNED_IN_ACCOUNT_REQUIRED' | 'BLOCKED_BY_POLICY';

/**
 * Switching on again needs a signed-in account with a phone; no box to tick, no copy version to match (owner
 * 2026-11-03). Switching off always succeeds. Both are no-ops when nothing changes; switching on while on by default
 * is recorded all the same, as the customer's own explicit choice.
 */
export function planBasketReminderChange(input: {
  current: ConsentState | null;
  requested: 'granted' | 'withdrawn';
  confirmationTicked?: boolean;
  copyVersionId?: string | null;
  signedInAccount: boolean;
  phoneE164: string | null;
}): { ok: true; next: ConsentState; eventType: string; noOp: boolean } | { ok: false; reason: BasketReminderChangeRefusal } {
  if (input.requested === 'withdrawn') {
    return { ok: true, next: 'withdrawn', eventType: 'basket_reminders_withdrawn', noOp: input.current === 'withdrawn' };
  }
  if (!input.signedInAccount) return { ok: false, reason: 'SIGNED_IN_ACCOUNT_REQUIRED' };
  if (input.current === 'blocked_by_policy') return { ok: false, reason: 'BLOCKED_BY_POLICY' };
  if (!input.phoneE164) return { ok: false, reason: 'PHONE_REQUIRED' };
  return { ok: true, next: 'granted', eventType: 'basket_reminders_granted', noOp: input.current === 'granted' };
}

/**
 * The gate: on unless switched off or blocked, and only with a number on the account. A changed number is still
 * covered (the reminder is the shop's default, not a grant tied to one number).
 */
export function mayReceiveBasketReminder(input: {
  state: ConsentState | null | undefined;
  currentPhoneHash: string | null | undefined;
}): { allowed: boolean; reason: string } {
  if (input.state === 'withdrawn') return { allowed: false, reason: 'SWITCHED_OFF' };
  if (input.state === 'blocked_by_policy') return { allowed: false, reason: 'BLOCKED_BY_POLICY' };
  if (!input.currentPhoneHash) return { allowed: false, reason: 'NO_PHONE' };
  return { allowed: true, reason: input.state === 'granted' ? 'OPTED_IN' : 'ON_BY_DEFAULT' };
}
