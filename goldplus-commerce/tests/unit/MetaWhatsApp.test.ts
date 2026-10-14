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
        // Meta counts a variable followed only by punctuation as the end ("Call {{support_phone}}." was rejected).
        const bare = spec.body.trim().replace(/[\s.,!?;:)\]]+$/, '').replace(/^[\s(\[]+/, '');
        expect(bare.startsWith('{{'), ours).toBe(false);
        expect(bare.endsWith('}}'), ours).toBe(false);
      }
      expect(spec.body, ours).not.toMatch(/\}\}\s*\{\{/);
      for (const v of spec.variables) expect(v.example.length, `${ours}.${v.name}`).toBeGreaterThan(0);
    }
    expect(CARE_ALERT_TEMPLATE.body.trim().replace(/[\s.,!?;:]+$/, '').endsWith('}}')).toBe(false);
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
      { messageId: 'wamid.A', status: 'delivered', errorCode: null, errorTitle: null, recipientId: null },
      { messageId: 'wamid.B', status: 'failed', errorCode: 131026, errorTitle: 'Message undeliverable', recipientId: null },
    ]);
  });
});

import { optOutWord, parseAccountEvents, parseInboundTexts } from '../../apps/api/src/domain/assistant/WhatsAppGoldie';

describe('every kind of customer message is kept', () => {
  const wrap = (msg: Record<string, unknown>) => ({ object: 'whatsapp_business_account', entry: [{ id: '444555666', changes: [{ field: 'messages', value: { metadata: { phone_number_id: '111222333' }, contacts: [{ wa_id: '256772123456', profile: { name: 'Sarah' } }], messages: [{ from: '256772123456', id: 'wamid.M', timestamp: '1760000000', ...msg }] } }] }] });
  it('a photo with a caption, a voice note, a location and a contact card are filed; reactions are not', () => {
    const [photo] = parseInboundTexts(wrap({ type: 'image', image: { id: '1234567890', mime_type: 'image/jpeg', caption: 'Is this original?' } }), '444555666');
    expect(photo).toMatchObject({ text: '[Photo ⟦media:1234567890:image/jpeg⟧] Is this original?', media: { kind: 'image', id: '1234567890', mimeType: 'image/jpeg' } });
    const [voice] = parseInboundTexts(wrap({ type: 'audio', audio: { id: '9876543210', mime_type: 'audio/ogg; codecs=opus' } }), '444555666');
    expect(voice!.media!.kind).toBe('audio');
    const [loc] = parseInboundTexts(wrap({ type: 'location', location: { latitude: 0.3136, longitude: 32.5811, name: 'Ntinda' } }), '444555666');
    expect(loc!.text).toBe('My location: Ntinda (0.31360, 32.58110)');
    const [card] = parseInboundTexts(wrap({ type: 'contacts', contacts: [{ name: { formatted_name: 'Brian' }, phones: [{ phone: '+256700111222' }] }] }), '444555666');
    expect(card!.text).toBe('[Contact card] Brian +256700111222');
    expect(parseInboundTexts(wrap({ type: 'reaction', reaction: { emoji: '👍', message_id: 'x' } }), '444555666')).toEqual([]);
  });
  it('STOP and START are recognised; a sentence with the word in it is not', () => {
    expect(optOutWord('STOP')).toBe('STOP'); expect(optOutWord('Unsubscribe.')).toBe('STOP'); expect(optOutWord('start')).toBe('START');
    expect(optOutWord('please stop the order, wrong address')).toBeNull();
  });
  it("Meta's account news: a paused template and a quality drop are flagged; an approval is not", () => {
    const ev = parseAccountEvents({ object: 'whatsapp_business_account', entry: [{ id: '444555666', changes: [
      { field: 'message_template_status_update', value: { event: 'APPROVED', message_template_name: 'goldplus_order_delivered' } },
      { field: 'message_template_status_update', value: { event: 'PAUSED', message_template_name: 'goldplus_order_on_the_way', reason: 'LOW_QUALITY' } },
      { field: 'phone_number_quality_update', value: { event: 'DOWNGRADE', display_phone_number: '256705004545', current_limit: 'TIER_250' } },
    ] }] }, '444555666');
    expect(ev.map((e) => [e.event, e.bad])).toEqual([['APPROVED', false], ['PAUSED', true], ['DOWNGRADE', true]]);
    expect(ev[1]).toMatchObject({ subject: 'goldplus_order_on_the_way', detail: 'LOW_QUALITY' });
  });
});

