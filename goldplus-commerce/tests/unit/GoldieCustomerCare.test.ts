import { afterEach, describe, expect, it, vi } from 'vitest';
import { acknowledge, checkBack, clarifyFirst, readMood } from '../../apps/web/src/lib/goldieEmpathy';
import { findContact, findOrderRef, trackOrder, myLoyalty, myOrders } from '../../apps/web/src/lib/goldieCare';
import { isOrderFollowUp } from '../../apps/web/src/lib/goldieTurn';
import { redact, nextOutcome, worseMood, selfServeRate } from '../../apps/api/src/domain/assistant/ConversationArchive';
import { parseInboundTexts, formatWhatsAppReply, whatsappKey, WHATSAPP_MAX } from '../../apps/api/src/domain/assistant/WhatsAppGoldie';
import { tierStanding } from '../../apps/api/src/domain/loyalty/LoyaltyLedger';
import { ConversationArchiveUseCases } from '../../apps/api/src/application/use-cases/assistant/ConversationArchiveUseCases';
import { GoldieChannelUseCases, HOLDING_REPLY, MEDIA_REPLY, STOP_REPLY } from '../../apps/api/src/application/use-cases/assistant/GoldieChannelUseCases';
import { GoldieSocialUseCases } from '../../apps/api/src/application/use-cases/assistant/GoldieSocialUseCases';
import { SOCIAL_MAX, formatSocialReply, parseSocialMessages, socialKey } from '../../apps/api/src/domain/assistant/SocialGoldie';
import { createHmac } from 'node:crypto';
import type { IAssistantConversationStore, ArchiveConversationRow, ArchiveMessageRow } from '../../apps/api/src/application/ports/IAssistantConversationStore';

vi.mock('../../apps/web/src/lib/api', () => ({ apiBase: 'http://api.test' }));

/**
 * Owner, 2026-10-13: Goldie must feel human (understand first, read the
 * customer's mood, never rush), handle real customer care (orders, points,
 * delivery) from the commerce engine, work on WhatsApp too, and keep every
 * conversation for the team's meetings. These pin the behaviour.
 */

describe('listening first', () => {
  it('reads how the customer feels', () => {
    expect(readMood('This is the WORST service, my order never came!!!').mood).toBe('upset');
    expect(readMood('Money left my phone but the order says unpaid').mood).toBe('worried');
    expect(readMood("I don't understand which charger I need").mood).toBe('confused');
    expect(readMood('Thank you, got it').mood).toBe('happy');
    expect(readMood('Do you have a 20W charger?').mood).toBe('neutral');
    expect(readMood('Is this charger fake or original?').mood).not.toBe('upset');
  });

  it('acknowledges the customer\'s own situation, in their mood, and checks back when it helps', () => {
    const upset = acknowledge('ORDER', { mood: 'upset', urgent: true }, 'seed-1');
    expect(upset).toMatch(/sorry|hear you|frustrating/i);
    expect(upset).toMatch(/your order/);
    expect(acknowledge('PRODUCT', { mood: 'neutral', urgent: false }, 'x')).toBe('');
    expect(checkBack('ORDER', { mood: 'upset', urgent: true }, 's')).toMatch(/team|anything else/i);
    expect(checkBack('PRODUCT', { mood: 'neutral', urgent: false }, 's')).toBe('');
  });

  it('asks one question when a request is too thin to answer well', () => {
    expect(clarifyFirst('charger', 'PRODUCT')).toMatch(/Which phone or device/);
    expect(clarifyFirst('battery', 'PRODUCT')).toMatch(/exact model/);
    expect(clarifyFirst('I need help', 'UNKNOWN')).toMatch(/Tell me a little/);
    expect(clarifyFirst('Do you have a 20W charger for iPhone 13?', 'PRODUCT')).toBeNull();
  });
});

