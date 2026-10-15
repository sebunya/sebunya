import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Pricing never looked at a promotion's usage limit; only the reservation at checkout did, and it threw a message
 * nothing classified, so the customer read "please try again" for ever, shop-wide once a global limit ran out.
 * Pricing now asks which versions are used up (the same counts the reservation refuses on) and leaves them out.
 * Real PostgreSQL.
 */
const URL = process.env.COMMERCE_TEST_DATABASE_URL;
const suite = URL ? describe : describe.skip;

suite('promotions whose usage limit is used up (real PostgreSQL)', () => {
  let raw: any; let repo: any;
  const tag = `lim-${Date.now()}`;
  const defs: string[] = []; const versions: Record<string, string> = {}; const quotes: string[] = [];
  const hour = 3_600_000;
  const now = new Date();

  async function version(name: string, limits: { global?: number | null; perCoupon?: number | null; coupon?: string | null }) {
    const [d] = await raw`insert into promotion_definitions (key, name, description, status) values (${`${tag}-${name}`}, ${name}, 'limit test', 'ACTIVE') returning id`;
    defs.push(d.id);
    const [v] = await raw`insert into promotion_versions (definition_id, version_number, status, conditions, benefits, exclusions, starts_at, ends_at, created_by, global_limit, per_coupon_limit, coupon_code)
      values (${d.id}, 1, 'ACTIVE', '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, ${new Date(now.getTime() - 24 * hour)}, ${new Date(now.getTime() + 24 * hour)}, '00000000-0000-4000-8000-000000000000',
              ${limits.global ?? null}, ${limits.perCoupon ?? null}, ${limits.coupon ?? null}) returning id`;
    versions[name] = v.id;
    return v.id as string;
  }
  async function reservation(versionId: string, status: string, opts: { expired?: boolean; coupon?: string | null } = {}) {
    const [q] = await raw`insert into pricing_quotes (base_subtotal_ugx, final_total_ugx, calculation_version, experiment_evidence, decision_trace, evaluated_at, expires_at)
      values (1000, 900, 'pricing-v1', '[]'::jsonb, '[]'::jsonb, ${now}, ${new Date(now.getTime() + hour)}) returning id`;
    quotes.push(q.id);
    const reservedAt = opts.expired ? new Date(now.getTime() - 2 * hour) : now;
    const expiresAt = opts.expired ? new Date(now.getTime() - hour) : new Date(now.getTime() + hour);
    await raw`insert into promotion_reservations (quote_id, promotion_version_id, idempotency_key, status, reserved_at, expires_at, coupon_reference_hash)
      values (${q.id}, ${versionId}, ${`${tag}-${Math.random()}`}, ${status}, ${reservedAt}, ${expiresAt}, ${opts.coupon ?? null})`;
  }

  beforeAll(async () => {
    process.env.DATABASE_URL = URL!;
    const { createRequire } = await import('node:module');
    raw = createRequire(import.meta.url)('../../apps/api/node_modules/postgres')(URL!, { max: 2, prepare: false });
    const { DrizzlePricingCapacityRepository } = await import('../../apps/api/src/infrastructure/db/repositories/DrizzlePricingCapacityRepository');
    repo = new DrizzlePricingCapacityRepository();

    const full = await version('FULL', { global: 2 });
    await reservation(full, 'REDEEMED'); await reservation(full, 'RESERVED');
    const room = await version('ROOM', { global: 2 });
    await reservation(room, 'REDEEMED'); await reservation(room, 'RESERVED', { expired: true }); await reservation(room, 'RELEASED');
    await version('NOLIMIT', {});
    const code = await version('CODE', { perCoupon: 1, coupon: 'SAVE10' });
    await reservation(code, 'REDEEMED', { coupon: 'hash-save10' });
  });

  afterAll(async () => {
    if (!raw) return;
    await raw`delete from promotion_reservations where quote_id = any(${quotes})`;
    await raw`delete from pricing_quotes where id = any(${quotes})`;
    await raw`update promotion_definitions set active_version_id = null where id = any(${defs})`;
    await raw`delete from promotion_versions where definition_id = any(${defs})`;
    await raw`delete from promotion_definitions where id = any(${defs})`;
    await raw.end({ timeout: 5 });
  });

  const names = (set: Set<string>) => Object.entries(versions).filter(([, id]) => set.has(id)).map(([n]) => n).sort();

  it('a global limit counts redeemed and live reservations; expired and released ones free their place', async () => {
    const out = await repo.exhaustedVersionIds({ versionIds: Object.values(versions), couponReferenceHash: null, now });
    expect(names(out)).toEqual(['FULL']);
  });

  it('a per-code limit counts that code only', async () => {
    expect(names(await repo.exhaustedVersionIds({ versionIds: Object.values(versions), couponReferenceHash: 'hash-save10', now }))).toEqual(['CODE', 'FULL']);
    expect(names(await repo.exhaustedVersionIds({ versionIds: Object.values(versions), couponReferenceHash: 'hash-other', now }))).toEqual(['FULL']);
  });

  it('no versions, no query', async () => {
    expect((await repo.exhaustedVersionIds({ versionIds: [], couponReferenceHash: null, now })).size).toBe(0);
  });
});
