import { describe, it, expect } from 'vitest';
import { calculateLineTotal, calculateSubtotal, validateQuantity, addOrUpdateCartItem, removeCartItem, parseLocalCartCookie, type CartItem } from '../../apps/web/src/lib/cart';

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

  it('removes only the target item', () => {
    const cart: CartItem[] = [
      sampleItem,
      { ...sampleItem, productId: 'prod_2', name: 'Other Item' }
    ];
    const updated = removeCartItem(cart, 'prod_1');
    expect(updated.length).toBe(1);
    expect(updated[0].productId).toBe('prod_2');
  });

  it('safely handles malformed cookie strings', () => {
    expect(parseLocalCartCookie(undefined)).toEqual([]);
    expect(parseLocalCartCookie('')).toEqual([]);
    expect(parseLocalCartCookie('not-json')).toEqual([]);
    expect(parseLocalCartCookie('{}')).toEqual([]); // Not an array

    const validJson = JSON.stringify([
      { productId: 'p1', name: 'Item 1', priceUgx: 5000, quantity: 2 }
    ]);
    const parsed = parseLocalCartCookie(validJson);
    expect(parsed.length).toBe(1);
    expect(parsed[0].productId).toBe('p1');
    expect(parsed[0].quantity).toBe(2);
  });
});
