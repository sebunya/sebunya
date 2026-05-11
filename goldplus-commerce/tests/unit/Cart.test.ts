import { describe, it, expect } from 'vitest';
import { calculateLineTotal, calculateSubtotal, validateQuantity, addOrUpdateCartItem, type CartItem } from '../../apps/web/src/lib/cart';

describe('Cart Business Logic', () => {
  const sampleItem: CartItem = {
    productId: 'prod_1',
    sku: 'SKU-001',
    name: 'Test Product',
    priceUgx: 10000,
    quantity: 2,
  };

  it('calculates line total correctly', () => {
    expect(calculateLineTotal(10000, 2)).toBe(20000);
    expect(calculateLineTotal(5000, 1)).toBe(5000);
    expect(calculateLineTotal(0, 5)).toBe(0);
    expect(calculateLineTotal(-1000, 1)).toBe(0); // Should handle negative price gracefully
  });

  it('calculates subtotal correctly', () => {
    const items: CartItem[] = [
      sampleItem, // 20000
      { ...sampleItem, productId: 'prod_2', priceUgx: 5000, quantity: 3 } // 15000
    ];
    expect(calculateSubtotal(items)).toBe(35000);
  });

  it('returns 0 for empty cart subtotal', () => {
    expect(calculateSubtotal([])).toBe(0);
  });

  it('validates quantity correctly', () => {
    expect(validateQuantity(5)).toBe(5);
    expect(validateQuantity(1)).toBe(1);
    expect(validateQuantity(0)).toBe(1); // Min is 1
    expect(validateQuantity(-5)).toBe(1);
  });

  it('adds new item to cart', () => {
    const cart: CartItem[] = [];
    const newCart = addOrUpdateCartItem(cart, sampleItem);
    expect(newCart.length).toBe(1);
    expect(newCart[0].productId).toBe('prod_1');
    expect(newCart[0].quantity).toBe(2);
  });

  it('updates quantity of existing item', () => {
    const cart: CartItem[] = [sampleItem];
    const newCart = addOrUpdateCartItem(cart, { ...sampleItem, quantity: 3 });
    expect(newCart.length).toBe(1);
    expect(newCart[0].quantity).toBe(5); // 2 + 3
  });
});
