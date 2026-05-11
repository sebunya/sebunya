import { expect, test, describe } from 'vitest';
import { Cart } from '../../apps/api/src/domain/commerce/Cart';
import { Order } from '../../apps/api/src/domain/commerce/Order';

describe('Cart Domain Entity', () => {
  test('Should calculate total correctly', () => {
    const cart = new Cart('c1', [
      { productId: 'p1', name: 'Item 1', price: 50000, quantity: 2 },
      { productId: 'p2', name: 'Item 2', price: 80000, quantity: 1 }
    ]);
    expect(cart.getTotal()).toBe(180000);
  });

  test('Should add items correctly', () => {
    let cart = new Cart('c1', []);
    cart = cart.addItem({ productId: 'p1', name: 'Item 1', price: 50000, quantity: 1 });
    expect(cart.items.length).toBe(1);
    expect(cart.items[0].quantity).toBe(1);

    cart = cart.addItem({ productId: 'p1', name: 'Item 1', price: 50000, quantity: 2 });
    expect(cart.items.length).toBe(1);
    expect(cart.items[0].quantity).toBe(3);
  });
});

describe('Order Domain Entity', () => {
  test('Should create order with received status for retail', () => {
    const order = Order.create('o1', { 
      name: 'John Doe', email: 'john@example.com', phone: '0700123456', 
      deliveryArea: 'Kampala', deliveryAddress: 'Plot 1' 
    }, 'retail', [
      { productId: 'p1', sku: 'SKU1', name: 'Item 1', price: 50000, quantity: 1 }
    ]);

    expect(order.orderStatus).toBe('received');
    expect(order.paymentStatus).toBe('unpaid');
    expect(order.totalUgx).toBe(50000);
  });

  test('Should set owner review status for wholesale', () => {
    const order = Order.create('o2', {
      name: 'Dealer 1', phone: '0700999999', deliveryArea: 'Gulu', deliveryAddress: 'Plot 2'
    }, 'wholesale', [
      { productId: 'p1', sku: 'SKU1', name: 'Item 1', price: 50000, quantity: 10 }
    ]);

    expect(order.orderStatus).toBe('pending_owner_review');
  });

  test('Should handle status transitions', () => {
    const order = Order.create('o3', {
      name: 'J', phone: '1', deliveryArea: 'Kla', deliveryAddress: 'Adr'
    }, 'retail', [], 0);
    const updated = order.transitionStatus('completed');
    expect(updated.orderStatus).toBe('completed');
  });
});
