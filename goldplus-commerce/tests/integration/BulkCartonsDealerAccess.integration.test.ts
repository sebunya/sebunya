import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

/**
 * Bulk by the carton at dealer price (0195) on real PostgreSQL: the terms
 * repository (on-sale read, all-or-nothing update), the phone-code challenges,
 * and a bulk request with cartons, and one with only a budget.
 */
const url = process.env.COMMERCE_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const run = url ? describe : describe.skip;

run('bulk cartons, dealer prices and price access (real PostgreSQL)', () => {
  const raw = createRequire(import.meta.url)('../../apps/api/node_modules/postgres')(url!, { max: 1, prepare: false });
  const tag = randomUUID().slice(0, 8);
  const cat = randomUUID();
  const carton = randomUUID();
  const flash = randomUUID();
  const unpriced = randomUUID();
  const draft = randomUUID();
  const phone = `+2567${String(Date.now()).slice(-8)}`;
  const quoteIds: string[] = [];
  type Repos = {
    terms: import('../../apps/api/src/infrastructure/db/repositories/DrizzleBulkTermsRepository').DrizzleBulkTermsRepository;
    access: import('../../apps/api/src/infrastructure/db/repositories/DrizzleBulkPriceAccessRepository').DrizzleBulkPriceAccessRepository;
    quotes: import('../../apps/api/src/infrastructure/db/repositories/DrizzleBulkQuoteRepository').DrizzleBulkQuoteRepository;
  };
  let r: Repos;

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    await raw`insert into categories (id, name, slug) values (${cat}, ${`Bulk IT ${tag}`}, ${`bulk-it-${tag}`})`;
    const product = (id: string, sku: string, name: string, approval = 'approved') =>
      raw`insert into products (id, sku, model_number, name, slug, category_id, approval_status, active) values (${id}, ${sku}, ${sku}, ${name}, ${`${sku}-${tag}`.toLowerCase()}, ${cat}, ${approval}, true)`;
    await product(carton, `BIT-C-${tag}`, 'Bulk IT charger');
    await product(flash, `BIT-F-${tag}`, 'GoldPlus Flash Drive 16GB IT');
    await product(unpriced, `BIT-U-${tag}`, 'Bulk IT no price row');
    await product(draft, `BIT-D-${tag}`, 'Bulk IT draft', 'draft');
    await raw`insert into product_prices (product_id, retail_price, dealer_price) values (${carton}, 30000, 21000), (${flash}, 15000, null), (${draft}, 10000, 7000)`;
    await raw`update products set bulk_unit = 'piece' where id = ${flash}`;
    await raw`update products set units_per_carton = 50 where id = ${carton}`;
    r = {
      terms: new (await import('../../apps/api/src/infrastructure/db/repositories/DrizzleBulkTermsRepository')).DrizzleBulkTermsRepository(),
      access: new (await import('../../apps/api/src/infrastructure/db/repositories/DrizzleBulkPriceAccessRepository')).DrizzleBulkPriceAccessRepository(),
      quotes: new (await import('../../apps/api/src/infrastructure/db/repositories/DrizzleBulkQuoteRepository')).DrizzleBulkQuoteRepository(),
    };
  });

  afterAll(async () => {
    if (quoteIds.length) await raw`delete from quote_requests where id in ${raw(quoteIds)}`;
    await raw`delete from bulk_price_access where phone = ${phone}`;
    await raw`delete from product_prices where product_id in ${raw([carton, flash, unpriced, draft])}`;
    await raw`delete from products where id in ${raw([carton, flash, unpriced, draft])}`;
    await raw`delete from categories where id = ${cat}`;
    await raw.end();
  });

  it('reads the terms of products on sale only, with the dealer price per piece', async () => {
    const terms = await r.terms.findOnSale([carton, flash, unpriced, draft]);
    const byId = new Map(terms.map((t) => [t.productId, t]));
    expect(byId.get(carton)).toEqual({ productId: carton, bulkUnit: 'carton', unitsPerCarton: 50, dealerPriceUgx: 21000 });
    expect(byId.get(flash)).toEqual({ productId: flash, bulkUnit: 'piece', unitsPerCarton: null, dealerPriceUgx: null });
    expect(byId.get(unpriced)).toMatchObject({ dealerPriceUgx: null });
    expect(byId.has(draft)).toBe(false);
  });

  it('writes the three fields together, and undoes the product write when there is no price row', async () => {
    expect(await r.terms.update(carton, { bulkUnit: 'carton', unitsPerCarton: 40, dealerPriceUgx: 20000 })).toBe('updated');
    const [after] = await raw`select p.units_per_carton, pp.dealer_price from products p join product_prices pp on pp.product_id = p.id where p.id = ${carton}`;
    expect(after).toEqual({ units_per_carton: 40, dealer_price: 20000 });

    expect(await r.terms.update(unpriced, { bulkUnit: 'piece', unitsPerCarton: null, dealerPriceUgx: 5000 })).toBe('no_retail_price');
    const [still] = await raw`select bulk_unit from products where id = ${unpriced}`;
    expect(still.bulk_unit).toBe('carton');
    expect(await r.terms.update(randomUUID(), { bulkUnit: 'carton', unitsPerCarton: null, dealerPriceUgx: null })).toBe('not_found');
  });

  it('the database refuses an impossible unit, carton size or dealer price', async () => {
    await expect(raw`update products set bulk_unit = 'box' where id = ${carton}`).rejects.toThrow(/products_bulk_unit_chk/);
    await expect(raw`update products set units_per_carton = 1 where id = ${carton}`).rejects.toThrow(/products_units_per_carton_chk/);
    await expect(raw`update product_prices set dealer_price = 0 where product_id = ${carton}`).rejects.toThrow(/product_prices_dealer_price_chk/);
  });

  it('keeps code challenges: counts, newest open one, attempts, verify once, leads', async () => {
    const since = new Date(Date.now() - 60_000);
    await r.access.create({ phone, codeHash: 'a'.repeat(64), expiresAt: new Date(Date.now() + 600_000) });
    await r.access.create({ phone, codeHash: 'b'.repeat(64), expiresAt: new Date(Date.now() + 600_000) });
    expect(await r.access.countSince(phone, since)).toBe(2);
    const open = await r.access.latestOpen(phone);
    expect(open?.codeHash).toBe('b'.repeat(64));
    expect(await r.access.recordAttempt(open!.id)).toBe(1);
    expect(await r.access.recordAttempt(open!.id)).toBe(2);
    expect(await r.access.markVerified(open!.id, new Date())).toBe(true);
    expect(await r.access.markVerified(open!.id, new Date())).toBe(false);
    expect((await r.access.latestOpen(phone))?.codeHash).toBe('a'.repeat(64));
    const leads = await r.access.listVerified({ since, limit: 50 });
    expect(leads.filter((l) => l.phone === phone)).toEqual([expect.objectContaining({ method: 'code' })]);
    // A first visit counts as a use, is never a code to answer, and is a lead marked as such.
    expect(await r.access.countUses(phone)).toBe(2);
    await r.access.recordFirstVisit(phone, new Date());
    expect(await r.access.countUses(phone)).toBe(3);
    expect(await r.access.countSince(phone, since)).toBe(2);
    expect((await r.access.latestOpen(phone))?.codeHash).toBe('a'.repeat(64));
    const after = await r.access.listVerified({ since, limit: 50 });
    expect(after.filter((l) => l.phone === phone).map((l) => l.method).sort()).toEqual(['code', 'first_visit']);
  });

  it('saves a request in cartons with dealer prices, and one with only a budget', async () => {
    const id = randomUUID();
    quoteIds.push(id);
    const outcome = await r.quotes.create({
      id, reference: `BQ-${tag.slice(0, 6).toUpperCase().replace(/[^A-Z2-9]/g, 'Z')}`, idempotencyKey: `it_${tag}_cartons_000`, requestFingerprint: 'f'.repeat(64),
      customerName: 'IT buyer', businessName: null, phone, email: '', buyerType: 'wholesale', deliveryDistrict: null, neededBy: null, notes: '',
      productName: 'Bulk list: IT', quantity: '601 cartons, 30050 pieces',
      lines: [
        { lineNo: 1, productId: carton, productCode: 'C', productName: 'Bulk IT charger', unitKind: 'carton', unitCount: 601, unitsPerCarton: 50, quantity: 30050, unitPriceUgx: 21000, lineTotalUgx: 631_050_000, priceBasis: 'dealer', aboveSelfServe: true, availability: 'unknown' },
        { lineNo: 2, productId: unpriced, productCode: 'U', productName: 'Bulk IT no price row', unitKind: 'carton', unitCount: 3, unitsPerCarton: null, quantity: null, unitPriceUgx: null, lineTotalUgx: null, priceBasis: 'dealer', aboveSelfServe: false, availability: 'unknown' },
      ],
      totals: { lineCount: 2, totalUnits: 30050, totalCartons: 604, estimatedTotalUgx: 631_050_000, pricedLineCount: 1 },
      budgetUgx: 700_000_000, pricesShown: true, createdAt: new Date(),
    });
    expect(outcome).toBe('created');
    const view = await r.quotes.findById(id);
    expect(view).toMatchObject({ budgetUgx: 700_000_000, pricesShown: true });
    expect(view!.lines[0]).toMatchObject({ unitKind: 'carton', unitCount: 601, quantity: 30050, priceBasis: 'dealer', aboveSelfServe: true });
    expect(view!.lines[1]).toMatchObject({ quantity: null, unitsPerCarton: null });
    expect(view!.totals).toMatchObject({ totalCartons: 604, totalUnits: 30050, estimatedTotalUgx: 631_050_000 });

    const budgetOnly = randomUUID();
    quoteIds.push(budgetOnly);
    expect(await r.quotes.create({
      id: budgetOnly, reference: `BQ-${tag.slice(2, 8).toUpperCase().replace(/[^A-Z2-9]/g, 'Y')}`, idempotencyKey: `it_${tag}_budget_0000`, requestFingerprint: 'e'.repeat(64),
      customerName: 'IT budget', businessName: null, phone, email: '', buyerType: 'retail', deliveryDistrict: null, neededBy: null, notes: 'I sell accessories',
      productName: 'Bulk budget: the team builds the list', quantity: '0', lines: [],
      totals: { lineCount: 0, totalUnits: 0, totalCartons: 0, estimatedTotalUgx: 0, pricedLineCount: 0 },
      budgetUgx: 5_000_000, pricesShown: false, createdAt: new Date(),
    })).toBe('created');
    expect(await r.quotes.findById(budgetOnly)).toMatchObject({ budgetUgx: 5_000_000, lines: [], totals: { lineCount: 0 } });
  });
});
