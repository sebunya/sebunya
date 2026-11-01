import { describe, expect, it } from 'vitest';
import {
  MAX_CARTONS_PER_LINE,
  MAX_PIECES_PER_LINE,
  SELF_SERVE_MAX_CARTONS,
  budgetStatus,
  buildCodeIndex,
  clampCount,
  countLabel,
  emptyState,
  estimate,
  idempotencyKeyFor,
  parseBudgetInput,
  parsePaste,
  parseStoredState,
  removeLine,
  serializeState,
  setBudget,
  setLine,
  splitPasteLine,
  submissionFingerprint,
  unitLabel,
  type CatalogueItem,
} from '../../apps/web/src/lib/bulkList';
import { toBulkRows } from '../../apps/web/src/lib/bulkCatalogue';
import { DEFAULT_TAXONOMY, type ProductPublicDto } from '../../packages/shared/src';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const D = '44444444-4444-4444-8444-444444444444';
const F = '66666666-6666-4666-8666-666666666666';

/** A: carton of 50 at 21,000 a piece. B: carton, size not entered. C: carton of 20, no bulk price. D: shares model X1 with C. F: flash drive by the piece. */
const items: CatalogueItem[] = [
  { productId: A, name: 'Fast Charger 20W', code: 'GP-C08', sku: 'GP-C08', modelNumber: 'C08', bulkUnit: 'carton', unitsPerCarton: 50, bulkPriceUgx: 21_000 },
  { productId: B, name: 'USB-C Cable 1m', code: 'GP-CB1', sku: 'GP-CB1', modelNumber: null, bulkUnit: 'carton', unitsPerCarton: null, bulkPriceUgx: 5_000 },
  { productId: C, name: 'Power Bank', code: 'GP-PB2', sku: 'GP-PB2', modelNumber: 'X1', bulkUnit: 'carton', unitsPerCarton: 20, bulkPriceUgx: null },
  { productId: D, name: 'Car Holder', code: 'GP-H1', sku: 'GP-H1', modelNumber: 'X1', bulkUnit: 'carton', unitsPerCarton: 40, bulkPriceUgx: 9_000 },
  { productId: F, name: 'Flash Drive 16GB', code: 'GP-16GB-F', sku: 'GP-16GB-F', modelNumber: null, bulkUnit: 'piece', unitsPerCarton: null, bulkPriceUgx: 9_500 },
];
const catalogue = new Map(items.map((i) => [i.productId, i]));
const units = new Map(items.map((i) => [i.productId, i.bulkUnit] as const));
const index = buildCodeIndex(items);
const byId = (id: string) => catalogue.get(id)!;

describe('paste parsing', () => {
  it('reads the common shapes, with carton words as well as piece words', () => {
    expect(splitPasteLine('GP-C08, 5')).toEqual({ code: 'GP-C08', quantity: '5' });
    expect(splitPasteLine('GP-C08 x5')).toEqual({ code: 'GP-C08', quantity: '5' });
    expect(splitPasteLine('GP-C08 × 5')).toEqual({ code: 'GP-C08', quantity: '5' });
    expect(splitPasteLine('GP-C08\t5')).toEqual({ code: 'GP-C08', quantity: '5' });
    expect(splitPasteLine('5 x GP-C08')).toEqual({ code: 'GP-C08', quantity: '5' });
    expect(splitPasteLine('GP-C08, 12 ctns')).toEqual({ code: 'GP-C08', quantity: '12' });
    expect(splitPasteLine('GP-C08 3 cartons')).toEqual({ code: 'GP-C08', quantity: '3' });
    expect(splitPasteLine('GP-16GB-F, 1,000 pcs')).toEqual({ code: 'GP-16GB-F', quantity: '1,000' });
    expect(splitPasteLine('GP-C08')).toEqual({ code: 'GP-C08', quantity: '' });
  });

  it('reads the number in each product\'s unit, sums repeats, and reports every miss', () => {
    const { matches, misses } = parsePaste(
      ['gp c08, 10', 'GP-C08 x5', '', 'NOPE-1, 4', 'GP-CB1', 'GP-H1, 0', 'X1, 3', `GP-H1, ${MAX_CARTONS_PER_LINE + 1}`, 'GP-16GB-F, 20000'].join('\n'),
      index,
      units,
    );
    expect(matches).toEqual([
      { productId: A, count: 15, source: 'gp c08, 10; GP-C08 x5' },
      { productId: F, count: 20_000, source: 'GP-16GB-F, 20000' },
    ]);
    expect(misses).toEqual([
      { source: 'NOPE-1, 4', reason: 'NOT_FOUND' },
      { source: 'GP-CB1', reason: 'NO_QUANTITY' },
      { source: 'GP-H1, 0', reason: 'BAD_QUANTITY' },
      { source: 'X1, 3', reason: 'AMBIGUOUS' },
      { source: `GP-H1, ${MAX_CARTONS_PER_LINE + 1}`, reason: 'BAD_QUANTITY' },
    ]);
  });
});

