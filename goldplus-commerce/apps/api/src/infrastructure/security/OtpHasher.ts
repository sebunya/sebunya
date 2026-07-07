import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Hashes OTP / backup codes for storage. Uses HMAC-SHA256 with a server
 * pepper so a database leak alone never reveals live codes. Codes are
 * short-lived and single-use, so HMAC (fast, constant-time comparable) is
 * appropriate here — unlike passwords, which use scrypt.
 */
export class OtpHasher {
  private readonly pepper: string;

  constructor(pepper: string | undefined = process.env.OTP_PEPPER ?? process.env.JWT_SECRET) {
    this.pepper = (pepper ?? '').trim() || 'goldplus-dev-otp-pepper';
  }

  hash(code: string, salt: string): string {
    return createHmac('sha256', this.pepper).update(`${salt}:${code}`).digest('hex');
  }

  matches(code: string, salt: string, storedHash: string): boolean {
    const computed = Buffer.from(this.hash(code, salt), 'hex');
    let stored: Buffer;
    try {
      stored = Buffer.from(storedHash, 'hex');
    } catch {
      return false;
    }
    return computed.length === stored.length && timingSafeEqual(computed, stored);
  }
}
