import type { NavConfig } from '@goldplus/shared';

export interface StoredNavConfig {
  config: NavConfig;
  version: number;
  updatedAt: Date;
}

export interface INavRepository {
  getConfig(): Promise<StoredNavConfig | null>;
  updateConfig(config: NavConfig, actorId: string): Promise<StoredNavConfig>;
  /** Add-only: insert DEFAULT_NAV_CONFIG only if no row exists; never overwrite edits. */
  seedMissing(defaultConfig: NavConfig): Promise<{ inserted: number }>;
}