describe('order care', () => {
  const turns = (...t: Array<[ 'user' | 'assistant', string ]>) => t.map(([role, content]) => ({ role, content }));

  it('finds the reference and the proof the customer typed, newest first', () => {
    const t = turns(['user', 'where is gp-202610-3f7a9c21'], ['assistant', 'What is the phone number or email you used at checkout?'], ['user', 'it is 0772 123 456']);
    expect(findOrderRef(t)).toBe('GP-202610-3F7A9C21');
    expect(findContact(t)).toBe('0772123456');
    expect(isOrderFollowUp(t)).toBe(true);
    expect(findOrderRef(turns(['user', 'GP-DRAFT-1234-ABCD']))).toBeNull();
  });

  afterEach(() => { vi.unstubAllGlobals(); });
  const ctx = { bearer: null, clientAddress: '41.210.1.1', site: 'https://shopgoldplus.com' };

  it('tracks an order through the verified lookup and says it in plain words', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ success: true, data: { orderNumber: 'GP-202610-3F7A9C21', items: [{ name: 'GoldPlus 20W Charger', quantity: 1 }], totalUgx: 45000, deliveryArea: 'Ntinda', paymentStatus: 'paid', orderStatus: 'dispatched', createdAt: '2026-10-12T08:00:00Z' } }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const a = await trackOrder('GP-202610-3F7A9C21', '0772123456', ctx);
    expect(a.ok).toBe(true);
    expect(a.text).toMatch(/on its way/i);
    expect(a.text).toMatch(/keep your phone on/);
    expect(a.text).toMatch(/UGX 45,000/);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://api.test/commerce/orders/lookup');
    expect((init.headers as Record<string, string>)['X-Forwarded-For']).toBe('41.210.1.1');
  });

  it('never says which half was wrong, and respects the lockout', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ success: false, error: { code: 'VERIFICATION_FAILED' } }), { status: 401 })));
    expect((await trackOrder('GP-202610-AAAA1111', '0700000000', ctx)).text).toMatch(/couldn't match .* with that phone number or email/);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 429 })));
    expect((await trackOrder('GP-202610-AAAA1111', '0700000000', ctx)).text).toMatch(/locked for a short while/);
  });

  it('orders and points need a session (or WhatsApp\'s verified number); a guest is never looked up by phone alone', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect((await myOrders(ctx)).text).toMatch(/sign in first/i);
    expect((await myLoyalty(ctx)).text).toMatch(/sign in/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reads points, tier and expiry for a signed-in customer', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ success: true, data: { programmeActive: true, balance: { available: 1250, pendingExpiry: 200 }, pendingPoints: 90, tier: { current: { name: 'Silver' }, next: { name: 'Gold', pointsToGo: 750 } }, soonestExpiry: '2026-11-30T00:00:00Z' } }), { status: 200 })));
    const a = await myLoyalty({ ...ctx, bearer: 'token' });
    expect(a.text).toMatch(/1,250 points/);
    expect(a.text).toMatch(/Silver/);
    expect(a.text).toMatch(/750 more lifetime points take you to Gold/);
    expect(a.text).toMatch(/expire on/);
  });
});

describe('tier standing (same rule as the nightly evaluation)', () => {
  const tiers = [{ code: 'S', name: 'Silver', thresholdLifetimePoints: 1000, rank: 1 }, { code: 'G', name: 'Gold', thresholdLifetimePoints: 3000, rank: 2 }];
  it('places the customer and names the next step', () => {
    expect(tierStanding(500, tiers)).toMatchObject({ current: null, next: { name: 'Silver', pointsToGo: 500 } });
    expect(tierStanding(1200, tiers)).toMatchObject({ current: { name: 'Silver' }, next: { name: 'Gold', pointsToGo: 1800 } });
    expect(tierStanding(5000, tiers)).toMatchObject({ current: { name: 'Gold' }, next: null });
  });
});

