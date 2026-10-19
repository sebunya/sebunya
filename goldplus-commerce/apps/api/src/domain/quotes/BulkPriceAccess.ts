/**
 * Who may see bulk (dealer) prices (owner, 2026-10-19):
 *  - the FIRST time a phone number is used, the buyer just types it and sees
 *    prices for that visit (no SMS: the code must not lengthen a first journey);
 *  - every LATER time, the buyer proves the number with the six-digit code we
 *    text, and the proof lasts 30 days on that device.
 * A first visit is not proof of the number; the team's leads list says so.
 *
 * Pure domain: the clock, the code, the keyed hash and the signature are
 * passed in, so nothing here touches crypto, the network or the database.
 */

export const ACCESS_CODE_TTL_MS = 10 * 60 * 1000;
/** Wrong guesses allowed on one code before a new one is needed. */
export const MAX_CODE_ATTEMPTS = 5;
/** Codes one phone may be sent in an hour: an SMS costs money and annoys the owner of the number. */
export const MAX_CODES_PER_PHONE_PER_HOUR = 3;
export const ACCESS_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** A first visit: one sitting (a browser-session cookie), at most a day. */
export const FIRST_VISIT_TTL_MS = 24 * 60 * 60 * 1000;

export type AccessMethod = 'first_visit' | 'code';

/** No code the first time a number is used; a code every time after. */
export function accessMethodFor(previousUses: number): AccessMethod {
  return previousUses === 0 ? 'first_visit' : 'code';
}

const TOKEN_VERSION = 'b1';

/** `b1.<phone digits>.<expiry ms>`: what the signature covers. */
function tokenBody(phone: string, expiresAtMs: number): string {
  return `${TOKEN_VERSION}.${phone.replace(/\D/g, '')}.${expiresAtMs}`;
}

/** A token the storefront keeps in an httpOnly cookie. `sign` is a keyed MAC (hex). */
export function issueAccessToken(phone: string, now: Date, sign: (body: string) => string, ttlMs: number = ACCESS_TTL_MS): { token: string; expiresAt: Date } {
  const expiresAtMs = now.getTime() + Math.min(ttlMs, ACCESS_TTL_MS);
  const body = tokenBody(phone, expiresAtMs);
  return { token: `${body}.${sign(body)}`, expiresAt: new Date(expiresAtMs) };
}

/** Constant-time for equal lengths, so a signature cannot be guessed byte by byte. */
function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** The verified phone (+256…) a token proves, or null for anything forged, malformed or expired. */
export function readAccessToken(token: unknown, now: Date, sign: (body: string) => string): string | null {
  if (typeof token !== 'string' || token.length > 200) return null;
  const parts = token.split('.');
  if (parts.length !== 4 || parts[0] !== TOKEN_VERSION) return null;
  const [, digits, expiry, signature] = parts;
  if (!/^256\d{9}$/.test(digits) || !/^\d{13}$/.test(expiry) || !/^[0-9a-f]{64}$/.test(signature)) return null;
  const expiresAtMs = Number(expiry);
  if (expiresAtMs <= now.getTime() || expiresAtMs > now.getTime() + ACCESS_TTL_MS + 60_000) return null;
  if (!sameText(sign(`${TOKEN_VERSION}.${digits}.${expiry}`), signature)) return null;
  return `+${digits}`;
}

/** "0772 •••456": enough for the buyer to recognise their number on a shared screen. */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  const local = digits.startsWith('256') ? `0${digits.slice(3)}` : digits;
  return local.length >= 7 ? `${local.slice(0, 4)} •••${local.slice(-3)}` : '•••';
}

export interface AccessChallenge {
  id: string;
  codeHash: string;
  attempts: number;
  expiresAt: Date;
  verifiedAt: Date | null;
}

export type ChallengeCheck =
  | { ok: true }
  | { ok: false; code: 'NO_CODE' | 'EXPIRED' | 'TOO_MANY_ATTEMPTS' | 'WRONG_CODE' };

/** Whether a typed code answers this challenge. The caller records the attempt first. */
export function checkChallenge(challenge: AccessChallenge | null, typedHash: string, now: Date): ChallengeCheck {
  if (!challenge || challenge.verifiedAt) return { ok: false, code: 'NO_CODE' };
  if (challenge.expiresAt.getTime() <= now.getTime()) return { ok: false, code: 'EXPIRED' };
  if (challenge.attempts > MAX_CODE_ATTEMPTS) return { ok: false, code: 'TOO_MANY_ATTEMPTS' };
  return sameText(challenge.codeHash, typedHash) ? { ok: true } : { ok: false, code: 'WRONG_CODE' };
}

/** What the buyer is told for each refusal. No system words. */
export function challengeMessage(code: Exclude<ChallengeCheck, { ok: true }>['code']): string {
  switch (code) {
    case 'EXPIRED':
      return 'That code has expired. Ask for a new one.';
    case 'TOO_MANY_ATTEMPTS':
      return 'Too many wrong tries. Ask for a new code.';
    case 'WRONG_CODE':
      return 'That code is not right. Check the SMS and try again.';
    case 'NO_CODE':
    default:
      return 'Ask for a code first, then type it here.';
  }
}
