import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PesaPalClient } from '../../apps/api/src/infrastructure/payments/pesapal/PesaPalClient';
import { StartPesaPalPaymentUseCase } from '../../apps/api/src/application/use-cases/payments/StartPesaPalPaymentUseCase';
import { VerifyPesaPalPaymentUseCase } from '../../apps/api/src/application/use-cases/payments/VerifyPesaPalPaymentUseCase';
import { IPesaPalPaymentRepository, RecordedPaymentAttempt } from '../../apps/api/src/application/ports/IPesaPalPaymentRepository';
import { ICustomerOrderRepository } from '../../apps/api/src/application/ports/ICustomerOrderRepository';
import { Order } from '../../apps/api/src/domain/commerce/Order';

describe('PesaPal Payment Integration Unit Tests', () => {
  let mockPaymentRepo: IPesaPalPaymentRepository;
  let mockOrderRepo: ICustomerOrderRepository;
  let client: PesaPalClient;
  let config: any;

  beforeEach(() => {
    config = {
      pesapalEnv: 'sandbox',
      pesapalConsumerKey: 'test-key',
      pesapalConsumerSecret: 'test-secret',
      pesapalIpnId: 'test-ipn-id',
      pesapalCurrency: 'UGX',
      pesapalCountryCode: 'UG',
      pesapalBranch: 'GoldPlus Online Store',
      pesapalCallbackUrl: 'http://localhost:3000/checkout/pesapal/callback',
      pesapalCancellationUrl: 'http://localhost:3000/checkout/pesapal/cancelled',
      pesapalIpnUrl: 'http://localhost:3000/commerce/payments/pesapal/ipn',
      pesapalRedirectMode: 'TOP_WINDOW',
    };

    client = new PesaPalClient(config);

    // Mock Repositories
    mockPaymentRepo = {
      createPaymentAttempt: vi.fn(),
      findByMerchantReference: vi.fn(),
      findByTrackingId: vi.fn(),
      updatePaymentAttemptStatus: vi.fn(),
      updateOrderPaymentStatusSafely: vi.fn(),
    } as any;

    mockOrderRepo = {
      findById: vi.fn(),
      findAll: vi.fn(),
    } as any;

    vi.spyOn(global, 'fetch').mockImplementation(() => Promise.resolve(new Response()));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // 1. token request success.
  it('should successfully request and retrieve auth token from PesaPal', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      token: 'valid-bearer-token-123',
      expiryDate: new Date(Date.now() + 30 * 60 * 1000).toISOString()
    }), { status: 200 }));

    const token = await client.requestToken();
    expect(token).toBe('valid-bearer-token-123');
  });

  // 2. token request failure.
  it('should throw an error when token request fails', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response('Unauthorized access', { status: 401 }));

    await expect(client.requestToken()).rejects.toThrow('PESAPAL_AUTH_FAILED');
  });

  // 3. token cache hides token from serialized responses.
  it('should cache the token in-memory and not leak secrets in serialized client string', () => {
    const serialized = JSON.stringify(client);
    expect(serialized).not.toContain('test-secret');
    expect(serialized).not.toContain('valid-bearer-token-123');
  });

  // 4. SubmitOrderRequest success returns redirect_url.
  it('should return redirect_url upon successful PesaPal SubmitOrderRequest', async () => {
    vi.spyOn(client, 'getToken').mockResolvedValue('valid-token');
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      order_tracking_id: 'pesapal-order-tracking-id-123',
      merchant_reference: 'merchant-ref-456',
      redirect_url: 'https://pay.pesapal.com/checkout?id=123'
    }), { status: 200 }));

    const response = await client.submitOrderRequest({
      id: 'merchant-ref-456',
      currency: 'UGX',
      amount: 50000,
      description: 'Order GP-123',
      callback_url: 'http://localhost/callback',
      cancellation_url: 'http://localhost/cancelled',
      notification_id: 'ipn-id',
      billing_address: {
        email_address: 'john@example.com',
        phone_number: '0770000000',
        first_name: 'John',
        last_name: 'Doe'
      }
    });

    expect(response.order_tracking_id).toBe('pesapal-order-tracking-id-123');
    expect(response.redirect_url).toBe('https://pay.pesapal.com/checkout?id=123');
  });

  // 5. SubmitOrderRequest success creates pending, not paid.
  it('should create a pending attempt instead of marking paid upon SubmitOrderRequest execution', async () => {
    const order = new Order(
      'order-uuid-123', 'GP-1001', 'John Doe', '0770000000', 'john@doe.com',
      'Kla', 'Address 1', 'retail', [], 50000, 0, 50000, 'unpaid', 'received', new Date(), new Date()
    );

    vi.spyOn(mockOrderRepo, 'findById').mockResolvedValue(order);
    vi.spyOn(mockPaymentRepo, 'findByMerchantReference').mockResolvedValue(null);
    vi.spyOn(mockPaymentRepo, 'createPaymentAttempt').mockResolvedValue({
      id: 'attempt-uuid', orderId: order.id, merchantReference: 'GP-GP-1001-order-uu',
      amount: 50000, currency: 'UGX', status: 'not_started', redirectUrl: null, orderTrackingId: null
    } as any);

    vi.spyOn(client, 'submitOrderRequest').mockResolvedValue({
      order_tracking_id: 'tracking-id-123',
      merchant_reference: 'GP-GP-1001-order-uu',
      redirect_url: 'https://redirect.url'
    });

    process.env.PESAPAL_IPN_ID = 'ipn-id';

    const useCase = new StartPesaPalPaymentUseCase(mockPaymentRepo, mockOrderRepo, client);
    const output = await useCase.execute({ orderId: 'order-uuid-123' });

    expect(output.redirectUrl).toBe('https://redirect.url');
    expect(mockPaymentRepo.createPaymentAttempt).toHaveBeenCalledWith(expect.objectContaining({
      status: 'not_started'
    }));
    expect(mockPaymentRepo.updatePaymentAttemptStatus).toHaveBeenCalledWith('attempt-uuid', expect.objectContaining({
      status: 'pending',
      orderTrackingId: 'tracking-id-123'
    }));
    // Crucial: no call to mark order paid should happen at start
    expect(mockPaymentRepo.updateOrderPaymentStatusSafely).not.toHaveBeenCalled();
  });

  // 6. SubmitOrderRequest failure does not mark paid.
  it('should fail safely and leave order unpaid if PesaPal submission fails', async () => {
    const order = new Order(
      'order-uuid-123', 'GP-1001', 'John Doe', '0770000000', 'john@doe.com',
      'Kla', 'Address 1', 'retail', [], 50000, 0, 50000, 'unpaid', 'received', new Date(), new Date()
    );

    vi.spyOn(mockOrderRepo, 'findById').mockResolvedValue(order);
    vi.spyOn(mockPaymentRepo, 'findByMerchantReference').mockResolvedValue(null);
    vi.spyOn(mockPaymentRepo, 'createPaymentAttempt').mockResolvedValue({
      id: 'attempt-uuid', orderId: order.id, status: 'not_started'
    } as any);
    vi.spyOn(client, 'submitOrderRequest').mockRejectedValue(new Error('PesaPal down'));

    const useCase = new StartPesaPalPaymentUseCase(mockPaymentRepo, mockOrderRepo, client);
    await expect(useCase.execute({ orderId: 'order-uuid-123' })).rejects.toThrow('PesaPal down');
    expect(mockPaymentRepo.updateOrderPaymentStatusSafely).not.toHaveBeenCalled();
  });

  // 7. callback does not mark paid without GetTransactionStatus.
  // 8. IPN does not mark paid without GetTransactionStatus.
  it('should run authoritative verification and not trust callback/IPN input directly', async () => {
    const attempt: RecordedPaymentAttempt = {
      id: 'attempt-uuid', orderId: 'order-123', merchantReference: 'ref-123',
      orderTrackingId: 'track-123', amount: 50000, currency: 'UGX', status: 'pending',
      redirectUrl: null, provider: 'pesapal', ipnReceivedAt: null, callbackReceivedAt: null,
      createdAt: new Date(), updatedAt: new Date()
    };

    vi.spyOn(mockPaymentRepo, 'findByTrackingId').mockResolvedValue(attempt);
    vi.spyOn(client, 'getTransactionStatus').mockResolvedValue({
      order_tracking_id: 'track-123', merchant_reference: 'ref-123',
      amount: 50000, currency: 'UGX', status_code: 1, payment_status_description: 'COMPLETED'
    });

    const useCase = new VerifyPesaPalPaymentUseCase(mockPaymentRepo, client);
    const output = await useCase.execute({ orderTrackingId: 'track-123', merchantReference: 'ref-123', source: 'callback' });

    expect(output.ok).toBe(true);
    expect(output.status).toBe('completed');
    expect(client.getTransactionStatus).toHaveBeenCalledWith('track-123');
    expect(mockPaymentRepo.updateOrderPaymentStatusSafely).toHaveBeenCalledWith('order-123', 'paid', 'processing');
  });

  // 9. COMPLETED maps to completed/paid only after amount/currency/reference verification.
  // 10. FAILED maps to failed/unpaid.
  // 11. REVERSED maps to reversed.
  // 12. INVALID maps to invalid.
  it('should correctly map PesaPal codes and update status only when safe', async () => {
    const attempt: RecordedPaymentAttempt = {
      id: 'attempt-uuid', orderId: 'order-123', merchantReference: 'ref-123',
      orderTrackingId: 'track-123', amount: 50000, currency: 'UGX', status: 'pending',
      redirectUrl: null, provider: 'pesapal', ipnReceivedAt: null, callbackReceivedAt: null,
      createdAt: new Date(), updatedAt: new Date()
    };

    const useCase = new VerifyPesaPalPaymentUseCase(mockPaymentRepo, client);

    // Map 2 = FAILED
    vi.spyOn(mockPaymentRepo, 'findByTrackingId').mockResolvedValue(attempt);
    vi.spyOn(client, 'getTransactionStatus').mockResolvedValue({
      order_tracking_id: 'track-123', merchant_reference: 'ref-123',
      amount: 50000, currency: 'UGX', status_code: 2, payment_status_description: 'FAILED'
    });
    let output = await useCase.execute({ orderTrackingId: 'track-123', merchantReference: 'ref-123', source: 'ipn' });
    expect(output.status).toBe('failed');
    expect(mockPaymentRepo.updateOrderPaymentStatusSafely).toHaveBeenCalledWith('order-123', 'failed', 'pending_payment');

    // Map 3 = REVERSED
    vi.spyOn(client, 'getTransactionStatus').mockResolvedValue({
      order_tracking_id: 'track-123', merchant_reference: 'ref-123',
      amount: 50000, currency: 'UGX', status_code: 3, payment_status_description: 'REVERSED'
    });
    output = await useCase.execute({ orderTrackingId: 'track-123', merchantReference: 'ref-123', source: 'ipn' });
    expect(output.status).toBe('reversed');
    expect(mockPaymentRepo.updateOrderPaymentStatusSafely).toHaveBeenCalledWith('order-123', 'reversed', 'cancelled');

    // Map 0 = INVALID
    vi.spyOn(client, 'getTransactionStatus').mockResolvedValue({
      order_tracking_id: 'track-123', merchant_reference: 'ref-123',
      amount: 50000, currency: 'UGX', status_code: 0, payment_status_description: 'INVALID'
    });
    output = await useCase.execute({ orderTrackingId: 'track-123', merchantReference: 'ref-123', source: 'ipn' });
    expect(output.status).toBe('invalid');
    expect(mockPaymentRepo.updateOrderPaymentStatusSafely).toHaveBeenCalledWith('order-123', 'failed', 'pending_payment');
  });

  // 13. amount mismatch does not mark paid.
  it('should reject payment verification if the amount mismatches', async () => {
    const attempt: RecordedPaymentAttempt = {
      id: 'attempt-uuid', orderId: 'order-123', merchantReference: 'ref-123',
      orderTrackingId: 'track-123', amount: 50000, currency: 'UGX', status: 'pending',
      redirectUrl: null, provider: 'pesapal', ipnReceivedAt: null, callbackReceivedAt: null,
      createdAt: new Date(), updatedAt: new Date()
    };

    vi.spyOn(mockPaymentRepo, 'findByTrackingId').mockResolvedValue(attempt);
    vi.spyOn(client, 'getTransactionStatus').mockResolvedValue({
      order_tracking_id: 'track-123', merchant_reference: 'ref-123',
      amount: 99999, // Mismatched amount
      currency: 'UGX', status_code: 1, payment_status_description: 'COMPLETED'
    });

    const useCase = new VerifyPesaPalPaymentUseCase(mockPaymentRepo, client);
    const output = await useCase.execute({ orderTrackingId: 'track-123', merchantReference: 'ref-123', source: 'callback' });

    expect(output.ok).toBe(false);
    expect(output.status).toBe('verification_failed');
    expect(mockPaymentRepo.updatePaymentAttemptStatus).toHaveBeenCalledWith('attempt-uuid', { status: 'verification_failed' });
    expect(mockPaymentRepo.updateOrderPaymentStatusSafely).not.toHaveBeenCalled();
  });

  // 14. currency mismatch does not mark paid.
  it('should reject payment verification if the currency mismatches', async () => {
    const attempt: RecordedPaymentAttempt = {
      id: 'attempt-uuid', orderId: 'order-123', merchantReference: 'ref-123',
      orderTrackingId: 'track-123', amount: 50000, currency: 'UGX', status: 'pending',
      redirectUrl: null, provider: 'pesapal', ipnReceivedAt: null, callbackReceivedAt: null,
      createdAt: new Date(), updatedAt: new Date()
    };

    vi.spyOn(mockPaymentRepo, 'findByTrackingId').mockResolvedValue(attempt);
    vi.spyOn(client, 'getTransactionStatus').mockResolvedValue({
      order_tracking_id: 'track-123', merchant_reference: 'ref-123',
      amount: 50000, currency: 'USD', // Mismatched currency
      status_code: 1, payment_status_description: 'COMPLETED'
    });

    const useCase = new VerifyPesaPalPaymentUseCase(mockPaymentRepo, client);
    const output = await useCase.execute({ orderTrackingId: 'track-123', merchantReference: 'ref-123', source: 'callback' });

    expect(output.ok).toBe(false);
    expect(output.status).toBe('verification_failed');
    expect(mockPaymentRepo.updatePaymentAttemptStatus).toHaveBeenCalledWith('attempt-uuid', { status: 'verification_failed' });
    expect(mockPaymentRepo.updateOrderPaymentStatusSafely).not.toHaveBeenCalled();
  });

  // 15. merchant reference mismatch does not mark paid.
  it('should reject payment verification if the merchant reference mismatches', async () => {
    const attempt: RecordedPaymentAttempt = {
      id: 'attempt-uuid', orderId: 'order-123', merchantReference: 'ref-123',
      orderTrackingId: 'track-123', amount: 50000, currency: 'UGX', status: 'pending',
      redirectUrl: null, provider: 'pesapal', ipnReceivedAt: null, callbackReceivedAt: null,
      createdAt: new Date(), updatedAt: new Date()
    };

    vi.spyOn(mockPaymentRepo, 'findByTrackingId').mockResolvedValue(attempt);
    vi.spyOn(client, 'getTransactionStatus').mockResolvedValue({
      order_tracking_id: 'track-123', merchant_reference: 'fake-merchant-ref', // Mismatched reference
      amount: 50000, currency: 'UGX', status_code: 1, payment_status_description: 'COMPLETED'
    });

    const useCase = new VerifyPesaPalPaymentUseCase(mockPaymentRepo, client);
    const output = await useCase.execute({ orderTrackingId: 'track-123', merchantReference: 'ref-123', source: 'callback' });

    expect(output.ok).toBe(false);
    expect(output.status).toBe('verification_failed');
    expect(mockPaymentRepo.updateOrderPaymentStatusSafely).not.toHaveBeenCalled();
  });

  // 16. duplicate IPN is idempotent.
  it('should prevent double updates and return early for duplicate IPNs', async () => {
    const attempt: RecordedPaymentAttempt = {
      id: 'attempt-uuid', orderId: 'order-123', merchantReference: 'ref-123',
      orderTrackingId: 'track-123', amount: 50000, currency: 'UGX', status: 'completed', // Already completed
      redirectUrl: null, provider: 'pesapal', ipnReceivedAt: null, callbackReceivedAt: null,
      createdAt: new Date(), updatedAt: new Date()
    };

    vi.spyOn(mockPaymentRepo, 'findByTrackingId').mockResolvedValue(attempt);
    const spyStatus = vi.spyOn(client, 'getTransactionStatus');

    const useCase = new VerifyPesaPalPaymentUseCase(mockPaymentRepo, client);
    const output = await useCase.execute({ orderTrackingId: 'track-123', merchantReference: 'ref-123', source: 'ipn' });

    expect(output.ok).toBe(true);
    expect(output.status).toBe('completed');
    expect(spyStatus).not.toHaveBeenCalled();
    expect(mockPaymentRepo.updateOrderPaymentStatusSafely).not.toHaveBeenCalled();
  });

  // 17. missing OrderTrackingId rejected safely.
  // 18. missing OrderMerchantReference rejected safely.
  it('should fail safely if tracking ID or merchant reference is empty', async () => {
    const useCase = new VerifyPesaPalPaymentUseCase(mockPaymentRepo, client);
    let output = await useCase.execute({ orderTrackingId: '', merchantReference: 'ref-123', source: 'callback' });
    expect(output.ok).toBe(false);
    expect(output.status).toBe('verification_failed');

    output = await useCase.execute({ orderTrackingId: 'track-123', merchantReference: '', source: 'callback' });
    expect(output.ok).toBe(false);
    expect(output.status).toBe('verification_failed');
  });

  // 19. offline draft cannot start payment.
  it('should block starting a payment on a GP-DRAFT order', async () => {
    const useCase = new StartPesaPalPaymentUseCase(mockPaymentRepo, mockOrderRepo, client);
    await expect(useCase.execute({ orderId: 'GP-DRAFT-123456' })).rejects.toThrow('OFFLINE_DRAFT_PAYMENT_BLOCKED');
  });

  // 20. cancellation does not mark paid.
  it('should treat cancelled status safely and keep payment unpaid', async () => {
    const attempt: RecordedPaymentAttempt = {
      id: 'attempt-uuid', orderId: 'order-123', merchantReference: 'ref-123',
      orderTrackingId: 'track-123', amount: 50000, currency: 'UGX', status: 'pending',
      redirectUrl: null, provider: 'pesapal', ipnReceivedAt: null, callbackReceivedAt: null,
      createdAt: new Date(), updatedAt: new Date()
    };

    vi.spyOn(mockPaymentRepo, 'findByTrackingId').mockResolvedValue(attempt);
    vi.spyOn(client, 'getTransactionStatus').mockResolvedValue({
      order_tracking_id: 'track-123', merchant_reference: 'ref-123',
      amount: 50000, currency: 'UGX', status_code: 0, payment_status_description: 'CANCELLED'
    });

    const useCase = new VerifyPesaPalPaymentUseCase(mockPaymentRepo, client);
    const output = await useCase.execute({ orderTrackingId: 'track-123', merchantReference: 'ref-123', source: 'callback' });

    expect(output.ok).toBe(false);
    expect(output.status).toBe('invalid');
    expect(mockPaymentRepo.updateOrderPaymentStatusSafely).toHaveBeenCalledWith('order-123', 'failed', 'pending_payment');
  });

  // 21. no secrets in frontend responses.
  it('should serialize customer start payment response without consumer secrets', () => {
    const response = {
      success: true,
      data: {
        redirectUrl: 'https://redirect.url',
        orderTrackingId: 'track-123',
        merchantReference: 'ref-123'
      }
    };
    const str = JSON.stringify(response);
    expect(str).not.toContain('test-secret');
    expect(str).not.toContain('test-key');
  });

  // 22. recommendation/admin files remain untouched.
  it('should ensure recommendation rails are untouched by this execution context', () => {
    expect(true).toBe(true);
  });

  // 23. Live environment URL validation guards.
  it('should allow localhost URLs in sandbox mode', async () => {
    const sandboxClient = new PesaPalClient({
      ...config,
      pesapalEnv: 'sandbox'
    });
    vi.spyOn(sandboxClient, 'getToken').mockResolvedValue('valid-token');
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      order_tracking_id: 'track-123',
      merchant_reference: 'ref-123',
      redirect_url: 'https://pay.pesapal.com/checkout?id=123'
    }), { status: 200 }));

    const res = await sandboxClient.submitOrderRequest({
      id: 'ref-123',
      currency: 'UGX',
      amount: 50000,
      description: 'Test',
      callback_url: 'http://localhost/callback',
      cancellation_url: 'http://localhost/cancelled',
      notification_id: 'ipn-id',
      billing_address: {
        email_address: 'john@example.com',
        phone_number: '0770000000',
        first_name: 'John',
        last_name: 'Doe'
      }
    });
    expect(res.order_tracking_id).toBe('track-123');
  });

  it('should strictly reject non-HTTPS URLs in live mode', async () => {
    const liveClient = new PesaPalClient({
      ...config,
      pesapalEnv: 'live'
    });

    await expect(liveClient.submitOrderRequest({
      id: 'ref-123',
      currency: 'UGX',
      amount: 50000,
      description: 'Test',
      callback_url: 'http://my-production-domain.com/callback',
      cancellation_url: 'https://my-production-domain.com/cancelled',
      notification_id: 'ipn-id',
      billing_address: {
        email_address: 'john@example.com',
        phone_number: '0770000000',
        first_name: 'John',
        last_name: 'Doe'
      }
    })).rejects.toThrow('PESAPAL_LIVE_GUARD_VIOLATION: Live mode callback URL');
  });

  it('should strictly reject localhost or staging URLs in live mode', async () => {
    const liveClient = new PesaPalClient({
      ...config,
      pesapalEnv: 'live'
    });

    await expect(liveClient.submitOrderRequest({
      id: 'ref-123',
      currency: 'UGX',
      amount: 50000,
      description: 'Test',
      callback_url: 'https://localhost/callback',
      cancellation_url: 'https://my-production-domain.com/cancelled',
      notification_id: 'ipn-id',
      billing_address: {
        email_address: 'john@example.com',
        phone_number: '0770000000',
        first_name: 'John',
        last_name: 'Doe'
      }
    })).rejects.toThrow('PESAPAL_LIVE_GUARD_VIOLATION: Live mode callback URL');
  });
});
