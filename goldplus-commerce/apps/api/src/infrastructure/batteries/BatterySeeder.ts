import { Registry } from '../Registry';
import { logger } from '../logging/logger';

/**
 * Battery module defaults (0125). Idempotent, add-only: the default stock
 * location and the finder copy document are inserted only when absent; an
 * operator's edits survive redeploys. No battery, device or claim is ever
 * seeded; those arrive through the importer as drafts and review items.
 */
export async function runBatterySeedAtBoot(): Promise<void> {
  try {
    const registry = Registry.getInstance();
    const location = await registry.inventoryLedgerUseCases.seedDefaultLocation();
    if (location.inserted) logger.info('BATTERY_STOCK_LOCATION_SEEDED');
    const config = await registry.batteryFinderUseCases.seedConfig();
    if (config.inserted) logger.info('BATTERY_FINDER_CONFIG_SEEDED');
  } catch (error) {
    logger.warn({ err: error instanceof Error ? error.message : String(error) }, 'BATTERY_SEED_FAILED');
  }
}