describe('the saved list', () => {
  it('round-trips through storage, budget included, and survives garbage', () => {
    let s = setLine(emptyState(), byId(A), 12);
    s = setLine(s, byId(F), 150);
    s = setBudget(s, '5,000,000');
    expect(parseStoredState(serializeState(s))).toEqual(s);
    for (const junk of [null, '', '{', '[]', '{"v":2,"lines":"x"}']) {
      expect(parseStoredState(junk)).toEqual(emptyState());
    }
  });

  it('starts again from a v1 list, whose numbers were pieces and cannot be read as cartons', () => {
    expect(parseStoredState(JSON.stringify({ v: 1, lines: [{ productId: A, quantity: 50, name: 'a', code: null }], pending: null }))).toEqual(emptyState());
  });

  it('sets, edits in place, removes and clamps by unit', () => {
    let s = setLine(emptyState(), byId(A), 3);
    s = setLine(s, byId(C), 1);
    s = setLine(s, byId(A), 9);
    expect(s.lines.map((l) => [l.productId, l.count])).toEqual([[A, 9], [C, 1]]);
    s = setLine(s, byId(A), 0);
    expect(s.lines.map((l) => l.productId)).toEqual([C]);
    s = removeLine(s, C);
    expect(s.lines).toEqual([]);
    expect(clampCount('1,200', 'carton')).toBe(1200);
    expect(clampCount(MAX_CARTONS_PER_LINE * 3, 'carton')).toBe(MAX_CARTONS_PER_LINE);
    expect(clampCount(MAX_PIECES_PER_LINE * 3, 'piece')).toBe(MAX_PIECES_PER_LINE);
    expect(clampCount('abc')).toBeNull();
  });

  it('describes counts the way a buyer says them', () => {
    expect(countLabel(byId(A), 12)).toBe('12 cartons (600 pieces)');
    expect(countLabel(byId(A), 1)).toBe('1 carton (50 pieces)');
    expect(countLabel(byId(B), 3)).toBe('3 cartons (size to confirm)');
    expect(countLabel(byId(F), 40)).toBe('40 pieces');
    expect(unitLabel(byId(A))).toBe('Carton of 50 pieces');
    expect(unitLabel(byId(B))).toBe('Carton, size to confirm');
    expect(unitLabel(byId(F))).toBe('Sold by the piece');
  });
});

