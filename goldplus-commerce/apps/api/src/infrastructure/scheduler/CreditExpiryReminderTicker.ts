import { Registry } from '../Registry';
import { logger } from '../logging/logger';

/**
 * The one reminder, a week before, that a gift card / store credit with money left is about to end
 * (CreditExpiryRemindersUseCase). Each card is texted once (idempotency key per card), so the cadence bounds only
 * how late in the day a reminder goes.
 */
const INTERVAL_MS = 60 * 60 * 1000;
const START_DELAY_MS = 210 * 1000;

let timer: NodeJS.Timeout | null = null;
let running = false;

async function runOnce(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const result = await Registry.getInstance().creditExpiryRemindersUseCase.execute(new Date());
    if (result.due > 0) logger.info(result, 'CREDIT_EXPIRY_REMINDERS_ENQUEUED');
  } catch (error) {
    logger.error({ err: (error as Error).message }, 'CREDIT_EXPIRY_REMINDERS_FAILED');
  } finally {
    running = false;
  }
}

export function startCreditExpiryReminderTicker(): void {
  if (timer) return;
  setTimeout(() => void runOnce(), START_DELAY_MS).unref?.();
  timer = setInterval(() => void runOnce(), INTERVAL_MS);
  timer.unref?.();
}

export function stopCreditExpiryReminderTicker(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
