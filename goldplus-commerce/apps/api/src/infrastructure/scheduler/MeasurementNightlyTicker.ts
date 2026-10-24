import { Registry } from '../Registry';
import { tryAcquireSessionLock } from '../db/sessionLock';
import { logger } from '../logging/logger';
import { db } from '../db/client';
import { sql } from 'drizzle-orm';
import { Ga4Reconciliation, HttpGa4Reader, careDeskAlarm } from '../measurement/Ga4Reconciliation';

/**
 * Measurement nightly (0203, 2026-10-23), after the attribution batch and the first-party run (03:30–05:59
 * Kampala), once a day, one replica at a time:
 *  0. control feeds (market dollar rate, the Bank of Uganda rate, Kampala rain) into measurement.control_series, then GA4's daily series
 *     (sessions, users, purchases by channel, source, landing page, device) into measurement.ga4_daily_series;
 *  1. derived marketing costs (SMS, WhatsApp, loyalty, referrals, creators) into media_cost_facts;
 *  2. the MMM daily dataset and its control series;
 *  3. holdout outcomes (treated versus held, 14 and 28 days);
 *  4. GA4 purchases against what we sent, with an alarm when they disagree.
 * Each step is its own try/catch: one failure never hides the others. The run is recorded in measurement.batch_run
 * (job 'measurement_nightly') so the admin page can say when it last ran and what it found.
 */
const CHECK_INTERVAL_MS = 30 * 60 * 1000;
const START_DELAY_MS = 5 * 60 * 1000;
const LOCK_ID = 0x4d4d4e31; // 'MMN1'
const JOB = 'measurement_nightly';
let timer: NodeJS.Timeout | null = null;
let running = false;
const rows = (r: unknown): any[] => (Array.isArray(r) ? r : ((r as { rows?: any[] })?.rows ?? []));

export function inWindow(now: Date): boolean {
  const kampala = (now.getUTCHours() + 3) % 24;
  const minutes = now.getUTCMinutes();
  return (kampala === 3 && minutes >= 30) || kampala === 4 || kampala === 5;
}

export async function runMeasurementNightlyOnce(now = new Date(), trigger: 'schedule' | 'admin' = 'schedule'): Promise<{ status: 'RAN' | 'SKIPPED_WINDOW' | 'SKIPPED_RECENT' | 'SKIPPED_LOCKED' | 'SKIPPED_BUSY'; stats?: Record<string, unknown> }> {
  if (running) return { status: 'SKIPPED_BUSY' };
  if (trigger === 'schedule' && !inWindow(now)) return { status: 'SKIPPED_WINDOW' };
  if (trigger === 'schedule') {
    const recent = rows(await db.execute(sql`select 1 from measurement.batch_run where job = ${JOB} and state = 'COMPLETE' and started_at > now() - interval '20 hours' limit 1`));
    if (recent.length) return { status: 'SKIPPED_RECENT' };
  }
  const lock = await tryAcquireSessionLock(LOCK_ID);
  if (!lock) return { status: 'SKIPPED_LOCKED' };
  running = true;
  const registry = Registry.getInstance();
  const stats: Record<string, unknown> = { trigger };
  const runId = rows(await db.execute(sql`insert into measurement.batch_run (run_id, job, state, started_at, stats) values (gen_random_uuid(), ${JOB}, 'RUNNING', now(), '{}'::jsonb) returning run_id`))[0]?.run_id;
  try {
    const step = async (name: string, fn: () => Promise<unknown>) => {
      try { stats[name] = await fn(); } catch (err) { stats[name] = { error: String((err as Error).message ?? err).slice(0, 300) }; logger.error({ err: (err as Error).message, step: name }, '[measurement-nightly] step failed'); }
    };
    await step('feeds', () => registry.controlFeeds.run(now));
    await step('ga4_series', () => registry.ga4DailyPull.run(now));
    await step('youtube_views', () => registry.youtubeViewsPull.run(now));
    await step('costs', () => registry.marketingCostDerivation.derive(35, now));
    await step('mmm', () => registry.mmmDataset.rebuild(now));
    await step('holdouts', () => registry.holdoutStore.computeOutcomes(now));
    const reconciliation = new Ga4Reconciliation(registry.measurementConfig, new HttpGa4Reader(registry.ga4DataApi), careDeskAlarm(registry.careDeskUseCases));
    await step('ga4', () => reconciliation.run(now));
    logger.info(stats, '[measurement-nightly] run');
    return { status: 'RAN', stats };
  } finally {
    running = false;
    if (runId) await db.execute(sql`update measurement.batch_run set state = 'COMPLETE', finished_at = now(), stats = ${JSON.stringify(stats)}::jsonb where run_id = ${runId}::uuid`).catch(() => undefined);
    await lock.release().catch(() => undefined);
  }
}

export async function lastMeasurementNightly(): Promise<{ startedAt: string; finishedAt: string | null; state: string; stats: Record<string, unknown> } | null> {
  const r = rows(await db.execute(sql`select started_at, finished_at, state, stats from measurement.batch_run where job = ${JOB} order by started_at desc limit 1`))[0];
  return r ? { startedAt: new Date(r.started_at).toISOString(), finishedAt: r.finished_at ? new Date(r.finished_at).toISOString() : null, state: String(r.state), stats: r.stats ?? {} } : null;
}

/** 13:00–13:59 Kampala: the owner's chosen time for the day's dollar rates (the market quote and the Bank of Uganda table, which is posted by then). */
export function inBouWindow(now: Date): boolean { return (now.getUTCHours() + 3) % 24 === 13; }
let bouRanOn = '';
export async function runBouRateOnce(now = new Date()): Promise<{ status: 'RAN' | 'SKIPPED_WINDOW' | 'SKIPPED_DONE'; result?: unknown }> {
  if (!inBouWindow(now)) return { status: 'SKIPPED_WINDOW' };
  const day = new Date(now.getTime() + 3 * 3600_000).toISOString().slice(0, 10);
  if (bouRanOn === day) return { status: 'SKIPPED_DONE' };
  bouRanOn = day;
  const feeds = Registry.getInstance().controlFeeds;
  const result = { market: await feeds.fxSafe(now), bou: await feeds.bouSafe(now) };
  logger.info({ result }, '[measurement-nightly] 1 pm dollar rates');
  return { status: 'RAN', result };
}

export function startMeasurementNightlyTicker(): void {
  if (timer) return;
  const tick = () => {
    void runMeasurementNightlyOnce().catch((err) => logger.error({ err: (err as Error).message }, '[measurement-nightly] run failed'));
    void runBouRateOnce().catch((err) => logger.error({ err: (err as Error).message }, '[measurement-nightly] bou rate failed'));
  };
  setTimeout(tick, START_DELAY_MS).unref?.();
  timer = setInterval(tick, CHECK_INTERVAL_MS);
  timer.unref?.();
}
export function stopMeasurementNightlyTicker(): void { if (timer) clearInterval(timer); timer = null; }
