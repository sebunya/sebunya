import { Registry } from '../Registry';
import { DEFAULT_BUSINESS_INFO } from '@goldplus/shared';
import { logger } from '../logging/logger';

/**
 * Ensure business/contact info exists (0112). Idempotent, add-only: inserts
 * DEFAULT_BUSINESS_INFO only if no row exists, on conflict does nothing — an
 * operator's edits survive redeploys. Best-effort; the footer falls back to
 * DEFAULT_BUSINESS_INFO if the table is empty.
 */
export async function runBusinessInfoSeedAtBoot(): Promise<void> {
  try {
    const { inserted } = await Registry.getInstance().businessInfoRepo.seedMissing(DEFAULT_BUSINESS_INFO);
    if (inserted > 0) logger.info({ inserted }, 'BUSINESS_INFO_SEEDED');
  } catch (error) {
    logger.warn({ err: error instanceof Error ? error.message : String(error) }, 'BUSINESS_INFO_SEED_FAILED');
  }
}
