/** Advertising destinations (0138): a platform's switch, ids and encrypted token. */
export interface AdDestinationRow {
  platform: string;
  enabled: boolean;
  config: Record<string, string>;
  hasSecret: boolean;
  secretMask: string | null;
  updatedAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  sentCount: number;
  failedCount: number;
}

export interface AdDestinationRepository {
  list(): Promise<AdDestinationRow[]>;
  get(platform: string): Promise<AdDestinationRow | null>;
  save(platform: string, patch: { enabled?: boolean; config?: Record<string, string>; secretEnc?: string | null; secretMask?: string | null; updatedBy: string | null }): Promise<AdDestinationRow>;
  /** Enabled, fully configured platforms with the ENCRYPTED secret (dispatch only). */
  active(): Promise<Array<{ platform: string; config: Record<string, string>; secretEnc: string }>>;
}

export interface SecretCipher { encrypt(plain: string): string; decrypt(enc: string): string; mask(plain: string): string }
