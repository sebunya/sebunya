import { Registry } from '../Registry';
import { logger } from '../logging/logger';

/**
 * The one payment reminder for an online order placed and never paid (SendUnpaidOrderRemindersUseCase). Every
 * send is idempotent per order, so the cadence bounds only how late after the hour a reminder goes.
 */
const INTERVAL_MS = 15 * 60 * 1000;
const START_DELAY_MS = 150 * 1000;

let timer: NodeJS.Timeout | null = null;
let running = false;

async function runOnce(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const result = await Registry.getInstance().sendUnpaidOrderRemindersUseCase.execute(new Date());
    if (result.due > 0) logger.info(result, 'PAYMENT_REMINDERS_ENQUEUED');
  } catch (error) {
    logger.error({ err: (error as Error).message }, 'PAYMENT_REMINDERS_FAILED');
  } finally {
    running = false;
  }
}

export function startUnpaidOrderReminderTicker(): void {
  if (timer) return;
  setTimeout(() => void runOnce(), START_DELAY_MS).unref?.();
  timer = setInterval(() => void runOnce(), INTERVAL_MS);
  timer.unref?.();
}

export function stopUnpaidOrderReminderTicker(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
