import { Registry } from '../Registry';
import { logger } from '../logging/logger';

/**
 * The one review reminder, a few days after an order is delivered or
 * collected (SendReviewRemindersUseCase). Every send is idempotent per order,
 * so the cadence only bounds how late in the day a reminder goes, never how
 * many go.
 */
const INTERVAL_MS = 6 * 3600 * 1000;
const START_DELAY_MS = 120 * 1000;

let timer: NodeJS.Timeout | null = null;
let running = false;

async function runOnce(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const result = await Registry.getInstance().sendReviewRemindersUseCase.execute(new Date());
    if (result.due > 0) logger.info(result, 'REVIEW_REMINDERS_ENQUEUED');
  } catch (error) {
    logger.error({ err: (error as Error).message }, 'REVIEW_REMINDERS_FAILED');
  } finally {
    running = false;
  }
}

export function startReviewReminderTicker(): void {
  if (timer) return;
  setTimeout(() => void runOnce(), START_DELAY_MS).unref?.();
  timer = setInterval(() => void runOnce(), INTERVAL_MS);
  timer.unref?.();
}

export function stopReviewReminderTicker(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
