import { normalizeUgandanPhone } from '@goldplus/shared';

/**
 * Idempotency key for a public form's "we have it" acknowledgement.
 *
 * WHAT WAS WRONG
 * The dealer, quote, support and fake-report forms each enqueued an SMS to the
 * phone typed on the form under a key made from the NEW row's uuid, so every
 * submission was a fresh message. The storefront posts these forms
 * server-side, which the API's per-family rate limits treat as internal
 * traffic, and nothing capped messages per recipient. A script could make the
 * shop SMS any Ugandan number as fast as it could post, draining the same
 * EgoSMS credit that carries OTPs and paid-order alerts.
 *
 * The key is now the RECIPIENT and the hour: one acknowledgement per
 * recipient, per form, per hour. The outbox dedupes on the key, so a flood
 * still saves its rows (the team sees them) but texts the number once. With no
 * contact at all there is nobody to message, and the row id keeps the key
 * unique as before.
 */
export function acknowledgementIdempotencyKey(input: {
  kind: string;
  phone?: string | null;
  email?: string | null;
  entityId: string;
  now?: Date;
}): string {
  // Keyed on the same contact the outbox sends to: the phone when there is
  // one (the SMS channel), otherwise the email. Lengths are capped so the key
  // always fits outbox_events.idempotency_key (varchar 255).
  const phone = typeof input.phone === 'string' && input.phone.trim()
    ? (normalizeUgandanPhone(input.phone)?.e164 ?? input.phone.replace(/\D/g, '').slice(0, 20))
    : '';
  const email = typeof input.email === 'string' ? input.email.trim().toLowerCase().slice(0, 160) : '';
  const recipient = phone ? `tel:${phone}` : email ? `mail:${email}` : null;
  if (!recipient) return `ack:${input.kind}:${input.entityId}`;
  // UTC hour bucket, e.g. 2026-09-24T10.
  const hour = (input.now ?? new Date()).toISOString().slice(0, 13);
  return `ack:${input.kind}:${recipient}:${hour}`;
}
