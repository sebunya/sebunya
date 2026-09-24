import { describe, expect, it } from 'vitest';
import {
  MAX_BULK_LINES,
  MAX_BULK_LINE_QUANTITY,
  REFERENCE_ALPHABET,
  buyerStatusCopy,
  canTransitionQuoteRequest,
  fingerprintSource,
  legacySummary,
  makeBulkReference,
  normaliseBulkReference,
  parseNeededBy,
  snapshotBulkLines,
  validateBulkLines,
  type CatalogueEntry,
} from '../../apps/api/src/domain/quotes/BulkQuoteRequest';
import {
  LookupBulkQuoteUseCase,
  SubmitBulkQuoteUseCase,
  UpdateQuoteRequestStatusUseCase,
  quoteLinesCsvRows,
  QUOTE_LINES_CSV_HEADER,
} from '../../apps/api/src/application/use-cases/quotes/BulkQuoteUseCases';
import type {
  CreateBulkQuoteOutcome,
  IBulkQuoteRepository,
  NewBulkQuoteRecord,
  QuoteRequestView,
} from '../../apps/api/src/application/ports/IBulkQuoteRepository';
import type { IProductRepository, ProductWithPrice } from '../../apps/api/src/application/ports/IProductRepository';
import { ProductEntity } from '../../apps/api/src/domain/products/ProductEntity';
import { smsText } from '../../apps/api/src/application/notifications/CustomerMessages';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const GONE = '99999999-9999-4999-8999-999999999999';

/* ------------------------------------------------------------------------ */
/* Domain                                                                     */
/* ------------------------------------------------------------------------ */

describe('bulk line validation', () => {
  it('refuses an empty list and a non-list', () => {
    expect(validateBulkLines([])).toMatchObject({ ok: false, code: 'NO_LINES' });
    expect(validateBulkLines('x')).toMatchObject({ ok: false, code: 'NO_LINES' });
    expect(validateBulkLines(null)).toMatchObject({ ok: false, code: 'NO_LINES' });
  });

  it('refuses a malformed product id or a quantity outside 1..50,000 or not whole', () => {
    expect(validateBulkLines([{ productId: 'abc', quantity: 1 }])).toMatchObject({ ok: false, code: 'BAD_LINE' });
    for (const quantity of [0, -1, 1.5, MAX_BULK_LINE_QUANTITY + 1, '5', null]) {
      expect(validateBulkLines([{ productId: A, quantity }])).toMatchObject({ ok: false, code: 'BAD_LINE' });
    }
    expect(validateBulkLines([{ productId: A, quantity: MAX_BULK_LINE_QUANTITY }])).toMatchObject({ ok: true });
  });

  it('merges repeats of one product in first-seen order and caps the sum', () => {
    const r = validateBulkLines([
      { productId: B, quantity: 3 },
      { productId: A.toUpperCase(), quantity: 2 },
      { productId: B, quantity: MAX_BULK_LINE_QUANTITY },
    ]);
    expect(r).toEqual({ ok: true, lines: [{ productId: B, quantity: MAX_BULK_LINE_QUANTITY }, { productId: A, quantity: 2 }] });
  });

  it('caps the number of distinct products', () => {
    const many = Array.from({ length: MAX_BULK_LINES + 1 }, (_, i) => ({
      productId: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      quantity: 1,
    }));
    expect(validateBulkLines(many)).toMatchObject({ ok: false, code: 'TOO_MANY_LINES' });
    expect(validateBulkLines(many.slice(0, MAX_BULK_LINES))).toMatchObject({ ok: true });
  });
});

