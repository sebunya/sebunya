import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/** Which promotions have active batch codes (so apply only with one): real PostgreSQL. */
const URL = process.env.COMMERCE_TEST_DATABASE_URL;
const suite = URL ? describe : describe.skip;

suite('promotions with active batch codes (real PostgreSQL)', () => {
  let raw: any; let repo: any;
  const tag = `cpn-${Date.now()}`;
  const defs: string[] = [];

  beforeAll(async () => {
    process.env.DATABASE_URL = URL!;
    const { createRequire } = await import('node:module');
    raw = createRequire(import.meta.url)('../../apps/api/node_modules/postgres')(URL!, { max: 2, prepare: false });
    for (const n of ['active', 'inactive', 'none']) {
      const [d] = await raw`insert into promotion_definitions (key, name, description, status) values (${`${tag}-${n}`}, ${n}, 'x', 'ACTIVE') returning id`;
      defs.push(d.id);
    }
    const code = (n: number) => `${tag.slice(-6).toUpperCase()}${n}`;
    await raw`insert into coupon_codes (promotion_definition_id, code, code_normalised, is_active) values (${defs[0]}, ${code(1)}, ${code(1)}, true), (${defs[0]}, ${code(2)}, ${code(2)}, false), (${defs[1]}, ${code(3)}, ${code(3)}, false)`;
    const { DrizzleCouponRepository } = await import('../../apps/api/src/infrastructure/db/repositories/DrizzleCouponRepository');
    repo = new DrizzleCouponRepository();
  });

  afterAll(async () => {
    if (!raw) return;
    await raw`delete from coupon_codes where promotion_definition_id = any(${defs})`;
    await raw`delete from promotion_definitions where id = any(${defs})`;
    await raw.end({ timeout: 5 });
  });

  it('only a promotion with at least one ACTIVE code is code-only', async () => {
    const out = await repo.definitionsWithActiveCodes(defs);
    expect([...out]).toEqual([defs[0]]);
    expect((await repo.definitionsWithActiveCodes([])).size).toBe(0);
  });
});
