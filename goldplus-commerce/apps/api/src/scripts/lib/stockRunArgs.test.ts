import { describe, expect, it } from 'vitest';
import { parseBatteryImportStage, parseStockQuantity, stockReason } from './stockRunArgs';

describe('parseBatteryImportStage', () => {
  it('maps the three stages and defaults to catalogue', () => {
    expect(parseBatteryImportStage(undefined)).toBe('BATTERY_CATALOGUE');
    expect(parseBatteryImportStage('price')).toBe('PRICE_UPDATE');
    expect(parseBatteryImportStage('stock')).toBe('STOCK_COUNT');
  });
  it('rejects a typo instead of running a price import', () => {
    for (const s of ['stocks', 'Stock', 'prices', '']) expect(() => parseBatteryImportStage(s)).toThrow(/STAGE/);
  });
});
describe('parseStockQuantity', () => {
  it('accepts whole numbers', () => {
    expect(parseStockQuantity(undefined)).toBe(200);
    expect(parseStockQuantity('0')).toBe(0);
    expect(parseStockQuantity('50')).toBe(50);
  });
  it('rejects anything else', () => {
    for (const q of ['abc', '1.5', '-1', '1e9']) expect(() => parseStockQuantity(q)).toThrow(/QUANTITY/);
  });
});
describe('stockReason', () => {
  it('states the quantity used, or the operator reason', () => {
    expect(stockReason(50, undefined)).toBe('Stock set to 50 units per product');
    expect(stockReason(50, ' Count 2026-11-01 ')).toBe('Count 2026-11-01');
  });
});
