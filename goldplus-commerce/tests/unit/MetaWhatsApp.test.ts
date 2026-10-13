import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FailoverWhatsAppProvider, MetaWhatsAppAdapter, classifyMetaWhatsAppFailure } from '../../apps/api/src/infrastructure/notifications/whatsapp/MetaWhatsAppAdapter';
import { MetaWhatsAppTemplateCatalog } from '../../apps/api/src/infrastructure/notifications/whatsapp/MetaWhatsAppTemplateCatalog';
import { CARE_ALERT_TEMPLATE, WHATSAPP_TEMPLATES, careAlertCreateBody, metaTemplateCreateBody, metaTemplateSendObject } from '../../apps/api/src/infrastructure/notifications/whatsapp/whatsAppTemplates';
import { parseDeliveryReceipts } from '../../apps/api/src/domain/assistant/WhatsAppGoldie';
import { OUTCOME_UNKNOWN_PROVIDER_CODE, type INotificationProvider } from '../../apps/api/src/application/ports/INotificationProvider';

/** WhatsApp directly with Meta (owner, 2026-10-14), Zoho CPaaS as the fallback, SMS last. */
const TOKEN = ['FAKE', 'meta', 'fixture', 'token'].join('-');
const LIVE_ENV: NodeJS.ProcessEnv = {
  NODE_ENV: 'test', PROVIDER_DELIVERY_ENABLED: 'true', CUSTOMER_COMMUNICATIONS_ENABLED: 'true', NOTIFICATION_DELIVERY_ENABLED: 'true',
  NOTIFICATIONS_OPERATOR_APPROVED: 'true', NOTIFICATIONS_WHATSAPP_ENABLED: 'true', NOTIFICATIONS_DRY_RUN: 'false', NOTIFICATIONS_LIVE_SEND_ENABLED: 'true',
  NOTIFICATIONS_ALLOWED_TEST_RECIPIENTS: '', GOLDIE_WHATSAPP_PHONE_NUMBER_ID: '111222333', WHATSAPP_WABA_ID: '444555666', GOLDIE_WHATSAPP_TOKEN: TOKEN,
};
const ORDER = { customerName: 'Grace Namuli', orderNumber: 'GP-1001', totalUgx: 250000 };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const VAR = /\{\{([a-z_0-9]+)\}\}/g;

describe('templates as submitted to Meta', () => {
  it('every body names exactly its variables in order, and never starts or ends with one (Meta refuses that)', () => {
    for (const [ours, spec] of Object.entries(WHATSAPP_TEMPLATES)) {
      expect(spec.name, ours).toMatch(/^[a-z0-9_]{1,512}$/);
      expect([...spec.body.matchAll(VAR)].map((m) => m[1]), ours).toEqual(spec.variables.map((v) => v.name));
      // Authentication wording is Meta's own preset (never submitted as text), so the rule applies to the rest.
      if (spec.category !== 'AUTHENTICATION') {
        expect(spec.body.trim().startsWith('{{'), ours).toBe(false);
        expect(spec.body.trim().endsWith('}}'), ours).toBe(false);
      }
      expect(spec.body, ours).not.toMatch(/\}\}\s*\{\{/);
      for (const v of spec.variables) expect(v.example.length, `${ours}.${v.name}`).toBeGreaterThan(0);
    }
    expect(CARE_ALERT_TEMPLATE.body.trim().endsWith('}}')).toBe(false);
  });

  it('utility templates are created with NAMED parameters and examples; the phone code as Meta authentication', () => {
    const pay = metaTemplateCreateBody(WHATSAPP_TEMPLATES.ORDER_PAYMENT_SUCCESS!) as any;
    expect(pay).toMatchObject({ name: 'goldplus_payment_received', language: 'en', category: 'UTILITY', parameter_format: 'NAMED' });
    expect(pay.components[0].example.body_text_named_params.map((p: any) => p.param_name)).toEqual(['customer_name', 'amount', 'order_number', 'track_url']);
    const otp = metaTemplateCreateBody(WHATSAPP_TEMPLATES.PHONE_VERIFICATION!) as any;
    expect(otp.category).toBe('AUTHENTICATION');
    expect(otp.components).toEqual([{ type: 'BODY', add_security_recommendation: true }, { type: 'FOOTER', code_expiration_minutes: 10 }, { type: 'BUTTONS', buttons: [{ type: 'OTP', otp_type: 'COPY_CODE', text: 'Copy code' }] }]);
    expect((careAlertCreateBody() as any).components[0].example.body_text).toEqual([[CARE_ALERT_TEMPLATE.example]]);
  });

  it('a send fills named parameters as one tidy line each; the phone code fills body and copy button', () => {
    const t = metaTemplateSendObject(WHATSAPP_TEMPLATES.ORDER_DISPATCHED!, [{ name: 'customer_name', value: 'Grace' }, { name: 'order_number', value: 'GP-1001' }, { name: 'track_url', value: 'https://x/y\n' }]) as any;
    expect(t.components[0].parameters).toEqual([{ type: 'text', parameter_name: 'customer_name', text: 'Grace' }, { type: 'text', parameter_name: 'order_number', text: 'GP-1001' }, { type: 'text', parameter_name: 'track_url', text: 'https://x/y' }]);
    const otp = metaTemplateSendObject(WHATSAPP_TEMPLATES.PHONE_VERIFICATION!, [{ name: 'code', value: '482913' }]) as any;
    expect(otp.components).toEqual([{ type: 'body', parameters: [{ type: 'text', text: '482913' }] }, { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: '482913' }] }]);
  });
});

