import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'node:module';

/**
 * The plain /quote-request form has no JavaScript and no idempotency key. A double tap, or the browser resending
 * after a timeout, must still make ONE enquiry: ten identical posts at the same moment leave one row, and every
 * caller gets that row's id. A different quantity is a new enquiry.
 */
const URL = process.env.COMMERCE_TEST_DATABASE_URL;
const d = URL ? describe : describe.skip;

d('quote request de-duplication under concurrency (real PostgreSQL)', () => {
  let raw: any; let uc: any;
  const phone = `+2567${Date.now().toString().slice(-8)}`;
  beforeAll(async () => {
    process.env.DATABASE_URL = URL!;
    const require = createRequire(import.meta.url);
    const postgres = require('../../apps/api/node_modules/postgres');
    raw = postgres(URL!, { max: 4, prepare: false });
    const { DrizzleQuoteRepository } = await import('../../apps/api/src/infrastructure/db/repositories/DrizzleQuoteRepository');
    const { RequestQuoteUseCase } = await import('../../apps/api/src/application/use-cases/governance/RequestQuoteUseCase');
    uc = new RequestQuoteUseCase(new DrizzleQuoteRepository() as any);
  });
  afterAll(async () => { if (!raw) return; await raw`delete from quote_requests where product_name = 'FIXTURE charger' and phone like ${'%' + phone.slice(-8)}`; await raw.end(); });

  const input = () => ({ customerName: 'Fixture Reseller', email: '', phone, productName: 'FIXTURE charger', quantity: '2 cartons', message: '', kind: 'wholesale' });

  it('ten simultaneous identical posts leave one enquiry and return its id to every caller', async () => {
    const results = await Promise.all(Array.from({ length: 10 }, () => uc.execute(input())));
    expect(results.every((r: any) => r.ok)).toBe(true);
    const ids = new Set(results.map((r: any) => r.quoteId));
    expect(ids.size).toBe(1);
    const [{ n }] = await raw`select count(*)::int as n from quote_requests where product_name = 'FIXTURE charger' and phone like ${'%' + phone.slice(-8)}`;
    expect(n).toBe(1);
  });

  it('a different quantity is a new enquiry', async () => {
    const r = await uc.execute({ ...input(), quantity: '3 cartons' });
    expect(r.ok).toBe(true);
    const [{ n }] = await raw`select count(*)::int as n from quote_requests where product_name = 'FIXTURE charger' and phone like ${'%' + phone.slice(-8)}`;
    expect(n).toBe(2);
  });
});