describe('the conversation archive', () => {
  it('never keeps a secret', () => {
    expect(redact('my card is 4111 1111 1111 1111')).not.toMatch(/4111/);
    expect(redact('my PIN is 4821')).toBe('my PIN is [removed]');
    expect(redact('OTP: 552190 please')).toContain('[removed]');
    expect(redact('call me on 0772123456')).toContain('0772123456');
  });

  it('files the lowest mood and a sensible outcome', () => {
    expect(worseMood('happy', 'upset')).toBe('upset');
    expect(nextOutcome('open', { mood: 'upset' })).toBe('needs_human');
    expect(nextOutcome('needs_human', { mood: 'happy' })).toBe('needs_human');
    expect(nextOutcome('open', { mood: 'happy' })).toBe('resolved');
    expect(nextOutcome('handed_over', { mood: 'neutral' })).toBe('handed_over');
    expect(selfServeRate({ resolved: 6, open: 2, needs_human: 1, handed_over: 1 })).toBe(0.8);
    expect(selfServeRate({})).toBeNull();
  });
});

function memoryStore() {
  const convs = new Map<string, ArchiveConversationRow>(); const msgs = new Map<string, ArchiveMessageRow[]>(); const seen = new Set<string>();
  let n = 0; const outcomes = new Map<string, string>();
  const store: IAssistantConversationStore = {
    async open(i) {
      const found = [...convs.values()].find((c) => c.channel === i.channel && c.channelKey === i.channelKey);
      if (found) { if (i.contact?.phone) found.contactPhone = i.contact.phone; return found; }
      const c: ArchiveConversationRow = { id: `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`, channel: i.channel, channelKey: i.channelKey, customerId: i.customerId, contactName: i.contact?.name ?? null, contactPhone: i.contact?.phone ?? null, contactEmail: null, firstTopic: null, lastTopic: null, worstMood: 'neutral', outcome: 'open', supportTicketId: null, page: i.page, messageCount: 0, aiTurns: 0, humanUntil: null, startedAt: new Date(), lastMessageAt: new Date() };
      convs.set(c.id, c); msgs.set(c.id, []); return c;
    },
    async addMessage(id, m) {
      if (m.channelMessageId) { if (seen.has(m.channelMessageId)) return false; seen.add(m.channelMessageId); }
      msgs.get(id)!.push({ id: String(Math.random()), role: m.role, content: m.content, intent: m.intent ?? null, mood: m.mood ?? null, route: m.route ?? null, createdAt: new Date(), channelMessageId: m.channelMessageId ?? null } as ArchiveMessageRow);
      convs.get(id)!.messageCount += 1; return true;
    },
    async update(id, p) { const c = convs.get(id)!; if (p.outcome) c.outcome = p.outcome; if (p.worstMood) c.worstMood = p.worstMood; if (p.lastTopic) c.lastTopic = p.lastTopic; if (p.firstTopic) c.firstTopic = p.firstTopic; if (p.humanUntil !== undefined) c.humanUntil = p.humanUntil; if (p.aiTurn) c.aiTurns += 1; },
    async servedMemory() { return []; },
    async findByKey(ch, k) { return [...convs.values()].find((c) => c.channel === ch && c.channelKey === k) ?? null; },
    async get(id) { const c = convs.get(id); return c ? { conversation: c, messages: msgs.get(id)! } : null; },
    async list() { return { rows: [], total: 0 }; },
    async summary() { throw new Error('unused'); },
    async purgeBefore() { return 0; },
    async pendingWhatsApp() { return []; },
    async claimCustomerMessage() { return true; },
    async markCustomerMessage(id, outcome) { outcomes.set(id, outcome); },
    async replyFailuresSince() { return 0; },
    async pendingSocial() {
      return [...convs.values()].filter((c) => c.channel === 'messenger' || c.channel === 'instagram').flatMap((c) => {
        const last = msgs.get(c.id)!.at(-1) as (ArchiveMessageRow & { channelMessageId?: string | null }) | undefined;
        return last && last.role === 'customer' && last.channelMessageId && !outcomes.has(last.channelMessageId)
          ? [{ conversationId: c.id, channel: c.channel as 'messenger' | 'instagram', channelKey: c.channelKey, messageId: last.channelMessageId, text: last.content, at: last.createdAt }] : [];
      });
    },
  };
  return { store, convs, msgs, outcomes };
}

