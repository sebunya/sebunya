import { describe, it, expect } from 'vitest';
import {
  totp,
  verifyTotp,
  base32Encode,
  base32Decode,
  encryptSecret,
  decryptSecret,
  generateTotpSecret,
  hashRecoveryCode,
} from '../../apps/api/src/infrastructure/security/TotpService';
import {
  decideStepUp,
  isStepUpFresh,
  requiresMfa,
  STEP_UP_FRESHNESS_MS,
} from '../../apps/api/src/domain/identity/MfaPolicy';

// RFC 6238 Appendix B test vectors (SHA-1, secret "12345678901234567890").
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890', 'ascii'));
const VECTORS: Array<[number, string]> = [
  [59, '94287082'],
  [1111111109, '07081804'],
  [1111111111, '14050471'],
  [1234567890, '89005924'],
  [2000000000, '69279037'],
  [20000000000, '65353130'],
];

describe('TOTP (RFC 6238)', () => {
  it('matches every official 8-digit test vector', () => {
    for (const [t, expected] of VECTORS) {
      expect(totp(RFC_SECRET, t * 1000, { digits: 8 })).toBe(expected);
    }
  });

  it('accepts a correct current 6-digit code and rejects a wrong one', () => {
    const secret = generateTotpSecret();
    const now = 1_760_000_000_000;
    const code = totp(secret, now);
    expect(verifyTotp(secret, code, now)).toBe(true);
    expect(verifyTotp(secret, '000000', now)).toBe(false);
    expect(verifyTotp(secret, code, now + 5 * 60_000)).toBe(false); // far outside the window
  });

  it('tolerates +/- one step of clock drift but not two', () => {
    const secret = generateTotpSecret();
    const now = 1_760_000_000_000;
    const prev = totp(secret, now - 30_000);
    const next = totp(secret, now + 30_000);
    expect(verifyTotp(secret, prev, now)).toBe(true);
    expect(verifyTotp(secret, next, now)).toBe(true);
    expect(verifyTotp(secret, totp(secret, now - 90_000), now)).toBe(false);
  });

  it('rejects malformed codes', () => {
    const secret = generateTotpSecret();
    expect(verifyTotp(secret, 'abcdef', Date.now())).toBe(false);
    expect(verifyTotp(secret, '12345', Date.now())).toBe(false); // wrong length
  });
});

describe('base32 + at-rest crypto', () => {
  it('round-trips base32', () => {
    const buf = Buffer.from('the quick brown fox');
    expect(base32Decode(base32Encode(buf)).equals(buf)).toBe(true);
  });
  it('encrypts and decrypts a secret (AES-256-GCM) and rejects tampering', () => {
    const secret = generateTotpSecret();
    const ct = encryptSecret(secret);
    expect(ct).not.toContain(secret);
    expect(decryptSecret(ct)).toBe(secret);
    const tampered = ct.slice(0, -4) + (ct.slice(-4) === 'AAAA' ? 'BBBB' : 'AAAA');
    expect(() => decryptSecret(tampered)).toThrow();
  });
  it('hashes recovery codes to 64 hex chars, case/space-insensitively', () => {
    expect(hashRecoveryCode('AB CD')).toBe(hashRecoveryCode('abcd'));
    expect(hashRecoveryCode('abcd')).toHaveLength(64);
  });
});

describe('MfaPolicy — step-up', () => {
  const now = new Date('2026-08-02T12:00:00Z');
  it('knows the privileged action set and denies self-bypass', () => {
    expect(requiresMfa('release_approval')).toBe(true);
    expect(requiresMfa('pricing_approval')).toBe(true);
    expect(requiresMfa('view_dashboard')).toBe(false);
    // Privileged action + no confirmed MFA => must enrol, cannot skip.
    expect(decideStepUp({ action: 'release_approval', mfaConfirmed: false, lastVerifiedAt: null, now }).action).toBe(
      'ENROL_REQUIRED',
    );
  });
  it('requires a FRESH proof, not merely enrolment', () => {
    const stale = new Date(now.getTime() - STEP_UP_FRESHNESS_MS - 1);
    const fresh = new Date(now.getTime() - 60_000);
    expect(isStepUpFresh(stale, now)).toBe(false);
    expect(isStepUpFresh(fresh, now)).toBe(true);
    expect(decideStepUp({ action: 'canary_control', mfaConfirmed: true, lastVerifiedAt: stale, now }).action).toBe(
      'STEP_UP_REQUIRED',
    );
    expect(decideStepUp({ action: 'canary_control', mfaConfirmed: true, lastVerifiedAt: fresh, now }).action).toBe(
      'ALLOW',
    );
  });
  it('does not gate non-privileged actions', () => {
    expect(decideStepUp({ action: 'view_dashboard', mfaConfirmed: false, lastVerifiedAt: null, now }).action).toBe(
      'ALLOW',
    );
  });
});