describe('STOP is honoured on every provider', () => {
  const original = { ...process.env };
  beforeEach(() => { process.env = { ...LIVE_ENV }; });
  afterEach(() => { process.env = original; });
  const payload = { recipient: '0772123456', template: 'ORDER_PAYMENT_SUCCESS', data: ORDER, relatedEntity: 'order', relatedEntityId: null };
  it('Meta does not send to an opted-out number, and Zoho is not asked either: SMS carries it', async () => {
    const { c } = catalogWith({ goldplus_payment_received: 'APPROVED' });
    await c.refresh();
    const send = vi.fn();
    const outcomes: string[] = [];
    const meta = new MetaWhatsAppAdapter(c, async () => null, send as unknown as typeof fetch, { blockReason: async (p) => (p === '+256772123456' ? 'RECIPIENT_OPTED_OUT' : null), onOutcome: (o) => outcomes.push(o) });
    const zoho = { canCarry: vi.fn(() => true), dispatch: vi.fn() };
    const r = await new FailoverWhatsAppProvider(meta, zoho as unknown as INotificationProvider, async () => 'RECIPIENT_OPTED_OUT').dispatch(payload);
    expect(r).toMatchObject({ status: 'NOT_CONFIGURED', providerCode: 'RECIPIENT_OPTED_OUT' });
    expect(send).not.toHaveBeenCalled();
    expect(zoho.dispatch).not.toHaveBeenCalled();
    expect(outcomes).toEqual(['opted_out']);
    // Zoho alone (Meta not approved yet) also honours it.
    const { c: empty } = catalogWith({}); await empty.refresh();
    const r2 = await new FailoverWhatsAppProvider(new MetaWhatsAppAdapter(empty, async () => null), zoho as unknown as INotificationProvider, async () => 'RECIPIENT_OPTED_OUT').dispatch(payload);
    expect(r2.providerCode).toBe('RECIPIENT_OPTED_OUT');
    expect(zoho.dispatch).not.toHaveBeenCalled();
  });
  it('a refused token is reported as auth_rejected (the team is paged)', async () => {
    const { c } = catalogWith({ goldplus_payment_received: 'APPROVED' }); await c.refresh();
    const seen: Array<[string, string | null]> = [];
    const meta = new MetaWhatsAppAdapter(c, async () => null, (async () => json(401, { error: { code: 190 } })) as unknown as typeof fetch, { onOutcome: (o, k) => seen.push([o, k]) });
    await meta.dispatch(payload);
    expect(seen).toEqual([['failed', 'auth_rejected']]);
  });
});

describe('a template changed in code after Meta approved it', () => {
  const original = { ...process.env };
  beforeEach(() => { process.env = { ...LIVE_ENV }; });
  afterEach(() => { process.env = original; });
  it('is not used (old words), shows as out of date, and is sent to Meta as an edit of the same template', async () => {
    const posts: Array<{ url: string; body: any }> = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (!init?.method) return json(200, { data: [
        { id: '900', name: 'goldplus_order_delivered', status: 'APPROVED', language: 'en', components: [{ type: 'BODY', text: 'Old words {{customer_name}} {{order_number}} {{support_phone}} end.' }] },
        { id: '901', name: 'goldplus_payment_received', status: 'APPROVED', language: 'en', components: [{ type: 'BODY', text: WHATSAPP_TEMPLATES.ORDER_PAYMENT_SUCCESS!.body }] },
      ] });
      posts.push({ url, body: JSON.parse(String(init.body)) });
      return json(200, { success: true });
    });
    const c = new MetaWhatsAppTemplateCatalog(async () => null, fetchImpl as unknown as typeof fetch);
    await c.refresh();
    expect(c.approved('goldplus_order_delivered')).toBe(false);
    expect(c.approved('goldplus_payment_received')).toBe(true);
    expect((await c.rows()).rows.find((r) => r.name === 'goldplus_order_delivered')!.status).toBe('OUT_OF_DATE');
    await c.submitMissing();
    const edit = posts.find((p) => p.url.endsWith('/900'))!;
    expect(edit.body).toEqual({ components: (metaTemplateCreateBody(WHATSAPP_TEMPLATES.ORDER_FULFILLMENT_COMPLETED!) as any).components });
    expect(posts.some((p) => p.url.endsWith('/901'))).toBe(false);
  });
});

import { createHmac } from 'node:crypto';
import { WhatsAppAdsUseCases } from '../../apps/api/src/application/use-cases/advertising/WhatsAppAdsUseCases';