describe("Meta's refusals", () => {
  it.each([
    [401, 190, 'auth_rejected', false], [400, 131026, 'recipient_rejected', false], [400, 132001, 'invalid_template', false],
    [400, 132015, 'invalid_template', false], [429, 130429, 'rate_limited', true], [400, 131042, 'account_blocked', false],
    [500, 131000, 'provider_unavailable', true], [400, 100, 'invalid_request', false],
  ])('HTTP %i code %i -> %s (retryable=%s)', (status, code, cls, retryable) => {
    expect(classifyMetaWhatsAppFailure(status, { error: { code } })).toMatchObject({ classification: cls, retryable });
  });
});

function catalogWith(statuses: Record<string, string>) {
  const fetchImpl = vi.fn(async () => json(200, { data: Object.entries(statuses).map(([name, status]) => ({ name, status, language: 'en', category: 'UTILITY' })) }));
  const c = new MetaWhatsAppTemplateCatalog(async () => null, fetchImpl as unknown as typeof fetch);
  return { c, fetchImpl };
}

describe('direct Meta adapter', () => {
  const original = { ...process.env };
  beforeEach(() => { process.env = { ...LIVE_ENV }; });
  afterEach(() => { process.env = original; vi.restoreAllMocks(); });

  it('offers WhatsApp only for a template Meta has approved', async () => {
    const { c } = catalogWith({ goldplus_payment_received: 'APPROVED', goldplus_order_on_the_way: 'PENDING' });
    await c.refresh();
    const a = new MetaWhatsAppAdapter(c, async () => null);
    expect(a.canCarry('ORDER_PAYMENT_SUCCESS', '0772123456', ORDER)).toBe(true);
    expect(a.canCarry('ORDER_DISPATCHED', '0772123456', ORDER)).toBe(false);
    expect(a.canCarry('ORDER_PAYMENT_SUCCESS', 'not-a-number', ORDER)).toBe(false);
    process.env.NOTIFICATIONS_WHATSAPP_ENABLED = 'false';
    expect(a.canCarry('ORDER_PAYMENT_SUCCESS', '0772123456', ORDER)).toBe(false);
  });

  it('sends the named template to the Cloud API number and keeps the wamid', async () => {
    const { c } = catalogWith({ goldplus_payment_received: 'APPROVED' });
    await c.refresh();
    const send = vi.fn(async () => json(200, { messages: [{ id: 'wamid.HBgMMjU2NzcyMTIzNDU2FQIAERgSQUJDREVGMDEyMzQ1Njc4OQA=' }] }));
    const a = new MetaWhatsAppAdapter(c, async () => null, send as unknown as typeof fetch);
    const r = await a.dispatch({ recipient: '0772123456', template: 'ORDER_PAYMENT_SUCCESS', data: ORDER, relatedEntity: 'order', relatedEntityId: null });
    expect(r.status).toBe('SENT');
    expect(r.providerCode!.length).toBeGreaterThan(50);
    const [url, init] = send.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/111222333\/messages$/);
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ messaging_product: 'whatsapp', to: '256772123456', type: 'template', template: { name: 'goldplus_payment_received', language: { code: 'en' } } });
  });

  it('a refusal is classified and the token never appears in what is kept', async () => {
    const { c } = catalogWith({ goldplus_payment_received: 'APPROVED' });
    await c.refresh();
    const a = new MetaWhatsAppAdapter(c, async () => null, (async () => json(400, { error: { code: 131026, message: `bad ${TOKEN}` } })) as unknown as typeof fetch);
    const r = await a.dispatch({ recipient: '0772123456', template: 'ORDER_PAYMENT_SUCCESS', data: ORDER, relatedEntity: 'order', relatedEntityId: null });
    expect(r).toMatchObject({ status: 'FAILED', providerCode: 'META_RECIPIENT_REJECTED', retryable: false });
    expect(r.providerMessage).not.toContain(TOKEN);
  });
});

