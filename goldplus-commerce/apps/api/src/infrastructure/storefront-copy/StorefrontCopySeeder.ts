import { Registry } from '../Registry';
import { DEFAULT_STOREFRONT_COPY } from '@goldplus/shared';
import { logger } from '../logging/logger';

/**
 * Ensure storefront copy exists (0115). Idempotent, add-only: inserts
 * DEFAULT_STOREFRONT_COPY only if no row exists; edits survive redeploys.
 * Best-effort; the storefront falls back to DEFAULT if the table is empty.
 */
export async function runStorefrontCopySeedAtBoot(): Promise<void> {
  try {
    const { inserted } = await Registry.getInstance().storefrontCopyRepo.seedMissing(DEFAULT_STOREFRONT_COPY);
    if (inserted > 0) logger.info({ inserted }, 'STOREFRONT_COPY_SEEDED');
  } catch (error) {
    logger.warn({ err: error instanceof Error ? error.message : String(error) }, 'STOREFRONT_COPY_SEED_FAILED');
  }
}
