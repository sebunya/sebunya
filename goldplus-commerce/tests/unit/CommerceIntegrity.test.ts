import { describe, it, expect } from 'vitest';
import {
  checkOrderMoney,
  checkInventory,
  reconcileCommerce,
} from '../../apps/api/src/domain/commerce/CommerceIntegrity';

describe('checkOrderMoney', () => {
  it('passes a consistent order', () => {
    expect(checkOrderMoney({ orderId: 'o1', totalAmount: 110, subtotalAmount: 100, deliveryFee: 10, lineItemsSum: 100 })).toEqual([]);
  });
  it('flags total != subtotal + delivery', () => {
    const ex = checkOrderMoney({ orderId: 'o1', totalAmount: 999, subtotalAmount: 100, deliveryFee: 10, lineItemsSum: 100 });
    expect(ex.map((e) => e.type)).toContain('ORDER_TOTAL_MISMATCH');
  });
  it('flags subtotal != sum of line totals', () => {
    const ex = checkOrderMoney({ orderId: 'o1', totalAmount: 110, subtotalAmount: 100, deliveryFee: 10, lineItemsSum: 80 });
    expect(ex.map((e) => e.type)).toContain('ORDER_LINES_MISMATCH');
  });
});

describe('checkInventory', () => {
  it('passes a consistent product', () => {
    expect(checkInventory({ productId: 'p1', stockQuantity: 50, reservedQuantity: 10, ledgerReservedSum: 10 })).toEqual([]);
  });
  it('flags product reserved != ledger sum', () => {
    const ex = checkInventory({ productId: 'p1', stockQuantity: 50, reservedQuantity: 10, ledgerReservedSum: 7 });
    expect(ex.map((e) => e.type)).toContain('RESERVED_LEDGER_MISMATCH');
  });
  it('flags reserved exceeding stock (available would be negative)', () => {
    const ex = checkInventory({ productId: 'p1', stockQuantity: 5, reservedQuantity: 8, ledgerReservedSum: 8 });
    expect(ex.map((e) => e.type)).toContain('RESERVED_EXCEEDS_STOCK');
  });
});

describe('reconcileCommerce', () => {
  it('returns no exceptions when everything reconciles', () => {
    const out = reconcileCommerce({
      orders: [{ orderId: 'o1', totalAmount: 110, subtotalAmount: 100, deliveryFee: 10, lineItemsSum: 100 }],
      inventory: [{ productId: 'p1', stockQuantity: 50, reservedQuantity: 10, ledgerReservedSum: 10 }],
    });
    expect(out).toEqual([]);
  });
  it('surfaces every drift across orders and inventory', () => {
    const out = reconcileCommerce({
      orders: [{ orderId: 'o1', totalAmount: 999, subtotalAmount: 100, deliveryFee: 10, lineItemsSum: 100 }],
      inventory: [{ productId: 'p1', stockQuantity: 5, reservedQuantity: 8, ledgerReservedSum: 3 }],
    });
    expect(out.map((e) => e.type).sort()).toEqual(
      ['ORDER_TOTAL_MISMATCH', 'RESERVED_EXCEEDS_STOCK', 'RESERVED_LEDGER_MISMATCH'].sort(),
    );
  });
});
