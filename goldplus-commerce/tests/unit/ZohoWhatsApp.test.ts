import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  ZohoWhatsAppAdapter,
  classifyZohoWhatsAppFailure,
  toZohoWhatsAppRequest,
} from '../../apps/api/src/infrastructure/notifications/whatsapp/ZohoWhatsAppAdapter';
import { ZOHO_WHATSAPP_TEMPLATES, fillWhatsAppVariables } from '../../apps/api/src/infrastructure/notifications/whatsapp/zohoWhatsAppTemplates';
import { readZohoWhatsAppConfig, zohoWhatsAppStartupWarnings } from '../../apps/api/src/config/zohoWhatsApp';
import { classifyTemplate } from '../../apps/api/src/infrastructure/notifications/messageClassification';
import { outboundGovernance } from '../../apps/api/src/infrastructure/notifications/OutboundGovernanceService';
import { customerChannelStatuses } from '../../apps/api/src/infrastructure/notifications/channelStatus';
import { DefaultNotificationRouter } from '../../apps/api/src/infrastructure/notifications/NotificationRouter';
import { ProcessOutboxBatchUseCase, NotificationRoutingTarget } from '../../apps/api/src/application/use-cases/outbox/ProcessOutboxBatchUseCase';
import { RecordNotificationAttemptUseCase } from '../../apps/api/src/application/use-cases/notifications/RecordNotificationAttemptUseCase';
import { INotificationProvider, NotificationDispatchResult } from '../../apps/api/src/application/ports/INotificationProvider';
import { PersistedOutboxEvent } from '../../apps/api/src/application/ports/IOutboxRepository';

/** An obviously fake key, assembled at runtime so the file holds no scannable secret literal. */
const API_KEY = ['FAKE', 'zoho', 'fixture', 'not', 'a', 'real', 'key'].join('-');

const LIVE_ENV: NodeJS.ProcessEnv = {
  NODE_ENV: 'test',
  PROVIDER_DELIVERY_ENABLED: 'true',
  CUSTOMER_COMMUNICATIONS_ENABLED: 'true',
  NOTIFICATION_DELIVERY_ENABLED: 'true',
  NOTIFICATIONS_OPERATOR_APPROVED: 'true',
  NOTIFICATIONS_WHATSAPP_ENABLED: 'true',
  NOTIFICATIONS_DRY_RUN: 'false',
  NOTIFICATIONS_LIVE_SEND_ENABLED: 'true',
  NOTIFICATIONS_ALLOWED_TEST_RECIPIENTS: '',
  ZOHO_WHATSAPP_API_KEY: API_KEY,
  ZOHO_WHATSAPP_FROM_NUMBER: '256705004545',
  ZOHO_WHATSAPP_TEMPLATE_ORDER_PAYMENT_SUCCESS: 'tpl-key-payment-success',
  ZOHO_WHATSAPP_TEMPLATE_PHONE_VERIFICATION: 'tpl-key-otp',
};

const ORDER_DATA = { customerName: 'Grace Namuli', orderNumber: 'GP-1001', totalUgx: 250000 };

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

