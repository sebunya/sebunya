import { describe, it, expect } from 'vitest';
import { GetOrderByIdUseCase } from '../../apps/api/src/application/use-cases/commerce/GetOrderByIdUseCase';
import { Order } from '../../apps/api/src/domain/commerce/Order';

describe('GetOrderByIdUseCase', () => {
  const mockOrder = Order.create(
    'test-id',
    { name: 'John', phone: '0700000000', deliveryArea: 'Kampala', deliveryAddress: 'Main St' },
    'retail',
    [{ productId: 'prod_1', sku: 'SKU1', name: 'Product', price: 10000, quantity: 1 }],
    0
  );

  const mockRepo = {
    save: async () => {},
    findById: async (id: string) => {
      if (id === 'test-id') return mockOrder;
      return null;
    }
  };

  it('returns order when found', async () => {
    const useCase = new GetOrderByIdUseCase(mockRepo);
    const order = await useCase.execute('test-id');
    expect(order).not.toBeNull();
    expect(order?.id).toBe('test-id');
    expect(order?.customerName).toBe('John');
  });

  it('returns null when order not found', async () => {
    const useCase = new GetOrderByIdUseCase(mockRepo);
    const order = await useCase.execute('invalid-id');
    expect(order).toBeNull();
  });

  it('throws error when order ID is empty', async () => {
    const useCase = new GetOrderByIdUseCase(mockRepo);
    await expect(useCase.execute('')).rejects.toThrow('Order ID is required');
  });
});
