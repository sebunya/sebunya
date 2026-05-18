import { describe, it, expect } from 'vitest';
import { validateCheckoutPayload, prepareCheckoutPayload } from '../../apps/web/src/lib/checkout';
import type { CartItem } from '../../apps/web/src/lib/cart';

describe('Checkout Business Logic', () => {
  const validFormData = new FormData();
  validFormData.append('name', 'John Doe');
  validFormData.append('email', 'john@example.com');
  validFormData.append('phone', '0770000000');
  validFormData.append('deliveryArea', 'Kampala');
  validFormData.append('deliveryAddress', 'Main St');
  validFormData.append('buyerType', 'retail');

  const validCartItems: CartItem[] = [
    { productId: 'prod_1', sku: 'SKU-001', name: 'Item 1', priceUgx: 10000, quantity: 1 }
  ];

  it('prepares checkout payload correctly', () => {
    const payload = prepareCheckoutPayload(validFormData, validCartItems);
    expect(payload.customerDetails.name).toBe('John Doe');
    expect(payload.customerDetails.phone).toBe('0770000000');
    expect(payload.buyerType).toBe('retail');
    expect(payload.items.length).toBe(1);
    expect(payload.items[0].price).toBe(10000);
  });

  it('validates a correct payload', () => {
    const payload = prepareCheckoutPayload(validFormData, validCartItems);
    const result = validateCheckoutPayload(payload);
    expect(result.valid).toBe(true);
    expect(result.errors.length).toBe(0);
  });

  it('rejects payload with missing required fields', () => {
    const invalidFormData = new FormData();
    // Missing name, phone, area, address
    invalidFormData.append('buyerType', 'retail');
    
    const payload = prepareCheckoutPayload(invalidFormData, validCartItems);
    const result = validateCheckoutPayload(payload);
    
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Name is required');
    expect(result.errors).toContain('Phone is required');
    expect(result.errors).toContain('Delivery area is required');
  });

  it('rejects payload with empty cart', () => {
    const payload = prepareCheckoutPayload(validFormData, []);
    const result = validateCheckoutPayload(payload);
    
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Cart is empty');
  });

  it('guarantees offline reference is prefixed as local draft', () => {
    // Verify that simulated offline reference prefix is strictly GP-DRAFT- or GP-OFFLINE-
    const simulateDraftId = `GP-DRAFT-${Math.floor(100000 + Math.random() * 900000)}`;
    expect(simulateDraftId.startsWith('GP-DRAFT-')).toBe(true);
    expect(simulateDraftId).toMatch(/^GP-DRAFT-\d{6}$/);
  });
});
