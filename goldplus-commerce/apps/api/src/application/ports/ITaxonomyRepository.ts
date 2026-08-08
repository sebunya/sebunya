import type { Taxonomy } from '@goldplus/shared';

export interface StoredTaxonomy {
  config: Taxonomy;
  version: number;
  updatedAt: Date;
}

export interface ITaxonomyRepository {
  getConfig(): Promise<StoredTaxonomy | null>;
  updateConfig(config: Taxonomy, actorId: string): Promise<StoredTaxonomy>;
  /** Add-only: insert DEFAULT only if no row exists; never overwrite edits. */
  seedMissing(defaultConfig: Taxonomy): Promise<{ inserted: number }>;
}
