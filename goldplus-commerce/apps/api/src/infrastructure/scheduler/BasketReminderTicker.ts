import { Registry } from '../Registry';
import { logger } from '../logging/logger';

/**
 * 0210: the one text about a basket left behind (SendBasketRemindersUseCase). Every send is idempotent per basket
 * and the use case records each outcome, so the cadence bounds only how late after the hour a reminder goes.
 */
const INTERVAL_MS = 20 * 60 * 1000;
const START_DELAY_MS = 200 * 1000;

let timer: NodeJS.Timeout | null = null;
let running = false;

async function runOnce(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const result = await Registry.getInstance().sendBasketRemindersUseCase.execute(new Date());
    if (result.due > 0) logger.info(result, 'BASKET_REMINDERS_RUN');
  } catch (error) {
    logger.error({ err: (error as Error).message }, 'BASKET_REMINDERS_FAILED');
  } finally {
    running = false;
  }
}

export function startBasketReminderTicker(): void {
  if (timer) return;
  setTimeout(() => void runOnce(), START_DELAY_MS).unref?.();
  timer = setInterval(() => void runOnce(), INTERVAL_MS);
  timer.unref?.();
}

export function stopBasketReminderTicker(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
