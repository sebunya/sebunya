import { Registry } from '../Registry';
import { logger } from '../logging/logger';
import { runDailyAdvertisingJobs } from '../../application/use-cases/advertising/AdvertisingDailyJobs';

/**
 * Advertising operations on a timer (0154).
 *  - every 5 minutes: queue offline conversions (COD deliveries, admin sales)
 *    and send the due ones; confirm audience uploads Google accepted
 *    asynchronously (AudienceSyncUseCases.confirmPending);
 *  - once a day after 03:00 Kampala: audience sync for every LIVE audience
 *    capability, then spend import (the last 7 days) for every LIVE spend
 *    capability. Each platform's job is claimed on its own in ad_job_claims
 *    with a lease (AdvertisingDailyJobs): a restart, a second instance or an
 *    overlapping tick never runs it twice at once, a success is never
 *    repeated, and a failure is retried on a later tick the same day (at most
 *    3 attempts).
 * Nothing runs for a capability that is not LIVE: the use cases answer
 * "Not configured" without a network call.
 */
const INTERVAL_MS = 5 * 60_000;
const START_DELAY_MS = 90_000;
const DAILY_HOUR_KAMPALA = 3;

let timer: NodeJS.Timeout | null = null;
let running = false;

/** The Kampala calendar day and hour (UTC+3, no daylight saving). */
export function kampalaClock(now: Date = new Date()): { day: string; hour: number } {
  const k = new Date(now.getTime() + 3 * 3600_000);
  return { day: k.toISOString().slice(0, 10), hour: k.getUTCHours() };
}

export async function runAdvertisingTick(now: Date = new Date()): Promise<void> {
  if (running) return;
  running = true;
  const ops = Registry.getInstance().advertisingOps;
  try {
    const queued = await ops.offline.enqueue();
    const sent = await ops.offline.dispatch(25);
    if (queued || sent.sent || sent.failed || sent.retried) logger.info({ queued, ...sent }, 'AD_OFFLINE_CONVERSIONS_TICK');
  } catch (err) {
    logger.error({ err: (err as Error).message }, 'AD_OFFLINE_CONVERSIONS_TICK_FAILED');
  }
  try {
    const confirmed = await ops.audiences.confirmPending();
    if (confirmed.checked) logger.info(confirmed, 'AD_AUDIENCE_CONFIRMATIONS_TICK');
  } catch (err) {
    logger.error({ err: (err as Error).message }, 'AD_AUDIENCE_CONFIRMATIONS_TICK_FAILED');
  }
  try {
    const { day, hour } = kampalaClock(now);
    if (hour >= DAILY_HOUR_KAMPALA) {
      // Each audience run records its capability's last run itself (AudienceSyncUseCases.run).
      const done = await runDailyAdvertisingJobs(day, {
        jobs: ops.jobs,
        audiences: { live: async (p) => !!(await ops.capabilities.live(p, 'audiences')), run: (p) => ops.audiences.run(p, 'SYNC', 'SCHEDULE', null) },
        spend: {
          live: async (p) => !!(await ops.capabilities.live(p, 'spend')),
          run: async (p) => {
            const r = await ops.spend.importFromApi(p, 'SCHEDULE', null);
            await recordRuns(ops, 'spend', [{ platform: r.platform, status: r.status, message: r.message }]);
            return r;
          },
        },
      });
      if (done.length) logger.info({ day, jobs: done.map((j) => `${j.capability}/${j.platform}:${j.ok ? 'ok' : 'retry'}:${j.summary}`.slice(0, 300)) }, 'AD_DAILY_JOBS');
    }
  } catch (err) {
    logger.error({ err: (err as Error).message }, 'AD_DAILY_JOBS_FAILED');
  } finally {
    running = false;
  }
}

/** The worst outcome per platform becomes the capability's last run status. */
async function recordRuns(ops: ReturnType<typeof Registry.getInstance>['advertisingOps'], capability: 'spend', runs: Array<{ platform: string; status: string; message: string | null }>) {
  const byPlatform = new Map<string, { status: string; message: string | null }>();
  for (const r of runs) {
    const prev = byPlatform.get(r.platform);
    if (!prev || r.status === 'FAILED') byPlatform.set(r.platform, { status: r.status, message: r.message });
  }
  for (const [platform, r] of byPlatform) await ops.capabilities.recordRun(platform, capability, r.status, r.status === 'FAILED' ? r.message : null).catch(() => undefined);
}

export function startAdvertisingTicker(): void {
  if (timer || process.env.DISABLE_ADVERTISING_TICKER === '1') return;
  setTimeout(() => void runAdvertisingTick(), START_DELAY_MS).unref?.();
  timer = setInterval(() => void runAdvertisingTick(), INTERVAL_MS);
  timer.unref?.();
}

export function stopAdvertisingTicker(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