describe('snapshots come from the catalogue, never the client', () => {
  const catalogue: CatalogueEntry[] = [
    { productId: A, name: 'Fast charger', code: 'GP-C08', unitPriceUgx: 25_000, availability: 'in_stock' },
    { productId: B, name: 'Cable', code: null, unitPriceUgx: null, availability: 'out_of_stock' },
  ];

  it('builds each line from the catalogue entry and totals priced lines only', () => {
    const r = snapshotBulkLines([{ productId: A, quantity: 4 }, { productId: B, quantity: 10 }], catalogue);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.lines).toEqual([
      { lineNo: 1, productId: A, productCode: 'GP-C08', productName: 'Fast charger', quantity: 4, unitPriceUgx: 25_000, lineTotalUgx: 100_000, availability: 'in_stock' },
      { lineNo: 2, productId: B, productCode: null, productName: 'Cable', quantity: 10, unitPriceUgx: null, lineTotalUgx: null, availability: 'out_of_stock' },
    ]);
    expect(r.totals).toEqual({ lineCount: 2, totalUnits: 14, estimatedTotalUgx: 100_000, pricedLineCount: 1 });
  });

  it('refuses the whole request, naming every product that is not on sale', () => {
    expect(snapshotBulkLines([{ productId: A, quantity: 1 }, { productId: GONE, quantity: 1 }], catalogue))
      .toEqual({ ok: false, code: 'PRODUCTS_UNAVAILABLE', productIds: [GONE] });
  });

  it('keeps the legacy summary columns true', () => {
    const r = snapshotBulkLines([{ productId: A, quantity: 4 }, { productId: B, quantity: 10 }], catalogue);
    if (!r.ok) throw new Error('expected ok');
    expect(legacySummary(r.lines)).toEqual({ productName: 'Bulk list: Fast charger and 1 more', quantity: '14' });
  });
});

describe('reference', () => {
  it('is BQ- plus six characters from an alphabet without 0, O, 1, I or L', () => {
    expect(REFERENCE_ALPHABET).not.toMatch(/[01OIL]/);
    let i = 0;
    const ref = makeBulkReference((n) => (i++ * 7) % n);
    expect(ref).toMatch(/^BQ-[A-Z2-9]{6}$/);
  });

  it('normalises what a buyer types and refuses anything else', () => {
    expect(normaliseBulkReference(' bq 7k3m9p ')).toBe('BQ-7K3M9P');
    expect(normaliseBulkReference('BQ-7K3M9P')).toBe('BQ-7K3M9P');
    expect(normaliseBulkReference('BQ-7K3M9')).toBeNull();
    expect(normaliseBulkReference('BQ-0K3M9P')).toBeNull(); // 0 is not in the alphabet
    expect(normaliseBulkReference(42)).toBeNull();
  });
});

describe('status', () => {
  it('moves new -> quoted/lost and quoted -> won/lost/expired only', () => {
    expect(canTransitionQuoteRequest('new', 'quoted')).toBe(true);
    expect(canTransitionQuoteRequest('new', 'won')).toBe(false);
    expect(canTransitionQuoteRequest('quoted', 'won')).toBe(true);
    expect(canTransitionQuoteRequest('won', 'lost')).toBe(false);
    expect(canTransitionQuoteRequest('bogus', 'quoted')).toBe(false);
  });

  it('tells the buyer in plain words', () => {
    expect(buyerStatusCopy('new').label).toBe('Received');
    expect(buyerStatusCopy('quoted').label).toBe('Quote sent');
    for (const s of ['new', 'quoted', 'won', 'lost', 'expired']) expect(buyerStatusCopy(s).detail).not.toMatch(/_/);
  });
});

describe('needed-by date', () => {
  const today = new Date('2026-09-25T10:00:00Z');
  it('accepts today up to a year ahead; refuses the past, nonsense and fake dates', () => {
    expect(parseNeededBy('', today)).toBeNull();
    expect(parseNeededBy(undefined, today)).toBeNull();
    expect(parseNeededBy('2026-09-25', today)).toBe('2026-09-25');
    expect(parseNeededBy('2027-09-01', today)).toBe('2027-09-01');
    expect(parseNeededBy('2026-09-24', today)).toBe('INVALID');
    expect(parseNeededBy('2028-01-01', today)).toBe('INVALID');
    expect(parseNeededBy('2026-02-30', today)).toBe('INVALID');
    expect(parseNeededBy('next week', today)).toBe('INVALID');
  });
});

