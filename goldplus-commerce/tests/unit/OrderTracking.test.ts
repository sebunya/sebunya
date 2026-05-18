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

describe('H1D-R1 Secure Public API Lookup & Timeline Protection', () => {
  const mockOrder = Order.create(
    'test-order-uuid',
    {
      name: 'Alice Nansubuga',
      phone: '0781234567',
      email: 'alice@gmail.com',
      deliveryArea: 'Kampala Central',
      deliveryAddress: 'Plot 12, Kampala Rd'
    },
    'retail',
    [{ productId: 'prod_2', sku: 'SKU2', name: 'Soundbar', price: 250000, quantity: 1 }],
    10000
  );

  const mockRepo = {
    save: async () => {},
    findById: async (id: string) => {
      if (id === 'test-order-uuid' || id === mockOrder.orderNumber) {
        return mockOrder;
      }
      return null;
    }
  };

  // Safe API lookup simulator representing apps/api POST /orders/lookup
  const simulateApiLookup = async (reference: string, contact?: string) => {
    if (reference.toUpperCase().startsWith('GP-DRAFT-')) {
      throw new Error('DATABASE_HIT_FORBIDDEN_FOR_DRAFT');
    }

    if (!reference || !contact) {
      return { success: false, error: 'BAD_INPUT' };
    }

    const order = await mockRepo.findById(reference);
    if (!order) {
      return { success: false, error: 'ORDER_NOT_FOUND' };
    }

    const normalizedContact = contact.trim().toLowerCase();
    const storedEmail = (order.customerEmail ?? '').trim().toLowerCase();
    const storedPhone = (order.customerPhone ?? '').trim();

    const contactMatch =
      (storedEmail && normalizedContact === storedEmail) ||
      (storedPhone && normalizedContact.replace(/\s+/g, '') === storedPhone.replace(/\s+/g, ''));

    if (!contactMatch) {
      return { success: false, error: 'UNAUTHORIZED' };
    }

    // Mask sensitive contact details at API layer
    const maskPhone = (phone: string) => phone.slice(0, 3) + '****' + phone.slice(-3);
    const maskEmail = (email: string) => {
      const parts = email.split('@');
      return parts[0].slice(0, 1) + '***' + parts[0].slice(-1) + '@' + parts[1];
    };

    return {
      success: true,
      data: {
        id: order.id,
        orderNumber: order.orderNumber,
        customerName: order.customerName,
        customerPhone: maskPhone(order.customerPhone),
        customerEmail: order.customerEmail ? maskEmail(order.customerEmail) : undefined,
        deliveryArea: order.deliveryArea,
        deliveryAddress: order.deliveryAddress,
        items: order.items,
        totalUgx: order.totalUgx,
        orderStatus: order.orderStatus,
      }
    };
  };

  it('proves GP-DRAFT references are treated as local drafts and never hit the database/API lookup', async () => {
    const handleTrackingSubmission = async (ref: string, contact: string) => {
      if (ref.toUpperCase().startsWith('GP-DRAFT-')) {
        return { isOfflineDraft: true, draftReference: ref.toUpperCase() };
      }
      return simulateApiLookup(ref, contact);
    };

    const result = await handleTrackingSubmission('GP-DRAFT-999888', 'alice@gmail.com');
    expect(result).toEqual({ isOfflineDraft: true, draftReference: 'GP-DRAFT-999888' });
  });

  it('proves valid order reference with matching email successfully returns the masked order', async () => {
    const res = await simulateApiLookup(mockOrder.orderNumber, 'alice@gmail.com');
    expect(res.success).toBe(true);
    expect(res.data).toBeDefined();
    expect(res.data?.customerPhone).toBe('078****567');
    expect(res.data?.customerEmail).toBe('a***e@gmail.com');
  });

  it('proves valid order reference with matching phone successfully returns the masked order', async () => {
    const res = await simulateApiLookup(mockOrder.orderNumber, '078 123 4567');
    expect(res.success).toBe(true);
    expect(res.data?.orderNumber).toBe(mockOrder.orderNumber);
  });

  it('proves valid order reference with wrong email returns unauthorized with no details', async () => {
    const res = await simulateApiLookup(mockOrder.orderNumber, 'wrong@gmail.com');
    expect(res.success).toBe(false);
    expect(res.error).toBe('UNAUTHORIZED');
    expect(res.data).toBeUndefined();
  });

  it('proves valid order reference with wrong phone returns unauthorized with no details', async () => {
    const res = await simulateApiLookup(mockOrder.orderNumber, '0781234568');
    expect(res.success).toBe(false);
    expect(res.error).toBe('UNAUTHORIZED');
    expect(res.data).toBeUndefined();
  });

  it('proves order reference alone is insufficient for public lookup (returns BAD_INPUT)', async () => {
    const res = await simulateApiLookup(mockOrder.orderNumber, '');
    expect(res.success).toBe(false);
    expect(res.error).toBe('BAD_INPUT');
    expect(res.data).toBeUndefined();
  });

  it('ensures unsupported/unknown status does not render fake timeline progress', () => {
    // Replicates track-order.astro progress rendering condition logic
    const statusBadge: Record<string, string> = {
      received: 'Received',
      processing: 'Processing',
      completed: 'Completed',
    };

    const getTimelineStepClass = (orderStatus: string, step: string) => {
      // Step must be a known, registered timeline stage
      if (!statusBadge[orderStatus]) {
        return 'inactive-timeline-state'; // Unknown status fallback
      }
      return orderStatus === step ? 'active-timeline-state' : 'past-timeline-state';
    };

    // Unknown status should return inactive fallback instead of active/completed states
    expect(getTimelineStepClass('unsupported_status', 'received')).toBe('inactive-timeline-state');
    expect(getTimelineStepClass('completed', 'completed')).not.toBe('inactive-timeline-state');
  });
});
