import { ITwoFactorRepository, BackupCodeEntry } from '../../ports/ITwoFactorRepository';
import { IUserRepository } from '../../ports/IUserRepository';
import { generateTotpSecret, buildOtpAuthUri, verifyTotp } from '../../../domain/security/Totp';
import { generateBackupCodes, normalizeBackupCode } from '../../../domain/security/BackupCodes';

const ISSUER = 'GoldPlus';

export interface IOtpHasher {
  hash(code: string, salt: string): string;
  matches(code: string, salt: string, storedHash: string): boolean;
}

export interface TwoFactorStatus {
  enabled: boolean;
  method: 'none' | 'totp' | 'sms' | 'email';
  backupCodesRemaining: number;
}

export class GetTwoFactorStatusUseCase {
  constructor(private readonly repo: ITwoFactorRepository) {}
  async execute(userId: string): Promise<TwoFactorStatus> {
    const config = await this.repo.find(userId);
    if (!config || !config.enabled) return { enabled: false, method: 'none', backupCodesRemaining: 0 };
    return {
      enabled: true,
      method: config.method,
      backupCodesRemaining: config.backupCodes.filter((c) => !c.usedAt).length,
    };
  }
}

export type EnrollTotpResult =
  | { ok: true; secret: string; otpauthUri: string }
  | { ok: false; code: 'NOT_FOUND' | 'ALREADY_ENABLED'; message: string };

export class EnrollTotpUseCase {
  constructor(private readonly repo: ITwoFactorRepository, private readonly users: IUserRepository) {}

  async execute(userId: string): Promise<EnrollTotpResult> {
    const user = await this.users.findById(userId);
    if (!user) return { ok: false, code: 'NOT_FOUND', message: 'User not found.' };

    const existing = await this.repo.find(userId);
    if (existing?.enabled) {
      return { ok: false, code: 'ALREADY_ENABLED', message: 'Two-factor is already enabled. Disable it first to re-enroll.' };
    }

    const secret = generateTotpSecret();
    await this.repo.upsertPendingTotp(userId, secret);
    return { ok: true, secret, otpauthUri: buildOtpAuthUri({ secretBase32: secret, accountName: user.email, issuer: ISSUER }) };
  }
}

export type ConfirmTotpResult =
  | { ok: true; backupCodes: string[] }
  | { ok: false; code: 'NO_PENDING' | 'INVALID_CODE'; message: string };

export class ConfirmTotpUseCase {
  constructor(private readonly repo: ITwoFactorRepository, private readonly hasher: IOtpHasher) {}

  async execute(input: { userId: string; code: string }): Promise<ConfirmTotpResult> {
    const config = await this.repo.find(input.userId);
    if (!config?.totpSecret) {
      return { ok: false, code: 'NO_PENDING', message: 'Start TOTP enrolment before confirming.' };
    }
    if (!verifyTotp(config.totpSecret, input.code)) {
      return { ok: false, code: 'INVALID_CODE', message: 'That authenticator code is incorrect.' };
    }
    const plaintext = generateBackupCodes();
    const entries: BackupCodeEntry[] = plaintext.map((code) => ({
      hash: this.hasher.hash(normalizeBackupCode(code), input.userId),
      usedAt: null,
    }));
    await this.repo.enable(input.userId, 'totp', entries);
    return { ok: true, backupCodes: plaintext };
  }
}

export type VerifyTotpResult =
  | { ok: true; usedBackupCode: boolean }
  | { ok: false; code: 'NOT_ENABLED' | 'INVALID_CODE'; message: string };

/**
 * Verifies a login/step-up code for a TOTP-protected account: accepts a
 * live TOTP code or a single-use backup code (which is then consumed).
 */
export class VerifyTotpOrBackupUseCase {
  constructor(private readonly repo: ITwoFactorRepository, private readonly hasher: IOtpHasher) {}

  async execute(input: { userId: string; code: string }): Promise<VerifyTotpResult> {
    const config = await this.repo.find(input.userId);
    if (!config?.enabled || config.method !== 'totp' || !config.totpSecret) {
      return { ok: false, code: 'NOT_ENABLED', message: 'TOTP is not enabled for this account.' };
    }

    if (verifyTotp(config.totpSecret, input.code)) {
      return { ok: true, usedBackupCode: false };
    }

    // Try backup codes (single-use).
    const normalized = normalizeBackupCode(input.code);
    const idx = config.backupCodes.findIndex((c) => !c.usedAt && this.hasher.matches(normalized, input.userId, c.hash));
    if (idx >= 0) {
      const updated = config.backupCodes.map((c, i) => (i === idx ? { ...c, usedAt: new Date().toISOString() } : c));
      await this.repo.saveBackupCodes(input.userId, updated);
      return { ok: true, usedBackupCode: true };
    }

    return { ok: false, code: 'INVALID_CODE', message: 'That code is incorrect or already used.' };
  }
}

export type DisableTwoFactorResult = { ok: true } | { ok: false; code: 'NOT_ENABLED' | 'INVALID_CODE'; message: string };

export class DisableTwoFactorUseCase {
  constructor(private readonly repo: ITwoFactorRepository, private readonly verifyTotpOrBackup: VerifyTotpOrBackupUseCase) {}

  async execute(input: { userId: string; code: string }): Promise<DisableTwoFactorResult> {
    const config = await this.repo.find(input.userId);
    if (!config?.enabled) return { ok: false, code: 'NOT_ENABLED', message: 'Two-factor is not enabled.' };

    // Only a valid current factor may disable 2FA (prevents a hijacked
    // session from silently removing it). TOTP accounts verify here; SMS/
    // email accounts should disable via a fresh OTP challenge (see routes).
    if (config.method === 'totp') {
      const verified = await this.verifyTotpOrBackup.execute({ userId: input.userId, code: input.code });
      if (!verified.ok) return { ok: false, code: 'INVALID_CODE', message: 'A valid code is required to disable two-factor.' };
    }
    await this.repo.disable(input.userId);
    return { ok: true };
  }
}
