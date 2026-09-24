import { describe, expect, it } from 'vitest';
import {
  CART_LINE_QUANTITY_CAP,
  MAX_BULK_LINE_QUANTITY,
  buildCodeIndex,
  clampQuantity,
  emptyState,
  estimate,
  idempotencyKeyFor,
  parsePaste,
  parseStoredState,
  removeLine,
  serializeState,
  setLine,
  splitForCart,
  splitPasteLine,
  submissionFingerprint,
  type CatalogueItem,
} from '../../apps/web/src/lib/bulkList';
import { toBulkRows } from '../../apps/web/src/lib/bulkCatalogue';
import { DEFAULT_TAXONOMY, type ProductPublicDto } from '../../packages/shared/src';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const D = '44444444-4444-4444-8444-444444444444';

const items: CatalogueItem[] = [
  { productId: A, name: 'Fast Charger 20W', code: 'GP-C08', sku: 'GP-C08', modelNumber: 'C08', unitPriceUgx: 25_000, inStock: true },
  { productId: B, name: 'USB-C Cable 1m', code: 'GP-CB1', sku: 'GP-CB1', modelNumber: null, unitPriceUgx: null, inStock: false },
  { productId: C, name: 'Power Bank', code: 'GP-PB2', sku: 'GP-PB2', modelNumber: 'X1', unitPriceUgx: 90_000, inStock: true },
  { productId: D, name: 'Car Holder', code: 'GP-H1', sku: 'GP-H1', modelNumber: 'X1', unitPriceUgx: 15_000, inStock: true },
];
const catalogue = new Map(items.map((i) => [i.productId, i]));
const index = buildCodeIndex(items);

describe('paste parsing', () => {
  it('reads the common shapes', () => {
    expect(splitPasteLine('GP-C08, 50')).toEqual({ code: 'GP-C08', quantity: '50' });
    expect(splitPasteLine('GP-C08 x50')).toEqual({ code: 'GP-C08', quantity: '50' });
    expect(splitPasteLine('GP-C08 X 50')).toEqual({ code: 'GP-C08', quantity: '50' });
    expect(splitPasteLine('GP-C08 × 50')).toEqual({ code: 'GP-C08', quantity: '50' });
    expect(splitPasteLine('GP-C08 50')).toEqual({ code: 'GP-C08', quantity: '50' });
    expect(splitPasteLine('GP-C08\t50')).toEqual({ code: 'GP-C08', quantity: '50' });
    expect(splitPasteLine('50 x GP-C08')).toEqual({ code: 'GP-C08', quantity: '50' });
    expect(splitPasteLine('GP-C08, 1,000 pcs')).toEqual({ code: 'GP-C08', quantity: '1,000' });
    expect(splitPasteLine('GP-C08')).toEqual({ code: 'GP-C08', quantity: '' });
  });

  it('matches codes ignoring case, spaces and dashes, sums repeats, and reports every miss', () => {
    const { matches, misses } = parsePaste(
      ['gp c08, 10', 'GP-C08 x5', '', 'GP-PB2 2', 'NOPE-1, 4', 'GP-CB1', 'GP-H1, 0', 'X1, 3', `GP-CB1, ${MAX_BULK_LINE_QUANTITY + 1}`, 'Power Bank, 1'].join('\n'),
      index,
    );
    expect(matches).toEqual([
      { productId: A, quantity: 15, source: 'gp c08, 10; GP-C08 x5' },
      { productId: C, quantity: 3, source: 'GP-PB2 2; Power Bank, 1' },
    ]);
    expect(misses).toEqual([
      { source: 'NOPE-1, 4', reason: 'NOT_FOUND' },
      { source: 'GP-CB1', reason: 'NO_QUANTITY' },
      { source: 'GP-H1, 0', reason: 'BAD_QUANTITY' },
      { source: 'X1, 3', reason: 'AMBIGUOUS' },
      { source: `GP-CB1, ${MAX_BULK_LINE_QUANTITY + 1}`, reason: 'BAD_QUANTITY' },
    ]);
  });

  it('matches a model number as well as a SKU', () => {
    expect(parsePaste('C08, 2', index).matches).toEqual([{ productId: A, quantity: 2, source: 'C08, 2' }]);
  });
});

