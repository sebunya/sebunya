import { IMfaRepository } from '../../application/ports/IMfaRepository';
import {
  RECOVERY_CODE_COUNT,
  RECOVERY_CODE_BYTES,
  decideStepUp,
  StepUpDecision,
} from '../../domain/identity/MfaPolicy';
import {
  generateTotpSecret,
  otpauthUri,
  verifyTotp,
  encryptSecret,
  decryptSecret,
  hashRecoveryCode,
  generateRecoveryCodes,
} from './TotpService';

export interface EnrolmentStart {
  secret: string;
  otpauthUri: string;
}

export interface MfaStatus {
  enrolled: boolean;
  confirmed: boolean;
  lastVerifiedAt: Date | null;
}

/**
 * Privileged MFA lifecycle. Composes the TOTP algorithm, at-rest encryption, the
 * repository and the pure step-up policy. Recovery codes are shown to the user
 * exactly once — on confirmation — and only their hashes are ever stored.
 */
export class MfaService {
  constructor(private readonly repo: IMfaRepository) {}

  /** Begin enrolment: a fresh secret, encrypted at rest, plus the otpauth URI. */
  async beginEnrolment(userId: string, account: string): Promise<EnrolmentStart> {
    const secret = generateTotpSecret();
    await this.repo.upsertEnrolment(userId, encryptSecret(secret));
    return { secret, otpauthUri: otpauthUri(secret, account) };
  }

  /**
   * Confirm enrolment by proving the first code. Returns the one-time recovery
   * codes; from here MFA is active.
   */
  async confirmEnrolment(
    userId: string,
    code: string,
    now = new Date(),
  ): Promise<{ ok: boolean; recoveryCodes?: string[] }> {
    const record = await this.repo.get(userId);
    if (!record) return { ok: false };
    if (!verifyTotp(decryptSecret(record.secretCiphertext), code, now.getTime())) {
      return { ok: false };
    }
    await this.repo.confirm(userId, now);
    const codes = generateRecoveryCodes(RECOVERY_CODE_COUNT, RECOVERY_CODE_BYTES);
    await this.repo.replaceRecoveryCodes(userId, codes.map(hashRecoveryCode));
    return { ok: true, recoveryCodes: codes };
  }

  /** Verify a TOTP code as a step-up; stamps freshness on success. */
  async verify(userId: string, code: string, now = new Date()): Promise<boolean> {
    const record = await this.repo.get(userId);
    if (!record || !record.confirmedAt) return false;
    if (!verifyTotp(decryptSecret(record.secretCiphertext), code, now.getTime())) return false;
    await this.repo.recordVerification(userId, now);
    return true;
  }

  /** Consume a single-use recovery code as a step-up; stamps freshness. */
  async useRecoveryCode(userId: string, code: string, now = new Date()): Promise<boolean> {
    const record = await this.repo.get(userId);
    if (!record || !record.confirmedAt) return false;
    const consumed = await this.repo.consumeRecoveryCode(userId, hashRecoveryCode(code), now);
    if (consumed) await this.repo.recordVerification(userId, now);
    return consumed;
  }

  async status(userId: string): Promise<MfaStatus> {
    const record = await this.repo.get(userId);
    return {
      enrolled: !!record,
      confirmed: !!record?.confirmedAt,
      lastVerifiedAt: record?.lastVerifiedAt ?? null,
    };
  }

  /** Audited reset / disable. Callers must record the actor separately. */
  async disable(userId: string): Promise<void> {
    await this.repo.disable(userId);
  }

  /** The step-up gate for a privileged action, using the current MFA state. */
  async gate(userId: string, action: string, now = new Date()): Promise<StepUpDecision> {
    const record = await this.repo.get(userId);
    return decideStepUp({
      action,
      mfaConfirmed: !!record?.confirmedAt,
      lastVerifiedAt: record?.lastVerifiedAt ?? null,
      now,
    });
  }
}
