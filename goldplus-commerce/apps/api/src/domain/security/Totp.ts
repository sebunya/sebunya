import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * TOTP (RFC 6238) on top of HOTP (RFC 4226) — authenticator-app 2FA.
 *
 * Pure and deterministic (node:crypto only, no I/O), so it can be tested
 * against the published RFC vectors. Defaults match what Google
 * Authenticator / Authy expect: SHA-1, 6 digits, 30-second period.
 */

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_DIGITS = 6;

/** Generates a random base32 secret (default 160 bits, RFC-recommended). */
export function generateTotpSecret(bytes = 20): string {
  return encodeBase32(randomBytes(bytes));
}

export function encodeBase32(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

export function decodeBase32(input: string): Buffer {
  const clean = input.toUpperCase().replace(/=+$/, '').replace(/\s+/g, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const ch of clean) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx === -1) throw new Error('Invalid base32 character in TOTP secret.');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** HOTP (RFC 4226): a counter-based one-time code. */
export function hotp(secret: Buffer, counter: number, digits = TOTP_DIGITS): string {
  const buf = Buffer.alloc(8);
  // 64-bit big-endian counter. Split to stay within 32-bit bitwise ops.
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buf.writeUInt32BE(counter % 0x100000000, 4);

  const hmac = createHmac('sha1', secret).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return (binary % 10 ** digits).toString().padStart(digits, '0');
}

/** Current TOTP code for a base32 secret at a given time. */
export function totp(secretBase32: string, atMs: number = Date.now(), digits = TOTP_DIGITS): string {
  const counter = Math.floor(atMs / 1000 / TOTP_PERIOD_SECONDS);
  return hotp(decodeBase32(secretBase32), counter, digits);
}

/**
 * Verifies a submitted code within a ±window of time steps (default ±1,
 * i.e. ~90s) to tolerate clock drift. Constant-time comparison.
 */
export function verifyTotp(
  secretBase32: string,
  submitted: string,
  opts: { atMs?: number; window?: number; digits?: number } = {}
): boolean {
  const atMs = opts.atMs ?? Date.now();
  const window = opts.window ?? 1;
  const digits = opts.digits ?? TOTP_DIGITS;
  const cleaned = (submitted ?? '').replace(/\s+/g, '');
  if (!/^\d+$/.test(cleaned) || cleaned.length !== digits) return false;

  const secret = decodeBase32(secretBase32);
  const baseCounter = Math.floor(atMs / 1000 / TOTP_PERIOD_SECONDS);
  const submittedBuf = Buffer.from(cleaned);
  for (let errorWindow = -window; errorWindow <= window; errorWindow++) {
    const candidate = hotp(secret, baseCounter + errorWindow, digits);
    const candidateBuf = Buffer.from(candidate);
    if (candidateBuf.length === submittedBuf.length && timingSafeEqual(candidateBuf, submittedBuf)) {
      return true;
    }
  }
  return false;
}

/** otpauth:// provisioning URI for QR codes in authenticator apps. */
export function buildOtpAuthUri(opts: { secretBase32: string; accountName: string; issuer: string }): string {
  const label = encodeURIComponent(`${opts.issuer}:${opts.accountName}`);
  const params = new URLSearchParams({
    secret: opts.secretBase32,
    issuer: opts.issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