describe('the signed webhook, end to end', () => {
  const appSecret = 'test-app-secret-for-signatures';
  const repo = { record: vi.fn(async () => true), latestFor: vi.fn(async () => null), markAttributed: vi.fn(async () => undefined), purgeBefore: vi.fn(async () => 0) };
  const uc = () => new WhatsAppAdsUseCases(repo as never, async () => ({ live: false, wabaId: '444555666', windowDays: 7, datasetId: null, secrets: { appSecret, verifyToken: 'v', accessToken: 'tok' } }) as never);
  const body = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ id: '444555666', changes: [
    { field: 'messages', value: { metadata: { phone_number_id: '111222333' }, contacts: [{ wa_id: '256772123456', profile: { name: 'Sarah' } }], messages: [{ from: '256772123456', id: 'wamid.in', timestamp: '1760000000', type: 'text', text: { body: 'Hello' } }], statuses: [{ id: 'wamid.out', status: 'failed', errors: [{ code: 131026, title: 'Message undeliverable' }] }] } },
    { field: 'message_template_status_update', value: { event: 'PAUSED', message_template_name: 'goldplus_order_on_the_way', reason: 'LOW_QUALITY' } },
  ] }] });
  it('one delivery reaches Goldie, the receipt handler and the account handler; a forged one reaches none', async () => {
    const u = uc();
    const inbound = vi.fn(), receipts = vi.fn(), events = vi.fn();
    u.onInboundText(inbound); u.onDeliveryReceipts(receipts); u.onAccountEvents(events);
    const forged = await u.receive(body, 'sha256=00');
    expect(forged.status).toBe(401);
    expect(inbound).not.toHaveBeenCalled();
    const ok = await u.receive(body, `sha256=${createHmac('sha256', appSecret).update(body).digest('hex')}`);
    expect(ok.status).toBe(200);
    expect(inbound.mock.calls[0]![0][0]).toMatchObject({ from: '256772123456', text: 'Hello' });
    expect(receipts.mock.calls[0]![0]).toEqual([{ messageId: 'wamid.out', status: 'failed', errorCode: 131026, errorTitle: 'Message undeliverable', recipientId: null }]);
    expect(events.mock.calls[0]![0][0]).toMatchObject({ field: 'message_template_status_update', event: 'PAUSED', bad: true });
  });

  it('every delivery leaves a trace for the admin: refused (with why), accepted (what it held), foreign account flagged', async () => {
    const u = uc();
    await u.receive(body, 'sha256=00');
    expect(u.recentDeliveries()[0]).toMatchObject({ status: 401, note: 'signature did not match the saved app secret' });
    await u.receive(body, `sha256=${createHmac('sha256', appSecret).update(body).digest('hex')}`);
    expect(u.recentDeliveries()[0]).toMatchObject({ status: 200, entryIds: ['444555666'], messages: 1, receipts: 1, events: 1 });
    expect(u.recentDeliveries()[0]!.note).toBeUndefined();
    const other = body.replace(/444555666/g, '999888777');
    await u.receive(other, `sha256=${createHmac('sha256', appSecret).update(other).digest('hex')}`);
    expect(u.recentDeliveries()[0]).toMatchObject({ status: 200, messages: 0, note: 'ignored entries for account 999888777 (ours: 444555666)' });
    expect(u.recentDeliveries()).toHaveLength(3);
  });
});

describe('second round of hardening', () => {
  const original = { ...process.env };
  beforeEach(() => { process.env = { ...LIVE_ENV }; });
  afterEach(() => { process.env = original; });
  const payload = { recipient: '0772123456', template: 'ORDER_PAYMENT_SUCCESS', data: ORDER, relatedEntity: 'order', relatedEntityId: null };

  it('a template Meta moved to Marketing is never used for an order update, and shows why', async () => {
    const fetchImpl = vi.fn(async () => json(200, { data: [{ id: '1', name: 'goldplus_payment_received', status: 'APPROVED', language: 'en', category: 'MARKETING', components: [{ type: 'BODY', text: WHATSAPP_TEMPLATES.ORDER_PAYMENT_SUCCESS!.body }] }] }));
    const c = new MetaWhatsAppTemplateCatalog(async () => null, fetchImpl as unknown as typeof fetch);
    await c.refresh();
    expect(c.approved('goldplus_payment_received')).toBe(false);
    expect((await c.rows()).rows.find((r) => r.name === 'goldplus_payment_received')!.status).toBe('RECATEGORISED');
    expect(parseAccountEvents({ object: 'whatsapp_business_account', entry: [{ id: '444555666', changes: [{ field: 'template_category_update', value: { message_template_name: 'goldplus_payment_received', new_category: 'MARKETING', previous_category: 'UTILITY' } }] }] }, '444555666')[0]).toMatchObject({ event: 'CATEGORY_MARKETING', bad: true });
  });

  it('a number Meta could not reach lately goes straight to SMS (even the phone code), and Zoho is not tried', async () => {
    const { c } = catalogWith({ goldplus_payment_received: 'APPROVED', goldplus_phone_code: 'APPROVED' }); await c.refresh();
    const send = vi.fn();
    const meta = new MetaWhatsAppAdapter(c, async () => null, send as unknown as typeof fetch, { blockReason: async () => 'RECIPIENT_NOT_ON_WHATSAPP' });
    const zoho = { canCarry: vi.fn(() => true), dispatch: vi.fn() };
    const r = await new FailoverWhatsAppProvider(meta, zoho as unknown as INotificationProvider, async () => 'RECIPIENT_NOT_ON_WHATSAPP').dispatch(payload);
    expect(r.providerCode).toBe('RECIPIENT_NOT_ON_WHATSAPP');
    const code = await meta.dispatch({ ...payload, template: 'PHONE_VERIFICATION', data: { code: '123456' } });
    expect(code.providerCode).toBe('RECIPIENT_NOT_ON_WHATSAPP');
    expect(send).not.toHaveBeenCalled();
    expect(zoho.dispatch).not.toHaveBeenCalled();
  });

  it('an accepted send is remembered (for the SMS fallback); a 131026 refusal marks the number', async () => {
    const { c } = catalogWith({ goldplus_payment_received: 'APPROVED' }); await c.refresh();
    const sent: string[] = [], undeliverable: string[] = [];
    const ok = new MetaWhatsAppAdapter(c, async () => null, (async () => json(200, { messages: [{ id: 'wamid.ok' }] })) as unknown as typeof fetch, { onSent: (id) => sent.push(id) });
    await ok.dispatch(payload);
    expect(sent).toEqual(['wamid.ok']);
    const refused = new MetaWhatsAppAdapter(c, async () => null, (async () => json(400, { error: { code: 131026 } })) as unknown as typeof fetch, { onUndeliverable: (p) => undeliverable.push(p) });
    await refused.dispatch(payload);
    expect(undeliverable).toEqual(['+256772123456']);
  });
});

