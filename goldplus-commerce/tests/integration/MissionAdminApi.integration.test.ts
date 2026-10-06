import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { Fixtures } from './helpers/fixtures';

/**
 * Mission admin on REAL PostgreSQL through the real Hono app: the route the
 * gamification page calls to activate, archive and retune a mission. Only
 * authentication is stubbed (the Bearer token names the actor).
 */
const URL = process.env.COMMERCE_TEST_DATABASE_URL;
const suite = URL && process.env.DATABASE_URL ? describe : describe.skip;

vi.mock('../../apps/api/src/interfaces/http/middleware/auth', async () => {
  const { PERMISSIONS } = await import('../../packages/shared/src/permissions');
  return {
    authMiddleware: async (c: any, next: any) => {
      const id = (c.req.header('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
      if (!id) return c.json({ success: false, error: { code: 'UNAUTHENTICATED' } }, 401);
      c.set('user', { id, email: `${id}@itest`, permissions: Object.values(PERMISSIONS) });
      await next();
    },
  };
});

suite('mission admin API (real PostgreSQL, real app)', () => {
  let app: any; let raw: any; let admin: string;
  const tag = Date.now().toString(36);
  const keys = { live: `itest_live_${tag}`, dead: `itest_dead_${tag}` };
  const ids: Record<string, string> = {};
  const J = { 'Content-Type': 'application/json' };
  const patch = (id: string, body: unknown) =>
    app.request(`/admin/loyalty/gamification/missions/${id}`, { method: 'PATCH', headers: { ...J, Authorization: `Bearer ${admin}` }, body: JSON.stringify(body) });

  beforeAll(async () => {
    raw = createRequire(import.meta.url)('postgres')(URL as string, { max: 2, onnotice: () => undefined });
    app = (await import('../../apps/api/src/interfaces/http/app')).default;
    admin = await new Fixtures(raw).user();
    ids.live = (await raw`insert into gamification_missions (key, title, description, kind, threshold, reward_points, status)
      values (${keys.live}, 'Itest Friends', 'Introduce three friends.', 'REFERRAL_COUNT', 3, 300, 'DRAFT') returning id`)[0].id;
    // A legacy row of a kind with no data source: it may exist, never go live.
    ids.dead = (await raw`insert into gamification_missions (key, title, kind, threshold, reward_points, status)
      values (${keys.dead}, 'Itest Reviews', 'REVIEW_COUNT', 2, 50, 'DRAFT') returning id`)[0].id;
  }, 60_000);

  afterAll(async () => {
    await raw`delete from gamification_missions where key in (${keys.live}, ${keys.dead})`;
    await raw.end();
  });

  it('activates and retunes a mission, and the change is audited with before and after', async () => {
    const res = await patch(ids.live, { status: 'ACTIVE', threshold: 5, rewardPoints: 500, description: 'Introduce five friends.' });
    expect(res.status).toBe(200);
    const [row] = await raw`select status, threshold, reward_points, description from gamification_missions where id = ${ids.live}::uuid`;
    expect(row).toEqual({ status: 'ACTIVE', threshold: 5, reward_points: 500, description: 'Introduce five friends.' });
    const [audit] = await raw`select action, previous_state, new_state from audit_logs
      where entity = 'gamification_mission' and entity_id = ${ids.live}::uuid order by created_at desc limit 1`;
    expect(audit.action).toBe('GAMIFICATION_MISSION_UPDATED');
    // The audit repository stores each state as serialised JSON.
    const state = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : v);
    expect(state(audit.previous_state)).toMatchObject({ status: 'DRAFT', threshold: 3, rewardPoints: 300 });
    expect(state(audit.new_state)).toMatchObject({ status: 'ACTIVE', threshold: 5, rewardPoints: 500 });
  });

  it('archives a mission, so it stops being offered or evaluated', async () => {
    expect((await patch(ids.live, { status: 'ARCHIVED' })).status).toBe(200);
    const { Registry } = await import('../../apps/api/src/infrastructure/Registry');
    const active = await Registry.getInstance().gamificationRepo.listActiveMissions();
    expect(active.map((m) => m.key)).not.toContain(keys.live);
  });

  it('refuses to activate a kind nobody could ever complete', async () => {
    const res = await patch(ids.dead, { status: 'ACTIVE' });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('NOT_EVALUABLE');
    expect((await raw`select status from gamification_missions where id = ${ids.dead}::uuid`)[0].status).toBe('DRAFT');
  });

  it('refuses nonsense: unknown status, zero threshold, points past the ceiling, an empty change', async () => {
    for (const body of [{ status: 'LIVE' }, { threshold: 0 }, { rewardPoints: 10_001 }, { rewardPoints: 1.5 }, {}]) {
      expect((await patch(ids.live, body)).status, JSON.stringify(body)).toBe(400);
    }
  });

  it('a mission that does not exist is a 404', async () => {
    expect((await patch('00000000-0000-0000-0000-000000000000', { status: 'ARCHIVED' })).status).toBe(404);
  });

  it('creating a mission refuses kinds with no data source and keeps its points', async () => {
    const create = (body: unknown) => app.request('/admin/loyalty/gamification/missions', { method: 'POST', headers: { ...J, Authorization: `Bearer ${admin}` }, body: JSON.stringify(body) });
    expect((await create({ key: `itest_rev_${tag}`, title: 'x', kind: 'REVIEW_COUNT', threshold: 1, rewardPoints: 10 })).status).toBe(400);
    const res = await create({ key: `itest_new_${tag}`, title: 'Itest new', kind: 'PURCHASE_COUNT', threshold: 2, rewardPoints: 120, description: 'Two deliveries.' });
    expect(res.status).toBe(200);
    const [row] = await raw`select reward_points, status, description from gamification_missions where key = ${`itest_new_${tag}`}`;
    expect(row).toEqual({ reward_points: 120, status: 'DRAFT', description: 'Two deliveries.' });
    await raw`delete from gamification_missions where key = ${`itest_new_${tag}`}`;
  });
});
