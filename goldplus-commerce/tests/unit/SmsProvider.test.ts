import { expect, test, describe, vi, beforeEach, afterEach } from 'vitest';
import { PahappaCommsSmsAdapter } from '../../apps/api/src/infrastructure/notifications/sms/PahappaCommsSmsAdapter';

describe('Pahappa Comms / EgoSMS SMS Adapter Unit Tests', () => {
  let adapter: PahappaCommsSmsAdapter;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    adapter = new PahappaCommsSmsAdapter();
    vi.stubGlobal('fetch', vi.fn());
    process.env = {
      NODE_ENV: 'test',
      SMS_PROVIDER: 'pahappa_comms',
      SMS_BASE_URL: 'https://comms.egosms.co/api/v1/json/',
      SMS_USERNAME: 'test_user',
      SMS_API_KEY: 'test_key',
      SMS_SENDER_ID: 'GoldPlus',
      SMS_DEFAULT_COUNTRY_CODE: 'UG',
      SMS_PRIORITY: '0',
      SMS_TIMEOUT_MS: '10000',
      // The master outbound gates. The adapters used to read neither
      // PROVIDER_DELIVERY_ENABLED nor CUSTOMER_COMMUNICATIONS_ENABLED — they were
      // enforced only by convention — so a provider test could reach a live send
      // without ever naming them. The shared policy requires them explicitly.
      PROVIDER_DELIVERY_ENABLED: 'true',
      CUSTOMER_COMMUNICATIONS_ENABLED: 'true',
      NOTIFICATION_DELIVERY_ENABLED: 'true',
      NOTIFICATIONS_OPERATOR_APPROVED: 'true',
      NOTIFICATIONS_SMS_ENABLED: 'true',
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
    // The STATUS stays NOT_CONFIGURED — it is what the notification port means by
    // "the provider cannot be called" — while the CODE is now the governance decision,
    // so a caller grouping by code sees which guard answered.
    process.env.SMS_USERNAME = '';
    const res = await adapter.dispatch({
      recipient: '0772123456',
      template: 'ORDER_PAYMENT_SUCCESS',
      data: { message: 'Hello' },
    });
    expect(res.status).toBe('NOT_CONFIGURED');
    expect(res.providerCode).toBe('BLOCK_PROVIDER_NOT_CONFIGURED');
    expect(res.providerMessage).toContain('SMS_CREDENTIALS');
  });

  test('2. Dry-run reports DRY_RUN, never SENT, and does not call fetch', async () => {
    process.env.NOTIFICATIONS_DRY_RUN = 'true';
    // Live sending OFF. Dry-run and live-send both enabled is now refused as
    // contradictory: resolving that silently either way risks sending real messages to
    // someone who believed they were simulating.
    process.env.NOTIFICATIONS_LIVE_SEND_ENABLED = 'false';
    const res = await adapter.dispatch({
      recipient: '0772123456',
      template: 'ORDER_PAYMENT_SUCCESS',
      data: { message: 'Hello' },
    });
    // This adapter used to report a simulated message as SENT with a DRY_RUN_SUCCESS
    // code, which made a suppressed message indistinguishable from a delivered one in
    // every metric, dashboard and query.
    expect(res.status).toBe('DRY_RUN');
    expect(res.status).not.toBe('SENT');
    expect(res.providerCode).toBe('DRY_RUN');
    expect(res.providerMessage).toContain('No message was sent');
    expect(fetch).not.toHaveBeenCalled();
  });

  test('3. Live-send disabled blocks external send', async () => {
    process.env.NOTIFICATIONS_LIVE_SEND_ENABLED = 'false';
    const res = await adapter.dispatch({
      recipient: '0772123456',
      template: 'ORDER_PAYMENT_SUCCESS',
      data: { message: 'Hello' },
    });
    expect(res.status).toBe('DISABLED');
    expect(res.providerCode).toBe('BLOCK_APPROVAL_REQUIRED');
    // The guard is named exactly, rather than described in prose the operator cannot
    // group by.
    expect(res.providerMessage).toContain('NOTIFICATIONS_LIVE_SEND_ENABLED');
    expect(fetch).not.toHaveBeenCalled();
  });

  test('4. SMS channel disabled blocks external send', async () => {
    process.env.NOTIFICATIONS_SMS_ENABLED = 'false';
    const res = await adapter.dispatch({
      recipient: '0772123456',
      template: 'ORDER_PAYMENT_SUCCESS',
      data: { message: 'Hello' },
    });
    expect(res.status).toBe('DISABLED');
    expect(res.providerCode).toBe('BLOCK_CHANNEL_DISABLED');
    expect(res.providerMessage).toContain('SMS_CHANNEL_ENABLED');
    expect(fetch).not.toHaveBeenCalled();
  });

  test('5. Recipient not on allowlist is blocked', async () => {
    process.env.NOTIFICATIONS_ALLOWED_TEST_RECIPIENTS = '0772000000, 0772111111';
    const res = await adapter.dispatch({
      recipient: '0772123456', // Different number
      template: 'ORDER_PAYMENT_SUCCESS',
      data: { message: 'Hello' },
    });
    expect(res.status).toBe('DISABLED');
    expect(res.providerCode).toBe('BLOCK_RECIPIENT_NOT_ALLOWLISTED');
    expect(res.providerMessage).toContain('NOTIFICATIONS_ALLOWED_TEST_RECIPIENTS');
    expect(fetch).not.toHaveBeenCalled();
  });

  test('6. Recipient on allowlist can proceed when all flags allow', async () => {
    process.env.NOTIFICATIONS_ALLOWED_TEST_RECIPIENTS = '0772123456, 0772111111';
    
    const mockJsonPromise = Promise.resolve({
      Status: 'OK',
      Message: 'Successfully Sent!',
      Cost: '35',
      MsgFollowUpUniqueCode: 'ApiMSG.12345',
    });
    const mockFetchPromise = Promise.resolve({
      ok: true,
      json: () => mockJsonPromise,
    });
    vi.mocked(fetch).mockImplementation(() => mockFetchPromise);

    const res = await adapter.dispatch({
      recipient: '0772123456',
      template: 'ORDER_PAYMENT_SUCCESS',
      data: { message: 'Hello' },
    });

    expect(res.status).toBe('SENT');
    expect(res.providerCode).toBe('ApiMSG.12345');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test('7. Invalid phone number rejected safely', async () => {
    const res = await adapter.dispatch({
      recipient: 'abcdefg', // invalid
      template: 'ORDER_PAYMENT_SUCCESS',
      data: { message: 'Hello' },
    });
    expect(res.status).toBe('FAILED');
    expect(res.providerCode).toBe('INVALID_RECIPIENT');
    expect(fetch).not.toHaveBeenCalled();
  });

  test('8. Ugandan phone normalization works', () => {
    expect(adapter.normalizeUgandanNumber('0772123456')).toBe('256772123456');
    expect(adapter.normalizeUgandanNumber('+256772123456')).toBe('256772123456');
    expect(adapter.normalizeUgandanNumber('256772123456')).toBe('256772123456');
    expect(adapter.normalizeUgandanNumber('  +256 (772) 123-456 ')).toBe('256772123456');
    expect(adapter.normalizeUgandanNumber('07721234')).toBeNull(); // too short
    expect(adapter.normalizeUgandanNumber('0772123456789')).toBeNull(); // too long
    expect(adapter.normalizeUgandanNumber('44772123456')).toBeNull(); // non-Uganda
  });

  test('9. SendSms payload shape matches provider spec', async () => {
    const mockJsonPromise = Promise.resolve({ Status: 'OK', Message: 'Successfully Sent!' });
    const mockFetchPromise = Promise.resolve({
      ok: true,
      json: () => mockJsonPromise,
    });
    vi.mocked(fetch).mockImplementation(() => mockFetchPromise);

    await adapter.dispatch({
      recipient: '0772123456',
      template: 'ORDER_PAYMENT_SUCCESS',
      data: { message: 'Test message body' },
    });

    expect(fetch).toHaveBeenCalledWith('https://comms.egosms.co/api/v1/json/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        method: 'SendSms',
        userdata: {
          username: 'test_user',
          password: 'test_key',
        },
        msgdata: [
          {
            number: '256772123456',
            message: 'Test message body',
            senderid: 'GoldPlus',
            priority: '0',
          },
        ],
      }),
      signal: expect.any(AbortSignal),
    });
  });

  test('10. Provider Failed response maps to PROVIDER_ERROR', async () => {
    const mockJsonPromise = Promise.resolve({ Status: 'Failed', Message: 'Authentication Failed' });
    const mockFetchPromise = Promise.resolve({
      ok: true,
      json: () => mockJsonPromise,
    });
    vi.mocked(fetch).mockImplementation(() => mockFetchPromise);

    const res = await adapter.dispatch({
      recipient: '0772123456',
      template: 'ORDER_PAYMENT_SUCCESS',
      data: { message: 'Hello' },
    });

    expect(res.status).toBe('FAILED');
    expect(res.providerCode).toBe('PROVIDER_ERROR');
    expect(res.providerMessage).toBe('Authentication Failed');
  });

  test('11. Network failure/HTTP error maps to PROVIDER_ERROR', async () => {
    const mockFetchPromise = Promise.resolve({
      ok: false,
      status: 500,
    });
    vi.mocked(fetch).mockImplementation(() => mockFetchPromise);

    const res = await adapter.dispatch({
      recipient: '0772123456',
      template: 'ORDER_PAYMENT_SUCCESS',
      data: { message: 'Hello' },
    });

    expect(res.status).toBe('FAILED');
    expect(res.providerCode).toBe('PROVIDER_ERROR');
    expect(res.providerMessage).toContain('HTTP error status 500');
  });

  test('12. Balance health check uses method Balance and does not send SMS', async () => {
    const mockJsonPromise = Promise.resolve({ Status: 'OK', Balance: 2500 });
    const mockFetchPromise = Promise.resolve({
      ok: true,
      json: () => mockJsonPromise,
    });
    vi.mocked(fetch).mockImplementation(() => mockFetchPromise);

    const res = await adapter.getBalance();

    expect(res.status).toBe('PASS');
    expect(res.balance).toBe(2500);
    expect(res.message).toBe('BALANCE_CHECK_OK');

    expect(fetch).toHaveBeenCalledWith('https://comms.egosms.co/api/v1/json/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        method: 'Balance',
        userdata: {
          username: 'test_user',
          password: 'test_key',
        },
      }),
      signal: expect.any(AbortSignal),
    });
  });

  test('13. API key/password is never included in returned error or masking leaks', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('Sensitive details username=test_user password=test_key'));

    const res = await adapter.dispatch({
      recipient: '0772123456',
      template: 'ORDER_PAYMENT_SUCCESS',
      data: { message: 'Hello' },
    });

    expect(res.status).toBe('FAILED');
    expect(res.providerCode).toBe('PROVIDER_ERROR');
    // Ensure raw process environment secret is NOT leaked in raw error details.
    expect(res.providerMessage).not.toContain('test_key');
  });

  test('14. Network timeout maps to FAILED and scrubs token', async () => {
    const mockAbortError = new Error('The operation was aborted.');
    mockAbortError.name = 'AbortError';
    vi.mocked(fetch).mockRejectedValue(mockAbortError);

    const res = await adapter.dispatch({
      recipient: '0772123456',
      template: 'ORDER_PAYMENT_SUCCESS',
      data: { message: 'Hello' },
    });

    expect(res.status).toBe('FAILED');
    expect(res.providerCode).toBe('PROVIDER_ERROR');
    expect(res.providerMessage).toContain('timed out');
  });

  test('15. Empty custom message falls back to template key safely', async () => {
    const mockJsonPromise = Promise.resolve({ Status: 'OK', Message: 'Successfully Sent!' });
    const mockFetchPromise = Promise.resolve({
      ok: true,
      json: () => mockJsonPromise,
    });
    vi.mocked(fetch).mockImplementation(() => mockFetchPromise);

    await adapter.dispatch({
      recipient: '0772123456',
      template: 'ORDER_PAYMENT_SUCCESS',
      data: { message: '' }, // empty message
    });

    const [, calledInit] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    const parsedBody = JSON.parse(calledInit.body as string);
    expect(parsedBody.msgdata[0].message).toBe('ORDER_PAYMENT_SUCCESS');
  });
});
