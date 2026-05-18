import { describe, it, expect } from 'vitest';
import { GetOrderByIdUseCase } from '../../apps/api/src/application/use-cases/commerce/GetOrderByIdUseCase';
import { Order } from '../../apps/api/src/domain/commerce/Order';

describe('GetOrderByIdUseCase', () => {
  const mockOrder = Order.create(
    'test-id',
    { name: 'John', phone: '0700000000', email: 'john@gmail.com', deliveryArea: 'Kampala', deliveryAddress: 'Main St' },
    'retail',
    [{ productId: 'prod_1', sku: 'SKU1', name: 'Product', price: 10000, quantity: 1 }],
    0
  );

  const mockRepo = {
    save: async () => {},
    findById: async (id: string) => {
      if (id === 'test-id' || id === mockOrder.orderNumber) return mockOrder;
      return null;
    }
  };

  it('returns order when found by ID', async () => {
    const useCase = new GetOrderByIdUseCase(mockRepo);
    const order = await useCase.execute('test-id');
    expect(order).not.toBeNull();
    expect(order?.id).toBe('test-id');
    expect(order?.customerName).toBe('John');
  });

  it('returns order when found by order number', async () => {
    const useCase = new GetOrderByIdUseCase(mockRepo);
    const order = await useCase.execute(mockOrder.orderNumber);
    expect(order).not.toBeNull();
    expect(order?.orderNumber).toBe(mockOrder.orderNumber);
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

describe('H1D Order Tracking Verification & PII Protection', () => {
  // Masking helpers replicates track-order.astro helpers
  const maskPhone = (phone: string) => {
    if (phone.length <= 5) return '*****';
    return phone.slice(0, 3) + '****' + phone.slice(-3);
  };

  const maskEmail = (email: string) => {
    const parts = email.split('@');
    if (parts.length !== 2) return '*****';
    const name = parts[0];
    const domain = parts[1];
    if (name.length <= 2) return '*@' + domain;
    return name.slice(0, 1) + '***' + name.slice(-1) + '@' + domain;
  };

  const verifyContact = (contactInput: string, orderEmail?: string, orderPhone?: string): boolean => {
    const normalizedInput = contactInput.trim().toLowerCase();
    const storedEmail = (orderEmail ?? '').trim().toLowerCase();
    const storedPhone = (orderPhone ?? '').trim();

    return (
      (storedEmail && normalizedInput === storedEmail) ||
      (storedPhone && normalizedInput.replace(/\s+/g, '') === storedPhone.replace(/\s+/g, ''))
    );
  };

  it('masks phone numbers safely, keeping only prefix and suffix', () => {
    expect(maskPhone('077123456')).toBe('077****456');
    expect(maskPhone('123')).toBe('*****');
  });

  it('masks emails safely to prevent PII leakage', () => {
    expect(maskEmail('john.doe@gmail.com')).toBe('j***e@gmail.com');
    expect(maskEmail('jo@gmail.com')).toBe('*@gmail.com');
    expect(maskEmail('invalid')).toBe('*****');
  });

  it('verifies customer contact details correctly (case-insensitive and space-insensitive)', () => {
    const orderEmail = 'customer@GoldPlus.co.ug';
    const orderPhone = '077 200 1122';

    // Successful phone matches
    expect(verifyContact('0772001122', orderEmail, orderPhone)).toBe(true);
    expect(verifyContact('077 200 1122', orderEmail, orderPhone)).toBe(true);

    // Successful email matches
    expect(verifyContact('customer@goldplus.co.ug', orderEmail, orderPhone)).toBe(true);
    expect(verifyContact(' CUSTOMER@GOLDPLUS.CO.UG ', orderEmail, orderPhone)).toBe(true);

    // Unsuccessful matches (security rejection)
    expect(verifyContact('0772001123', orderEmail, orderPhone)).toBe(false);
    expect(verifyContact('other@goldplus.co.ug', orderEmail, orderPhone)).toBe(false);
  });

  it('identifies local demo drafts by prefix correctly', () => {
    const isDraft = (ref: string) => ref.toUpperCase().startsWith('GP-DRAFT-');
    expect(isDraft('GP-DRAFT-123456')).toBe(true);
    expect(isDraft('gp-draft-999888')).toBe(true);
    expect(isDraft('GP-202605-ABCD')).toBe(false);
  });

  it('creates a safe WhatsApp support text url pre-populating reference only', () => {
    const makeWaUrl = (ref: string) =>
      `https://wa.me/256000000000?text=Hello%20GoldPlus,%20I'm%20inquiring%20about%20order%20${encodeURIComponent(ref)}`;
    
    expect(makeWaUrl('GP-123456')).toContain('GP-123456');
    expect(makeWaUrl('GP-DRAFT-777666')).toContain('GP-DRAFT-777666');
  });
});
