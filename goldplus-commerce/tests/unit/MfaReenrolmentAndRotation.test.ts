import { describe, it, expect, afterEach } from 'vitest';
import { MfaService } from '../../apps/api/src/infrastructure/security/MfaService';
import {
  encryptSecret,
  decryptSecret,
  decryptSecretWithRotation,
  totp,
  generateTotpSecret,
} from '../../apps/api/src/infrastructure/security/TotpService';
import type { IMfaRepository, MfaRecord } from '../../apps/api/src/application/ports/IMfaRepository';

/** In-memory repository with the same semantics as DrizzleMfaRepository. */
function fakeRepo(initial: Partial<MfaRecord> & { secret: string }) {
  const rec: MfaRecord = {
    userId: 'u1',
    secretCiphertext: encryptSecret(initial.secret),
    pendingSecretCiphertext: null,
    confirmedAt: initial.confirmedAt ?? null,
    lastVerifiedAt: initial.lastVerifiedAt ?? null,
    failedAttempts: initial.failedAttempts ?? 0,
    updatedAt: initial.updatedAt ?? new Date(0),
  };
  const log = { rewrapped: 0 };
  const repo: IMfaRepository = {
    get: async () => ({ ...rec }),
    upsertEnrolment: async (_u, ct) => {
      if (rec.confirmedAt) return;
      rec.secretCiphertext = ct;
      rec.pendingSecretCiphertext = null;
    },
    setPendingSecret: async (_u, ct) => {
      if (rec.confirmedAt) rec.pendingSecretCiphertext = ct;
    },
    promotePendingSecret: async (_u, at) => {
      if (!rec.pendingSecretCiphertext) return;
      rec.secretCiphertext = rec.pendingSecretCiphertext;
      rec.pendingSecretCiphertext = null;
      Object.assign(rec, { confirmedAt: at, lastVerifiedAt: at, failedAttempts: 0, updatedAt: at });
    },
    rewrapSecret: async (_u, oldCt, newCt) => {
      log.rewrapped += 1;
      if (rec.secretCiphertext === oldCt) rec.secretCiphertext = newCt;
    },
    confirm: async (_u, at) => Object.assign(rec, { confirmedAt: at, lastVerifiedAt: at, failedAttempts: 0, updatedAt: at }) && undefined,
    recordVerification: async (_u, at) => Object.assign(rec, { lastVerifiedAt: at, failedAttempts: 0, updatedAt: at }) && undefined,
    recordFailure: async (_u, at, decayAfterMs) => {
      const spent = decayAfterMs && at.getTime() - rec.updatedAt.getTime() >= decayAfterMs;
      rec.failedAttempts = spent ? 1 : rec.failedAttempts + 1;
      rec.updatedAt = at;
      return rec.failedAttempts;
    },
    replaceRecoveryCodes: async () => undefined,
    consumeRecoveryCode: async () => false,
    disable: async () => undefined,
  };
  return { repo, rec, log };
}

describe('re-enrolment holds the new secret as pending until it is proven', () => {
  const now = new Date('2026-11-01T10:00:00Z');

  it('an abandoned re-enrolment leaves the confirmed authenticator in force and still demands a code', async () => {
    const old = generateTotpSecret();
    const { repo, rec } = fakeRepo({ secret: old, confirmedAt: new Date('2026-10-01') });
    const svc = new MfaService(repo);
    const start = await svc.beginEnrolment('u1', 'admin@x', { code: totp(old, now.getTime()) }, now);
    expect('secret' in start).toBe(true);
    // Abandoned here: confirmed state is untouched.
    expect(rec.confirmedAt).not.toBeNull();
    expect(decryptSecret(rec.secretCiphertext)).toBe(old);
    expect(rec.pendingSecretCiphertext).not.toBeNull();
    expect((await svc.gate('u1', 'refund.issue', now)).action).not.toBe('ENROL_REQUIRED');
    // A stolen token without a current code gets nothing.
    expect(await svc.beginEnrolment('u1', 'admin@x', undefined, now)).toEqual({ currentCodeRequired: true });
  });

  it('confirming proves the pending secret and only then replaces the live one', async () => {
    const old = generateTotpSecret();
    const { repo, rec } = fakeRepo({ secret: old, confirmedAt: new Date('2026-10-01') });
    const svc = new MfaService(repo);
    const start = await svc.beginEnrolment('u1', 'admin@x', { code: totp(old, now.getTime()) }, now);
    const fresh = (start as { secret: string }).secret;
    const later = new Date(now.getTime() + 60_000);
    // The OLD code does not confirm the new secret.
    expect((await svc.confirmEnrolment('u1', totp(old, later.getTime()), later)).ok).toBe(false);
    expect(decryptSecret(rec.secretCiphertext)).toBe(old);
    const done = await svc.confirmEnrolment('u1', totp(fresh, later.getTime()), later);
    expect(done.ok).toBe(true);
    expect(decryptSecret(rec.secretCiphertext)).toBe(fresh);
    expect(rec.pendingSecretCiphertext).toBeNull();
  });
});

