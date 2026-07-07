import { describe, expect, it } from 'vitest';
import {
  decodeBase32,
  encodeBase32,
  hotp,
  totp,
  verifyTotp,
  buildOtpAuthUri,
  TOTP_PERIOD_SECONDS,
} from '../../apps/api/src/domain/security/Totp';
import {
  evaluateOtp,
  generateOtpCode,
  maskDestination,
  otpExpiryFrom,
} from '../../apps/api/src/domain/security/OtpChallenge';
import { generateBackupCodes, normalizeBackupCode } from '../../apps/api/src/domain/security/BackupCodes';

// RFC 4226 Appendix D — HOTP test vectors for ASCII secret "12345678901234567890".
const RFC_SECRET_ASCII = '12345678901234567890';
const RFC_SECRET_BASE32 = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
const RFC_HOTP = ['755224', '287082', '359152', '969429', '338314', '254676', '287922', '162583', '399871', '520489'];

describe('base32', () => {
  it('round-trips and decodes the RFC secret to its ASCII bytes', () => {
    expect(decodeBase32(RFC_SECRET_BASE32).toString('utf8')).toBe(RFC_SECRET_ASCII);
    expect(encodeBase32(Buffer.from(RFC_SECRET_ASCII))).toBe(RFC_SECRET_BASE32);
  });

  it('is case-insensitive and ignores padding/whitespace', () => {
    expect(decodeBase32(RFC_SECRET_BASE32.toLowerCase()).toString('utf8')).toBe(RFC_SECRET_ASCII);
  });
});

describe('HOTP (RFC 4226 vectors)', () => {
  it('matches all ten published vectors', () => {
    const secret = decodeBase32(RFC_SECRET_BASE32);
    for (let counter = 0; counter < RFC_HOTP.length; counter++) {
      expect(hotp(secret, counter)).toBe(RFC_HOTP[counter]);
    }
  });
});

describe('TOTP', () => {
  it('derives the code from the time counter', () => {
    // At t just after epoch, counter = floor(t/30). Pick t so counter=3.
    const atMs = 3 * TOTP_PERIOD_SECONDS * 1000 + 1000;
    expect(totp(RFC_SECRET_BASE32, atMs)).toBe(RFC_HOTP[3]);
  });

  it('verifies a correct code and rejects a wrong one', () => {
    const atMs = 5 * TOTP_PERIOD_SECONDS * 1000 + 1000;
    expect(verifyTotp(RFC_SECRET_BASE32, RFC_HOTP[5], { atMs })).toBe(true);
    expect(verifyTotp(RFC_SECRET_BASE32, '000000', { atMs })).toBe(false);
  });

  it('tolerates ±1 step of clock drift within the window', () => {
    const atMs = 5 * TOTP_PERIOD_SECONDS * 1000 + 1000;
    // Code from the previous step should still verify at window=1.
    expect(verifyTotp(RFC_SECRET_BASE32, RFC_HOTP[4], { atMs, window: 1 })).toBe(true);
    // But not two steps away.
    expect(verifyTotp(RFC_SECRET_BASE32, RFC_HOTP[2], { atMs, window: 1 })).toBe(false);
  });

  it('rejects malformed input without throwing', () => {
    expect(verifyTotp(RFC_SECRET_BASE32, 'abcdef')).toBe(false);
    expect(verifyTotp(RFC_SECRET_BASE32, '12345')).toBe(false);
  });

  it('builds a scannable otpauth URI', () => {
    const uri = buildOtpAuthUri({ secretBase32: RFC_SECRET_BASE32, accountName: 'a@b.com', issuer: 'GoldPlus' });
    expect(uri).toContain('otpauth://totp/');
    expect(uri).toContain(`secret=${RFC_SECRET_BASE32}`);
    expect(uri).toContain('issuer=GoldPlus');
  });
});

describe('OTP challenge state machine', () => {
  const base = { expiresAt: otpExpiryFrom(), consumedAt: null, attempts: 0, maxAttempts: 5 };

  it('accepts a correct, unexpired, unconsumed code', () => {
    expect(evaluateOtp(base, true).outcome).toBe('OK');
  });

  it('rejects wrong codes and reports invalid', () => {
    expect(evaluateOtp(base, false).outcome).toBe('INVALID_CODE');
  });

  it('locks after max attempts even with a correct code', () => {
    expect(evaluateOtp({ ...base, attempts: 5 }, true).outcome).toBe('TOO_MANY_ATTEMPTS');
  });

  it('treats an expired or consumed challenge as dead even with a correct code', () => {
    expect(evaluateOtp({ ...base, expiresAt: new Date(Date.now() - 1000) }, true).outcome).toBe('EXPIRED');
    expect(evaluateOtp({ ...base, consumedAt: new Date() }, true).outcome).toBe('CONSUMED');
  });

  it('generates numeric codes of the right length', () => {
    for (let i = 0; i < 50; i++) {
      const code = generateOtpCode(6);
      expect(code).toMatch(/^\d{6}$/);
    }
  });

  it('masks destinations for safe display', () => {
    expect(maskDestination('email', 'john@example.com')).toMatch(/^j\*+@example\.com$/);
    expect(maskDestination('sms', '+256700123456')).toContain('*');
  });
});

describe('backup codes', () => {
  it('generates distinct, formatted codes and normalises input', () => {
    const codes = generateBackupCodes(10);
    expect(new Set(codes).size).toBe(10);
    expect(codes[0]).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    expect(normalizeBackupCode('abcd-ef12')).toBe('ABCDEF12');
  });
});
