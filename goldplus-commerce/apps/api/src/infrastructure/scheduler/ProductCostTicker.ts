import { Registry } from '../Registry';
import { logger } from '../logging/logger';

/**
 * Makes future-dated supplier costs current on their day (Kampala).
 *
 * The refresh is idempotent and touches only products whose current cost is
 * wrong, so an hourly cadence costs one UPDATE that usually changes nothing,
 * and a cost dated for a given day is current within the first hour of it.
 */
const INTERVAL_MS = 3600 * 1000;
const START_DELAY_MS = 60 * 1000;

let timer: NodeJS.Timeout | null = null;
let running = false;

async function runOnce(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const changed = await Registry.getInstance().refreshCurrentProductCostsUseCase.execute();
    if (changed > 0) logger.info({ changed }, 'PRODUCT_COSTS_BECAME_CURRENT');
  } catch (error) {
    logger.error({ err: (error as Error).message }, 'PRODUCT_COST_REFRESH_FAILED');
  } finally {
    running = false;
  }
}

export function startProductCostTicker(): void {
  if (timer) return;
  setTimeout(() => void runOnce(), START_DELAY_MS).unref?.();
  timer = setInterval(() => void runOnce(), INTERVAL_MS);
  timer.unref?.();
}

export function stopProductCostTicker(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
