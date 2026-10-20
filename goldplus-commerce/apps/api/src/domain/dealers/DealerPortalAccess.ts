/**
 * The dealer portal's own sign-in token (gap analysis #16, 2026-10-20). Deliberately NOT the bulk-price token:
 * that one is issued without an SMS code on a number's first use (prices only), while the portal shows a phone's
 * orders and amounts, so it is issued ONLY after an SMS code is verified. A different version tag ('d1') means a
 * bulk token can never open the portal, and vice versa.
 */
export const DEALER_PORTAL_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const VERSION = 'd1';

export function issueDealerToken(phone: string, now: Date, sign: (body: string) => string): { token: string; expiresAt: Date } {
  const expiresAtMs = now.getTime() + DEALER_PORTAL_TTL_MS;
  const body = `${VERSION}.${phone.replace(/\D/g, '')}.${expiresAtMs}`;
  return { token: `${body}.${sign(body)}`, expiresAt: new Date(expiresAtMs) };
}

/** The phone (+256…) a portal token proves, or null for anything forged, malformed, expired or not a portal token. */
export function readDealerToken(token: unknown, now: Date, sign: (body: string) => string): string | null {
  if (typeof token !== 'string' || token.length > 200) return null;
  const parts = token.split('.');
  if (parts.length !== 4 || parts[0] !== VERSION) return null;
  const [, digits, expiry, signature] = parts;
  if (!/^256\d{9}$/.test(digits) || !/^\d{13}$/.test(expiry) || !/^[0-9a-f]{64}$/.test(signature)) return null;
  const exp = Number(expiry);
  if (exp <= now.getTime() || exp > now.getTime() + DEALER_PORTAL_TTL_MS + 60_000) return null;
  const expected = sign(`${VERSION}.${digits}.${expiry}`);
  let diff = expected.length === signature.length ? 0 : 1;
  for (let i = 0; i < Math.min(expected.length, signature.length); i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0 ? `+${digits}` : null;
}