describe('fingerprint', () => {
  it('ignores line order but not quantity or phone', () => {
    const one = fingerprintSource('+256772000001', [{ productId: A, quantity: 1 }, { productId: B, quantity: 2 }]);
    expect(fingerprintSource('+256772000001', [{ productId: B, quantity: 2 }, { productId: A, quantity: 1 }])).toBe(one);
    expect(fingerprintSource('+256772000001', [{ productId: B, quantity: 3 }, { productId: A, quantity: 1 }])).not.toBe(one);
    expect(fingerprintSource('+256772000002', [{ productId: A, quantity: 1 }, { productId: B, quantity: 2 }])).not.toBe(one);
  });
});

/* ------------------------------------------------------------------------ */
/* Use cases                                                                  */
/* ------------------------------------------------------------------------ */

function product(id: string, opts: { sku?: string; price?: number | null; stock?: number; name?: string } = {}): ProductWithPrice {
  const entity = new ProductEntity(
    id, opts.sku ?? `SKU-${id.slice(0, 4)}`, `MOD-${id.slice(0, 4)}`, opts.name ?? `Product ${id.slice(0, 4)}`, `p-${id.slice(0, 4)}`,
    'Power Devices', undefined, '', '', 0, undefined, 'in_stock', undefined, [], '1 Year', true, true, 'approved',
    false, true, true, opts.stock ?? 5, {},
  );
  return {
    entity,
    retailPriceUgx: opts.price === undefined ? 10_000 : opts.price,
    floorPriceUgx: 7_000,
    categoryName: 'Power Devices',
    images: [],
    attributeValues: [],
  };
}

function fakeProducts(rows: ProductWithPrice[]): IProductRepository & { calls: Array<{ ids?: string[] }> } {
  const calls: Array<{ ids?: string[] }> = [];
  return {
    calls,
    findPublicViewBySlug: async () => null,
    findAdminViewById: async () => null,
    findPublicViewList: async (opts = {}) => {
      calls.push({ ids: opts.ids });
      return rows.filter((r) => (opts.ids ?? []).includes(r.entity.id));
    },
  };
}

function fakeRepo(): IBulkQuoteRepository & { saved: NewBulkQuoteRecord[]; statuses: Map<string, string>; forceOutcome?: CreateBulkQuoteOutcome[] } {
  const saved: NewBulkQuoteRecord[] = [];
  const statuses = new Map<string, string>();
  const toView = (r: NewBulkQuoteRecord): QuoteRequestView => ({
    id: r.id, reference: r.reference, source: 'bulk_builder', status: statuses.get(r.id) ?? 'new',
    customerName: r.customerName, businessName: r.businessName, phone: r.phone, email: r.email,
    buyerType: r.buyerType, deliveryDistrict: r.deliveryDistrict, neededBy: r.neededBy, notes: r.notes,
    productName: r.productName, quantity: r.quantity, requestFingerprint: r.requestFingerprint,
    lines: r.lines, totals: r.totals, createdAt: r.createdAt, updatedAt: null,
  });
  const repo = {
    saved,
    statuses,
    forceOutcome: [] as CreateBulkQuoteOutcome[],
    async create(record: NewBulkQuoteRecord) {
      const forced = repo.forceOutcome.shift();
      if (forced) return forced;
      if (saved.some((s) => s.idempotencyKey === record.idempotencyKey)) return 'duplicate_idempotency_key' as const;
      if (saved.some((s) => s.reference === record.reference)) return 'duplicate_reference' as const;
      saved.push(record);
      return 'created' as const;
    },
    async findByIdempotencyKey(key: string) { const r = saved.find((s) => s.idempotencyKey === key); return r ? toView(r) : null; },
    async findByReference(ref: string) { const r = saved.find((s) => s.reference === ref); return r ? toView(r) : null; },
    async findById(id: string) { const r = saved.find((s) => s.id === id); return r ? toView(r) : null; },
    async list() { return saved.map(toView); },
    async updateStatus(id: string, from: string, to: string) {
      if ((statuses.get(id) ?? 'new') !== from) return false;
      statuses.set(id, to);
      return true;
    },
  };
  return repo;
}

