import type { HomepageContent } from '@goldplus/shared';

export interface StoredHomepageContent {
  config: HomepageContent;
  version: number;
  updatedAt: Date;
}

export interface IHomepageContentRepository {
  getConfig(): Promise<StoredHomepageContent | null>;
  updateConfig(config: HomepageContent, actorId: string): Promise<StoredHomepageContent>;
  /** Add-only: insert DEFAULT only if no row exists; never overwrite edits. */
  seedMissing(defaultConfig: HomepageContent): Promise<{ inserted: number }>;
}
