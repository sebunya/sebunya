export interface BackupCodeEntry {
  hash: string;
  usedAt: string | null;
}

export interface TwoFactorConfig {
  userId: string;
  method: 'none' | 'totp' | 'sms' | 'email';
  totpSecret: string | null;
  enabled: boolean;
  backupCodes: BackupCodeEntry[];
  confirmedAt: Date | null;
}

export interface ITwoFactorRepository {
  find(userId: string): Promise<TwoFactorConfig | null>;
  /** Creates or replaces the pending TOTP secret (not yet enabled). */
  upsertPendingTotp(userId: string, totpSecret: string): Promise<void>;
  /** Marks 2FA enabled with the given method and stores backup-code hashes. */
  enable(userId: string, method: 'totp' | 'sms' | 'email', backupCodes: BackupCodeEntry[]): Promise<void>;
  disable(userId: string): Promise<void>;
  /** Persists an updated backup-code list (e.g. after one is consumed). */
  saveBackupCodes(userId: string, backupCodes: BackupCodeEntry[]): Promise<void>;
}