describe('the total at bulk price', () => {
  it('prices pieces, counts what the team must price, and flags over 500 cartons', () => {
    let s = setLine(emptyState(), byId(A), 2); // 100 pieces x 21,000
    s = setLine(s, byId(B), 3); // no carton size: unpriced
    s = setLine(s, byId(C), SELF_SERVE_MAX_CARTONS + 1); // no bulk price: unpriced, over 500
    s = setLine(s, byId(F), 10); // 10 pieces x 9,500
    s = setLine(s, { productId: '55555555-5555-4555-8555-555555555555', name: 'gone', code: null, bulkUnit: 'carton' }, 2);
    expect(estimate(s, catalogue)).toEqual({
      lineCount: 5,
      totalCartons: 2 + 3 + SELF_SERVE_MAX_CARTONS + 1,
      totalPieces: 100 + (SELF_SERVE_MAX_CARTONS + 1) * 20 + 10,
      piecesUnknownLineCount: 1,
      estimatedTotalUgx: 2_100_000 + 95_000,
      unpricedLineCount: 2,
      unavailableLineCount: 1,
      aboveSelfServeCount: 1,
    });
  });

  it('measures a budget only once prices are unlocked', () => {
    const s = setLine(emptyState(), byId(A), 2);
    const est = estimate(s, catalogue);
    expect(budgetStatus(null, est, true)).toEqual({ kind: 'none' });
    expect(budgetStatus(3_000_000, est, false)).toEqual({ kind: 'unmeasured', budgetUgx: 3_000_000 });
    expect(budgetStatus(3_000_000, est, true)).toEqual({ kind: 'within', budgetUgx: 3_000_000, usedUgx: 2_100_000, remainingUgx: 900_000 });
    expect(budgetStatus(2_000_000, est, true)).toMatchObject({ kind: 'over', remainingUgx: -100_000 });
  });

  it('reads a budget the way people type it, within bounds', () => {
    expect(parseBudgetInput('UGX 5,000,000')).toBe(5_000_000);
    expect(parseBudgetInput('5 000 000')).toBe(5_000_000);
    expect(parseBudgetInput('500')).toBeNull();
    expect(parseBudgetInput('five million')).toBeNull();
  });
});

describe('idempotency key', () => {
  it('is reused for an unchanged submission and replaced when the list, budget or phone changes', () => {
    let n = 0;
    const mint = () => `key_${String(++n).padStart(16, '0')}`;
    let s = setLine(emptyState(), byId(A), 4);
    const first = idempotencyKeyFor(s, submissionFingerprint('0772 123 456', s.lines, null), mint);
    s = first.state;
    expect(idempotencyKeyFor(s, submissionFingerprint('0772123456', s.lines, null), mint).key).toBe(first.key);
    expect(idempotencyKeyFor(s, submissionFingerprint('0772123456', s.lines, 1_000_000), mint).key).not.toBe(first.key);
    s = setLine(s, byId(A), 5);
    expect(idempotencyKeyFor(s, submissionFingerprint('0772123456', s.lines, null), mint).key).not.toBe(first.key);
  });
});

describe('page rows', () => {
  const dto = (over: Partial<ProductPublicDto>): ProductPublicDto => ({
    id: A, slug: 'fast-charger', name: 'Fast Charger 20W', categoryName: 'Power Devices', shortDescription: null, longDescription: null,
    sku: 'GP-C08', modelNumber: 'C08', retailPriceUgx: 25_000, floorPriceUgx: 19_000, availability: { kind: 'in_stock', quantity: 37 },
    hasImage: false, primaryImageUrl: null, verifiedSpecs: {}, hasMissingSpecs: false, images: [], attributeValues: [], ...over,
  });

  it('carry the carton terms and no stock, retail, floor or cost figure', () => {
    const [row] = toBulkRows([dto({})], DEFAULT_TAXONOMY, new Map([[A, { productId: A, bulkUnit: 'carton', unitsPerCarton: 50 }]]));
    expect(row).toMatchObject({ productId: A, code: 'GP-C08', bulkUnit: 'carton', unitsPerCarton: 50, bulkPriceUgx: null });
    const text = JSON.stringify(row);
    expect(text).not.toMatch(/37|19000|25000|floor|cost|stock|quantity/i);
  });

  it('carry the bulk price only when the API gave one (a verified phone)', () => {
    const [row] = toBulkRows([dto({})], DEFAULT_TAXONOMY, new Map([[A, { productId: A, bulkUnit: 'carton', unitsPerCarton: 50, bulkPriceUgx: 21_000 }]]));
    expect(row.bulkPriceUgx).toBe(21_000);
  });

  it('default to a carton of unknown size when terms are missing', () => {
    const [row] = toBulkRows([dto({})], DEFAULT_TAXONOMY);
    expect(row).toMatchObject({ bulkUnit: 'carton', unitsPerCarton: null, bulkPriceUgx: null });
  });
});
