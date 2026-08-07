import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_NAV_CONFIG } from '@goldplus/shared';

/**
 * Nav content (0109) against REAL PostgreSQL. The one regression this suite
 * exists to prevent: jsonb double-encoding. postgres-js serialises a bound
 * object exactly once, so the repository binds the RAW object and casts ::jsonb;
 * a JSON.stringify first would store a STRING and every reader would then have
 * to JSON.parse. We assert jsonb_typeof(config) = 'object' — the ground truth.
 */

const URL = process.env.COMMERCE_TEST_DATABASE_URL;
const suite = URL && process.env.DATABASE_URL ? describe : describe.skip;

suite('nav content on real PostgreSQL', () => {
  let pg: typeof import('../../apps/api/src/infrastructure/db/client').client;
  let repo: import('../../apps/api/src/infrastructure/db/repositories/DrizzleNavRepository').DrizzleNavRepository;
  let service: import('../../apps/api/src/application/nav/NavContentService').NavContentService;
  const actor = '00000000-0000-0000-0000-0000000000aa';

  beforeAll(async () => {
    ({ client: pg } = await import('../../apps/api/src/infrastructure/db/client'));
    const { DrizzleNavRepository } = await import('../../apps/api/src/infrastructure/db/repositories/DrizzleNavRepository');
    const { NavContentService } = await import('../../apps/api/src/application/nav/NavContentService');
    repo = new DrizzleNavRepository();
    service = new NavContentService(repo);
    const { applyRecommendationMigrations } = await import('./helpers/applyRecommendationMigrations');
    await applyRecommendationMigrations(pg);
    await pg`delete from nav_config`;
  });

  afterAll(async () => {
    await pg`delete from nav_config`;
  });

  it('seeds once, and is a no-op the second time', async () => {
    const first = await repo.seedMissing(DEFAULT_NAV_CONFIG);
    expect(first.inserted).toBe(1);
    const second = await repo.seedMissing(DEFAULT_NAV_CONFIG);
    expect(second.inserted).toBe(0);
  });

  it('stores config as a jsonb OBJECT, not a double-encoded string', async () => {
    const [row] = await pg`select jsonb_typeof(config) as t from nav_config where id = true`;
    expect(row.t).toBe('object');
  });

  it('round-trips the config as a real object through the repository', async () => {
    const stored = await repo.getConfig();
    expect(stored).not.toBeNull();
    expect(Array.isArray(stored!.config.rail)).toBe(true);
    expect(stored!.config.rail[0].key).toBe(DEFAULT_NAV_CONFIG.rail[0].key);
  });

  it('updateConfig bumps the version and stays a jsonb object', async () => {
    const before = await repo.getConfig();
    const edited = structuredClone(before!.config);
    edited.rail[0].label = 'Shop Everything';
    const res = await service.updateConfig(edited, actor);
    expect(res.ok).toBe(true);

    const [row] = await pg`select jsonb_typeof(config) as t, version from nav_config where id = true`;
    expect(row.t).toBe('object');
    expect(Number(row.version)).toBe(before!.version + 1);

    const after = await repo.getConfig();
    expect(after!.config.rail[0].label).toBe('Shop Everything');
  });

  it('updateConfig refuses a config that would break the header', async () => {
    const before = await repo.getConfig();
    const broken = structuredClone(before!.config);
    broken.rail = [];
    const res = await service.updateConfig(broken, actor);
    expect(res.ok).toBe(false);
    // and the stored config is unchanged (still has categories)
    const after = await repo.getConfig();
    expect(after!.config.rail.length).toBeGreaterThan(0);
  });
});
