import { randomBytes } from 'node:crypto';

/**
 * Coupon-code generation (U1). Pure domain.
 *
 * The alphabet deliberately EXCLUDES the visually ambiguous glyphs 0/O, 1/I/L so
 * a code stays readable when printed on a card or read aloud. What remains is a
 * subset of [A-Z0-9], so every generated code also satisfies the canonical
 * `normalizeCouponCode` pattern (`^[A-Z0-9_-]{3,40}$`).
 *
 * Randomness is `crypto.randomBytes` (never Math.random). Rejection sampling
 * removes modulo bias so every symbol is equiprobable — important when millions
 * of codes share one space and a bias would concentrate collisions.
 */
export const COUPON_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // 31 symbols: A-Z minus I,L,O; 2-9
export const COUPON_AMBIGUOUS = new Set(['0', 'O', '1', 'I', 'L']);

const DEFAULT_LENGTH = 12;
const MAX_PREFIX = 12;

export interface CouponBatchOptions {
  /** Random body length (excludes any prefix). 6..32. */
  length?: number;
  /** Optional fixed prefix (e.g. "GP"), normalised to the alphabet's case. */
  prefix?: string;
}

/** Draw `count` unbiased symbols from the alphabet using CSPRNG bytes. */
function drawSymbols(count: number): string {
  const alphabetLen = COUPON_ALPHABET.length;
  // Largest multiple of alphabetLen that fits in a byte; bytes above it are
  // rejected to keep the distribution uniform.
  const ceiling = 256 - (256 % alphabetLen);
  let out = '';
  while (out.length < count) {
    const need = count - out.length;
    const buf = randomBytes(need * 2); // over-draw to cover rejections
    for (let i = 0; i < buf.length && out.length < count; i++) {
      const b = buf[i];
      if (b >= ceiling) continue; // reject to avoid modulo bias
      out += COUPON_ALPHABET[b % alphabetLen];
    }
  }
  return out;
}

export function generateCouponCode(options: CouponBatchOptions = {}): string {
  const length = options.length ?? DEFAULT_LENGTH;
  if (!Number.isInteger(length) || length < 6 || length > 32) {
    throw new Error('Coupon body length must be an integer from 6 to 32.');
  }
  const prefix = (options.prefix ?? '').trim().toUpperCase();
  if (prefix) {
    if (prefix.length > MAX_PREFIX) throw new Error('Coupon prefix must be at most 12 characters.');
    for (const ch of prefix) {
      if (!COUPON_ALPHABET.includes(ch)) {
        throw new Error(`Coupon prefix contains an unsupported or ambiguous character: ${ch}`);
      }
    }
  }
  return prefix + drawSymbols(length);
}

/**
 * Generate `count` DISTINCT codes. In-memory dedup removes the collisions this
 * process can see; residual collisions against already-persisted codes are the
 * database's job (unique index + ON CONFLICT DO NOTHING + shortfall retry).
 */
export function generateUniqueCouponCodes(count: number, options: CouponBatchOptions = {}): string[] {
  if (!Number.isInteger(count) || count < 1 || count > 1_000_000) {
    throw new Error('Coupon batch count must be an integer from 1 to 1,000,000.');
  }
  const seen = new Set<string>();
  // Bounded attempts so an over-tight (short length, huge count) request fails
  // loudly instead of spinning forever.
  const maxAttempts = count * 20 + 1000;
  let attempts = 0;
  while (seen.size < count) {
    if (attempts++ > maxAttempts) {
      throw new Error('Coupon space too small for the requested batch size; increase length.');
    }
    seen.add(generateCouponCode(options));
  }
  return Array.from(seen);
}

/** True if a code contains only unambiguous, in-alphabet symbols (plus an optional prefix already validated). */
export function isUnambiguousCouponCode(code: string): boolean {
  for (const ch of code) {
    if (COUPON_AMBIGUOUS.has(ch)) return false;
    if (!COUPON_ALPHABET.includes(ch)) return false;
  }
  return code.length > 0;
}