const KEY = 'k_0123456789abcdef0123';
const valid = () => ({
  idempotencyKey: KEY,
  customerName: 'Grace Namuli',
  businessName: 'Namuli Phone Shop',
  phone: '0772 123 456',
  email: '',
  buyerType: 'wholesale',
  deliveryDistrict: 'wakiso',
  neededBy: '',
  notes: 'Branded boxes please',
  lines: [
    { productId: A, quantity: 120, unitPriceUgx: 1, name: 'client says free' },
    { productId: B, quantity: 5 },
  ],
});

function setup(rows = [product(A, { sku: 'GP-C08', price: 25_000 }), product(B, { price: null, stock: 0 })]) {
  const repo = fakeRepo();
  const products = fakeProducts(rows);
  const acks: Array<Record<string, unknown>> = [];
  let counter = 0;
  const uc = new SubmitBulkQuoteUseCase(
    repo,
    products,
    { execute: async (input) => { acks.push(input as unknown as Record<string, unknown>); return 'queued'; } },
    () => new Date('2026-09-25T09:00:00Z'),
    (n) => (counter++ * 7) % n,
    () => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  );
  return { repo, products, acks, uc };
}

describe('SubmitBulkQuoteUseCase', () => {
  it('saves the request with server-side snapshots and ignores any client price or name', async () => {
    const { repo, uc, products } = setup();
    const r = await uc.execute(valid());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.replayed).toBe(false);
    expect(products.calls[0].ids).toEqual([A, B]);
    const saved = repo.saved[0];
    expect(saved.phone).toBe('+256772123456');
    expect(saved.deliveryDistrict).toBe('Wakiso');
    expect(saved.buyerType).toBe('wholesale');
    expect(saved.lines[0]).toMatchObject({ productName: 'Product 1111', productCode: 'GP-C08', unitPriceUgx: 25_000, lineTotalUgx: 3_000_000, quantity: 120, availability: 'in_stock' });
    expect(saved.lines[1]).toMatchObject({ unitPriceUgx: null, lineTotalUgx: null, availability: 'out_of_stock' });
    expect(saved.totals).toEqual({ lineCount: 2, totalUnits: 125, estimatedTotalUgx: 3_000_000, pricedLineCount: 1 });
    expect(r.request.reference).toMatch(/^BQ-[A-Z2-9]{6}$/);
    expect(JSON.stringify(r.request)).not.toMatch(/floor|7000|dealer|cost/i);
  });

  it('acknowledges once, with the reference and the line count, on QUOTE_REQUEST_RECEIVED', async () => {
    const { uc, acks } = setup();
    const r = await uc.execute(valid());
    if (!r.ok) throw new Error('expected ok');
    expect(acks).toHaveLength(1);
    expect(acks[0]).toMatchObject({
      eventType: 'QUOTE_REQUEST_RECEIVED',
      template: 'QUOTE_REQUEST_RECEIVED',
      phone: '+256772123456',
      relatedEntity: 'quote_request',
      data: { reference: r.request.reference, lineCount: 2, totalUnits: 125, customerName: 'Grace Namuli' },
    });
  });

  it('a retry with the same key and list returns the first request and sends nothing again', async () => {
    const { repo, uc, acks } = setup();
    const first = await uc.execute(valid());
    const second = await uc.execute({ ...valid(), lines: [...valid().lines].reverse() });
    expect(second).toMatchObject({ ok: true, replayed: true });
    if (!first.ok || !second.ok) throw new Error('expected ok');
    expect(second.request.reference).toBe(first.request.reference);
    expect(repo.saved).toHaveLength(1);
    expect(acks).toHaveLength(1);
  });

  it('the same key with a different list is a conflict, not a replay', async () => {
    const { uc } = setup();
    await uc.execute(valid());
    const r = await uc.execute({ ...valid(), lines: [{ productId: A, quantity: 121 }, { productId: B, quantity: 5 }] });
    expect(r).toMatchObject({ ok: false, code: 'IDEMPOTENCY_CONFLICT' });
  });

  it('a lost race on the key answers with the winner', async () => {
    const { repo, uc } = setup();
    await uc.execute(valid());
    // Simulate the race: the pre-check misses, the insert then clashes on the key.
    const realFind = repo.findByIdempotencyKey.bind(repo);
    let calls = 0;
    repo.findByIdempotencyKey = async (key: string) => (calls++ === 0 ? null : realFind(key));
    const r = await uc.execute(valid());
    expect(r).toMatchObject({ ok: true, replayed: true });
  });

  it('retries a clashing reference, and fails cleanly after three', async () => {
    const { repo, uc } = setup();
    repo.forceOutcome = ['duplicate_reference'];
    expect(await uc.execute(valid())).toMatchObject({ ok: true, replayed: false });
    const again = setup();
    again.repo.forceOutcome = ['duplicate_reference', 'duplicate_reference', 'duplicate_reference'];
    await expect(again.uc.execute(valid())).rejects.toThrow('BULK_QUOTE_REFERENCE_EXHAUSTED');
  });

  it('refuses products that are not on sale and saves nothing', async () => {
    const { repo, uc, acks } = setup();
    const r = await uc.execute({ ...valid(), lines: [{ productId: A, quantity: 1 }, { productId: GONE, quantity: 2 }] });
    expect(r).toMatchObject({ ok: false, code: 'PRODUCTS_UNAVAILABLE', productIds: [GONE] });
    expect(repo.saved).toHaveLength(0);
    expect(acks).toHaveLength(0);
  });

  it('validates the business details', async () => {
    const { uc } = setup();
    expect(await uc.execute({ ...valid(), idempotencyKey: 'short' })).toMatchObject({ code: 'BAD_INPUT', field: 'idempotencyKey' });
    expect(await uc.execute({ ...valid(), customerName: 'G' })).toMatchObject({ code: 'BAD_INPUT', field: 'customerName' });
    expect(await uc.execute({ ...valid(), phone: '12345' })).toMatchObject({ code: 'BAD_INPUT', field: 'phone' });
    expect(await uc.execute({ ...valid(), email: 'not-an-email' })).toMatchObject({ code: 'BAD_INPUT', field: 'email' });
    expect(await uc.execute({ ...valid(), buyerType: 'vip' })).toMatchObject({ code: 'BAD_INPUT', field: 'buyerType' });
    expect(await uc.execute({ ...valid(), deliveryDistrict: 'Atlantis' })).toMatchObject({ code: 'BAD_INPUT', field: 'deliveryDistrict' });
    expect(await uc.execute({ ...valid(), neededBy: '2020-01-01' })).toMatchObject({ code: 'BAD_INPUT', field: 'neededBy' });
    expect(await uc.execute({ ...valid(), notes: 'x'.repeat(2001) })).toMatchObject({ code: 'BAD_INPUT', field: 'notes' });
    expect(await uc.execute({ ...valid(), lines: [] })).toMatchObject({ code: 'NO_LINES' });
    expect(await uc.execute({ ...valid(), customerName: 42 })).toMatchObject({ code: 'BAD_INPUT' });
  });

  it('email and business name are optional; buyer type defaults to retail', async () => {
    const { repo, uc } = setup();
    const r = await uc.execute({ ...valid(), email: undefined, businessName: undefined, buyerType: undefined, deliveryDistrict: undefined });
    expect(r.ok).toBe(true);
    expect(repo.saved[0]).toMatchObject({ email: '', businessName: null, buyerType: 'retail', deliveryDistrict: null });
  });
});