describe('Zoho CPaaS WhatsApp', () => {
  const original = { ...process.env };
  let fetchMock: ReturnType<typeof vi.fn>;
  let adapter: ZohoWhatsAppAdapter;

  beforeEach(() => {
    process.env = { ...LIVE_ENV };
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    adapter = new ZohoWhatsAppAdapter();
  });

  afterEach(() => {
    process.env = original;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const send = (template = 'ORDER_PAYMENT_SUCCESS', data: Record<string, unknown> = ORDER_DATA, recipient = '0772123456') =>
    adapter.dispatch({ recipient, template, data, relatedEntity: 'order', relatedEntityId: null });

  it('timeout after send -> outcome unknown, not retryable', async () => {
    fetchMock.mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    const res = await send();
    expect(res.status).toBe('FAILED');
    expect(res.providerCode).toBe('PROVIDER_TIMEOUT_AMBIGUOUS');
    expect(res.retryable).toBe(false);
  });

  describe('adapter: not configured', () => {
    it('missing API key -> NOT_CONFIGURED and no fetch', async () => {
      delete process.env.ZOHO_WHATSAPP_API_KEY;
      const res = await send();
      expect(res.status).toBe('NOT_CONFIGURED');
      expect(res.providerCode).toBe('BLOCK_PROVIDER_NOT_CONFIGURED');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('missing sender number -> NOT_CONFIGURED and no fetch', async () => {
      delete process.env.ZOHO_WHATSAPP_FROM_NUMBER;
      expect((await send()).status).toBe('NOT_CONFIGURED');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('unmapped template -> NOT_CONFIGURED TEMPLATE_NOT_MAPPED and no fetch', async () => {
      const res = await send('LOYALTY_TIER_CHANGED', { tierName: 'Gold' });
      expect(res.status).toBe('NOT_CONFIGURED');
      expect(res.providerCode).toBe('TEMPLATE_NOT_MAPPED');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('mapped template without an owner-supplied Zoho key -> NOT_CONFIGURED and no fetch', async () => {
      const res = await send('ORDER_DISPATCHED', ORDER_DATA);
      expect(res.status).toBe('NOT_CONFIGURED');
      expect(res.providerMessage).toContain('ZOHO_WHATSAPP_TEMPLATE_ORDER_DISPATCHED');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('channel flag off -> DISABLED and no fetch', async () => {
      process.env.NOTIFICATIONS_WHATSAPP_ENABLED = 'false';
      const res = await send();
      expect(res.status).toBe('DISABLED');
      expect(res.providerCode).toBe('BLOCK_CHANNEL_DISABLED');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('dry run (the default when unset) -> DRY_RUN, never SENT, no fetch', async () => {
      delete process.env.NOTIFICATIONS_DRY_RUN;
      process.env.NOTIFICATIONS_LIVE_SEND_ENABLED = 'false';
      const res = await send();
      expect(res.status).toBe('DRY_RUN');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('invalid recipient -> FAILED non-retryable, no fetch', async () => {
      const res = await send('ORDER_PAYMENT_SUCCESS', ORDER_DATA, 'not-a-phone');
      expect(res.status).toBe('FAILED');
      expect(res.retryable).toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('missing template data -> FAILED non-retryable, no fetch', async () => {
      const res = await send('ORDER_PAYMENT_SUCCESS', { customerName: 'A' });
      expect(res.status).toBe('FAILED');
      expect(res.providerCode).toBe('TEMPLATE_DATA_MISSING');
      expect(res.retryable).toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('adapter: live send and payload mapping', () => {
    it('posts the documented body with the API key in Authorization', async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, { status: 'success', data: { code: 'MSG_101', message: 'Message queued', request_id: 'req-9' } }));
      const res = await send();
      expect(res.status).toBe('SENT');
      expect(res.providerCode).toBe('req-9');
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://cpaas.zoho.com/v1.1/whatsapp');
      expect(init.method).toBe('POST');
      expect(init.headers.Authorization).toBe(API_KEY);
      const body = JSON.parse(init.body);
      expect(body).toEqual({
        from: '256705004545',
        to: '256772123456',
        template_key: 'tpl-key-payment-success',
        merge_info: {
          customer_name: 'Grace',
          amount: 'UGX 250,000',
          order_number: 'GP-1001',
          track_url: expect.stringContaining('/track-order?reference=GP-1001'),
        },
      });
    });

    it('respects a configured base URL (another Zoho data centre)', async () => {
      process.env.ZOHO_WHATSAPP_BASE_URL = 'https://cpaas.zoho.eu/v1.1/whatsapp';
      fetchMock.mockResolvedValue(jsonResponse(200, { status: 'success', data: { request_id: 'r' } }));
      await send();
      expect(fetchMock.mock.calls[0][0]).toBe('https://cpaas.zoho.eu/v1.1/whatsapp');
    });

    it('toZohoWhatsAppRequest keys merge_info by variable name', () => {
      expect(toZohoWhatsAppRequest({ fromNumber: '1' }, '2', 'k', [{ name: 'code', value: '123456' }])).toEqual({
        from: '1', to: '2', template_key: 'k', merge_info: { code: '123456' },
      });
    });

    it('a 200 carrying an error envelope is not SENT', async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, { error: { code: 'X', message: 'template not approved' } }));
      const res = await send();
      expect(res.status).toBe('FAILED');
      expect(res.providerCode).toBe('PROVIDER_INVALID_TEMPLATE');
    });
  });

  describe('error classification', () => {
    it.each([
      [401, {}, 'auth_rejected', false],
      [403, {}, 'auth_rejected', false],
      [429, {}, 'rate_limited', true],
      [500, {}, 'provider_unavailable', true],
      [503, {}, 'provider_unavailable', true],
      [400, { error: { code: 'E', message: 'Invalid', details: [{ field: 'template_key', message: 'not found' }] } }, 'invalid_template', false],
      [400, { error: { code: 'E', message: 'Invalid', details: [{ field: 'to', message: 'invalid' }] } }, 'recipient_rejected', false],
      [400, { error: { code: 'E', message: 'Number is not on WhatsApp' } }, 'recipient_rejected', false],
      [400, { error: { code: 'E', message: 'Insufficient credits' } }, 'credits_exhausted', false],
      [400, { error: { code: 'E', message: 'Bad' } }, 'invalid_request', false],
    ])('HTTP %i %j -> %s (retryable=%s)', (status, body, cls, retryable) => {
      expect(classifyZohoWhatsAppFailure(status as number, body)).toEqual({ classification: cls, retryable });
    });

    it('a failed send carries the class, the retry verdict and no secret or full phone', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(401, { error: { code: 'AUTH', message: `bad key ${API_KEY} for 256772123456` } }),
      );
      const res = await send();
      expect(res.status).toBe('FAILED');
      expect(res.providerCode).toBe('PROVIDER_AUTH_REJECTED');
      expect(res.retryable).toBe(false);
      expect(res.providerMessage).not.toContain(API_KEY);
      expect(res.providerMessage).not.toContain('256772123456');
      expect(res.providerMessage.length).toBeLessThanOrEqual(300);
    });

    it('network errors are redacted and left retryable', async () => {
      fetchMock.mockRejectedValue(new Error(`socket closed Authorization: ${API_KEY}`));
      const res = await send();
      expect(res.status).toBe('FAILED');
      expect(res.retryable).toBeUndefined();
      expect(res.providerMessage).not.toContain(API_KEY);
    });

    it('maskPhone never shows the whole number', () => {
      expect(adapter.maskPhone('256772123456')).toBe('25677******56');
    });
  });

  describe('templates', () => {
    it('every mapped template is TRANSACTIONAL and its body names exactly its variables, in order', () => {
      for (const [template, spec] of Object.entries(ZOHO_WHATSAPP_TEMPLATES)) {
        expect(classifyTemplate(template), template).toBe('TRANSACTIONAL');
        const inBody = [...spec.body.matchAll(/\{\{([a-z_]+)\}\}/g)].map((m) => m[1]);
        expect(inBody, template).toEqual(spec.variables.map((v) => v.name));
        expect(spec.zohoName).toMatch(/^[a-z0-9_]+$/);
      }
    });

    it('PHONE_VERIFICATION is an Authentication template filled from the code', () => {
      const spec = ZOHO_WHATSAPP_TEMPLATES.PHONE_VERIFICATION;
      expect(spec.category).toBe('AUTHENTICATION');
      expect(fillWhatsAppVariables(spec, { code: '482913', expiresInMinutes: 10 })).toEqual({
        ok: true,
        values: [{ name: 'code', value: '482913' }, { name: 'minutes', value: '10' }],
      });
      expect(fillWhatsAppVariables(spec, {}).ok).toBe(false);
    });
  });

  describe('canCarry (routing eligibility)', () => {
    it('true only when on, configured, mapped, keyed, transactional and fillable', () => {
      expect(adapter.canCarry('ORDER_PAYMENT_SUCCESS', '0772123456', ORDER_DATA)).toBe(true);
      expect(adapter.canCarry('ORDER_DISPATCHED', '0772123456', ORDER_DATA)).toBe(false); // no key
      expect(adapter.canCarry('SOME_PROMOTION', '0772123456', ORDER_DATA)).toBe(false); // marketing
      expect(adapter.canCarry('ORDER_PAYMENT_SUCCESS', 'nope', ORDER_DATA)).toBe(false);
      expect(adapter.canCarry('ORDER_PAYMENT_SUCCESS', '0772123456', {})).toBe(false);
      process.env.NOTIFICATIONS_WHATSAPP_ENABLED = 'false';
      expect(adapter.canCarry('ORDER_PAYMENT_SUCCESS', '0772123456', ORDER_DATA)).toBe(false);
      process.env.NOTIFICATIONS_WHATSAPP_ENABLED = 'true';
      delete process.env.ZOHO_WHATSAPP_API_KEY;
      expect(adapter.canCarry('ORDER_PAYMENT_SUCCESS', '0772123456', ORDER_DATA)).toBe(false);
    });
  });

  describe('governance flags', () => {
    it('reads NOTIFICATIONS_WHATSAPP_ENABLED as the WhatsApp channel flag', () => {
      expect(outboundGovernance.flags('WHATSAPP', { NOTIFICATIONS_WHATSAPP_ENABLED: 'true' }).channelEnabled).toBe(true);
      expect(outboundGovernance.flags('WHATSAPP', {}).channelEnabled).toBe(false);
      expect(outboundGovernance.flags('WHATSAPP', { NOTIFICATIONS_EMAIL_ENABLED: 'true' }).channelEnabled).toBe(false);
    });

    it('admin channel status is derived from the flags', () => {
      const wa = (env: NodeJS.ProcessEnv) => customerChannelStatuses(env).find((c) => c.channel === 'whatsapp')!;
      expect(wa({}).state).toBe('NOT_CONFIGURED');
      expect(wa(LIVE_ENV).state).toBe('LIVE');
      expect(wa(LIVE_ENV).keyedTemplates).toEqual(['ORDER_PAYMENT_SUCCESS', 'PHONE_VERIFICATION']);
      expect(wa({ ...LIVE_ENV, NOTIFICATIONS_DRY_RUN: 'true', NOTIFICATIONS_LIVE_SEND_ENABLED: 'false' }).state).toBe('CONFIGURED_DRY_RUN');
      expect(wa({ ...LIVE_ENV, NOTIFICATIONS_WHATSAPP_ENABLED: 'false' }).state).toBe('CONFIGURED_OFF');
      expect(JSON.stringify(customerChannelStatuses(LIVE_ENV))).not.toContain(API_KEY);
    });
  });

  describe('env validation', () => {
    it('nothing set is plain Not configured, with no warnings', () => {
      expect(readZohoWhatsAppConfig({}).configured).toBe(false);
      expect(zohoWhatsAppStartupWarnings({})).toEqual([]);
    });

    it('a complete configuration is configured with the documented default URL', () => {
      const cfg = readZohoWhatsAppConfig(LIVE_ENV);
      expect(cfg.configured).toBe(true);
      expect(cfg.baseUrl).toBe('https://cpaas.zoho.com/v1.1/whatsapp');
      expect(cfg.timeoutMs).toBe(10000);
      expect(zohoWhatsAppStartupWarnings(LIVE_ENV)).toEqual([]);
    });

    it('half-configured or malformed values warn by name, never by value', () => {
      const env = { ZOHO_WHATSAPP_API_KEY: API_KEY, ZOHO_WHATSAPP_FROM_NUMBER: '0705', ZOHO_WHATSAPP_BASE_URL: 'http://x/', ZOHO_WHATSAPP_TIMEOUT_MS: 'abc' };
      const warnings = zohoWhatsAppStartupWarnings(env);
      expect(warnings.join(' ')).toContain('ZOHO_WHATSAPP_FROM_NUMBER');
      expect(warnings.join(' ')).toContain('ZOHO_WHATSAPP_BASE_URL');
      expect(warnings.join(' ')).toContain('ZOHO_WHATSAPP_TIMEOUT_MS');
      expect(warnings.join(' ')).not.toContain(API_KEY);
      expect(readZohoWhatsAppConfig(env).configured).toBe(false);
    });

    it('enabled but no template keys warns', () => {
      const env = { ...LIVE_ENV };
      delete env.ZOHO_WHATSAPP_TEMPLATE_ORDER_PAYMENT_SUCCESS;
      delete env.ZOHO_WHATSAPP_TEMPLATE_PHONE_VERIFICATION;
      expect(zohoWhatsAppStartupWarnings(env).join(' ')).toContain('ZOHO_WHATSAPP_TEMPLATE_');
    });
  });
});

/* ── Routing and fallback ─────────────────────────────────────────────── */

const provider = (result: Partial<NotificationDispatchResult> & { status: NotificationDispatchResult['status'] }, canCarry?: boolean) => {
  const p: INotificationProvider & { calls: number } = {
    calls: 0,
    dispatch: vi.fn(async () => {
      p.calls++;
      return { providerCode: null, providerMessage: 'x', ...result } as NotificationDispatchResult;
    }),
  };
  if (canCarry !== undefined) p.canCarry = () => canCarry;
  return p;
};

describe('router: WhatsApp ahead of SMS', () => {
  const orderPayload = { template: 'ORDER_PAYMENT_SUCCESS', customerPhone: '0772123456', customerEmail: 'a@b.co', ...ORDER_DATA };

  it('offers WhatsApp with SMS as the fallback when WhatsApp can carry it', async () => {
    const sms = provider({ status: 'SENT' });
    const wa = provider({ status: 'SENT' }, true);
    const targets = await new DefaultNotificationRouter(provider({ status: 'SENT' }), wa, sms).route('CUSTOMER_ORDER_MESSAGE', orderPayload);
    expect(targets).toHaveLength(1);
    expect(targets[0].channel).toBe('whatsapp');
    expect(targets[0].fallback?.channel).toBe('sms');
  });

  it('routes SMS exactly as before when WhatsApp cannot carry it', async () => {
    const targets = await new DefaultNotificationRouter(provider({ status: 'SENT' }), provider({ status: 'SENT' }, false), provider({ status: 'SENT' })).route('CUSTOMER_ORDER_MESSAGE', orderPayload);
    expect(targets.map((t) => t.channel)).toEqual(['sms']);
    expect(targets[0].fallback).toBeUndefined();
  });

  it('never offers WhatsApp for a dry-run-only event', async () => {
    const targets = await new DefaultNotificationRouter(provider({ status: 'SENT' }), provider({ status: 'SENT' }, true), provider({ status: 'SENT' })).route('CUSTOMER_ORDER_MESSAGE', { ...orderPayload, dryRunOnly: true });
    expect(targets.map((t) => t.channel)).toEqual(['sms']);
  });

  it('phone verification may go by WhatsApp with SMS fallback', async () => {
    const targets = await new DefaultNotificationRouter(provider({ status: 'SENT' }), provider({ status: 'SENT' }, true), provider({ status: 'SENT' })).route('PHONE_VERIFICATION_REQUESTED', { customerPhone: '+256772123456', code: '123456' });
    expect(targets[0].channel).toBe('whatsapp');
    expect(targets[0].fallback?.payload.template).toBe('PHONE_VERIFICATION');
  });

  it('loyalty stays on SMS (not mapped for WhatsApp)', async () => {
    const targets = await new DefaultNotificationRouter(provider({ status: 'SENT' }), provider({ status: 'SENT' }, true), provider({ status: 'SENT' })).route('LOYALTY_TIER_CHANGED', { customerPhone: '0772123456' });
    expect(targets.map((t) => t.channel)).toEqual(['sms']);
  });
});

describe('outbox: WhatsApp fallback to SMS, never both', () => {
  const makeEvent = (attemptCount = 0): PersistedOutboxEvent => ({
    id: 'e1',
    eventType: 'CUSTOMER_ORDER_MESSAGE',
    payload: {},
    attemptCount,
    isProcessed: false,
    createdAt: new Date(),
    nextAttemptAt: new Date(Date.now() - 1000),
  } as PersistedOutboxEvent);

  const run = async (wa: INotificationProvider, sms: INotificationProvider, attemptCount = 0) => {
    const saved: any[] = [];
    const outbox: any = {
      state: 'pending',
      claimDueBatch: async () => [makeEvent(attemptCount)],
      markProcessed: async () => { outbox.state = 'processed'; },
      recordFailure: async () => { outbox.state = 'retry'; },
      markDeadLettered: async () => { outbox.state = 'dead'; },
    };
    const recorder = new RecordNotificationAttemptUseCase({ save: async (i: any) => { saved.push(i); return { id: 'a', attemptedAt: new Date(), ...i }; }, findRecent: async () => [], findByRelatedEntity: async () => [] } as any);
    const payload = { recipient: '0772123456', template: 'ORDER_PAYMENT_SUCCESS', data: {}, relatedEntity: 'order', relatedEntityId: null };
    const target: NotificationRoutingTarget = {
      channel: 'whatsapp', provider: wa, payload,
      fallback: { channel: 'sms', provider: sms, payload },
    };
    await new ProcessOutboxBatchUseCase(outbox, { route: async () => [target] }, recorder).execute();
    return { saved, outbox };
  };

  it('WhatsApp sent -> SMS never tried', async () => {
    const wa = provider({ status: 'SENT' });
    const sms = provider({ status: 'SENT' });
    const { saved, outbox } = await run(wa, sms);
    expect((sms as any).calls).toBe(0);
    expect(saved.map((s) => s.channel)).toEqual(['whatsapp']);
    expect(outbox.state).toBe('processed');
  });

  it('WhatsApp dry run -> SMS never tried (a dry run is an outcome)', async () => {
    const sms = provider({ status: 'SENT' });
    await run(provider({ status: 'DRY_RUN' }), sms);
    expect((sms as any).calls).toBe(0);
  });

  it('non-retryable WhatsApp failure -> SMS once, both attempts recorded', async () => {
    const sms = provider({ status: 'SENT' });
    const { saved, outbox } = await run(provider({ status: 'FAILED', retryable: false, providerCode: 'PROVIDER_RECIPIENT_REJECTED' }), sms);
    expect((sms as any).calls).toBe(1);
    expect(saved.map((s) => s.channel)).toEqual(['whatsapp', 'sms']);
    expect(outbox.state).toBe('processed');
  });

  it('retryable WhatsApp failure early -> retried on WhatsApp, SMS not sent', async () => {
    const sms = provider({ status: 'SENT' });
    const { outbox } = await run(provider({ status: 'FAILED', retryable: true }), sms, 0);
    expect((sms as any).calls).toBe(0);
    expect(outbox.state).toBe('retry');
  });

  it('retryable WhatsApp failure after two retries -> SMS takes over', async () => {
    const sms = provider({ status: 'SENT' });
    const { outbox } = await run(provider({ status: 'FAILED', retryable: true }), sms, 2);
    expect((sms as any).calls).toBe(1);
    expect(outbox.state).toBe('processed');
  });

  it('WhatsApp outcome unknown (timeout after send) -> no SMS, no retry, even late', async () => {
    const sms = provider({ status: 'SENT' });
    const { outbox } = await run(provider({ status: 'FAILED', retryable: false, providerCode: 'PROVIDER_TIMEOUT_AMBIGUOUS' }), sms, 5);
    expect((sms as any).calls).toBe(0);
    expect(outbox.state).not.toBe('retry');
  });

  it('WhatsApp not configured -> SMS', async () => {
    const sms = provider({ status: 'SENT' });
    await run(provider({ status: 'NOT_CONFIGURED' }), sms);
    expect((sms as any).calls).toBe(1);
  });
});
