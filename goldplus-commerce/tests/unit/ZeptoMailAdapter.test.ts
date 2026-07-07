import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ZeptoMailAdapter, FetchLike } from '../../apps/api/src/infrastructure/notifications/zeptomail/ZeptoMailAdapter';
import { renderEmail } from '../../apps/api/src/infrastructure/notifications/zeptomail/emailTemplates';
import { NotificationDispatchPayload } from '../../apps/api/src/application/ports/INotificationProvider';

const PAYLOAD: NotificationDispatchPayload = {
  recipient: 'ops@example.com',
  template: 'PAYMENT_SUCCESS',
  data: { paymentId: 'pay-1', orderId: 'ord-1' },
  relatedEntity: 'payment',
  relatedEntityId: 'pay-1',
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('ZeptoMailAdapter', () => {
  const savedEnv = { ...process.env };

  beforeEach(() => {
    process.env.ZEPTOMAIL_API_TOKEN = 'test-token';
    process.env.ZEPTOMAIL_FROM_ADDRESS = 'noreply@goldplus.example';
  });

  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it('returns NOT_CONFIGURED without sending when credentials are missing', async () => {
    delete process.env.ZEPTOMAIL_API_TOKEN;
    let called = false;
    const adapter = new ZeptoMailAdapter((async () => {
      called = true;
      return jsonResponse(201, {});
    }) as FetchLike);

    const result = await adapter.dispatch(PAYLOAD);
    expect(result.status).toBe('NOT_CONFIGURED');
    expect(called).toBe(false);
  });

  it('sends via the ZeptoMail API and reports SENT on 2xx', async () => {
    let capturedUrl = '';
    let capturedInit: RequestInit | undefined;
    const adapter = new ZeptoMailAdapter((async (url: string, init?: RequestInit) => {
      capturedUrl = url;
      capturedInit = init;
      return jsonResponse(201, { request_id: 'req-42', message: 'OK' });
    }) as FetchLike);

    const result = await adapter.dispatch(PAYLOAD);
    expect(result.status).toBe('SENT');
    expect(result.providerCode).toBe('req-42');

    expect(capturedUrl).toBe('https://api.zeptomail.com/v1.1/email');
    const headers = capturedInit?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Zoho-enczapikey test-token');

    const body = JSON.parse(String(capturedInit?.body));
    expect(body.from.address).toBe('noreply@goldplus.example');
    expect(body.to[0].email_address.address).toBe('ops@example.com');
    expect(body.subject).toContain('payment received');
    expect(body.htmlbody).toContain('pay-1');
  });

  it('does not double-prefix an already prefixed token', async () => {
    process.env.ZEPTOMAIL_API_TOKEN = 'Zoho-enczapikey abc';
    let auth = '';
    const adapter = new ZeptoMailAdapter((async (_url: string, init?: RequestInit) => {
      auth = (init?.headers as Record<string, string>).Authorization;
      return jsonResponse(201, {});
    }) as FetchLike);
    await adapter.dispatch(PAYLOAD);
    expect(auth).toBe('Zoho-enczapikey abc');
  });

  it('reports FAILED with provider details on API rejection', async () => {
    const adapter = new ZeptoMailAdapter((async () =>
      jsonResponse(401, { error: { code: 'TM_4001', details: [{ message: 'Invalid API token' }] } })) as FetchLike);

    const result = await adapter.dispatch(PAYLOAD);
    expect(result.status).toBe('FAILED');
    expect(result.providerCode).toBe('TM_4001');
    expect(result.providerMessage).toContain('Invalid API token');
  });

  it('reports FAILED on network errors instead of throwing', async () => {
    const adapter = new ZeptoMailAdapter((async () => {
      throw new Error('socket hang up');
    }) as FetchLike);

    const result = await adapter.dispatch(PAYLOAD);
    expect(result.status).toBe('FAILED');
    expect(result.providerCode).toBe('NETWORK_ERROR');
  });

  it('rejects invalid recipients before calling the API', async () => {
    let called = false;
    const adapter = new ZeptoMailAdapter((async () => {
      called = true;
      return jsonResponse(201, {});
    }) as FetchLike);

    const result = await adapter.dispatch({ ...PAYLOAD, recipient: '256700000000' });
    expect(result.status).toBe('FAILED');
    expect(result.providerCode).toBe('BAD_RECIPIENT');
    expect(called).toBe(false);
  });
});

describe('email templates', () => {
  it('renders every mapped template with a subject and branded body', () => {
    for (const template of ['PAYMENT_SUCCESS', 'PAYMENT_FAILED', 'DEALER_APPLICATION', 'NEW_QUOTE_REQUEST', 'FAKE_REPORT_ALERT']) {
      const rendered = renderEmail(template, { paymentId: 'x', orderId: 'y', applicationId: 'z', quoteId: 'q', reportId: 'r' });
      expect(rendered.subject).toContain('GoldPlus');
      expect(rendered.htmlBody).toContain('GoldPlus');
    }
  });

  it('falls back to a generic email for unmapped templates', () => {
    const rendered = renderEmail('SOMETHING_NEW', { foo: 'bar' });
    expect(rendered.subject).toContain('SOMETHING_NEW');
    expect(rendered.htmlBody).toContain('bar');
  });

  it('escapes HTML in payload values', () => {
    const rendered = renderEmail('SOMETHING_NEW', { foo: '<script>alert(1)</script>' });
    expect(rendered.htmlBody).not.toContain('<script>');
    expect(rendered.htmlBody).toContain('&lt;script&gt;');
  });
});
