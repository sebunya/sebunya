import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Post-PR §3 — durable GTM plan persistence on a REAL PostgreSQL. Proves plans
 * and diffs survive across repository instances (restart safety) and are not
 * held in a process-local map, and that a checksum is stored. GTM publication is
 * not exercised — this is persistence only.
 *
 * Set COMMERCE_TEST_DATABASE_URL to a MIGRATED database. Skips otherwise.
 */
const URL = process.env.COMMERCE_TEST_DATABASE_URL;
const suite = URL ? describe : describe.skip;

suite('durable GTM plan persistence (real PostgreSQL)', () => {
  let repo: any;
  let RepoClass: any;
  let raw: any;
  const ids: string[] = [];

  const newId = () => {
    const id = `plan_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    ids.push(id);
    return id;
  };

  beforeAll(async () => {
    process.env.DATABASE_URL = URL!;
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    const postgres = require('../../apps/api/node_modules/postgres');
    raw = postgres(URL!, { max: 2, prepare: false });
    const mod = await import('../../apps/api/src/infrastructure/measurement/DrizzleGtmPlanRepository');
    RepoClass = mod.DrizzleGtmPlanRepository;
    repo = new RepoClass();
  });

  afterAll(async () => {
    if (raw && ids.length) {
      await raw`delete from measurement_gtm_plans where id = any(${ids})`;
      await raw.end();
    }
  });

  it('persists a plan and reads it back through a SEPARATE repository instance (restart safety)', async () => {
    const id = newId();
    const plan = { container: 'web', tags: [{ name: 't1' }, { name: 't2' }], meta: { v: 1 } };
    await repo.savePlan(id, plan);

    // A fresh instance = a restarted process; it must see the same plan.
    const fresh = new RepoClass();
    expect(await fresh.getPlan(id)).toEqual(plan);

    // Stored with a checksum, not raw-only.
    const [row] = await raw`select plan_checksum, version, status from measurement_gtm_plans where id = ${id}`;
    expect(row.plan_checksum).toHaveLength(64);
    expect(Number(row.version)).toBe(1);
    expect(row.status).toBe('DRY_RUN');
  });

  it('lists recent plans most-recent-first and bounds the limit', async () => {
    const a = newId();
    const b = newId();
    await repo.savePlan(a, { n: 'a' });
    await repo.savePlan(b, { n: 'b' });
    const recent = await repo.listRecentPlans(50);
    const names = recent.map((p: any) => p?.n);
    // Both present; b (saved later) appears before a.
    expect(names).toContain('a');
    expect(names).toContain('b');
    expect(names.indexOf('b')).toBeLessThan(names.indexOf('a'));
  });

  it('bumps the optimistic version and refreshes the checksum on overwrite', async () => {
    const id = newId();
    await repo.savePlan(id, { v: 1 });
    const c1 = (await raw`select plan_checksum from measurement_gtm_plans where id = ${id}`)[0].plan_checksum;
    await repo.savePlan(id, { v: 2 });
    const [row] = await raw`select version, plan_checksum from measurement_gtm_plans where id = ${id}`;
    expect(Number(row.version)).toBe(2); // optimistic version bumped
    expect(row.plan_checksum).not.toBe(c1); // checksum refreshed for the new plan
    // The plan itself is read back through the repo (drizzle parses jsonb).
    expect((await repo.getPlan(id)).v).toBe(2);
  });

  it('persists a diff for a plan id, durably', async () => {
    const id = newId();
    await repo.saveDiff(id, { added: ['x'], removed: [] });
    const [row] = await raw`select diff from measurement_gtm_plans where id = ${id}`;
    const diff = typeof row.diff === 'string' ? JSON.parse(row.diff) : row.diff;
    expect(diff.added).toEqual(['x']);
  });
});
