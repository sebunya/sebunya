import { Registry } from '../Registry';

/**
 * Loyalty daily machinery (brief PARTs H/O): FIFO expiry entries, reservation
 * TTL releases, expiry warnings (once per earn+kind), reconciliation and the
 * daily liability snapshot. Runs every 6 hours — every action inside the sweep
 * is idempotent (expiry per-earn unique, notices unique, snapshot upsert-by-
 * date), so the cadence only bounds staleness, never correctness.
 */
const SWEEP_INTERVAL_MS = 6 * 3600 * 1000;
const START_DELAY_MS = 90 * 1000;

let timer: NodeJS.Timeout | null = null;
let running = false;

async function runOnce(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const result = await Registry.getInstance().runLoyaltyDailySweepUseCase.execute(new Date());
    // eslint-disable-next-line no-console
    console.log('[loyalty-sweep]', JSON.stringify(result));
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[loyalty-sweep] failed', (error as Error).message);
  } finally {
    running = false;
  }
}

export function startLoyaltyDailyTicker(): void {
  if (timer) return;
  setTimeout(() => void runOnce(), START_DELAY_MS).unref?.();
  timer = setInterval(() => void runOnce(), SWEEP_INTERVAL_MS);
  timer.unref?.();
}

export function stopLoyaltyDailyTicker(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
