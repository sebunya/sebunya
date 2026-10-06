import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';

/**
 * 0174 on REAL PostgreSQL: Friends & Family replaces Serial Authenticator, and
 * its progress counts only AWARDED referrals (a friend's first order delivered).
 */

const URL = process.env.COMMERCE_TEST_DATABASE_URL;
const suite = URL && process.env.DATABASE_URL ? describe : describe.skip;

suite('referral mission (0174) on real PostgreSQL', () => {
  let pg: typeof import('../../apps/api/src/infrastructure/db/client').client;
  let repo: import('../../apps/api/src/infrastructure/db/repositories/DrizzleGamificationRepository').DrizzleGamificationRepository;

  const suffix = crypto.randomBytes(5).toString('hex');
  const referrer = crypto.randomUUID();
  const friends = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];

  beforeAll(async () => {
    ({ client: pg } = await import('../../apps/api/src/infrastructure/db/client'));
    const { DrizzleGamificationRepository } = await import('../../apps/api/src/infrastructure/db/repositories/DrizzleGamificationRepository');
    repo = new DrizzleGamificationRepository();
    for (const [i, id] of [referrer, ...friends].entries()) {
      await pg`insert into users (id, email) values (${id}::uuid, ${`rm-${i}-${suffix}@example.test`})`;
    }
    const statuses = ['awarded', 'awarded', 'pending', 'rejected'];
    for (const [i, friend] of friends.entries()) {
      await pg`insert into loyalty_referrals (code, referrer_user_id, referee_user_id, status)
        values (${`RM${suffix}`}, ${referrer}::uuid, ${friend}::uuid, ${statuses[i]})`;
    }
  });

  afterAll(async () => {
    await pg`delete from loyalty_referrals where referrer_user_id = ${referrer}::uuid`;
    await pg`delete from users where id in ${pg([referrer, ...friends])}`;
  });

  it('the active missions are Five Deliveries, Friends & Family and On A Roll', async () => {
    const active = await repo.listActiveMissions();
    const keys = active.map((m) => m.key);
    expect(keys).toEqual(expect.arrayContaining(['five_deliveries', 'refer_three', 'order_streak_3']));
    expect(keys).not.toContain('verify_ten');
    const mission = active.find((m) => m.key === 'refer_three')!;
    expect(mission).toMatchObject({ title: 'Friends & Family', kind: 'REFERRAL_COUNT', threshold: 3, rewardPoints: 300 });
  });

  it('Serial Authenticator is archived, not deleted', async () => {
    const [row] = await pg`select status from gamification_missions where key = 'verify_ten'`;
    expect(row?.status).toBe('ARCHIVED');
  });

  it('progress counts only awarded referrals, not pending or rejected ones', async () => {
    const mission = (await repo.listActiveMissions()).find((m) => m.key === 'refer_three')!;
    expect(await repo.missionProgress(referrer, mission, { streakWindowDays: 90 })).toBe(2);
  });
});
