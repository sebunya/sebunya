import { Registry } from '../Registry';
import { DEFAULT_NAV_CONFIG } from '@goldplus/shared';
import { logger } from '../logging/logger';

/**
 * Ensure the header/nav config exists (0109). Idempotent, add-only, safe on every
 * boot: it inserts DEFAULT_NAV_CONFIG only if no row exists, and on conflict does
 * NOTHING — a marketer's edits are never overwritten by a redeploy. Best-effort:
 * a seeding hiccup must not stop the API booting, because the storefront falls
 * back to DEFAULT_NAV_CONFIG if the table is empty.
 */
export async function runNavSeedAtBoot(): Promise<void> {
  try {
    const { inserted } = await Registry.getInstance().navRepo.seedMissing(DEFAULT_NAV_CONFIG);
    if (inserted > 0) logger.info({ inserted }, 'NAV_CONFIG_SEEDED');
  } catch (error) {
    logger.warn({ err: error instanceof Error ? error.message : String(error) }, 'NAV_CONFIG_SEED_FAILED');
  }
}
