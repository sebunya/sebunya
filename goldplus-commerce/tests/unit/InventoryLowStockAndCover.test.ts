import { describe, expect, it } from 'vitest';
import { daysOfCover, isLowStock, SALES_VELOCITY_WINDOW_DAYS } from '../../apps/api/src/domain/inventory/Inventory';

describe('derived low stock', () => {
  it('is low when available is at or below a positive reorder point', () => {
    expect(isLowStock({ stockOnHand: 10, reserved: 8, reorderPoint: 5 })).toBe(true);
    expect(isLowStock({ stockOnHand: 10, reserved: 5, reorderPoint: 5 })).toBe(true);
    expect(isLowStock({ stockOnHand: 100, reserved: 0, reorderPoint: 5 })).toBe(false);
  });

  it('is never low without a reorder point or for untracked (NON_STOCK_ITEM) products', () => {
    expect(isLowStock({ stockOnHand: 0, reserved: 0, reorderPoint: 0 })).toBe(false);
    expect(isLowStock({ stockOnHand: 0, reserved: 0, reorderPoint: 5, inventoryPolicy: 'NON_STOCK_ITEM' })).toBe(false);
    expect(isLowStock({ stockOnHand: 0, reserved: 0, reorderPoint: 5, inventoryPolicy: 'STOCK_CONTROLLED' })).toBe(true);
    expect(isLowStock({ stockOnHand: 0, reserved: 0, reorderPoint: 5, inventoryPolicy: null })).toBe(true);
  });
});

describe('days of cover', () => {
  it('divides available by average daily units over the 30-day window', () => {
    expect(SALES_VELOCITY_WINDOW_DAYS).toBe(30);
    // 60 units in 30 days = 2/day; 10 available -> 5 days.
    expect(daysOfCover(10, 60)).toBeCloseTo(5, 10);
    expect(daysOfCover(0, 60)).toBe(0);
  });

  it('is null (shown as a dash) when there is no sales history', () => {
    expect(daysOfCover(10, 0)).toBeNull();
    expect(daysOfCover(10, Number.NaN)).toBeNull();
  });
});
