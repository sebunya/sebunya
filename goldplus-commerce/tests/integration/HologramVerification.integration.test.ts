import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'node:module';

/**
 * A4: hologram code state transitions on real PostgreSQL, with SYNTHETIC
 * fixture codes only (prefix ZZTEST-, never a real hologram code).
 * new -> genuine; repeat -> already_checked (with first-check time, never a
 * counterfeit verdict); unknown -> not_found; simultaneous checks of one code
 * -> exactly one genuine, the rest already_checked; a read never consumes.
 */
const URL = process.env.COMMERCE_TEST_DATABASE_URL;
const d = URL ? describe : describe.skip;

d('hologram verification (real PostgreSQL)', () => {
  let raw: any; let uc: any; let repo: any;
  let productId = ''; let catId = '';
  const tag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase();
  const codes = { fresh: `ZZTEST-N-${tag}`, race: `ZZTEST-R-${tag}`, peek: `ZZTEST-P-${tag}` };

  beforeAll(async () => {
    process.env.DATABASE_URL = URL!;
    const require = createRequire(import.meta.url);
    const postgres = require('../../apps/api/node_modules/postgres');
    raw = postgres(URL!, { max: 8, prepare: false });
    catId = (await raw`insert into categories (name, slug) values ('T', ${'t-holo-' + tag.toLowerCase()}) returning id`)[0].id;
    const sku = `HV-${tag}`;
    productId = (await raw`insert into products (sku, model_number, name, slug, category_id, price_ugx, active, approval_status) values (${sku}, ${sku}, 'Hologram Test', ${sku.toLowerCase()}, ${catId}, 10000, true, 'approved') returning id`)[0].id;
    for (const c of Object.values(codes)) await raw`insert into verification_codes (product_id, code) values (${productId}, ${c})`;
    const { DrizzleVerificationRepository } = await import('../../apps/api/src/infrastructure/db/repositories/DrizzleVerificationRepository');
    const { VerificationCheckUseCase } = await import('../../apps/api/src/application/use-cases/VerificationCheckUseCase');
    repo = new DrizzleVerificationRepository();
    uc = new VerificationCheckUseCase(repo);
  });

  afterAll(async () => {
    if (!raw) return;
    await raw`delete from verification_attempts where code like ${'ZZTEST-%-' + tag}`;
    await raw`delete from verification_codes where product_id = ${productId}`;
    await raw`delete from products where id = ${productId}`;
    await raw`delete from categories where id = ${catId}`;
    await raw.end();
  });

  it('new code is genuine, then a repeat is already_checked with the first-check time', async () => {
    const first = await uc.execute(codes.fresh, '127.0.0.1', 'vitest');
    expect(first).toMatchObject({ success: true, status: 'genuine', productId });
    const again = await uc.execute(codes.fresh, '127.0.0.1', 'vitest');
    expect(again.status).toBe('already_checked');
    expect(again.success).toBe(false);
    expect(again.productId).toBe(productId);
    expect(Number.isNaN(Date.parse(again.firstCheckedAt))).toBe(false);
    const attempts = await raw`select is_successful from verification_attempts where code = ${codes.fresh} order by created_at`;
    expect(attempts.map((a: any) => a.is_successful)).toEqual([true, false]);
  });

  it('an unknown code is not_found and writes a failed attempt', async () => {
    const out = await uc.execute(`ZZTEST-X-${tag}`);
    expect(out).toEqual({ success: false, status: 'not_found' });
  });

  it('ten simultaneous checks of one code: exactly one genuine, nine already_checked', async () => {
    const results = await Promise.all(Array.from({ length: 10 }, () => uc.execute(codes.race)));
    const genuine = results.filter((r: any) => r.status === 'genuine').length;
    const repeat = results.filter((r: any) => r.status === 'already_checked').length;
    expect(genuine).toBe(1);
    expect(repeat).toBe(9);
    const [row] = await raw`select is_used from verification_codes where code = ${codes.race}`;
    expect(row.is_used).toBe(true);
  });

  it('reading a code (findCode) never consumes it', async () => {
    await repo.findCode(codes.peek);
    await repo.findCode(codes.peek);
    const [row] = await raw`select is_used, used_at from verification_codes where code = ${codes.peek}`;
    expect(row.is_used).toBe(false);
    expect(row.used_at).toBeNull();
    expect((await uc.execute(codes.peek)).status).toBe('genuine');
  });
});
