import { Registry } from '../Registry';
import { logger } from '../logging/logger';

/**
 * The daily stock alert (LowStockAlertUseCase). Hourly: the use case itself keeps to Kampala working hours and to
 * one task a day, reading the Care Desk, so a second replica or a restart opens nothing twice.
 */
const INTERVAL_MS = 3600 * 1000;
const START_DELAY_MS = 180 * 1000;

let timer: NodeJS.Timeout | null = null;
let running = false;

async function runOnce(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const result = await Registry.getInstance().lowStockAlertUseCase.execute(new Date());
    if (result.status === 'OPENED') logger.info(result, 'LOW_STOCK_ALERT_OPENED');
  } catch (error) {
    logger.error({ err: (error as Error).message }, 'LOW_STOCK_ALERT_FAILED');
  } finally {
    running = false;
  }
}

export function startLowStockAlertTicker(): void {
  if (timer) return;
  setTimeout(() => void runOnce(), START_DELAY_MS).unref?.();
  timer = setInterval(() => void runOnce(), INTERVAL_MS);
  timer.unref?.();
}

export function stopLowStockAlertTicker(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
