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
  matchTotpStep,
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
   * Replacing a live authenticator needs a code from the CURRENT one (or a
   * recovery code, for a lost phone) in the same request. It used to accept a
   * recent step-up instead, but freshness is stored per user, not per session,
   * and /mfa/status reports when it happened: a stolen token could wait for the
   * real admin to verify and then swap the authenticator inside those five
   * minutes. A code the thief does not hold cannot be borrowed that way. First
   * enrolment, and re-enrolment of a secret that was never confirmed, are
   * unaffected: there is nothing to protect yet.
   */
  async beginEnrolment(
    userId: string,
    account: string,
    proof?: { code?: string; recovery?: boolean },
    now = new Date(),
  ): Promise<EnrolmentStart | { currentCodeRequired: true } | { currentCodeInvalid: true } | { locked: true }> {
    const existing = await this.repo.get(userId);
    if (existing?.confirmedAt) {
      const code = String(proof?.code ?? '').trim();
      if (!code) return { currentCodeRequired: true };
      const proved = proof?.recovery ? await this.useRecoveryCode(userId, code, now) : await this.verify(userId, code, now);
      if (proved === 'LOCKED') return { locked: true };
      if (proved !== true) return { currentCodeInvalid: true };
    }

    const secret = generateTotpSecret();
    await this.repo.upsertEnrolment(userId, encryptSecret(secret));
    return { secret, otpauthUri: otpauthUri(secret, account) };
  }

  /**
   * Confirm enrolment by proving the first code. Returns the one-time recovery
   * codes; from here MFA is active.
   *
   * Confirmation is a one-shot for an UNCONFIRMED secret, and it counts wrong
   * codes against the same lock as step-up. It used to accept unlimited guesses
   * against an already-confirmed enrolment, and a hit stamped step-up freshness
   * and replaced the owner's recovery codes, so the five-strike lock on
   * /mfa/verify could simply be routed around from a stolen bearer token.
   * Re-enrolment goes through beginEnrolment (step-up gated), which clears
   * confirmedAt, so nothing legitimate confirms a confirmed secret.
   */
  async confirmEnrolment(
    userId: string,
    code: string,
    now = new Date(),
  ): Promise<{ ok: boolean; recoveryCodes?: string[]; locked?: true }> {
    const record = await this.repo.get(userId);
    if (!record || record.confirmedAt) return { ok: false };
    if (this.isLocked(record, now)) return { ok: false, locked: true };
    if (!verifyTotp(decryptSecret(record.secretCiphertext), code, now.getTime())) {
      await this.repo.recordFailure(userId, now);
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

  /**
   * A code is valid for ~90 seconds, so one read over a shoulder or out of a log could be used again. The last
   * accepted verification's step is known to within one (the window either side), so a code is accepted only from
   * a step after that; the cost is that a second step-up inside about a minute waits for the next code.
   */
  static isReplayedStep(matchedStep: number, lastVerifiedAt: Date | null): boolean {
    return !!lastVerifiedAt && matchedStep <= Math.floor(lastVerifiedAt.getTime() / 30_000) + 1;
  }

  async verify(userId: string, code: string, now = new Date()): Promise<boolean | 'LOCKED'> {
    const record = await this.repo.get(userId);
    if (!record || !record.confirmedAt) return false;
    if (this.isLocked(record, now)) return 'LOCKED';
    const matched = matchTotpStep(decryptSecret(record.secretCiphertext), code, now.getTime());
    if (matched === null || MfaService.isReplayedStep(matched, record.lastVerifiedAt)) {
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
