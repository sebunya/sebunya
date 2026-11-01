import type { BusinessInfo } from '@goldplus/shared';

export interface StoredBusinessInfo {
  config: BusinessInfo;
  version: number;
  updatedAt: Date;
}

export interface IBusinessInfoRepository {
  getConfig(): Promise<StoredBusinessInfo | null>;
  updateConfig(config: BusinessInfo, actorId: string): Promise<StoredBusinessInfo>;
  /** Add-only: insert DEFAULT only if no row exists; never overwrite edits. */
  seedMissing(defaultConfig: BusinessInfo): Promise<{ inserted: number }>;
}