describe('TOTP at-rest key survives a JWT_SECRET rotation', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it('decrypts a secret written under the previous JWT secret and re-encrypts it under the current key', async () => {
    delete process.env.MFA_ENCRYPTION_KEY;
    process.env.JWT_SECRET = 'old-secret-0123456789-0123456789-abcdef';
    const secret = generateTotpSecret();
    const { repo, rec, log } = fakeRepo({ secret, confirmedAt: new Date('2026-10-01') });
    const oldCt = rec.secretCiphertext;

    process.env.JWT_SECRET_PREVIOUS = process.env.JWT_SECRET;
    process.env.JWT_SECRET = 'new-secret-9876543210-9876543210-fedcba';
    expect(decryptSecretWithRotation(oldCt)).toEqual({ plain: secret, rotated: true });

    const svc = new MfaService(repo);
    const now = new Date('2026-11-01T10:00:00Z');
    expect(await svc.verify('u1', totp(secret, now.getTime()), now)).toBe(true);
    await new Promise((r) => setImmediate(r));
    expect(log.rewrapped).toBe(1);
    expect(decryptSecretWithRotation(rec.secretCiphertext)).toEqual({ plain: secret, rotated: false });
  });

  it('still refuses a ciphertext no known key opens', () => {
    delete process.env.MFA_ENCRYPTION_KEY;
    process.env.JWT_SECRET = 'a-secret-0123456789-0123456789-abcdefgh';
    const ct = encryptSecret('X');
    process.env.JWT_SECRET = 'b-secret-0123456789-0123456789-abcdefgh';
    delete process.env.JWT_SECRET_PREVIOUS;
    expect(() => decryptSecret(ct)).toThrow();
  });
});

describe('MFA lockout decays and a replayed step is not a failure', () => {
  it('after the lock window, one more typo does not re-lock', async () => {
    const secret = generateTotpSecret();
    const lockedAt = new Date('2026-11-01T10:00:00Z');
    const { repo, rec } = fakeRepo({ secret, confirmedAt: new Date('2026-10-01'), failedAttempts: 5, updatedAt: lockedAt });
    const svc = new MfaService(repo);
    const after = new Date(lockedAt.getTime() + MfaService.LOCK_WINDOW_MS + 1000);
    expect(await svc.verify('u1', '000000', after)).toBe(false);
    expect(rec.failedAttempts).toBe(1);
    expect(svc.isLocked(rec, after)).toBe(false);
  });

  it('re-using the code just accepted is refused without counting a failure', async () => {
    const secret = generateTotpSecret();
    const { repo, rec } = fakeRepo({ secret, confirmedAt: new Date('2026-10-01') });
    const svc = new MfaService(repo);
    const now = new Date('2026-11-01T10:00:05Z');
    const code = totp(secret, now.getTime());
    expect(await svc.verify('u1', code, now)).toBe(true);
    expect(await svc.verify('u1', code, new Date(now.getTime() + 5000))).toBe(false);
    expect(rec.failedAttempts).toBe(0);
  });
});
