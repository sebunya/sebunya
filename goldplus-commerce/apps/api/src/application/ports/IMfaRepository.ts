export interface MfaRecord {
  userId: string;
  secretCiphertext: string;
  /**
   * 0213: a replacement secret waiting for its first code. The confirmed secret above stays in force until this one
   * is proven, so an abandoned re-enrolment never leaves the account without a working authenticator.
   */
  pendingSecretCiphertext?: string | null;
  confirmedAt: Date | null;
  lastVerifiedAt: Date | null;
  /** Consecutive failed step-up codes since the last success. */
  failedAttempts: number;
  /** When the record last changed; bounds the failure window. */
  updatedAt: Date;
}

/**
 * Persistence for privileged MFA. The TOTP secret arrives already encrypted and
 * recovery codes already hashed — this port never sees a plaintext secret or
 * code.
 */
export interface IMfaRepository {
  get(userId: string): Promise<MfaRecord | null>;
  /** Create or replace an (unconfirmed) enrolment with a new encrypted secret. */
  upsertEnrolment(userId: string, secretCiphertext: string): Promise<void>;
  /** Hold a replacement secret beside a CONFIRMED one; the confirmed secret is untouched. */
  setPendingSecret(userId: string, secretCiphertext: string): Promise<void>;
  /** Promote the pending secret to the live one, confirmed now; recovery codes are replaced by the caller. */
  promotePendingSecret(userId: string, at: Date): Promise<void>;
  /**
   * Swap a ciphertext read under the previous at-rest key for one under the current key. Conditional on the old value,
   * so it never overwrites a secret that changed in between. Optional so older fakes type.
   */
  rewrapSecret?(userId: string, oldCiphertext: string, newCiphertext: string): Promise<void>;
  /** Mark the enrolment confirmed and stamp the first verification. */
  confirm(userId: string, at: Date): Promise<void>;
  /** Stamp a successful step-up verification. */
  recordVerification(userId: string, at: Date): Promise<void>;
  /** Count a failed step-up code. Returns the new consecutive-failure count. */
  /**
   * Count one failed code, atomically. With `decayAfterMs`, a count whose last failure is at least that old is spent
   * and restarts at 1 in the same statement (a separate reset then increment let parallel guesses on two replicas
   * wipe each other's counts).
   */
  recordFailure(userId: string, at: Date, decayAfterMs?: number): Promise<number>;
  /** Replace all recovery codes with a fresh set of hashes. */
  replaceRecoveryCodes(userId: string, codeHashes: string[]): Promise<void>;
  /** Atomically consume an unused recovery code; false if already used/unknown. */
  consumeRecoveryCode(userId: string, codeHash: string, at: Date): Promise<boolean>;
  /** Remove MFA and all recovery codes (audited reset / disable). */
  disable(userId: string): Promise<void>;
  /** 0187: a verification made in this sign-in session (refresh-token family). Optional so older fakes type. */
  recordSessionStepUp?(familyId: string, userId: string, at: Date): Promise<void>;
  /** When this user's sign-in session last passed two-step verification; null when never. */
  sessionStepUpAt?(familyId: string, userId: string): Promise<Date | null>;
}
