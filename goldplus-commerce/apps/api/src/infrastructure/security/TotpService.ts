import {
  createHash,
  createHmac,
  randomBytes,
  createCipheriv,
  createDecipheriv,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';

/**
 * TOTP (RFC 6238) and the crypto around privileged MFA. Infrastructure — the
 * algorithm and the at-rest protection live here; the freshness/enrolment RULES
 * are in domain/identity/MfaPolicy.ts.
 *
 * The TOTP secret is encrypted with AES-256-GCM before it ever reaches the
 * database, and recovery codes are only ever stored as SHA-256 hashes.
 */

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = input.replace(/=+$/g, '').replace(/\s+/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const ch of clean) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx === -1) throw new Error('INVALID_BASE32');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** RFC 4226 HOTP. */
export function hotp(key: Buffer, counter: number, digits = 6): string {
  const buf = Buffer.alloc(8);
  // 53-bit safe: counters here are time/30, far below 2^53.
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac('sha1', key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const bin =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return (bin % 10 ** digits).toString().padStart(digits, '0');
}

export interface TotpOptions {
  stepSeconds?: number;
  digits?: number;
  t0?: number;
}

/** RFC 6238 TOTP for a given time in ms. */
export function totp(secretBase32: string, timeMs: number, opts: TotpOptions = {}): string {
  const step = opts.stepSeconds ?? 30;
  const digits = opts.digits ?? 6;
  const t0 = opts.t0 ?? 0;
  const counter = Math.floor((Math.floor(timeMs / 1000) - t0) / step);
  return hotp(base32Decode(secretBase32), counter, digits);
}

/**
 * Verify a presented code, allowing +/- `window` steps for clock drift.
 * Constant-time compare per candidate so a timing side-channel cannot leak
 * which step matched.
 */
export function verifyTotp(
  secretBase32: string,
  code: string,
  nowMs: number,
  opts: TotpOptions & { window?: number } = {},
): boolean {
  return matchTotpStep(secretBase32, code, nowMs, opts) !== null;
}

/**
 * The time step the code belongs to, or null when it matches none in the window. A code is valid for ~90 seconds
 * (the window either side), so a caller that must refuse a replayed code needs to know WHICH step matched.
 */
export function matchTotpStep(
  secretBase32: string,
  code: string,
  nowMs: number,
  opts: TotpOptions & { window?: number } = {},
): number | null {
  const step = opts.stepSeconds ?? 30;
  const digits = opts.digits ?? 6;
  const window = opts.window ?? 1;
  const trimmed = (code ?? '').replace(/\s+/g, '');
  if (!/^\d+$/.test(trimmed) || trimmed.length !== digits) return null;
  const key = base32Decode(secretBase32);
  const t0 = opts.t0 ?? 0;
  const base = Math.floor((Math.floor(nowMs / 1000) - t0) / step);
  const provided = Buffer.from(trimmed);
  let matched: number | null = null;
  // Every step is compared (no early exit), so the timing does not say which one matched.
  for (let w = -window; w <= window; w++) {
    const candidate = Buffer.from(hotp(key, base + w, digits));
    if (candidate.length === provided.length && timingSafeEqual(candidate, provided)) matched = base + w;
  }
  return matched;
}

export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function otpauthUri(secretBase32: string, account: string, issuer = 'GoldPlus'): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({ secret: secretBase32, issuer, algorithm: 'SHA1', digits: '6', period: '30' });
  return `otpauth://totp/${label}?${params.toString()}`;
}

// ---- At-rest protection ------------------------------------------------------

const DEV_KEY_MATERIAL = 'local-test-only-mfa-key-material-000000000000';
const derivedKeys = new Map<string, Buffer>();

function deriveFromJwtSecret(material: string): Buffer {
  let key = derivedKeys.get(material);
  if (!key) {
    key = scryptSync(material, 'goldplus-mfa-secret', 32);
    derivedKeys.set(material, key);
  }
  return key;
}

function encryptionKey(): Buffer {
  // Prefer an explicit 32-byte key; otherwise derive one deterministically from
  // the JWT secret so dev/test work without extra config. Production supplies
  // MFA_ENCRYPTION_KEY (validated by the config boundary in Slice 3D).
  const explicit = process.env.MFA_ENCRYPTION_KEY;
  if (explicit && explicit.length >= 64) return Buffer.from(explicit.slice(0, 64), 'hex');
  return deriveFromJwtSecret(process.env.JWT_SECRET || DEV_KEY_MATERIAL);
}

/**
 * Keys a stored secret may have been written under, current first. Without MFA_ENCRYPTION_KEY the key comes from
 * JWT_SECRET, so a JWT rotation (old secret moved to JWT_SECRET_PREVIOUS) would otherwise make every stored
 * authenticator unreadable and lock every admin out of step-up.
 */
function decryptionKeys(): Buffer[] {
  const keys = [encryptionKey()];
  const previous = process.env.JWT_SECRET_PREVIOUS;
  if (previous) {
    const prevKey = deriveFromJwtSecret(previous);
    if (!keys[0].equals(prevKey)) keys.push(prevKey);
  }
  return keys;
}

/** AES-256-GCM. Output: base64(iv|tag|ciphertext). */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString('base64');
}

function decryptWith(key: Buffer, raw: Buffer): string {
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const ct = raw.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: 16 }); // a truncated tag is refused
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

/** Decrypt, and say whether it needed a previous key (the caller should then re-encrypt under the current one). */
export function decryptSecretWithRotation(payload: string): { plain: string; rotated: boolean } {
  const raw = Buffer.from(payload, 'base64');
  const keys = decryptionKeys();
  let lastError: unknown;
  for (let i = 0; i < keys.length; i += 1) {
    try {
      return { plain: decryptWith(keys[i], raw), rotated: i > 0 };
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

export function decryptSecret(payload: string): string {
  return decryptSecretWithRotation(payload).plain;
}

// ---- Recovery codes ----------------------------------------------------------

export function hashRecoveryCode(code: string): string {
  return createHash('sha256').update(code.replace(/\s+/g, '').toLowerCase()).digest('hex');
}

export function generateRecoveryCodes(count: number, bytesPerCode: number): string[] {
  return Array.from({ length: count }, () => randomBytes(bytesPerCode).toString('hex'));
}