describe('archive use cases', () => {
  it('files both sides with topic and mood, redacted, and a redelivery once', async () => {
    const { store, msgs } = memoryStore();
    const uc = new ConversationArchiveUseCases(store);
    const a = await uc.logTurn({ channel: 'web', channelKey: 'conv-12345678', customerId: null, customer: { content: 'my order never came!!! PIN 1234', channelMessageId: 'w1' }, goldie: { content: "I'm sorry...", route: 'deterministic' }, intent: 'ORDER', mood: 'upset' });
    const thread = await uc.get(a.conversationId);
    expect(thread!.conversation).toMatchObject({ worstMood: 'upset', outcome: 'needs_human', firstTopic: 'ORDER' });
    expect(msgs.get(a.conversationId)!.map((m) => m.role)).toEqual(['customer', 'goldie']);
    expect(msgs.get(a.conversationId)![0]!.content).toContain('PIN [removed]');
    const again = await uc.logTurn({ channel: 'web', channelKey: 'conv-12345678', customerId: null, customer: { content: 'x', channelMessageId: 'w1' } });
    expect(again.duplicate).toBe(true);
  });
});

describe('Goldie on WhatsApp', () => {
  const payload = (text: string, id = 'wamid.1') => ({ object: 'whatsapp_business_account', entry: [{ id: '1234567890', changes: [{ field: 'messages', value: { metadata: { phone_number_id: '111222333' }, contacts: [{ wa_id: '256772123456', profile: { name: 'Sarah N' } }], messages: [{ from: '256772123456', id, timestamp: '1760000000', type: 'text', text: { body: text } }] } }] }] });

  it('reads the customer\'s text from the signed webhook, and nothing from another account', () => {
    const [m] = parseInboundTexts(payload('Where is my order?'), '1234567890');
    expect(m).toMatchObject({ from: '256772123456', name: 'Sarah N', text: 'Where is my order?', messageId: 'wamid.1', phoneNumberId: '111222333' });
    expect(parseInboundTexts(payload('hi'), '999')).toEqual([]);
    expect(whatsappKey('256772123456')).toMatch(/^[0-9a-f]{64}$/);
    expect(whatsappKey('256772123456')).not.toContain('256772123456');
  });

  it('writes a phone-sized reply: words, a few products with links, no panel-only links', () => {
    const out = formatWhatsAppReply({ text: 'We have **two** options.', products: [{ name: 'GoldPlus 20W', url: 'https://shopgoldplus.com/products/a', price_ugx: 45000, availability: 'in_stock' }], links: [{ label: 'Email the team', url: 'https://shopgoldplus.com/support#goldie-team' }, { label: 'Track my order', url: 'https://shopgoldplus.com/track-order' }] });
    expect(out).toContain('*two*');
    expect(out).toContain('• GoldPlus 20W: UGX 45,000, in stock');
    expect(out).not.toContain('goldie-team');
    expect(out).toContain('Track my order: https://shopgoldplus.com/track-order');
    expect(formatWhatsAppReply({ text: 'x'.repeat(5000) }).length).toBeLessThanOrEqual(WHATSAPP_MAX);
  });

  function channel(enabled = true, onlyNumbers: string[] = []) {
    const { store, msgs, convs } = memoryStore();
    const archive = new ConversationArchiveUseCases(store);
    const brain = { turn: vi.fn(async () => ({ text: 'Let me check on your order. Your latest order is on its way.', products: [], links: [], intent: 'ORDER', mood: 'worried', route: 'deterministic' })) };
    const whatsapp = { sendText: vi.fn(async () => ({ ok: true as const, messageId: 'wamid.reply' })) };
    const uc = new GoldieChannelUseCases(archive, brain, whatsapp, () => ({ enabled, onlyNumbers, phoneNumberId: '111222333' }));
    return { uc, brain, whatsapp, msgs, convs, archive };
  }
  const inbound = { from: '256772123456', name: 'Sarah N', text: 'Where is my order?', messageId: 'wamid.1', phoneNumberId: '111222333', at: new Date() };

  it('stays silent until switched on, and only answers test numbers during a trial', async () => {
    const off = channel(false);
    expect(await off.uc.handleWhatsApp(inbound)).toBe('skipped');
    expect(off.whatsapp.sendText).not.toHaveBeenCalled();
    const trial = channel(true, ['256700000000']);
    expect(await trial.uc.handleWhatsApp(inbound)).toBe('skipped');
  });

  it('files the message, answers with the verified number as proof, sends, and files the reply once', async () => {
    const c = channel();
    expect(await c.uc.handleWhatsApp(inbound)).toBe('answered');
    expect(c.brain.turn).toHaveBeenCalledWith(expect.objectContaining({ verifiedPhone: '256772123456', turns: [{ role: 'user', content: 'Where is my order?' }] }));
    expect(c.whatsapp.sendText).toHaveBeenCalledWith({ phoneNumberId: '111222333', to: '256772123456', text: expect.stringContaining('on its way') });
    const [conv] = [...c.convs.values()];
    expect(c.msgs.get(conv!.id)!.map((m) => m.role)).toEqual(['customer', 'goldie']);
    expect(conv).toMatchObject({ contactPhone: '+256772123456', worstMood: 'worried', lastTopic: 'ORDER' });
    expect(await c.uc.handleWhatsApp(inbound)).toBe('duplicate');
    expect(c.whatsapp.sendText).toHaveBeenCalledTimes(1);
  });

  it('never leaves a customer unanswered: if Goldie cannot answer, one holding line and a task for a person', async () => {
    const { store, convs } = memoryStore();
    const archive = new ConversationArchiveUseCases(store);
    const whatsapp = { sendText: vi.fn(async () => ({ ok: true as const, messageId: 'wamid.hold' })) };
    const tasks: unknown[] = [];
    const { HOLDING_REPLY } = await import('../../apps/api/src/application/use-cases/assistant/GoldieChannelUseCases');
    const uc = new GoldieChannelUseCases(archive, { turn: vi.fn(async () => null) }, whatsapp, () => ({ enabled: true, onlyNumbers: [], phoneNumberId: '111222333' }), () => {}, () => new Date(), async () => [], async (t) => { tasks.push(t); });
    expect(await uc.handleWhatsApp(inbound)).toBe('failed');
    expect(whatsapp.sendText).toHaveBeenCalledWith(expect.objectContaining({ text: HOLDING_REPLY }));
    expect(tasks).toHaveLength(1);
    await uc.handleWhatsApp({ ...inbound, messageId: 'wamid.9', text: 'hello??' });
    expect(whatsapp.sendText).toHaveBeenCalledTimes(1); // the holding line is not repeated
    expect([...convs.values()][0]!.messageCount).toBeGreaterThan(0);
  });

  it('links the WhatsApp thread to the account whose verified phone it is', async () => {
    const { store, convs } = memoryStore();
    const archive = new ConversationArchiveUseCases(store);
    const brain = { turn: vi.fn(async () => ({ text: 'Hello Sarah.', products: [], links: [], intent: 'GREETING', mood: 'neutral', route: 'deterministic' })) };
    const uc = new GoldieChannelUseCases(archive, brain, { sendText: vi.fn(async () => ({ ok: true as const, messageId: 'w' })) }, () => ({ enabled: true, onlyNumbers: [], phoneNumberId: '111222333' }), () => {}, () => new Date(), async () => [], async () => undefined, async (d) => (d === '256772123456' ? '11111111-1111-4111-8111-111111111111' : null));
    await uc.handleWhatsApp(inbound);
    expect([...convs.values()][0]!.customerId).toBe('11111111-1111-4111-8111-111111111111');
  });

  it('keeps quiet while a person from the shop has the conversation, and a team reply takes it over', async () => {
    const c = channel();
    await c.uc.handleWhatsApp(inbound);
    const [conv] = [...c.convs.values()];
    const r = await c.uc.teamReply(conv!.id, 'Hi Sarah, this is Grace from GoldPlus. Your rider is 10 minutes away.');
    expect(r).toMatchObject({ ok: true, sent: true });
    expect(conv!.humanUntil!.getTime()).toBeGreaterThan(Date.now());
    expect(await c.uc.handleWhatsApp({ ...inbound, messageId: 'wamid.2', text: 'ok thanks' })).toBe('filed');
    expect(c.whatsapp.sendText).toHaveBeenCalledTimes(2); // Goldie's first answer + the team's reply, nothing after
  });
});