import { CareAlertChannels } from '../../apps/api/src/infrastructure/assistant/GoldieChannelAdapters';
describe('staff WhatsApp alerts', () => {
  it('are not tried until Meta has approved the alert template', async () => {
    const messenger = { sendTemplate: vi.fn(async () => ({ ok: true as const })) };
    const settings = () => ({ enabled: true, onlyNumbers: [], phoneNumberId: '111222333' });
    const before = new CareAlertChannels(messenger as never, settings, () => false);
    expect(await before.whatsapp({ to: '0705004545', message: 'x' })).toMatchObject({ queued: false });
    expect(messenger.sendTemplate).not.toHaveBeenCalled();
    const after = new CareAlertChannels(messenger as never, settings, () => true);
    expect(await after.whatsapp({ to: '0705004545', message: 'x' })).toMatchObject({ queued: true });
    expect(messenger.sendTemplate).toHaveBeenCalledWith(expect.objectContaining({ to: '256705004545', template: 'goldplus_care_alert', language: 'en' }));
  });
});

import { isOwnAccount } from '../../apps/api/src/domain/assistant/WhatsAppGoldie';
describe("Meta's WhatsApp account / Messaging account split", () => {
  const original = { ...process.env };
  afterEach(() => { process.env = original; });
  it('webhooks are accepted for either of the shop\'s own ids, and nobody else\'s', () => {
    expect(isOwnAccount('1070547395884403', '1070547395884403,2297240887691836')).toBe(true);
    expect(isOwnAccount('2297240887691836', '1070547395884403,2297240887691836')).toBe(true);
    expect(isOwnAccount('999', '1070547395884403,2297240887691836')).toBe(false);
    expect(isOwnAccount('', '1070547395884403')).toBe(false);
  });
  it('templates are read from the Messaging account first, then the WhatsApp account, and the one that answers is kept', async () => {
    process.env = { ...LIVE_ENV, WHATSAPP_WABA_ID: '1070547395884403', WHATSAPP_MESSAGING_ACCOUNT_ID: '2297240887691836' };
    const urls: string[] = [];
    const fetchImpl = vi.fn(async (url: string) => {
      urls.push(url);
      return url.includes('/2297240887691836/') ? json(400, { error: { code: 100, message: 'Unsupported get request' } }) : json(200, { data: [{ name: 'goldplus_payment_received', status: 'APPROVED', language: 'en', category: 'UTILITY', components: [{ type: 'BODY', text: WHATSAPP_TEMPLATES.ORDER_PAYMENT_SUCCESS!.body }] }] });
    });
    const c = new MetaWhatsAppTemplateCatalog(async () => null, fetchImpl as unknown as typeof fetch);
    await c.refresh();
    expect(urls.map((u) => u.split('/')[4])).toEqual(['2297240887691836', '1070547395884403']);
    expect(c.approved('goldplus_payment_received')).toBe(true);
    expect((await c.credentials()).wabaId).toBe('1070547395884403');
  });
});
