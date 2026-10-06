import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { priorLowestPrice, lastRestockedAt, firstPublishedAt, type MarketEvent } from '../../apps/api/src/domain/products/ProductMarketHistory';

const T0 = Date.parse('2026-10-06T00:00:00Z');
const day = (d: number) => new Date(T0 + d * 86_400_000);
const ev = (d: number, priceUgx: number, over: Partial<MarketEvent> = {}): MarketEvent =>
  ({ at: day(d), priceUgx, stockStatus: 'in_stock', published: true, changed: ['PRICE'], ...over });

describe('priorLowestPrice: the 30-day-lowest test', () => {
  it('a real drop: 450k for 40 days, then 400k', () => {
    expect(priorLowestPrice([ev(0, 450_000, { changed: ['BASELINE'] }), ev(40, 400_000)])).toBe(450_000);
  });

  it('raise-then-lower is caught: 450k, 500k for a week, back to 450k → the lowest before was 450k, not a drop', () => {
    expect(priorLowestPrice([ev(0, 450_000, { changed: ['BASELINE'] }), ev(40, 500_000), ev(47, 450_000)])).toBe(450_000);
  });

  it('a cheaper price inside the window counts', () => {
    expect(priorLowestPrice([ev(0, 450_000, { changed: ['BASELINE'] }), ev(35, 420_000), ev(45, 460_000), ev(50, 430_000)])).toBe(420_000);
  });

  it('nothing is claimed about the time before history starts', () => {
    // baseline 10 days before the change: the 30-day window is not covered
    expect(priorLowestPrice([ev(0, 450_000, { changed: ['BASELINE'] }), ev(10, 400_000)])).toBeNull();
  });

  it('no change ever recorded, or no history: null', () => {
    expect(priorLowestPrice([ev(0, 450_000, { changed: ['BASELINE'] }), ev(60, 450_000, { changed: ['STOCK'] })])).toBeNull();
    expect(priorLowestPrice([])).toBeNull();
  });

  it('a stock change after the price change does not move when the price took effect', () => {
    expect(priorLowestPrice([ev(0, 450_000, { changed: ['BASELINE'] }), ev(40, 400_000), ev(41, 400_000, { changed: ['STOCK'], stockStatus: 'low_stock' })])).toBe(450_000);
  });
});

describe('lastRestockedAt and firstPublishedAt', () => {
  it('finds the latest out-of-stock → in-stock moment', () => {
    const e = [ev(0, 1, { stockStatus: 'in_stock', changed: ['BASELINE'] }), ev(5, 1, { stockStatus: 'out_of_stock', changed: ['STOCK'] }), ev(9, 1, { stockStatus: 'low_stock', changed: ['STOCK'] })];
    expect(lastRestockedAt(e)).toEqual(day(9));
    expect(lastRestockedAt([ev(0, 1, { changed: ['BASELINE'] })])).toBeNull();
  });

  it('a product published at the baseline falls back to its creation time; a later publish is its own moment', () => {
    expect(firstPublishedAt([ev(0, 1, { changed: ['BASELINE'] })], day(-300))).toEqual(day(-300));
    expect(firstPublishedAt([ev(0, 1, { published: false, changed: ['BASELINE'] }), ev(12, 1, { changed: ['PUBLISHED'] })], day(-300))).toEqual(day(12));
    expect(firstPublishedAt([ev(0, 1, { published: false, changed: ['CREATED'] })], day(0))).toBeNull();
  });
});

describe('migration 0169 records history no code path can bypass', () => {
  const sql = readFileSync(join(__dirname, '../../apps/api/src/infrastructure/db/migrations/0169_product_market_events.sql'), 'utf8');
  it('a trigger on products, for every column a claim depends on', () => {
    expect(sql).toMatch(/AFTER INSERT OR UPDATE OF price_ugx, stock_status, approval_status, active ON products/);
    expect(sql).toMatch(/FOR EACH ROW EXECUTE FUNCTION record_product_market_event\(\)/);
  });
  it('records the PUBLIC price only, never dealer, cost or floor', () => {
    const code = sql.replace(/--.*$/gm, ''); // the comments explain the rule; the code must keep it
    expect(code).not.toMatch(/dealer|cost_price|floor_price/i);
    expect(code).toMatch(/NEW\.price_ugx/);
  });
  it('baselines every existing product once, and is registered in the journal', () => {
    expect(sql).toMatch(/ARRAY\['BASELINE'\][\s\S]*WHERE NOT EXISTS/);
    const journal = readFileSync(join(__dirname, '../../apps/api/src/infrastructure/db/migrations/meta/_journal.json'), 'utf8');
    expect(journal).toContain('"tag": "0169_product_market_events"');
  });
});
