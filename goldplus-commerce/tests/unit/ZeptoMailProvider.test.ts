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
    expect(res.providerCode).toBe('NOT_CONFIGURED');
    expect(res.providerMessage).toContain('credentials missing');
  });

  test('2. Dry-run returns DRY_RUN_SUCCESS and does not call fetch', async () => {
    process.env.NOTIFICATIONS_DRY_RUN = 'true';
    const res = await adapter.dispatch({
      recipient: 'customer@example.com',
      template: 'ORDER_PAYMENT_SUCCESS',
      data: { orderNumber: 'GP-1001', customerName: 'Alice', items: [], totalUgx: 50000, orderStatus: 'processing', paymentStatus: 'paid' },
      relatedEntity: 'Order',
      relatedEntityId: '1001',
    });
    expect(res.status).toBe('SENT');
    expect(res.providerCode).toBe('DRY_RUN_SUCCESS');
    expect(res.providerMessage).toContain('(Dry-Run)');
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
    expect(res.providerCode).toBe('BLOCKED_BY_LIVE_SEND_DISABLED');
    expect(res.providerMessage).toContain('globally disabled');
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
    expect(res.providerCode).toBe('CHANNEL_DISABLED');
    expect(res.providerMessage).toContain('disabled');
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
    expect(res.providerCode).toBe('BLOCKED_BY_ALLOWLIST');
    expect(res.providerMessage).toContain('allowlist');
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

  test('10. getBalance (config check) WARNs when outbound safety defaults are not enforced', async () => {
    // This suite's environment is deliberately fully unlocked
    // (NOTIFICATIONS_EMAIL_ENABLED=true, DRY_RUN=false, LIVE_SEND_ENABLED=true),
    // which is precisely the arrangement the check exists to detect. It used to
    // return PASS here with the warning buried in a message string, so the
    // unsafe case reported the same status as a locked-down one.
    const check = await adapter.getBalance();
    expect(check.status).toBe('WARN');
    expect(check.message).toContain('safe dry-run defaults are NOT enforced');
    // And it names which guard is open, so the warning is actionable.
    expect(check.message).toContain('NOTIFICATIONS_LIVE_SEND_ENABLED');
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
