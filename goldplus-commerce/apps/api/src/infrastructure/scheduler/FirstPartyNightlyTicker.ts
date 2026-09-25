import { Registry } from '../Registry';
import { tryAcquireSessionLock } from '../db/sessionLock';
import { logger } from '../logging/logger';

/**
 * First-party nightly job (0155): link historical orders to customers, then
 * materialise every active segment. Checked every 30 minutes; runs once a day
 * in the 02:00–05:59 Kampala window (23:00–02:59 UTC), when no COMPLETE run
 * finished in the last 20 hours. One replica at a time (session advisory
 * lock), so two API containers never materialise at once.
 */
const CHECK_INTERVAL_MS = 30 * 60 * 1000;
const START_DELAY_MS = 3 * 60 * 1000;
const LOCK_ID = 0x46505344; // 'FPSD'

let timer: NodeJS.Timeout | null = null;
let running = false;

export function inNightlyWindow(now: Date): boolean {
  const kampalaHour = (now.getUTCHours() + 3) % 24;
  return kampalaHour >= 2 && kampalaHour < 6;
}

export async function runFirstPartyNightlyOnce(now = new Date(), trigger = 'schedule'): Promise<'RAN' | 'SKIPPED_WINDOW' | 'SKIPPED_RECENT' | 'SKIPPED_LOCKED' | 'SKIPPED_BUSY'> {
  if (running) return 'SKIPPED_BUSY';
  if (trigger === 'schedule' && !inNightlyWindow(now)) return 'SKIPPED_WINDOW';
  const registry = Registry.getInstance();
  if (trigger === 'schedule') {
    const last = await registry.segmentRepo.lastCompletedRunAt();
    if (last && now.getTime() - last.getTime() < 20 * 3600 * 1000) return 'SKIPPED_RECENT';
  }
  const lock = await tryAcquireSessionLock(LOCK_ID);
  if (!lock) return 'SKIPPED_LOCKED';
  running = true;
  try {
    // IDENTITY_STITCHING=off is the identity rollback switch: segments still
    // materialise, but no order is newly linked to a customer.
    const stitchingOff = (process.env.IDENTITY_STITCHING ?? '').trim().toLowerCase() === 'off';
    const result = await registry.materialiseSegmentsUseCase.execute({ trigger, now, ...(stitchingOff ? { backfillLimit: 0 } : {}) });
    logger.info({ runId: result.runId, status: result.status, ordersStitched: result.ordersStitched, customers: result.customersEvaluated, segments: result.segments.length }, '[first-party] nightly run');
    return 'RAN';
  } finally {
    running = false;
    await lock.release().catch(() => undefined);
  }
}

export function startFirstPartyNightlyTicker(): void {
  if (timer) return;
  const tick = () => void runFirstPartyNightlyOnce().catch((err) => logger.error({ err: (err as Error).message }, '[first-party] nightly run failed'));
  setTimeout(tick, START_DELAY_MS).unref?.();
  timer = setInterval(tick, CHECK_INTERVAL_MS);
  timer.unref?.();
}

export function stopFirstPartyNightlyTicker(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
