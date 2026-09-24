import type { HomepageContent } from '@goldplus/shared';

export interface StoredHomepageContent {
  config: HomepageContent;
  version: number;
  updatedAt: Date;
}

export interface IHomepageContentRepository {
  getConfig(): Promise<StoredHomepageContent | null>;
  updateConfig(config: HomepageContent, actorId: string): Promise<StoredHomepageContent>;
  /**
   * Compare-and-swap: writes only if the stored version is still `expectedVersion`.
   * Null when someone else saved in between — the caller re-reads and decides,
   * so a copy read earlier can never silently overwrite a newer save.
   */
  replaceIfVersion(config: HomepageContent, actorId: string, expectedVersion: number): Promise<StoredHomepageContent | null>;
  /** Add-only: insert DEFAULT only if no row exists; never overwrite edits. */
  seedMissing(defaultConfig: HomepageContent): Promise<{ inserted: number }>;
}
