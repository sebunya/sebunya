import { afterEach, describe, expect, it, vi } from 'vitest';
import { acknowledge, checkBack, clarifyFirst, readMood } from '../../apps/web/src/lib/goldieEmpathy';
import { findContact, findOrderRef, trackOrder, myLoyalty, myOrders } from '../../apps/web/src/lib/goldieCare';
import { isOrderFollowUp } from '../../apps/web/src/lib/goldieTurn';
import { redact, nextOutcome, worseMood, selfServeRate } from '../../apps/api/src/domain/assistant/ConversationArchive';
import { parseInboundTexts, formatWhatsAppReply, whatsappKey, WHATSAPP_MAX } from '../../apps/api/src/domain/assistant/WhatsAppGoldie';
import { tierStanding } from '../../apps/api/src/domain/loyalty/LoyaltyLedger';
import { ConversationArchiveUseCases } from '../../apps/api/src/application/use-cases/assistant/ConversationArchiveUseCases';
import { GoldieChannelUseCases } from '../../apps/api/src/application/use-cases/assistant/GoldieChannelUseCases';
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
  let n = 0;
  const store: IAssistantConversationStore = {
    async open(i) {
      const found = [...convs.values()].find((c) => c.channel === i.channel && c.channelKey === i.channelKey);
      if (found) { if (i.contact?.phone) found.contactPhone = i.contact.phone; return found; }
      const c: ArchiveConversationRow = { id: `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`, channel: i.channel, channelKey: i.channelKey, customerId: i.customerId, contactName: i.contact?.name ?? null, contactPhone: i.contact?.phone ?? null, contactEmail: null, firstTopic: null, lastTopic: null, worstMood: 'neutral', outcome: 'open', supportTicketId: null, page: i.page, messageCount: 0, aiTurns: 0, humanUntil: null, startedAt: new Date(), lastMessageAt: new Date() };
      convs.set(c.id, c); msgs.set(c.id, []); return c;
    },
    async addMessage(id, m) {
      if (m.channelMessageId) { if (seen.has(m.channelMessageId)) return false; seen.add(m.channelMessageId); }
      msgs.get(id)!.push({ id: String(Math.random()), role: m.role, content: m.content, intent: m.intent ?? null, mood: m.mood ?? null, route: m.route ?? null, createdAt: new Date() });
      convs.get(id)!.messageCount += 1; return true;
    },
    async update(id, p) { const c = convs.get(id)!; if (p.outcome) c.outcome = p.outcome; if (p.worstMood) c.worstMood = p.worstMood; if (p.lastTopic) c.lastTopic = p.lastTopic; if (p.firstTopic) c.firstTopic = p.firstTopic; if (p.humanUntil !== undefined) c.humanUntil = p.humanUntil; if (p.aiTurn) c.aiTurns += 1; },
    async servedMemory() { return []; },
    async findByKey(ch, k) { return [...convs.values()].find((c) => c.channel === ch && c.channelKey === k) ?? null; },
    async get(id) { const c = convs.get(id); return c ? { conversation: c, messages: msgs.get(id)! } : null; },
    async list() { return { rows: [], total: 0 }; },
    async summary() { throw new Error('unused'); },
    async purgeBefore() { return 0; },
  };
  return { store, convs, msgs };
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
