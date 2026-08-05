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
    const registry = Registry.getInstance();
    const result = await registry.runLoyaltyDailySweepUseCase.execute(new Date());
    // 0087: birthday awards (idempotent per user+year) and tier evaluation
    // ride the same sweep — each isolated so one failure never stops the rest.
    const birthdays = await registry.awardBirthdayPointsUseCase.execute(new Date()).catch(() => ({ awarded: -1 }));
    const tiers = await registry.evaluateTiersUseCase.execute().catch(() => ({ evaluated: -1, changed: -1 }));
    // 0088: unplayed scratch cards expire on their own clock.
    const drawTokensExpired = await registry.loyaltyDrawRepo.expireTokensDueBefore(new Date()).catch(() => -1);
    // eslint-disable-next-line no-console
    console.log('[loyalty-sweep]', JSON.stringify({ ...result, birthdays, tiers, drawTokensExpired }));
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
