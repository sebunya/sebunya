import type { NavConfig } from '@goldplus/shared';

export interface StoredNavConfig {
  config: NavConfig;
  version: number;
  updatedAt: Date;
}

export interface INavRepository {
  getConfig(): Promise<StoredNavConfig | null>;
  /**
   * Replace the config. When `expectedVersion` is given, the write is a no-op if
   * the stored version has moved on (returns null) — optimistic concurrency so a
   * second admin cannot silently clobber the first's edit.
   */
  updateConfig(config: NavConfig, actorId: string, expectedVersion?: number): Promise<StoredNavConfig | null>;
  /** Add-only: insert DEFAULT_NAV_CONFIG only if no row exists; never overwrite edits. */
  seedMissing(defaultConfig: NavConfig): Promise<{ inserted: number }>;
}
