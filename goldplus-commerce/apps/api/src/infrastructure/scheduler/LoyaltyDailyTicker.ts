import { randomUUID } from 'node:crypto';
import { Registry } from '../Registry';

/** How many closed days each run snapshots (if missing) and re-checks. */
const RECONCILE_DAYS = 7;

async function reconcileControlTotals(now: Date): Promise<{ checked: number; discrepancies: string[] }> {
  const registry = Registry.getInstance();
  const discrepancies: string[] = [];
  let checked = 0;
  for (let back = 1; back <= RECONCILE_DAYS; back++) {
    const businessDate = new Date(now.getTime() - back * 86_400_000).toISOString().slice(0, 10);
    const result = await registry.reconcileLoyaltyControlTotalsUseCase.execute({ businessDate, computedBy: 'loyalty-sweep', traceId: randomUUID() });
    checked += 1;
    if (result.status === 'DISCREPANCY') {
      discrepancies.push(businessDate);
      // eslint-disable-next-line no-console
      console.error('[loyalty-sweep] LOYALTY_CONTROL_TOTALS_DISCREPANCY', JSON.stringify({ businessDate, differences: result.differences }));
      await registry.loyaltyCompletionRepo
        .recordFraudSignal({ signalType: 'LEDGER_CONTROL_TOTALS_DISCREPANCY', severity: 'high', details: { businessDate, differences: result.differences } })
        .catch(() => undefined);
    }
  }
  return { checked, discrepancies };
}

/**
 * Loyalty daily machinery (brief PARTs H/O): FIFO expiry entries, reservation
 * TTL releases, expiry warnings (once per earn+kind), the daily liability
 * snapshot, and ledger reconciliation (DoD #1): each closed day's control
 * totals are frozen once and re-derived on every later run, so a changed past
 * raises LOYALTY_CONTROL_TOTALS_DISCREPANCY. Runs every 6 hours — every action inside the sweep
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
    // DoD #1: a closed day's ledger position must never change.
    const reconciliation = await reconcileControlTotals(new Date()).catch((error) => ({ checked: -1, discrepancies: [], error: (error as Error).message }));
    // eslint-disable-next-line no-console
    console.log('[loyalty-sweep]', JSON.stringify({ ...result, birthdays, tiers, drawTokensExpired, reconciliation }));
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