describe('LookupBulkQuoteUseCase', () => {
  it('finds the request only with its own phone, and answers one NOT_FOUND for every miss', async () => {
    const { repo, uc } = setup();
    const r = await uc.execute(valid());
    if (!r.ok) throw new Error('expected ok');
    const lookup = new LookupBulkQuoteUseCase(repo);
    const hit = await lookup.execute({ reference: r.request.reference.toLowerCase().replace('-', ' '), phone: '+256 772 123456' });
    expect(hit.ok).toBe(true);
    if (hit.ok) {
      expect(hit.request.lines).toHaveLength(2);
      // Buyer-safe: no contact details, no notes, nothing internal.
      expect(JSON.stringify(hit.request)).not.toMatch(/Branded boxes|772123456|"email"|"notes"|"phone"|fingerprint|idempotency/i);
    }
    const wrongPhone = await lookup.execute({ reference: r.request.reference, phone: '0772 999 999' });
    const unknown = await lookup.execute({ reference: 'BQ-ZZZZZZ', phone: '0772 123 456' });
    const junk = await lookup.execute({ reference: { $ne: 1 }, phone: null });
    expect(wrongPhone).toEqual(unknown);
    expect(junk).toEqual(unknown);
    expect(unknown).toMatchObject({ ok: false, code: 'NOT_FOUND' });
  });
});

