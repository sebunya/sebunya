import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * The "stop these texts" link in a guest's basket reminder (2026-11-03). A guest has no account to switch reminders
 * off in, so the link carries the number itself, signed: `/stop-texts?t=<base64url(phone)>.<hmac>`. Anyone holding
 * the link can stop texts to that number and nothing else; the number is never shown on the page, only its masked
 * form. Signed with BASKET_STOP_TOKEN_KEY, else JWT_SECRET (same fallback as the bulk-price token).
 */
export function basketStopTokenSecret(env: Record<string, string | undefined> = process.env): string {
  const s = env.BASKET_STOP_TOKEN_KEY?.trim() || env.JWT_SECRET?.trim();
  if (s) return s;
  if (env.NODE_ENV === 'production') throw new Error('BASKET_STOP_TOKEN_KEY (or JWT_SECRET) is required in production');
  return 'dev-basket-stop-token-secret';
}

const sign = (body: string, secret: string) => createHmac('sha256', secret).update(body).digest('base64url');

export function issueBasketStopToken(phoneE164: string, secret: string = basketStopTokenSecret()): string {
  const body = Buffer.from(phoneE164, 'utf8').toString('base64url');
  return `${body}.${sign(body, secret)}`;
}

/** The phone the token names, or null when the token is malformed or not ours. */
export function readBasketStopToken(token: string, secret: string = basketStopTokenSecret()): string | null {
  const m = /^([A-Za-z0-9_-]{4,64})\.([A-Za-z0-9_-]{40,50})$/.exec(token ?? '');
  if (!m) return null;
  const expected = sign(m[1], secret);
  const a = Buffer.from(m[2]); const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const phone = Buffer.from(m[1], 'base64url').toString('utf8');
  return /^\+256\d{9}$/.test(phone) ? phone : null;
}