describe('Goldie on Messenger and Instagram', () => {
  const secret = 'meta-app-secret-for-tests';
  const sign = (body: string) => `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
  const delivery = (object: 'page' | 'instagram', text: string, mid = 'm_1', extra: Record<string, unknown> = {}) => JSON.stringify({ object, entry: [{ id: '5550001', time: 1760000000000, messaging: [{ sender: { id: '7000000001' }, recipient: { id: '5550001' }, timestamp: 1760000000000, message: { mid, text, ...extra } }] }] });

  function social(on = { messenger: true, instagram: true }, brainReply: unknown = { text: 'We have **two** chargers that fit.', products: [{ name: 'GoldPlus 20W', url: 'https://shopgoldplus.com/products/a', price_ugx: 45000, availability: 'in_stock' }], links: [], intent: 'PRODUCT', mood: 'neutral', route: 'deterministic' }) {
    const { store, msgs, convs, outcomes } = memoryStore();
    const archive = new ConversationArchiveUseCases(store);
    const brain = { turn: vi.fn(async () => brainReply as never) };
    const sender = { sendText: vi.fn(async () => ({ ok: true as const, messageId: 'mid.reply' })) };
    const tasks: unknown[] = [];
    const uc = new GoldieSocialUseCases(archive, brain, sender, () => on, async () => ({ appSecret: secret, verifyToken: 'verify-me' }), async (t) => { tasks.push(t); });
    return { uc, brain, sender, msgs, convs, outcomes, tasks };
  }

  it('reads text messages for both platforms and ignores echoes, deletions and non-text events', () => {
    expect(parseSocialMessages(JSON.parse(delivery('page', 'Do you have iPhone chargers?')))).toMatchObject([{ platform: 'messenger', senderId: '7000000001', text: 'Do you have iPhone chargers?', messageId: 'm_1' }]);
    expect(parseSocialMessages(JSON.parse(delivery('instagram', 'price?')))[0]!.platform).toBe('instagram');
    expect(parseSocialMessages(JSON.parse(delivery('page', 'our own reply', 'm_2', { is_echo: true })))).toEqual([]);
    expect(parseSocialMessages(JSON.parse(delivery('page', 'gone', 'm_3', { is_deleted: true })))).toEqual([]);
    expect(parseSocialMessages({ object: 'page', entry: [{ messaging: [{ sender: { id: '7000000001' }, recipient: { id: '5550001' }, read: { watermark: 1 } }] }] })).toEqual([]);
    expect(parseSocialMessages({ object: 'whatsapp_business_account', entry: [] })).toEqual([]);
    expect(socialKey('messenger', '7000000001')).toBe('fb:7000000001');
  });

  it('writes plain text inside each platform limit', () => {
    const out = formatSocialReply({ text: 'We have **two** options.', products: [{ name: 'GoldPlus 20W', url: 'https://shopgoldplus.com/products/a', price_ugx: 45000, availability: 'low_stock' }] }, 'messenger');
    expect(out).toContain('We have two options.');
    expect(out).toContain('GoldPlus 20W: UGX 45,000, low stock');
    expect(formatSocialReply({ text: 'x'.repeat(3000) }, 'messenger').length).toBeLessThanOrEqual(SOCIAL_MAX.messenger);
    expect(formatSocialReply({ text: 'x'.repeat(3000) }, 'instagram').length).toBeLessThanOrEqual(SOCIAL_MAX.instagram);
  });

  it('is invisible until switched on, and refuses a delivery without a valid signature', async () => {
    const off = social({ messenger: false, instagram: false });
    expect((await off.uc.receive(delivery('page', 'hi'), sign(delivery('page', 'hi')))).status).toBe(404);
    expect(await off.uc.verifySubscription({ mode: 'subscribe', token: 'verify-me', challenge: '42' })).toBeNull();
    const on = social();
    expect((await on.uc.receive(delivery('page', 'hi'), 'sha256=forged')).status).toBe(401);
    expect(await on.uc.verifySubscription({ mode: 'subscribe', token: 'verify-me', challenge: '42' })).toBe('42');
    expect(await on.uc.verifySubscription({ mode: 'subscribe', token: 'wrong', challenge: '42' })).toBeNull();
    const igOff = social({ messenger: true, instagram: false });
    expect((await igOff.uc.receive(delivery('instagram', 'hi'), sign(delivery('instagram', 'hi')))).messages).toBe(0);
  });

  it('files first, answers through the same brain with no phone proof, sends plain text, and files a redelivery once', async () => {
    const c = social();
    const msg = parseSocialMessages(JSON.parse(delivery('page', 'Do you have iPhone chargers?')))[0]!;
    expect(await c.uc.handle(msg)).toBe('answered');
    expect(c.brain.turn).toHaveBeenCalledWith(expect.objectContaining({ channel: 'messenger', senderId: '7000000001', conversationKey: 'fb:7000000001' }));
    expect(JSON.stringify(c.brain.turn.mock.calls[0])).not.toContain('verifiedPhone');
    expect(c.sender.sendText).toHaveBeenCalledWith(expect.objectContaining({ platform: 'messenger', recipientId: '7000000001', text: expect.stringContaining('We have two chargers that fit.') }));
    const conv = [...c.convs.values()][0]!;
    expect(conv).toMatchObject({ channel: 'messenger', channelKey: 'fb:7000000001' });
    expect(c.msgs.get(conv.id)!.map((m) => m.role)).toEqual(['customer', 'goldie']);
    expect(c.outcomes.get('m_1')).toBe('answered');
    expect(await c.uc.handle(msg)).toBe('duplicate');
    expect(c.sender.sendText).toHaveBeenCalledTimes(1);
  });

  it('when Goldie cannot answer: one holding line, a Care Desk task, and the message marked held', async () => {
    const c = social(undefined, null);
    const msg = parseSocialMessages(JSON.parse(delivery('instagram', 'Is the shop open on Sunday?')))[0]!;
    expect(await c.uc.handle(msg)).toBe('failed');
    expect(c.sender.sendText).toHaveBeenCalledWith(expect.objectContaining({ platform: 'instagram', text: HOLDING_REPLY }));
    expect(c.tasks).toMatchObject([{ kind: 'follow_up', channel: 'instagram', title: expect.stringContaining('Instagram message waiting') }]);
    expect(c.outcomes.get('m_1')).toBe('held');
  });

  it('a message filed but never answered (a restart mid-turn) is answered once by the recovery pass', async () => {
    const c = social();
    const archive = (c.uc as unknown as { archive: ConversationArchiveUseCases }).archive;
    await archive.logTurn({ channel: 'instagram', channelKey: 'ig:7000000001', customerId: null, contact: {}, customer: { content: 'Do you deliver to Jinja?', channelMessageId: 'm_lost' } });
    expect(await c.uc.recoverPending()).toBe(1);
    expect(c.sender.sendText).toHaveBeenCalledWith(expect.objectContaining({ platform: 'instagram', recipientId: '7000000001' }));
    expect(c.outcomes.get('m_lost')).toBe('answered');
    expect(await c.uc.recoverPending()).toBe(0);
  });

  it('a team reply goes back on the same platform and Goldie stays quiet', async () => {
    const c = social();
    const msg = parseSocialMessages(JSON.parse(delivery('page', 'Can someone call me?')))[0]!;
    await c.uc.handle(msg);
    const conv = [...c.convs.values()][0]!;
    expect(await c.uc.teamReply({ id: conv.id, channel: conv.channel, channelKey: conv.channelKey }, 'Hello, this is Grace from the shop.')).toEqual({ ok: true });
    expect(c.sender.sendText).toHaveBeenLastCalledWith({ platform: 'messenger', recipientId: '7000000001', text: 'Hello, this is Grace from the shop.' });
    expect(conv.humanUntil!.getTime()).toBeGreaterThan(Date.now());
    expect(await c.uc.handle({ ...msg, messageId: 'm_9', text: 'thanks' })).toBe('filed');
  });
});

describe('WhatsApp: STOP, media and read receipts', () => {
  const inboundBase = { from: '256772123456', name: 'Sarah N', phoneNumberId: '111222333', at: new Date() };
  function wa(enabled = true) {
    const { store, msgs, convs, outcomes } = memoryStore();
    const archive = new ConversationArchiveUseCases(store);
    const brain = { turn: vi.fn(async () => ({ text: 'Yes, that one is original.', products: [], links: [], intent: 'PRODUCT', mood: 'neutral', route: 'deterministic' })) };
    const whatsapp = { sendText: vi.fn(async () => ({ ok: true as const, messageId: 'wamid.r' })), markRead: vi.fn(async () => undefined) };
    const tasks: Array<Record<string, unknown>> = [];
    const optOuts = { stop: vi.fn(async () => undefined), start: vi.fn(async () => undefined) };
    const uc = new GoldieChannelUseCases(archive, brain, whatsapp, () => ({ enabled, onlyNumbers: [], phoneNumberId: '111222333' }), () => {}, () => new Date(), async () => [], async (t) => { tasks.push(t as Record<string, unknown>); }, async () => null, async () => false, async () => ({ ok: false as const, reason: 'n/a' }), optOuts);
    return { uc, brain, whatsapp, tasks, optOuts, msgs, convs, outcomes };
  }

  it('STOP is recorded and confirmed even while Goldie is switched off; START undoes it', async () => {
    const c = wa(false);
    expect(await c.uc.handleWhatsApp({ ...inboundBase, text: 'STOP', messageId: 'wamid.s1' })).toBe('answered');
    expect(c.optOuts.stop).toHaveBeenCalledWith('+256772123456', 'wamid.s1');
    expect(c.whatsapp.sendText).toHaveBeenCalledWith(expect.objectContaining({ text: STOP_REPLY }));
    await c.uc.handleWhatsApp({ ...inboundBase, text: 'start', messageId: 'wamid.s2' });
    expect(c.optOuts.start).toHaveBeenCalledWith('+256772123456');
    expect(c.brain.turn).not.toHaveBeenCalled();
  });

  it('a photo without words: a task for a person, an honest holding reply, blue ticks', async () => {
    const c = wa();
    const out = await c.uc.handleWhatsApp({ ...inboundBase, text: '[Photo ⟦media:1234567890:image/jpeg⟧]', messageId: 'wamid.p1', media: { kind: 'image', id: '1234567890', mimeType: 'image/jpeg' } });
    expect(out).toBe('answered');
    expect(c.tasks[0]).toMatchObject({ kind: 'follow_up', title: 'WhatsApp photo to look at', customerPhone: '+256772123456' });
    expect(c.whatsapp.sendText).toHaveBeenCalledWith(expect.objectContaining({ text: MEDIA_REPLY.image }));
    expect(c.whatsapp.markRead).toHaveBeenCalledWith({ phoneNumberId: '111222333', messageId: 'wamid.p1', typing: true });
    expect(c.brain.turn).not.toHaveBeenCalled();
  });

  it('a photo with a caption: Goldie answers the words (never sees the raw marker) and a person still looks', async () => {
    const c = wa();
    await c.uc.handleWhatsApp({ ...inboundBase, text: '[Photo ⟦media:1234567890:image/jpeg⟧] Is this charger original?', messageId: 'wamid.p2', media: { kind: 'image', id: '1234567890', mimeType: 'image/jpeg' } });
    expect(c.tasks[0]!.title).toBe('WhatsApp photo to look at: Is this charger original?');
    const sent = JSON.stringify((c.brain.turn.mock.calls[0] as unknown as [unknown])[0]);
    expect(sent).not.toContain('⟦media');
    expect(sent).toContain('Is this charger original?');
  });

  it('a sticker is filed quietly: no task, no reply', async () => {
    const c = wa();
    expect(await c.uc.handleWhatsApp({ ...inboundBase, text: '[Sticker ⟦media:5555566666:image/webp⟧]', messageId: 'wamid.k', media: { kind: 'sticker', id: '5555566666', mimeType: 'image/webp' } })).toBe('filed');
    expect(c.tasks).toEqual([]);
    expect(c.whatsapp.sendText).not.toHaveBeenCalled();
  });
});
