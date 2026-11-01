import { Registry } from '../Registry';
import { DEFAULT_TAXONOMY } from '@goldplus/shared';
import { logger } from '../logging/logger';

/**
 * Ensure the discovery taxonomy exists (0113). Idempotent, add-only: inserts
 * DEFAULT_TAXONOMY only if no row exists; an operator's edits survive redeploys.
 * Best-effort; the storefront falls back to DEFAULT_TAXONOMY if the table is empty.
 */
export async function runTaxonomySeedAtBoot(): Promise<void> {
  try {
    const { inserted } = await Registry.getInstance().taxonomyRepo.seedMissing(DEFAULT_TAXONOMY);
    if (inserted > 0) logger.info({ inserted }, 'TAXONOMY_SEEDED');
  } catch (error) {
    logger.warn({ err: error instanceof Error ? error.message : String(error) }, 'TAXONOMY_SEED_FAILED');
  }
}