describe('the saved list', () => {
  it('round-trips through storage and survives garbage', () => {
    let s = setLine(emptyState(), { productId: A, name: 'Fast Charger 20W', code: 'GP-C08' }, 12);
    s = setLine(s, { productId: B, name: 'USB-C Cable 1m', code: 'GP-CB1' }, 150);
    expect(parseStoredState(serializeState(s))).toEqual(s);
    for (const junk of [null, '', '{', '[]', '{"v":2,"lines":[]}', '{"v":1,"lines":"x"}']) {
      expect(parseStoredState(junk)).toEqual(emptyState());
    }
    const dirty = JSON.stringify({ v: 1, lines: [{ productId: 'nope', quantity: 1 }, { productId: A, quantity: -3 }, { productId: C, quantity: 7.9, name: 'P' }, { productId: C, quantity: 1 }], pending: { key: 'short', fingerprint: 'x' } });
    expect(parseStoredState(dirty)).toEqual({ v: 1, lines: [{ productId: C, quantity: 7, name: 'P', code: null }], pending: null });
  });

  it('sets, edits in place, removes and clamps', () => {
    let s = setLine(emptyState(), { productId: A, name: 'a', code: null }, 3);
    s = setLine(s, { productId: C, name: 'c', code: null }, 1);
    s = setLine(s, { productId: A, name: 'a', code: null }, 9);
    expect(s.lines.map((l) => [l.productId, l.quantity])).toEqual([[A, 9], [C, 1]]);
    s = setLine(s, { productId: A, name: 'a', code: null }, 0);
    expect(s.lines.map((l) => l.productId)).toEqual([C]);
    s = removeLine(s, C);
    expect(s.lines).toEqual([]);
    expect(clampQuantity('1,200')).toBe(1200);
    expect(clampQuantity(MAX_BULK_LINE_QUANTITY * 3)).toBe(MAX_BULK_LINE_QUANTITY);
    expect(clampQuantity('abc')).toBeNull();
  });

  it('estimates at list price, counting unpriced and no-longer-listed lines separately', () => {
    let s = setLine(emptyState(), { productId: A, name: 'a', code: null }, 4);
    s = setLine(s, { productId: B, name: 'b', code: null }, 10);
    s = setLine(s, { productId: '55555555-5555-4555-8555-555555555555', name: 'gone', code: null }, 2);
    expect(estimate(s, catalogue)).toEqual({ lineCount: 3, totalUnits: 16, estimatedTotalUgx: 100_000, unpricedLineCount: 1, unavailableLineCount: 1 });
  });

  it('sends only lines of 99 or fewer to the basket', () => {
    let s = setLine(emptyState(), { productId: A, name: 'a', code: null }, CART_LINE_QUANTITY_CAP);
    s = setLine(s, { productId: C, name: 'c', code: null }, CART_LINE_QUANTITY_CAP + 1);
    const { cartable, overCap } = splitForCart(s, catalogue);
    expect(cartable.map((l) => l.productId)).toEqual([A]);
    expect(overCap.map((l) => l.productId)).toEqual([C]);
  });
});

describe('idempotency key', () => {
  it('is reused for an unchanged submission and replaced when the list or phone changes', () => {
    let n = 0;
    const mint = () => `key_${String(++n).padStart(16, '0')}`;
    let s = setLine(emptyState(), { productId: A, name: 'a', code: null }, 4);
    const f1 = submissionFingerprint('0772 123 456', s.lines);
    const first = idempotencyKeyFor(s, f1, mint);
    s = first.state;
    expect(idempotencyKeyFor(s, submissionFingerprint('0772123456', s.lines), mint).key).toBe(first.key);
    s = setLine(s, { productId: A, name: 'a', code: null }, 5);
    expect(idempotencyKeyFor(s, submissionFingerprint('0772123456', s.lines), mint).key).not.toBe(first.key);
    expect(idempotencyKeyFor(first.state, submissionFingerprint('0772999999', first.state.lines), mint).key).not.toBe(first.key);
  });
});

describe('builder rows carry public facts only', () => {
  const dto = (over: Partial<ProductPublicDto>): ProductPublicDto => ({
    id: A, slug: 'fast-charger', name: 'Fast Charger 20W', categoryName: 'Power Devices', shortDescription: null, longDescription: null,
    sku: 'GP-C08', modelNumber: 'C08', retailPriceUgx: 25_000, floorPriceUgx: 19_000, availability: { kind: 'in_stock', quantity: 37 },
    hasImage: false, primaryImageUrl: null, verifiedSpecs: {}, hasMissingSpecs: false, images: [], attributeValues: [], ...over,
  });

  it('never carries a stock count, a floor, or any dealer or cost figure', () => {
    const [row] = toBulkRows([dto({})], DEFAULT_TAXONOMY);
    expect(row).toMatchObject({ productId: A, code: 'GP-C08', unitPriceUgx: 25_000, inStock: true, stockLabel: 'In stock' });
    const text = JSON.stringify(row);
    expect(text).not.toMatch(/37|19000|floor|dealer|cost|quantity/i);
  });

  it('labels stock honestly', () => {
    const rows = toBulkRows([
      dto({ id: B, slug: 'b', name: 'B', availability: { kind: 'out_of_stock' } }),
      dto({ id: C, slug: 'c', name: 'C', availability: { kind: 'unknown' } }),
    ], DEFAULT_TAXONOMY);
    expect(rows.map((r) => [r.inStock, r.stockLabel])).toEqual([[false, 'Out of stock'], [false, 'Ask us']]);
  });
});
