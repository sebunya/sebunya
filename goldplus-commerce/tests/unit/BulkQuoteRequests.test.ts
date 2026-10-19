import { describe, expect, it } from 'vitest';
import {
  MAX_BULK_LINES,
  MAX_CARTONS_PER_LINE,
  MAX_PIECES_PER_LINE,
  REFERENCE_ALPHABET,
  SELF_SERVE_MAX_CARTONS,
  buyerStatusCopy,
  canTransitionQuoteRequest,
  describeLineCount,
  fingerprintSource,
  legacySummary,
  makeBulkReference,
  normaliseBulkReference,
  parseBudget,
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
import type { BulkTerms, IBulkTermsRepository } from '../../apps/api/src/application/ports/IBulkTermsRepository';
import type { IProductRepository, ProductWithPrice } from '../../apps/api/src/application/ports/IProductRepository';
import { ProductEntity } from '../../apps/api/src/domain/products/ProductEntity';
import { smsText } from '../../apps/api/src/application/notifications/CustomerMessages';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const F = '66666666-6666-4666-8666-666666666666';
const GONE = '99999999-9999-4999-8999-999999999999';

/* ------------------------------------------------------------------------ */
/* Domain                                                                     */
/* ------------------------------------------------------------------------ */

describe('bulk line validation', () => {
  it('refuses an empty list and a non-list, unless a budget makes an empty list allowed', () => {
    expect(validateBulkLines([])).toMatchObject({ ok: false, code: 'NO_LINES' });
    expect(validateBulkLines('x')).toMatchObject({ ok: false, code: 'NO_LINES' });
    expect(validateBulkLines(null)).toMatchObject({ ok: false, code: 'NO_LINES' });
    expect(validateBulkLines([], { allowEmpty: true })).toEqual({ ok: true, lines: [] });
    expect(validateBulkLines(undefined, { allowEmpty: true })).toEqual({ ok: true, lines: [] });
    expect(validateBulkLines('x', { allowEmpty: true })).toMatchObject({ ok: false, code: 'NO_LINES' });
  });

  it('refuses a malformed product id or a count that is not a whole number from 1', () => {
    expect(validateBulkLines([{ productId: 'abc', count: 1 }])).toMatchObject({ ok: false, code: 'BAD_LINE' });
    for (const count of [0, -1, 1.5, MAX_PIECES_PER_LINE + 1, '5', null]) {
      expect(validateBulkLines([{ productId: A, count }])).toMatchObject({ ok: false, code: 'BAD_LINE' });
    }
    // The old field is not read: a v1 page cannot send pieces that become cartons.
    expect(validateBulkLines([{ productId: A, quantity: 5 }])).toMatchObject({ ok: false, code: 'BAD_LINE' });
    expect(validateBulkLines([{ productId: A, count: MAX_PIECES_PER_LINE }])).toMatchObject({ ok: true });
  });

  it('merges repeats of one product in first-seen order', () => {
    const r = validateBulkLines([
      { productId: B, count: 3 },
      { productId: A.toUpperCase(), count: 2 },
      { productId: B, count: 4 },
    ]);
    expect(r).toEqual({ ok: true, lines: [{ productId: B, count: 7 }, { productId: A, count: 2 }] });
  });

  it('caps the number of distinct products', () => {
    const many = Array.from({ length: MAX_BULK_LINES + 1 }, (_, i) => ({
      productId: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      count: 1,
    }));
    expect(validateBulkLines(many)).toMatchObject({ ok: false, code: 'TOO_MANY_LINES' });
    expect(validateBulkLines(many.slice(0, MAX_BULK_LINES))).toMatchObject({ ok: true });
  });
});

describe('snapshots: cartons, pieces and the bulk price come from the server', () => {
  const catalogue: CatalogueEntry[] = [
    { productId: A, name: 'Fast charger', code: 'GP-C08', bulkUnit: 'carton', unitsPerCarton: 50, bulkPriceUgx: 21_000, availability: 'in_stock' },
    { productId: B, name: 'Cable', code: null, bulkUnit: 'carton', unitsPerCarton: null, bulkPriceUgx: 5_000, availability: 'out_of_stock' },
    { productId: F, name: 'Flash Drive 16GB', code: 'GP-16GB-F', bulkUnit: 'piece', unitsPerCarton: null, bulkPriceUgx: null, availability: 'in_stock' },
  ];

  it('turns cartons into pieces, prices known pieces at the bulk price, and leaves the rest for the team', () => {
    const r = snapshotBulkLines([{ productId: A, count: 4 }, { productId: B, count: 10 }, { productId: F, count: 300 }], catalogue);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.lines).toEqual([
      { lineNo: 1, productId: A, productCode: 'GP-C08', productName: 'Fast charger', unitKind: 'carton', unitCount: 4, unitsPerCarton: 50, quantity: 200, unitPriceUgx: 21_000, lineTotalUgx: 4_200_000, priceBasis: 'dealer', aboveSelfServe: false, availability: 'in_stock' },
      { lineNo: 2, productId: B, productCode: null, productName: 'Cable', unitKind: 'carton', unitCount: 10, unitsPerCarton: null, quantity: null, unitPriceUgx: 5_000, lineTotalUgx: null, priceBasis: 'dealer', aboveSelfServe: false, availability: 'out_of_stock' },
      { lineNo: 3, productId: F, productCode: 'GP-16GB-F', productName: 'Flash Drive 16GB', unitKind: 'piece', unitCount: 300, unitsPerCarton: null, quantity: 300, unitPriceUgx: null, lineTotalUgx: null, priceBasis: 'dealer', aboveSelfServe: false, availability: 'in_stock' },
    ]);
    expect(r.totals).toEqual({ lineCount: 3, totalUnits: 500, totalCartons: 14, estimatedTotalUgx: 4_200_000, pricedLineCount: 1 });
  });

  it('takes more than 500 cartons and flags it; refuses only a typo-sized count', () => {
    const over = snapshotBulkLines([{ productId: A, count: SELF_SERVE_MAX_CARTONS + 1 }], catalogue);
    expect(over.ok && over.lines[0].aboveSelfServe).toBe(true);
    const at = snapshotBulkLines([{ productId: A, count: SELF_SERVE_MAX_CARTONS }], catalogue);
    expect(at.ok && at.lines[0].aboveSelfServe).toBe(false);
    expect(snapshotBulkLines([{ productId: A, count: MAX_CARTONS_PER_LINE + 1 }], catalogue)).toEqual({ ok: false, code: 'COUNT_TOO_LARGE', productIds: [A] });
    // Pieces have their own, higher bound.
    expect(snapshotBulkLines([{ productId: F, count: MAX_CARTONS_PER_LINE + 1 }], catalogue).ok).toBe(true);
  });

  it('refuses the whole request, naming every product that is not on sale', () => {
    expect(snapshotBulkLines([{ productId: A, count: 1 }, { productId: GONE, count: 1 }], catalogue))
      .toEqual({ ok: false, code: 'PRODUCTS_UNAVAILABLE', productIds: [GONE] });
  });

  it('keeps the legacy summary columns true, for a list and for a budget alone', () => {
    const r = snapshotBulkLines([{ productId: A, count: 4 }, { productId: F, count: 10 }], catalogue);
    if (!r.ok) throw new Error('expected ok');
    expect(legacySummary(r.lines)).toEqual({ productName: 'Bulk list: Fast charger and 1 more', quantity: '4 cartons, 210 pieces' });
    expect(legacySummary([])).toEqual({ productName: 'Bulk budget: the team builds the list', quantity: '0' });
  });

  it('describes a line the way a buyer says it', () => {
    expect(describeLineCount({ unitKind: 'carton', unitCount: 12, quantity: 600 })).toBe('12 cartons (600 pieces)');
    expect(describeLineCount({ unitKind: 'carton', unitCount: 1, quantity: null })).toBe('1 carton (carton size to confirm)');
    expect(describeLineCount({ unitKind: 'piece', unitCount: 40, quantity: 40 })).toBe('40 pieces');
    // A line from before cartons: pieces only.
    expect(describeLineCount({ unitKind: 'piece', unitCount: null, quantity: 120 })).toBe('120 pieces');
  });
});

