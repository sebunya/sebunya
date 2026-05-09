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
  test('Should create order with pending status', () => {
    const order = Order.create('o1', 'cust1', [
      { productId: 'p1', name: 'Item 1', price: 50000, quantity: 1 }
    ], { name: 'John Doe', email: 'john@example.com', phone: '0700123456' });

    expect(order.status).toBe('pending');
    expect(order.paymentStatus).toBe('unpaid');
    expect(order.total).toBe(50000);
  });

  test('Should handle payment success state', () => {
    const order = Order.create('o1', 'cust1', [], { name: 'J', email: 'j@e.com', phone: '1' });
    const paidOrder = order.markAsPaid();
    expect(paidOrder.status).toBe('paid');
    expect(paidOrder.paymentStatus).toBe('paid');
  });
});
