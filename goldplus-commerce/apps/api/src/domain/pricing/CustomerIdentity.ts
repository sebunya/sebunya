import { createHmac } from 'node:crypto';

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