describe('Meta first, Zoho second', () => {
  const original = { ...process.env };
  beforeEach(() => { process.env = { ...LIVE_ENV }; });
  afterEach(() => { process.env = original; });
  const payload = { recipient: '0772123456', template: 'ORDER_PAYMENT_SUCCESS', data: ORDER, relatedEntity: 'order', relatedEntityId: null };
  const zoho = () => ({ canCarry: vi.fn(() => true), dispatch: vi.fn(async () => ({ status: 'SENT' as const, providerCode: 'zoho-1', providerMessage: 'Zoho' })) }) as INotificationProvider & { canCarry: ReturnType<typeof vi.fn>; dispatch: ReturnType<typeof vi.fn> };
  async function meta(answer: () => Promise<Response>) {
    const { c } = catalogWith({ goldplus_payment_received: 'APPROVED' });
    await c.refresh();
    return new MetaWhatsAppAdapter(c, async () => null, answer as unknown as typeof fetch);
  }

  it('Meta sends: Zoho is never asked', async () => {
    const z = zoho();
    const r = await new FailoverWhatsAppProvider(await meta(async () => json(200, { messages: [{ id: 'wamid.1' }] })), z).dispatch(payload);
    expect(r.status).toBe('SENT');
    expect(z.dispatch).not.toHaveBeenCalled();
  });
  it('Meta refuses: Zoho carries it, and the record says Meta was tried first', async () => {
    const z = zoho();
    const r = await new FailoverWhatsAppProvider(await meta(async () => json(503, { error: { code: 131000 } })), z).dispatch(payload);
    expect(z.dispatch).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ status: 'SENT', providerCode: 'zoho-1' });
    expect(r.providerMessage).toContain('Meta first: META_PROVIDER_UNAVAILABLE');
  });
  it('Meta times out after sending: never Zoho (the message may already be on the phone)', async () => {
    const z = zoho();
    const r = await new FailoverWhatsAppProvider(await meta(async () => { throw Object.assign(new Error('timeout'), { name: 'TimeoutError' }); }), z).dispatch(payload);
    expect(r.providerCode).toBe(OUTCOME_UNKNOWN_PROVIDER_CODE);
    expect(z.dispatch).not.toHaveBeenCalled();
  });
  it('Meta cannot carry it (not approved yet): Zoho does', async () => {
    const z = zoho();
    const { c } = catalogWith({});
    await c.refresh();
    const r = await new FailoverWhatsAppProvider(new MetaWhatsAppAdapter(c, async () => null), z).dispatch(payload);
    expect(r.providerCode).toBe('zoho-1');
  });
});

describe('template catalogue', () => {
  const original = { ...process.env };
  beforeEach(() => { process.env = { ...LIVE_ENV }; });
  afterEach(() => { process.env = original; });
  it('submits only what Meta does not have, and reports what Meta refused', async () => {
    const posted: string[] = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (!init?.method) return json(200, { data: [{ name: 'goldplus_payment_received', status: 'APPROVED', language: 'en' }] });
      const b = JSON.parse(String(init.body)); posted.push(b.name);
      return b.name === 'goldplus_phone_code' ? json(400, { error: { code: 100, error_user_msg: 'Language not supported' } }) : json(200, { id: '1', status: 'PENDING' });
    });
    const c = new MetaWhatsAppTemplateCatalog(async () => null, fetchImpl as unknown as typeof fetch);
    const out = await c.submitMissing();
    expect(out.skipped).toEqual(['goldplus_payment_received']);
    expect(posted).not.toContain('goldplus_payment_received');
    expect(posted).toContain('goldplus_care_alert');
    expect(out.failed).toEqual([{ name: 'goldplus_phone_code', reason: '400 Language not supported' }]);
    expect(out.submitted.length).toBe(Object.keys(WHATSAPP_TEMPLATES).length - 1);
  });
  it('reads the WhatsApp account and token saved in the admin when the server sets neither', async () => {
    delete process.env.WHATSAPP_WABA_ID; delete process.env.GOLDIE_WHATSAPP_TOKEN;
    const fetchImpl = vi.fn(async () => json(200, { data: [] }));
    const c = new MetaWhatsAppTemplateCatalog(async () => ({ wabaId: '777888999', accessToken: 'saved-token' }), fetchImpl as unknown as typeof fetch);
    await c.refresh();
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/777888999/message_templates');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer saved-token');
  });
  it('without a WABA id nothing is called', async () => {
    delete process.env.WHATSAPP_WABA_ID;
    const fetchImpl = vi.fn();
    const out = await new MetaWhatsAppTemplateCatalog(async () => null, fetchImpl as unknown as typeof fetch).submitMissing();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(out.failed[0]!.reason).toMatch(/not configured/);
  });
});

describe('delivery receipts', () => {
  it('reads sent / delivered / read / failed for our account only, with Meta’s error', () => {
    const payload = { object: 'whatsapp_business_account', entry: [{ id: '444555666', changes: [{ field: 'messages', value: { statuses: [
      { id: 'wamid.A', status: 'delivered' }, { id: 'wamid.B', status: 'failed', errors: [{ code: 131026, title: 'Message undeliverable' }] }, { id: 'wamid.C', status: 'deleted' },
    ] } }] }, { id: '999', changes: [{ field: 'messages', value: { statuses: [{ id: 'wamid.X', status: 'read' }] } }] }] };
    expect(parseDeliveryReceipts(payload, '444555666')).toEqual([
      { messageId: 'wamid.A', status: 'delivered', errorCode: null, errorTitle: null },
      { messageId: 'wamid.B', status: 'failed', errorCode: 131026, errorTitle: 'Message undeliverable' },
    ]);
  });
});
