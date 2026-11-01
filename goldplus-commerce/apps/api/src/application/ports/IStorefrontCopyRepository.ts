import type { StorefrontCopy } from '@goldplus/shared';

export interface StoredStorefrontCopy {
  config: StorefrontCopy;
  version: number;
  updatedAt: Date;
}

export interface IStorefrontCopyRepository {
  getConfig(): Promise<StoredStorefrontCopy | null>;
  updateConfig(config: StorefrontCopy, actorId: string): Promise<StoredStorefrontCopy>;
  /** Add-only: insert DEFAULT only if no row exists; never overwrite edits. */
  seedMissing(defaultConfig: StorefrontCopy): Promise<{ inserted: number }>;
}
