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
  decryptSecretWithRotation,
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
   *
   * A proven re-enrolment only PARKS the new secret as pending (0213). The
   * confirmed secret stays live until the new one's first code is confirmed, so
   * abandoning re-enrolment half way never leaves the account unconfirmed, and
   * the next enrol still demands a code from the authenticator in force.
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
    if (existing?.confirmedAt) await this.repo.setPendingSecret(userId, encryptSecret(secret));
    else await this.repo.upsertEnrolment(userId, encryptSecret(secret));
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
   * Re-enrolment goes through beginEnrolment (current-code gated), which parks
   * the new secret as pending; confirming proves the PENDING secret and only
   * then replaces the live one. A confirmed secret itself is never re-confirmed.
   */
  async confirmEnrolment(
    userId: string,
    code: string,
    now = new Date(),
    sessionId: string | null = null,
  ): Promise<{ ok: boolean; recoveryCodes?: string[]; locked?: true }> {
    const record = await this.repo.get(userId);
    if (!record) return { ok: false };
    const pending = record.pendingSecretCiphertext ?? null;
    if (record.confirmedAt && !pending) return { ok: false };
    if (this.isLocked(record, now)) return { ok: false, locked: true };
    const ciphertext = pending ?? record.secretCiphertext;
    if (!verifyTotp(this.readSecret(userId, ciphertext), code, now.getTime())) {
      await this.countFailure(record, now);
      return { ok: false };
    }
    if (pending) await this.repo.promotePendingSecret(userId, now);
    else await this.repo.confirm(userId, now);
    await this.stampSession(sessionId, userId, now);
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
   * Count a wrong code. Failures older than the lock window are spent first: without that, five old typos plus ONE
   * new mistake after the lock had lapsed re-locked the account for another full window.
   */
  private async countFailure(record: { userId: string }, now: Date): Promise<void> {
    await this.repo.recordFailure(record.userId, now, MfaService.LOCK_WINDOW_MS);
  }

  /** Decrypt a stored secret; one written under the previous JWT-derived key is re-encrypted under the current one. */
  private readSecret(userId: string, ciphertext: string): string {
    const { plain, rotated } = decryptSecretWithRotation(ciphertext);
    if (rotated && this.repo.rewrapSecret) {
      void this.repo.rewrapSecret(userId, ciphertext, encryptSecret(plain)).catch(() => undefined);
    }
    return plain;
  }

  /**
   * A code is valid for ~90 seconds, so one read over a shoulder or out of a log could be used again. The last
   * accepted verification's step is known to within one (the window either side), so a code is accepted only from
   * a step after that; the cost is that a second step-up inside about a minute waits for the next code.
   */
  static isReplayedStep(matchedStep: number, lastVerifiedAt: Date | null): boolean {
    return !!lastVerifiedAt && matchedStep <= Math.floor(lastVerifiedAt.getTime() / 30_000) + 1;
  }

  /** 0187: a verification counts for the sign-in session it was made in. */
  private async stampSession(sessionId: string | null, userId: string, at: Date): Promise<void> {
    if (sessionId && this.repo.recordSessionStepUp) await this.repo.recordSessionStepUp(sessionId, userId, at);
  }

  async verify(userId: string, code: string, now = new Date(), sessionId: string | null = null): Promise<boolean | 'LOCKED'> {
    const record = await this.repo.get(userId);
    if (!record || !record.confirmedAt) return false;
    if (this.isLocked(record, now)) return 'LOCKED';
    const matched = matchTotpStep(this.readSecret(userId, record.secretCiphertext), code, now.getTime());
    if (matched === null) {
      await this.countFailure(record, now);
      return false;
    }
    // A replayed step is the RIGHT code used twice (a second step-up inside a minute), not a guess: refused, but it
    // does not eat into the five-strike budget.
    if (MfaService.isReplayedStep(matched, record.lastVerifiedAt)) return false;
    await this.repo.recordVerification(userId, now);
    await this.stampSession(sessionId, userId, now);
    return true;
  }

  /** Consume a single-use recovery code as a step-up; stamps freshness. */
  async useRecoveryCode(userId: string, code: string, now = new Date(), sessionId: string | null = null): Promise<boolean | 'LOCKED'> {
    const record = await this.repo.get(userId);
    if (!record || !record.confirmedAt) return false;
    if (this.isLocked(record, now)) return 'LOCKED';
    const consumed = await this.repo.consumeRecoveryCode(userId, hashRecoveryCode(code), now);
    if (consumed) {
      await this.repo.recordVerification(userId, now);
      await this.stampSession(sessionId, userId, now);
    } else await this.countFailure(record, now);
    return consumed;
  }

  async status(userId: string, sessionId: string | null = null): Promise<MfaStatus> {
    const record = await this.repo.get(userId);
    return {
      enrolled: !!record,
      confirmed: !!record?.confirmedAt,
      lastVerifiedAt: await this.freshnessBasis(record?.lastVerifiedAt ?? null, userId, sessionId),
    };
  }

  /**
   * The verification time that counts: this sign-in session's own (0187). A token issued without a session (only
   * when the session store was down) keeps the account-wide time, so it is never stuck re-verifying for nothing.
   */
  private async freshnessBasis(accountWide: Date | null, userId: string, sessionId: string | null): Promise<Date | null> {
    if (!sessionId || !this.repo.sessionStepUpAt) return accountWide;
    return this.repo.sessionStepUpAt(sessionId, userId);
  }

  /** Audited reset / disable. Callers must record the actor separately. */
  async disable(userId: string): Promise<void> {
    await this.repo.disable(userId);
  }

  /** The step-up gate for a privileged action, using the current MFA state. */
  async gate(userId: string, action: string, now = new Date(), sessionId: string | null = null): Promise<StepUpDecision> {
    const record = await this.repo.get(userId);
    return decideStepUp({
      action,
      mfaConfirmed: !!record?.confirmedAt,
      lastVerifiedAt: await this.freshnessBasis(record?.lastVerifiedAt ?? null, userId, sessionId),
      now,
    });
  }
}
