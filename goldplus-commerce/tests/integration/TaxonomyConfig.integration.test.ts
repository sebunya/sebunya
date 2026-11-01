import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_TAXONOMY } from '@goldplus/shared';

/**
 * Taxonomy config (0113) against REAL PostgreSQL. The one regression this suite
 * exists to prevent: jsonb double-encoding of the ARRAY document. A bare
 * ::jsonb cast made postgres-js JSON-encode the stringified array AGAIN,
 * storing a quoted string scalar — the tolerant reader masked it, so only
 * jsonb_typeof(config) = 'array' is ground truth.
 */

const URL = process.env.COMMERCE_TEST_DATABASE_URL;
const suite = URL && process.env.DATABASE_URL ? describe : describe.skip;

suite('taxonomy config on real PostgreSQL', () => {
  let pg: typeof import('../../apps/api/src/infrastructure/db/client').client;
  let repo: import('../../apps/api/src/infrastructure/db/repositories/DrizzleTaxonomyRepository').DrizzleTaxonomyRepository;
  const actor = '00000000-0000-0000-0000-0000000000bb';

  beforeAll(async () => {
    ({ client: pg } = await import('../../apps/api/src/infrastructure/db/client'));
    const { DrizzleTaxonomyRepository } = await import('../../apps/api/src/infrastructure/db/repositories/DrizzleTaxonomyRepository');
    repo = new DrizzleTaxonomyRepository();
    await pg.unsafe(`CREATE TABLE IF NOT EXISTS taxonomy_config (
      id boolean PRIMARY KEY DEFAULT true,
      config jsonb NOT NULL DEFAULT '[]'::jsonb,
      version integer NOT NULL DEFAULT 1,
      updated_by uuid,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT taxonomy_config_singleton CHECK (id = true)
    )`);
    await pg`delete from taxonomy_config`;
  });

  afterAll(async () => {
    await pg`delete from taxonomy_config`;
  });

  it('seedMissing stores a REAL jsonb array, never a quoted string scalar', async () => {
    const { inserted } = await repo.seedMissing(DEFAULT_TAXONOMY);
    expect(inserted).toBe(1);
    const [row] = await pg`select jsonb_typeof(config) as t, jsonb_array_length(config) as n from taxonomy_config where id = true`;
    expect(row.t).toBe('array');
    expect(Number(row.n)).toBe(DEFAULT_TAXONOMY.length);
  });

  it('updateConfig keeps the array shape and bumps the version', async () => {
    const edited = structuredClone(DEFAULT_TAXONOMY);
    edited[0].homepageBlurb = 'Banks and chargers';
    const stored = await repo.updateConfig(edited, actor);
    expect(stored.version).toBe(2);
    const [row] = await pg`select jsonb_typeof(config) as t from taxonomy_config where id = true`;
    expect(row.t).toBe('array');
    // SQL can address the elements directly — the shape a jsonb consumer relies on.
    const [first] = await pg`select config->0->>'slug' as slug from taxonomy_config where id = true`;
    expect(first.slug).toBe('power-devices');
  });

  it('getConfig round-trips the document', async () => {
    const stored = await repo.getConfig();
    expect(stored).not.toBeNull();
    expect(stored!.config.map((c) => c.slug)).toEqual(DEFAULT_TAXONOMY.map((c) => c.slug));
    expect(stored!.config[0].homepageBlurb).toBe('Banks and chargers');
  });
});
