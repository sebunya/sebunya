import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

/**
 * The public programme terms (/commerce/loyalty-programme) on REAL PostgreSQL
 * through the real app: mission bonuses are advertised from the ACTIVE mission
 * rows that pay them, never from loyalty_config's old streak settings.
 */
const URL = process.env.COMMERCE_TEST_DATABASE_URL;
const suite = URL && process.env.DATABASE_URL ? describe : describe.skip;

suite('public loyalty programme terms (real PostgreSQL, real app)', () => {
  let app: any; let raw: any;
  let restore: (() => Promise<void>) | null = null;
  const envBefore = process.env.LOYALTY_PROGRAMME_ENABLED;

  beforeAll(async () => {
    raw = createRequire(import.meta.url)('postgres')(URL as string, { max: 2, onnotice: () => undefined });
    process.env.LOYALTY_PROGRAMME_ENABLED = 'true';
    const [existing] = await raw`select * from loyalty_config where singleton = 'config'`;
    if (existing) {
      await raw`update loyalty_config set enabled = true, kill_switch = false, referral_referrer_points = 200, referral_referee_points = 100,
        streak_window_days = 90, streak_target_orders = 7, streak_reward_points = 999 where singleton = 'config'`;
      restore = async () => {
        await raw`update loyalty_config set enabled = ${existing.enabled}, kill_switch = ${existing.kill_switch},
          referral_referrer_points = ${existing.referral_referrer_points}, referral_referee_points = ${existing.referral_referee_points},
          streak_window_days = ${existing.streak_window_days}, streak_target_orders = ${existing.streak_target_orders},
          streak_reward_points = ${existing.streak_reward_points} where singleton = 'config'`;
      };
    } else {
      // 7 / 999 in the old streak columns: if the page still read them, the test would see them.
      // Upsert: a parallel suite may create the row at the same moment.
      await raw`insert into loyalty_config (enabled, earn_rate_per_1000_ugx, referral_referrer_points, referral_referee_points,
        streak_window_days, streak_target_orders, streak_reward_points) values (true, 10, 200, 100, 90, 7, 999)
        on conflict (singleton) do update set enabled = true, kill_switch = false, referral_referrer_points = 200, referral_referee_points = 100,
          streak_window_days = 90, streak_target_orders = 7, streak_reward_points = 999`;
      // Restore only this suite's columns (to the defaults of a row that did not
      // exist); the row stays, so a parallel suite's own columns are untouched.
      restore = async () => {
        await raw`update loyalty_config set enabled = false, kill_switch = false, referral_referrer_points = null, referral_referee_points = null,
          streak_window_days = null, streak_target_orders = null, streak_reward_points = null where singleton = 'config'`;
      };
    }
    app = (await import('../../apps/api/src/interfaces/http/app')).default;
  }, 60_000);

  afterAll(async () => {
    if (restore) await restore();
    if (envBefore === undefined) delete process.env.LOYALTY_PROGRAMME_ENABLED;
    else process.env.LOYALTY_PROGRAMME_ENABLED = envBefore;
    await raw.end();
  });

  it('advertises the streak, the referral bonus and Five Deliveries from the missions that pay them', async () => {
    const missions = await raw`select key, threshold, reward_points from gamification_missions where status = 'ACTIVE'`;
    const by = (key: string) => missions.find((m: any) => m.key === key);
    const res = await app.request('/commerce/loyalty-programme');
    expect(res.status).toBe(200);
    const src = (await res.json()).data.earnSources;
    expect(src.streak).toEqual({ orders: by('order_streak_3').threshold, windowDays: 90, points: by('order_streak_3').reward_points });
    expect(src.referral).toEqual({ referrer: 200, referee: 100, bonus: { friends: by('refer_three').threshold, points: by('refer_three').reward_points } });
    expect(src.milestones.map((m: any) => m.title)).toContain('Five Deliveries');
    expect(src.milestones.map((m: any) => m.title)).not.toContain('On A Roll');
    expect(src.milestones.map((m: any) => m.title)).not.toContain('Friends & Family');
    expect(src.milestones.map((m: any) => m.title)).not.toContain('Serial Authenticator');
  });
});
