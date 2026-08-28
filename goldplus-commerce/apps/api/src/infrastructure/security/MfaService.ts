import { IMfaRepository } from '../../application/ports/IMfaRepository';
import {
  RECOVERY_CODE_COUNT,
  RECOVERY_CODE_BYTES,
  decideStepUp,
  isStepUpFresh,
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

  /**
   * Begin enrolment: a fresh secret, encrypted at rest, plus the otpauth URI.
   *
   * RE-ENROLMENT IS ITSELF A PRIVILEGED ACTION.
   *
   * This used to call upsertEnrolment unconditionally, so a CONFIRMED secret was
   * overwritten by anyone who could reach the route. Holding a stolen bearer
   * token was therefore enough to defeat MFA entirely: POST /auth/mfa/enrol
   * returned a brand new secret, POST /auth/mfa/confirm accepted a code computed
   * from it and issued fresh recovery codes, and every requireStepUp gate then
   * answered ALLOW. The authenticator the administrator actually holds was
   * silently replaced, and MFA protected nothing it was added to protect.
   *
   * Replacing a live authenticator now needs a recent proof of the CURRENT one,
   * which is the same freshness rule every other privileged action uses. First
   * enrolment, and re-enrolment of a secret that was never confirmed, are
   * unaffected: there is nothing to protect yet.
   */
  async beginEnrolment(
    userId: string,
    account: string,
    now = new Date(),
  ): Promise<EnrolmentStart | { stepUpRequired: true }> {
    const existing = await this.repo.get(userId);
    if (existing?.confirmedAt && !isStepUpFresh(existing.lastVerifiedAt, now)) {
      return { stepUpRequired: true };
    }

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
  /**
   * Whether step-up is locked: too many consecutive failures inside the window.
   *
   * `failed_attempts` existed and was reset on success, but nothing ever
   * incremented or checked it, so a six-digit TOTP (three valid codes per
   * thirty-second step) could be brute-forced from a stolen bearer token, which
   * is precisely the case step-up exists for.
   */
  static readonly MAX_FAILURES = 5;
  static readonly LOCK_WINDOW_MS = 15 * 60_000;

  isLocked(record: { failedAttempts: number; updatedAt: Date }, now: Date): boolean {
    return (
      record.failedAttempts >= MfaService.MAX_FAILURES &&
      now.getTime() - record.updatedAt.getTime() < MfaService.LOCK_WINDOW_MS
    );
  }

  async verify(userId: string, code: string, now = new Date()): Promise<boolean | 'LOCKED'> {
    const record = await this.repo.get(userId);
    if (!record || !record.confirmedAt) return false;
    if (this.isLocked(record, now)) return 'LOCKED';
    if (!verifyTotp(decryptSecret(record.secretCiphertext), code, now.getTime())) {
      await this.repo.recordFailure(userId, now);
      return false;
    }
    await this.repo.recordVerification(userId, now);
    return true;
  }

  /** Consume a single-use recovery code as a step-up; stamps freshness. */
  async useRecoveryCode(userId: string, code: string, now = new Date()): Promise<boolean | 'LOCKED'> {
    const record = await this.repo.get(userId);
    if (!record || !record.confirmedAt) return false;
    if (this.isLocked(record, now)) return 'LOCKED';
    const consumed = await this.repo.consumeRecoveryCode(userId, hashRecoveryCode(code), now);
    if (consumed) await this.repo.recordVerification(userId, now);
    else await this.repo.recordFailure(userId, now);
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
