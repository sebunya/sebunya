import type { AudienceRunRecord, JobClaimPort, SpendImportRecord } from '../../ports/Advertising';
import { AUDIENCE_PLATFORMS, AudienceSyncUseCases } from './AudienceSyncUseCases';
import { SPEND_PLATFORMS } from './AdSpendUseCases';

/**
 * The daily advertising jobs (docs/advertising/README.md, "Schedule"): one
 * audience sync and one spend import per LIVE platform, each claimed on its
 * own (`advertising-daily:<day>:<capability>:<platform>`).
 *
 *  - A job is marked done only when it succeeded. A failed one (a platform or
 *    database error, an unreadable consent answer, a busy lock) is retried on
 *    a later tick the same day, at most DAILY_MAX_ATTEMPTS times, no sooner
 *    than DAILY_RETRY_AFTER_MS after the failure. People who refused
 *    advertising are therefore not left on a platform list for a whole extra
 *    day because of one transient error.
 *  - Each attempt holds a lease: a second instance or an overlapping tick
 *    never runs the same job at the same time.
 * A capability that is not LIVE is not attempted at all.
 */
export const DAILY_MAX_ATTEMPTS = 3;
export const DAILY_RETRY_AFTER_MS = 20 * 60_000;
export const DAILY_LEASE_MS = 45 * 60_000;

export const dailyJobKey = (day: string, capability: 'audiences' | 'spend', platform: string) => `advertising-daily:${day}:${capability}:${platform}`;

export interface DailyJobDeps {
  jobs: Pick<JobClaimPort, 'claimAttempt' | 'settleAttempt'>;
  audiences: { live(platform: string): Promise<boolean>; run(platform: string): Promise<AudienceRunRecord[]> };
  spend: { live(platform: string): Promise<boolean>; run(platform: string): Promise<SpendImportRecord> };
}

export interface DailyJobOutcome {
  capability: 'audiences' | 'spend';
  platform: string;
  ok: boolean;
  summary: string;
}

const spendNeedsRetry = (r: SpendImportRecord) => r.status === 'FAILED';

export async function runDailyAdvertisingJobs(day: string, deps: DailyJobDeps): Promise<DailyJobOutcome[]> {
  const out: DailyJobOutcome[] = [];
  const attempt = async (capability: 'audiences' | 'spend', platform: string, work: () => Promise<{ ok: boolean; summary: string }>) => {
    const key = dailyJobKey(day, capability, platform);
    const token = await deps.jobs.claimAttempt(key, { maxAttempts: DAILY_MAX_ATTEMPTS, leaseMs: DAILY_LEASE_MS });
    if (!token) return;
    let result: { ok: boolean; summary: string };
    try { result = await work(); } catch (err) { result = { ok: false, summary: `error: ${String((err as Error)?.message ?? err).slice(0, 200)}` }; }
    await deps.jobs.settleAttempt(key, token, result.ok, DAILY_RETRY_AFTER_MS);
    out.push({ capability, platform, ...result });
  };
  for (const p of AUDIENCE_PLATFORMS) {
    if (!(await deps.audiences.live(p).catch(() => false))) continue;
    await attempt('audiences', p, async () => {
      const runs = await deps.audiences.run(p);
      return { ok: !AudienceSyncUseCases.runNeedsRetry(runs), summary: runs.map((r) => `${r.segment}:${r.status}`).join(',') };
    });
  }
  for (const p of SPEND_PLATFORMS) {
    if (!(await deps.spend.live(p).catch(() => false))) continue;
    await attempt('spend', p, async () => {
      const r = await deps.spend.run(p);
      return { ok: !spendNeedsRetry(r), summary: r.status };
    });
  }
  return out;
}
