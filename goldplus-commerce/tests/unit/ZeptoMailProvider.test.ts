import { expect, test, describe, vi, beforeEach, afterEach } from 'vitest';
import { ZeptoMailAdapter } from '../../apps/api/src/infrastructure/notifications/zeptomail/ZeptoMailAdapter';

describe('ZeptoMail Transactional Email Adapter Unit Tests', () => {
  let adapter: ZeptoMailAdapter;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    adapter = new ZeptoMailAdapter();
    vi.stubGlobal('fetch', vi.fn());
    process.env = {
      NODE_ENV: 'test',
      ZEPTOMAIL_API_TOKEN: 'test_zepto_key_12345',
      ZEPTOMAIL_FROM_ADDRESS: 'receipts@shopgoldplus.com',
      ZEPTOMAIL_FROM_NAME: 'GoldPlus',
      ZEPTOMAIL_REPLY_TO: 'support@shopgoldplus.com',
      ZEPTOMAIL_BASE_URL: 'https://api.zeptomail.com/v1.1/email',
      ZEPTOMAIL_TIMEOUT_MS: '10000',
      // The master outbound gates. The adapters used to read neither
      // PROVIDER_DELIVERY_ENABLED nor CUSTOMER_COMMUNICATIONS_ENABLED — they were
      // enforced only by convention — so a provider test could reach a live send
      // without ever naming them. The shared policy requires them explicitly.
      PROVIDER_DELIVERY_ENABLED: 'true',
      CUSTOMER_COMMUNICATIONS_ENABLED: 'true',
      NOTIFICATION_DELIVERY_ENABLED: 'true',
      NOTIFICATIONS_OPERATOR_APPROVED: 'true',
      NOTIFICATIONS_EMAIL_ENABLED: 'true',
      NOTIFICATIONS_DRY_RUN: 'false',
      NOTIFICATIONS_LIVE_SEND_ENABLED: 'true',
      NOTIFICATIONS_ALLOWED_TEST_RECIPIENTS: '',
    };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  test('1. Missing credentials returns NOT_CONFIGURED', async () => {
    process.env.ZEPTOMAIL_API_TOKEN = '';
    const res = await adapter.dispatch({
      recipient: 'customer@example.com',
      template: 'ORDER_PAYMENT_SUCCESS',
      data: { orderNumber: 'GP-1001', customerName: 'Alice', items: [], totalUgx: 50000, orderStatus: 'processing', paymentStatus: 'paid' },
      relatedEntity: 'Order',
      relatedEntityId: '1001',
    });
    expect(res.status).toBe('NOT_CONFIGURED');
    expect(res.providerCode).toBe('BLOCK_PROVIDER_NOT_CONFIGURED');
    expect(res.providerMessage).toContain('EMAIL_CREDENTIALS');
  });

  test('2. Dry-run reports DRY_RUN, never SENT, and does not call fetch', async () => {
    process.env.NOTIFICATIONS_DRY_RUN = 'true';
    // Live sending OFF. Dry-run and live-send both enabled is now refused as
    // contradictory: resolving that silently either way risks sending real messages to
    // someone who believed they were simulating.
    process.env.NOTIFICATIONS_LIVE_SEND_ENABLED = 'false';
    const res = await adapter.dispatch({
      recipient: 'customer@example.com',
      template: 'ORDER_PAYMENT_SUCCESS',
      data: { orderNumber: 'GP-1001', customerName: 'Alice', items: [], totalUgx: 50000, orderStatus: 'processing', paymentStatus: 'paid' },
      relatedEntity: 'Order',
      relatedEntityId: '1001',
    });
    // This adapter used to report a simulated message as SENT, which made a suppressed
    // message indistinguishable from a delivered one in every metric and query.
    expect(res.status).toBe('DRY_RUN');
    expect(res.status).not.toBe('SENT');
    expect(res.providerCode).toBe('DRY_RUN');
    expect(res.providerMessage).toContain('No message was sent');
    expect(fetch).not.toHaveBeenCalled();
  });

  test('3. Live-send disabled blocks external send', async () => {
    process.env.NOTIFICATIONS_LIVE_SEND_ENABLED = 'false';
    const res = await adapter.dispatch({
      recipient: 'customer@example.com',
      template: 'ORDER_PAYMENT_SUCCESS',
      data: { orderNumber: 'GP-1001', customerName: 'Alice', items: [], totalUgx: 50000, orderStatus: 'processing', paymentStatus: 'paid' },
      relatedEntity: 'Order',
      relatedEntityId: '1001',
    });
    expect(res.status).toBe('DISABLED');
    expect(res.providerCode).toBe('BLOCK_APPROVAL_REQUIRED');
    expect(res.providerMessage).toContain('NOTIFICATIONS_LIVE_SEND_ENABLED');
    expect(fetch).not.toHaveBeenCalled();
  });

  test('4. Email channel disabled blocks external send', async () => {
    process.env.NOTIFICATIONS_EMAIL_ENABLED = 'false';
    const res = await adapter.dispatch({
      recipient: 'customer@example.com',
      template: 'ORDER_PAYMENT_SUCCESS',
      data: { orderNumber: 'GP-1001', customerName: 'Alice', items: [], totalUgx: 50000, orderStatus: 'processing', paymentStatus: 'paid' },
      relatedEntity: 'Order',
      relatedEntityId: '1001',
    });
    expect(res.status).toBe('DISABLED');
    expect(res.providerCode).toBe('BLOCK_CHANNEL_DISABLED');
    expect(res.providerMessage).toContain('EMAIL_CHANNEL_ENABLED');
    expect(fetch).not.toHaveBeenCalled();
  });

  test('5. Recipient not on allowlist is blocked', async () => {
    process.env.NOTIFICATIONS_ALLOWED_TEST_RECIPIENTS = 'tester@goldplus.com, admin@goldplus.com';
    const res = await adapter.dispatch({
      recipient: 'customer@example.com', // Different email
      template: 'ORDER_PAYMENT_SUCCESS',
      data: { orderNumber: 'GP-1001', customerName: 'Alice', items: [], totalUgx: 50000, orderStatus: 'processing', paymentStatus: 'paid' },
      relatedEntity: 'Order',
      relatedEntityId: '1001',
    });
    expect(res.status).toBe('DISABLED');
    expect(res.providerCode).toBe('BLOCK_RECIPIENT_NOT_ALLOWLISTED');
    expect(res.providerMessage).toContain('NOTIFICATIONS_ALLOWED_TEST_RECIPIENTS');
    expect(fetch).not.toHaveBeenCalled();
  });

  test('6. Recipient on allowlist can proceed when all flags allow', async () => {
    process.env.NOTIFICATIONS_ALLOWED_TEST_RECIPIENTS = 'customer@example.com, tester@goldplus.com';
    
    const mockJsonPromise = Promise.resolve({
      message: 'success',
      data: [{ message_id: 'msg_zepto_99999' }]
    });
    const mockFetchPromise = Promise.resolve({
      ok: true,
      status: 200,
      json: () => mockJsonPromise,
    });
    vi.mocked(fetch).mockImplementation(() => mockFetchPromise);

    const res = await adapter.dispatch({
      recipient: 'customer@example.com',
      template: 'ORDER_PAYMENT_SUCCESS',
      data: { orderNumber: 'GP-1001', customerName: 'Alice', items: [], totalUgx: 50000, orderStatus: 'processing', paymentStatus: 'paid' },
      relatedEntity: 'Order',
      relatedEntityId: '1001',
    });

    expect(res.status).toBe('SENT');
    expect(res.providerCode).toBe('msg_zepto_99999');
    expect(fetch).toHaveBeenCalledTimes(1);

    // Verify correct authorization headers and endpoints are targeted
    const [calledUrl, calledInit] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toBe('https://api.zeptomail.com/v1.1/email');
    expect(calledInit.method).toBe('POST');
    expect(calledInit.headers).toEqual({
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Authorization': 'Zoho-enczapikey test_zepto_key_12345',
    });

    const parsedBody = JSON.parse(calledInit.body as string);
    expect(parsedBody.from.address).toBe('receipts@shopgoldplus.com');
    expect(parsedBody.to[0].email_address.address).toBe('customer@example.com');
    expect(parsedBody.reply_to[0].address).toBe('support@shopgoldplus.com');
    expect(parsedBody.subject).toBe('Payment received for your GoldPlus order');
    expect(parsedBody.htmlbody).toContain('Alice');
    expect(parsedBody.htmlbody).toContain('GP-1001');
    expect(parsedBody.textbody).toContain('Alice');
    expect(parsedBody.textbody).toContain('GP-1001');
    expect(parsedBody.track_clicks).toBe(false);
    expect(parsedBody.track_opens).toBe(false);
  });

  test('7. Successful API dispatch maps to SENT', async () => {
    const mockJsonPromise = Promise.resolve({
      data: [{ message_id: 'msg_zepto_11111' }]
    });
    const mockFetchPromise = Promise.resolve({
      ok: true,
      status: 200,
      json: () => mockJsonPromise,
    });
    vi.mocked(fetch).mockImplementation(() => mockFetchPromise);

    const res = await adapter.dispatch({
      recipient: 'customer@example.com',
      template: 'ORDER_PAYMENT_SUCCESS',
      data: { orderNumber: 'GP-1001', customerName: 'Alice', items: [], totalUgx: 50000, orderStatus: 'processing', paymentStatus: 'paid' },
      relatedEntity: 'Order',
      relatedEntityId: '1001',
    });

    expect(res.status).toBe('SENT');
    expect(res.providerCode).toBe('msg_zepto_11111');
  });

  test('8. Network timeout returns FAILED', async () => {
    const mockAbortError = new Error('The operation was aborted.');
    mockAbortError.name = 'AbortError';
    vi.mocked(fetch).mockRejectedValue(mockAbortError);

    const res = await adapter.dispatch({
      recipient: 'customer@example.com',
      template: 'ORDER_PAYMENT_SUCCESS',
      data: { orderNumber: 'GP-1001', customerName: 'Alice', items: [], totalUgx: 50000, orderStatus: 'processing', paymentStatus: 'paid' },
      relatedEntity: 'Order',
      relatedEntityId: '1001',
    });

    expect(res.status).toBe('FAILED');
    expect(res.providerCode).toBe('PROVIDER_ERROR');
    expect(res.providerMessage).toContain('timed out');
  });

  test('9. HTTP network failure returns FAILED and scrubs token', async () => {
    const mockNetworkError = new Error('Connect timeout to API. Secret token: test_zepto_key_12345');
    vi.mocked(fetch).mockRejectedValue(mockNetworkError);

    const res = await adapter.dispatch({
      recipient: 'customer@example.com',
      template: 'ORDER_PAYMENT_SUCCESS',
      data: { orderNumber: 'GP-1001', customerName: 'Alice', items: [], totalUgx: 50000, orderStatus: 'processing', paymentStatus: 'paid' },
      relatedEntity: 'Order',
      relatedEntityId: '1001',
    });

    expect(res.status).toBe('FAILED');
    expect(res.providerCode).toBe('PROVIDER_ERROR');
    expect(res.providerMessage).not.toContain('test_zepto_key_12345');
    expect(res.providerMessage).toContain('******');
  });

  test('10. getBalance (config check) WARNs when live sending is genuinely permitted', async () => {
    // This suite's environment is deliberately fully unlocked, so every guard is
    // satisfied and customer email CAN leave the system. That is reported as a WARN, not
    // a PASS: it is a state an operator should be told about explicitly even when it was
    // arranged deliberately. It used to return PASS with the warning buried in a message
    // string, so the unlocked case looked identical to a locked-down one.
    const check = await adapter.getBalance();
    expect(check.status).toBe('WARN');
    expect(check.message).toContain('LIVE SENDING IS ENABLED');
  });

  test('10a. getBalance (config check) FAILS on a contradictory configuration', async () => {
    // Dry-run and live-send both on. A safety check must not pass in the case it exists
    // to detect, and this must fail release readiness rather than merely warn.
    process.env.NOTIFICATIONS_DRY_RUN = 'true';
    process.env.NOTIFICATIONS_LIVE_SEND_ENABLED = 'true';
    const check = await adapter.getBalance();
    expect(check.status).toBe('FAIL');
    // The exact combination is named, so the operator knows what to change.
    expect(check.message).toContain('DRY_RUN_AND_LIVE_SEND_BOTH_ENABLED');
  });

  test('10b. getBalance (config check) returns PASS when the environment is locked down', async () => {
    process.env.NOTIFICATIONS_EMAIL_ENABLED = 'false';
    process.env.NOTIFICATIONS_LIVE_SEND_ENABLED = 'false';
    process.env.NOTIFICATIONS_DRY_RUN = 'true';
    const check = await adapter.getBalance();
    expect(check.status).toBe('PASS');
    expect(check.message).toContain('Safe dry-run defaults are active');
  });

  test('11. getBalance (config check) returns FAIL when from address format is invalid', async () => {
    process.env.ZEPTOMAIL_FROM_ADDRESS = 'invalid_format';
    const check = await adapter.getBalance();
    expect(check.status).toBe('FAIL');
    expect(check.message).toContain('Invalid from email address format');
  });

  test('12. getBalance (config check) returns NOT_CONFIGURED when missing credentials', async () => {
    process.env.ZEPTOMAIL_API_TOKEN = '';
    const check = await adapter.getBalance();
    expect(check.status).toBe('NOT_CONFIGURED');
    expect(check.message).toContain('Credentials missing');
  });
});