describe('UpdateQuoteRequestStatusUseCase', () => {
  it('follows the transitions and refuses a stale move', async () => {
    const { repo, uc } = setup();
    const r = await uc.execute(valid());
    if (!r.ok) throw new Error('expected ok');
    const update = new UpdateQuoteRequestStatusUseCase(repo);
    expect(await update.execute({ id: r.quoteId, status: 'won' })).toMatchObject({ ok: false, code: 'TRANSITION_BLOCKED' });
    expect(await update.execute({ id: r.quoteId, status: 'nope' })).toMatchObject({ ok: false, code: 'BAD_STATUS' });
    expect(await update.execute({ id: 'not-a-uuid', status: 'quoted' })).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    expect(await update.execute({ id: r.quoteId, status: 'quoted' })).toEqual({ ok: true, id: r.quoteId, from: 'new', to: 'quoted' });
    expect(await update.execute({ id: r.quoteId, status: 'won' })).toMatchObject({ ok: true, from: 'quoted', to: 'won' });
    // A compare-and-set miss (someone else moved it) is a conflict.
    repo.updateStatus = async () => false;
    repo.statuses.set(r.quoteId, 'quoted');
    expect(await update.execute({ id: r.quoteId, status: 'lost' })).toMatchObject({ ok: false, code: 'CONFLICT' });
  });
});

describe('CSV of lines', () => {
  it('has one row per line, in header order', async () => {
    const { repo, uc } = setup();
    await uc.execute(valid());
    const rows = quoteLinesCsvRows(await repo.list());
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveLength(QUOTE_LINES_CSV_HEADER.length);
    expect(rows[0][QUOTE_LINES_CSV_HEADER.indexOf('product_code')]).toBe('GP-C08');
    expect(rows[0][QUOTE_LINES_CSV_HEADER.indexOf('quantity')]).toBe(120);
    expect(QUOTE_LINES_CSV_HEADER.join(',')).not.toMatch(/cost|dealer|floor/);
  });
});

describe('acknowledgement text', () => {
  it('the SMS names the reference and the number of products, and is unchanged without a count', () => {
    expect(smsText('QUOTE_REQUEST_RECEIVED', { reference: 'BQ-7K3M9P', lineCount: 12 })).toContain('(ref BQ-7K3M9P) for 12 products.');
    expect(smsText('QUOTE_REQUEST_RECEIVED', { reference: 'BQ-7K3M9P', lineCount: 1 })).toContain('for 1 product.');
    expect(smsText('QUOTE_REQUEST_RECEIVED', { reference: 'X' })).toMatch(/quote request \(ref X\)\. Our sales team/);
  });
});
