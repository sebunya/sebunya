import { createHmac } from 'node:crypto';
import { normalizeUgandanPhone } from '@goldplus/shared';

/**
 * The canonical first-party customer identity used for first-order eligibility
 * (U1 AC11). Pure domain.
 *
 * The hash is derived from the PHONE (never the email), with HMAC-SHA256 keyed by
 * the identity pepper — the same construction the identity graph uses for
 * `hashed_phone`. Deriving from the phone means two accounts created with the
 * same phone number resolve to ONE identity, so a first-order promotion cannot be
 * claimed twice by simply re-registering.
 */
export function hashCustomerPhoneIdentity(phone: string, pepper: string): string {
  const normalised = phone.replace(/[^0-9+]/g, '').trim();
  if (!normalised) throw new Error('A phone number is required to resolve a first-order identity.');
  return createHmac('sha256', pepper).update(normalised).digest('hex');
}

/**
 * Who a per-customer promotion limit counts against at checkout.
 *
 * It used to be the optional email when one was typed, otherwise the phone as
 * typed. Leaving the email out, or writing the phone as `0700 000 000` instead
 * of `+256700000000`, made the same person a new customer, so a "one per
 * customer" coupon could be redeemed without limit.
 *
 * Now: the signed-in account when there is one; otherwise the phone in one
 * canonical shape (E.164 for a Ugandan number, digits only for anything else).
 * The email is never used. Existing reservations keyed the old way only make
 * limits temporarily more permissive, so nothing needs rewriting.
 */
export function pricingCustomerScopeKey(input: {
  principal?: { kind: 'USER' | 'GUEST'; id: string } | null;
  phone: string;
}): string {
  if (input.principal?.kind === 'USER' && input.principal.id.trim()) {
    return `user:${input.principal.id.trim()}`;
  }
  const ugandan = normalizeUgandanPhone(input.phone);
  if (ugandan) return `phone:${ugandan.e164}`;
  return `phone:${input.phone.replace(/[^0-9]/g, '')}`;
}
