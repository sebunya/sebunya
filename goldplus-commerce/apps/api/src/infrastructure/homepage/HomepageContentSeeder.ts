import { Registry } from '../Registry';
import { DEFAULT_HOMEPAGE_CONTENT } from '@goldplus/shared';
import { logger } from '../logging/logger';

/**
 * Ensure homepage content exists (0114). Idempotent, add-only: inserts
 * DEFAULT_HOMEPAGE_CONTENT only if no row exists; an operator's edits survive
 * redeploys. Best-effort; the homepage falls back to DEFAULT if the table is empty.
 */
export async function runHomepageContentSeedAtBoot(): Promise<void> {
  try {
    const { inserted } = await Registry.getInstance().homepageContentRepo.seedMissing(DEFAULT_HOMEPAGE_CONTENT);
    if (inserted > 0) logger.info({ inserted }, 'HOMEPAGE_CONTENT_SEEDED');
  } catch (error) {
    logger.warn({ err: error instanceof Error ? error.message : String(error) }, 'HOMEPAGE_CONTENT_SEED_FAILED');
  }
}
