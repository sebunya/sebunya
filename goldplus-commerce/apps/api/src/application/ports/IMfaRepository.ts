export interface MfaRecord {
  userId: string;
  secretCiphertext: string;
  confirmedAt: Date | null;
  lastVerifiedAt: Date | null;
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
  /** Mark the enrolment confirmed and stamp the first verification. */
  confirm(userId: string, at: Date): Promise<void>;
  /** Stamp a successful step-up verification. */
  recordVerification(userId: string, at: Date): Promise<void>;
  /** Replace all recovery codes with a fresh set of hashes. */
  replaceRecoveryCodes(userId: string, codeHashes: string[]): Promise<void>;
  /** Atomically consume an unused recovery code; false if already used/unknown. */
  consumeRecoveryCode(userId: string, codeHash: string, at: Date): Promise<boolean>;
  /** Remove MFA and all recovery codes (audited reset / disable). */
  disable(userId: string): Promise<void>;
}