describe('budget', () => {
  it('reads what people type, within bounds', () => {
    expect(parseBudget('')).toBeNull();
    expect(parseBudget(undefined)).toBeNull();
    expect(parseBudget('5,000,000')).toBe(5_000_000);
    expect(parseBudget('UGX 5 000 000')).toBe(5_000_000);
    expect(parseBudget(2_500_000)).toBe(2_500_000);
    expect(parseBudget('500')).toBe('INVALID');
    expect(parseBudget('lots')).toBe('INVALID');
    expect(parseBudget('99999999999999')).toBe('INVALID');
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
    expect(buyerStatusCopy('new').detail).toMatch(/delivery date/);
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
  it('ignores line order but not count, phone or budget', () => {
    const one = fingerprintSource('+256772000001', [{ productId: A, count: 1 }, { productId: B, count: 2 }]);
    expect(fingerprintSource('+256772000001', [{ productId: B, count: 2 }, { productId: A, count: 1 }])).toBe(one);
    expect(fingerprintSource('+256772000001', [{ productId: B, count: 3 }, { productId: A, count: 1 }])).not.toBe(one);
    expect(fingerprintSource('+256772000002', [{ productId: A, count: 1 }, { productId: B, count: 2 }])).not.toBe(one);
    expect(fingerprintSource('+256772000001', [{ productId: A, count: 1 }, { productId: B, count: 2 }], 1_000_000)).not.toBe(one);
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
    lines: r.lines, totals: r.totals, budgetUgx: r.budgetUgx, pricesShown: r.pricesShown, createdAt: r.createdAt, updatedAt: null,
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
const PHONE = '+256772123456';
const TOKEN = 'valid-token-for-0772123456';
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
    { productId: A, count: 12, unitPriceUgx: 1, name: 'client says free' },
    { productId: B, count: 5 },
  ],
});

function fakeTerms(rows: BulkTerms[]): IBulkTermsRepository {
  return {
    findOnSale: async (ids) => rows.filter((r) => !ids || ids.includes(r.productId)),
    listForAdmin: async () => [],
    update: async () => 'updated',
  };
}

const TERMS: BulkTerms[] = [
  { productId: A, bulkUnit: 'carton', unitsPerCarton: 50, dealerPriceUgx: 21_000 },
  { productId: B, bulkUnit: 'carton', unitsPerCarton: null, dealerPriceUgx: null },
];

function setup(rows = [product(A, { sku: 'GP-C08', price: 25_000 }), product(B, { price: null, stock: 0 })]) {
  const repo = fakeRepo();
  const products = fakeProducts(rows);
  const acks: Array<Record<string, unknown>> = [];
  let counter = 0;
  const uc = new SubmitBulkQuoteUseCase(
    repo,
    products,
    fakeTerms(TERMS),
    { execute: async (input) => { acks.push(input as unknown as Record<string, unknown>); return 'queued'; } },
    (token) => (token === TOKEN ? PHONE : null),
    () => new Date('2026-09-25T09:00:00Z'),
    (n) => (counter++ * 7) % n,
    () => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  );
  return { repo, products, acks, uc };
}

describe('SubmitBulkQuoteUseCase', () => {
  it('saves cartons at the dealer price from the server and ignores any client price or name', async () => {
    const { repo, uc, products } = setup();
    const r = await uc.execute(valid());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.replayed).toBe(false);
    expect(products.calls[0].ids).toEqual([A, B]);
    const saved = repo.saved[0];
    expect(saved.phone).toBe(PHONE);
    expect(saved.deliveryDistrict).toBe('Wakiso');
    expect(saved.lines[0]).toMatchObject({ productName: 'Product 1111', productCode: 'GP-C08', unitKind: 'carton', unitCount: 12, unitsPerCarton: 50, quantity: 600, unitPriceUgx: 21_000, lineTotalUgx: 12_600_000, priceBasis: 'dealer' });
    expect(saved.lines[1]).toMatchObject({ unitCount: 5, quantity: null, unitPriceUgx: null, lineTotalUgx: null });
    expect(saved.totals).toEqual({ lineCount: 2, totalUnits: 600, totalCartons: 17, estimatedTotalUgx: 12_600_000, pricedLineCount: 1 });
    expect(r.request.reference).toMatch(/^BQ-[A-Z2-9]{6}$/);
  });

  it('a buyer who did not prove their phone never sees the dealer price, though the team does', async () => {
    const { repo, uc } = setup();
    const r = await uc.execute(valid());
    if (!r.ok) throw new Error('expected ok');
    expect(repo.saved[0].pricesShown).toBe(false);
    expect(repo.saved[0].lines[0].unitPriceUgx).toBe(21_000);
    expect(r.request.pricesShown).toBe(false);
    expect(r.request.lines.map((l) => [l.unitPriceUgx, l.lineTotalUgx])).toEqual([[null, null], [null, null]]);
    expect(r.request.totals.estimatedTotalUgx).toBe(0);
    expect(JSON.stringify(r.request)).not.toMatch(/21000|12600000|floor|7000|availability|in_stock/i);
  });

  it('a token for the same phone shows the prices; a token for another phone does not', async () => {
    const same = setup();
    const r = await same.uc.execute({ ...valid(), priceAccessToken: TOKEN });
    if (!r.ok) throw new Error('expected ok');
    expect(same.repo.saved[0].pricesShown).toBe(true);
    expect(r.request.pricesShown).toBe(true);
    expect(r.request.lines[0]).toMatchObject({ unitPriceUgx: 21_000, lineTotalUgx: 12_600_000, countLabel: '12 cartons (600 pieces)' });

    const other = setup();
    await other.uc.execute({ ...valid(), phone: '0772 999 999', priceAccessToken: TOKEN });
    expect(other.repo.saved[0].pricesShown).toBe(false);
    const forged = setup();
    await forged.uc.execute({ ...valid(), priceAccessToken: 'forged' });
    expect(forged.repo.saved[0].pricesShown).toBe(false);
  });

  it('takes a budget alone when the notes say what to build, and refuses it without', async () => {
    const { repo, uc, products } = setup();
    const r = await uc.execute({ ...valid(), lines: [], budgetUgx: '5,000,000', notes: 'I sell phone accessories in Mbale' });
    expect(r).toMatchObject({ ok: true });
    expect(products.calls).toHaveLength(0);
    expect(repo.saved[0]).toMatchObject({ budgetUgx: 5_000_000, lines: [], productName: 'Bulk budget: the team builds the list' });
    const again = setup();
    expect(await again.uc.execute({ ...valid(), lines: [], budgetUgx: '5000000', notes: '' })).toMatchObject({ code: 'BAD_INPUT', field: 'notes' });
    expect(await again.uc.execute({ ...valid(), lines: [], notes: 'anything' })).toMatchObject({ code: 'NO_LINES' });
    expect(await again.uc.execute({ ...valid(), budgetUgx: 'lots' })).toMatchObject({ code: 'BAD_INPUT', field: 'budgetUgx' });
  });

  it('keeps a budget sent with a list', async () => {
    const { repo, uc } = setup();
    await uc.execute({ ...valid(), budgetUgx: 10_000_000 });
    expect(repo.saved[0].budgetUgx).toBe(10_000_000);
  });

  it('acknowledges once, with the reference and the line count, on QUOTE_REQUEST_RECEIVED', async () => {
    const { uc, acks } = setup();
    const r = await uc.execute(valid());
    if (!r.ok) throw new Error('expected ok');
    expect(acks).toHaveLength(1);
    expect(acks[0]).toMatchObject({
      eventType: 'QUOTE_REQUEST_RECEIVED',
      template: 'QUOTE_REQUEST_RECEIVED',
      phone: PHONE,
      relatedEntity: 'quote_request',
      data: { reference: r.request.reference, lineCount: 2, customerName: 'Grace Namuli' },
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

  it('the same key with a different list or budget is a conflict, not a replay', async () => {
    const { uc } = setup();
    await uc.execute(valid());
    expect(await uc.execute({ ...valid(), lines: [{ productId: A, count: 13 }, { productId: B, count: 5 }] })).toMatchObject({ ok: false, code: 'IDEMPOTENCY_CONFLICT' });
    expect(await uc.execute({ ...valid(), budgetUgx: 1_000_000 })).toMatchObject({ ok: false, code: 'IDEMPOTENCY_CONFLICT' });
  });

  it('a lost race on the key answers with the winner', async () => {
    const { repo, uc } = setup();
    await uc.execute(valid());
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

  it('refuses products that are not on sale, or a typo-sized count, and saves nothing', async () => {
    const { repo, uc, acks } = setup();
    expect(await uc.execute({ ...valid(), lines: [{ productId: A, count: 1 }, { productId: GONE, count: 2 }] })).toMatchObject({ ok: false, code: 'PRODUCTS_UNAVAILABLE', productIds: [GONE] });
    expect(await uc.execute({ ...valid(), lines: [{ productId: A, count: MAX_CARTONS_PER_LINE + 1 }] })).toMatchObject({ ok: false, code: 'COUNT_TOO_LARGE', productIds: [A] });
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

  it('the page sends only a name and phone: everything else is optional, buyer type defaults to wholesale', async () => {
    const { repo, uc } = setup();
    const r = await uc.execute({ idempotencyKey: KEY, customerName: 'Grace Namuli', phone: '0772 123 456', lines: valid().lines });
    expect(r.ok).toBe(true);
    expect(repo.saved[0]).toMatchObject({ email: '', businessName: null, buyerType: 'wholesale', deliveryDistrict: null, neededBy: null });
  });

  it('a buyer who confirmed their phone with the code is not asked for it again', async () => {
    const { repo, uc } = setup();
    const r = await uc.execute({ idempotencyKey: KEY, customerName: 'Grace Namuli', priceAccessToken: TOKEN, lines: valid().lines });
    expect(r).toMatchObject({ ok: true, contactPhone: PHONE, request: { pricesShown: true } });
    expect(repo.saved[0]).toMatchObject({ phone: PHONE, pricesShown: true });
    // No phone and no valid code: the phone is required.
    const none = setup();
    expect(await none.uc.execute({ idempotencyKey: KEY, customerName: 'Grace', priceAccessToken: 'forged', lines: valid().lines })).toMatchObject({ code: 'BAD_INPUT', field: 'phone' });
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
      // Buyer-safe: no contact details, no notes, nothing internal, no unearned price.
      expect(JSON.stringify(hit.request)).not.toMatch(/Branded boxes|772123456|"email"|"notes"|"phone"|fingerprint|idempotency|21000|availability/i);
    }
    const wrongPhone = await lookup.execute({ reference: r.request.reference, phone: '0772 999 999' });
    const unknown = await lookup.execute({ reference: 'BQ-ZZZZZZ', phone: '0772 123 456' });
    const junk = await lookup.execute({ reference: { $ne: 1 }, phone: null });
    expect(wrongPhone).toEqual(unknown);
    expect(junk).toEqual(unknown);
    expect(unknown).toMatchObject({ ok: false, code: 'NOT_FOUND' });
  });

  it('an older request priced at retail still shows its prices', async () => {
    const { repo } = setup();
    const view: QuoteRequestView = {
      id: 'x', reference: 'BQ-ABCDEF', source: 'bulk_builder', status: 'new', customerName: 'G', businessName: null, phone: PHONE, email: '',
      buyerType: 'retail', deliveryDistrict: null, neededBy: null, notes: '', productName: 'p', quantity: '3', requestFingerprint: null,
      lines: [{ lineNo: 1, productId: A, productCode: null, productName: 'p', unitKind: 'piece', unitCount: null, unitsPerCarton: null, quantity: 3, unitPriceUgx: 10_000, lineTotalUgx: 30_000, priceBasis: 'list', aboveSelfServe: false, availability: 'in_stock' }],
      totals: { lineCount: 1, totalUnits: 3, totalCartons: 0, estimatedTotalUgx: 30_000, pricedLineCount: 1 },
      budgetUgx: null, pricesShown: false, createdAt: new Date(), updatedAt: null,
    };
    repo.findByReference = async () => view;
    const hit = await new LookupBulkQuoteUseCase(repo).execute({ reference: 'BQ-ABCDEF', phone: '0772123456' });
    expect(hit.ok && hit.request.lines[0]).toMatchObject({ unitPriceUgx: 10_000, lineTotalUgx: 30_000, countLabel: '3 pieces' });
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
    repo.updateStatus = async () => false;
    repo.statuses.set(r.quoteId, 'quoted');
    expect(await update.execute({ id: r.quoteId, status: 'lost' })).toMatchObject({ ok: false, code: 'CONFLICT' });
  });
});

describe('CSV of lines', () => {
  it('has one row per line, in header order, with cartons, pieces and the price basis', async () => {
    const { repo, uc } = setup();
    await uc.execute({ ...valid(), budgetUgx: 20_000_000 });
    const rows = quoteLinesCsvRows(await repo.list());
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveLength(QUOTE_LINES_CSV_HEADER.length);
    const col = (name: (typeof QUOTE_LINES_CSV_HEADER)[number]) => rows[0][QUOTE_LINES_CSV_HEADER.indexOf(name)];
    expect(col('product_code')).toBe('GP-C08');
    expect(col('sold_by')).toBe('carton');
    expect(col('count')).toBe(12);
    expect(col('pieces')).toBe(600);
    expect(col('unit_price_ugx')).toBe(21_000);
    expect(col('price_basis')).toBe('dealer');
    expect(col('budget_ugx')).toBe(20_000_000);
    expect(QUOTE_LINES_CSV_HEADER.join(',')).not.toMatch(/cost|floor/);
  });
});

describe('acknowledgement text', () => {
  it('the SMS names the reference and the number of products, and is unchanged without a count', () => {
    expect(smsText('QUOTE_REQUEST_RECEIVED', { reference: 'BQ-7K3M9P', lineCount: 12 })).toContain('(ref BQ-7K3M9P) for 12 products.');
    expect(smsText('QUOTE_REQUEST_RECEIVED', { reference: 'BQ-7K3M9P', lineCount: 1 })).toContain('for 1 product.');
    expect(smsText('QUOTE_REQUEST_RECEIVED', { reference: 'X' })).toMatch(/quote request \(ref X\)\. Our sales team/);
    // A budget alone (no products) reads naturally.
    expect(smsText('QUOTE_REQUEST_RECEIVED', { reference: 'X', lineCount: 0 })).toMatch(/quote request \(ref X\)\. Our sales team/);
  });
});
