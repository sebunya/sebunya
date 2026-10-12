import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The shop assistant (2026-10-12): the Messages API call shaped for Claude
 * Haiku 5.5, the streamed reply, thinking-block replay, the tool round-trip,
 * product cards from validated tool data, stop reasons, and the endpoint's
 * gates (admission, idempotency, deterministic routes, fallbacks, ledger
 * settlement). The upstream is a fake SSE stream; the shop tools and the
 * admission API are stubbed at their module boundaries.
 */
const callTool = vi.fn();
vi.mock('../../apps/web/src/lib/agentTools', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../apps/web/src/lib/agentTools')>();
  return { ...actual, callTool: (...a: unknown[]) => callTool(...a) };
});
vi.mock('../../apps/web/src/lib/api', () => ({ apiBase: 'http://api.test' }));
vi.mock('../../apps/web/src/lib/businessInfo', () => ({ getBusinessInfo: async () => ({ whatsappUrl: 'https://wa.me/256705004545', mapUrl: 'https://maps.google.com/?cid=1', deliveryNote: 'Same-day in Kampala & Wakiso.' }) }));
vi.mock('../../apps/web/src/lib/storefrontCopy', () => ({ getStorefrontCopy: async () => ({ payment: { pesapal: { label: 'Pay now', description: 'MTN or Airtel Mobile Money, or a card, through PesaPal.' }, offline: { label: 'Pay on confirmation', description: 'We call to confirm, then you pay.' } } }) }));
vi.mock('../../apps/web/src/lib/catalogue', () => ({ fetchApprovedCatalogueWithStatus: async () => ({ products: [], complete: true }) }));
vi.mock('../../apps/web/src/lib/storefrontDiscount', () => ({ getStorefrontDiscount: async () => null }));
const admitMock = vi.fn(); const settleMock = vi.fn(); const releaseMock = vi.fn();
vi.mock('../../apps/web/src/lib/assistantAdmission', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../apps/web/src/lib/assistantAdmission')>();
  return { ...actual, admit: (...a: unknown[]) => admitMock(...a), settle: (...a: unknown[]) => settleMock(...a), release: (...a: unknown[]) => releaseMock(...a) };
});

const sse = (events: Array<Record<string, unknown>>): string => events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
const start = { type: 'message_start', message: { id: 'msg_1', usage: { input_tokens: 120, cache_read_input_tokens: 900, cache_creation_input_tokens: 0 } } };
const textTurn = (text: string, stop = 'end_turn') => sse([
  start,
  { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'sig_abc' } },
  { type: 'content_block_stop', index: 0 },
  { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
  ...text.split(' ').map((w, i) => ({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: (i ? ' ' : '') + w } })),
  { type: 'content_block_stop', index: 1 },
  { type: 'message_delta', delta: { stop_reason: stop }, usage: { output_tokens: 9 } },
  { type: 'message_stop' },
]);
const toolTurn = (name: string, input: Record<string, unknown>) => sse([
  start,
  { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'sig_think' } },
  { type: 'content_block_stop', index: 0 },
  { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
  { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Let me check.' } },
  { type: 'content_block_stop', index: 1 },
  { type: 'content_block_start', index: 2, content_block: { type: 'tool_use', id: 'toolu_1', name, input: {} } },
  { type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: JSON.stringify(input).slice(0, 8) } },
  { type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: JSON.stringify(input).slice(8) } },
  { type: 'content_block_stop', index: 2 },
  { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 20 } },
  { type: 'message_stop' },
]);
const streamResponse = (body: string, status = 200) => new Response(body, { status, headers: { 'Content-Type': 'text/event-stream' } });
const fetchMock = vi.fn();
const collect = async (gen: AsyncIterable<unknown>) => { const out: unknown[] = []; for await (const e of gen) out.push(e); return out; };
const allow = (over: Record<string, unknown> = {}) => ({ decision: 'ALLOW_AI', tier: 'welcome', reason: 'welcome', reservationId: '11111111-1111-4111-8111-111111111111', model: 'claude-haiku-5-5', effort: 'low', maxOutputTokens: 1024, maxToolRounds: 4, degraded: false, ...over });

beforeEach(() => { fetchMock.mockReset(); callTool.mockReset(); admitMock.mockReset(); settleMock.mockReset(); releaseMock.mockReset(); vi.stubGlobal('fetch', fetchMock); settleMock.mockResolvedValue({ costMicroUsd: 1 }); releaseMock.mockResolvedValue({ released: true }); });
afterEach(() => { vi.unstubAllGlobals(); delete process.env.ANTHROPIC_API_KEY; });

describe('assistant engine', () => {
  it('refuses a malformed conversation and keeps a sane one', async () => {
    const { validateTurns } = await import('../../apps/web/src/lib/assistant');
    expect(validateTurns(null)).toBeNull();
    expect(validateTurns([{ role: 'assistant', content: 'hi' }])).toBeNull();
    expect(validateTurns([{ role: 'user', content: 'a' }, { role: 'user', content: 'b' }])).toBeNull();
    expect(validateTurns([{ role: 'user', content: 'hello\u0000there' }])).toEqual([{ role: 'user', content: 'hellothere' }]);
    const long = Array.from({ length: 31 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `t${i}` }));
    expect(validateTurns(long)?.length).toBeLessThanOrEqual(12);
  });

  it('sends the Haiku 5.5 request shape: no sampling params, no fallbacks, effort in output_config, cached system prompt, the five shop tools', async () => {
    fetchMock.mockResolvedValueOnce(streamResponse(textTurn('Hello from the shop')));
    const { runAssistant } = await import('../../apps/web/src/lib/assistant');
    const events = await collect(runAssistant([{ role: 'user', content: 'hi' }], { apiKey: 'k', model: 'claude-haiku-5-5', effort: 'low', fetchImpl: fetchMock as never }));
    expect(events.filter((e: any) => e.type === 'text').map((e: any) => e.text).join('')).toBe('Hello from the shop');
    expect(events.at(-1)).toEqual({ type: 'done', usage: { inputTokens: 120, outputTokens: 9, cacheReadTokens: 900, cacheWriteTokens: 0 }, providerRequestId: 'msg_1', outcome: 'ANSWERED' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(init.headers['anthropic-version']).toBe('2023-06-01');
    expect(init.headers['anthropic-beta']).toBeUndefined();
    expect(init.headers['anthropic-workspace-id']).toBeUndefined();
    const body = JSON.parse(init.body);
    expect(body.model).toBe('claude-haiku-5-5');
    expect(body.fallbacks).toBeUndefined();
    expect(body.temperature).toBeUndefined();
    expect(body.thinking).toBeUndefined();
    expect(body.output_config).toEqual({ effort: 'low' });
    expect(body.max_tokens).toBe(1024);
    expect(body.system[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(body.tools.map((t: any) => t.name)).toEqual(['search_products', 'get_product', 'list_categories', 'find_battery', 'store_info']);
  });

  it('names the workspace only when an organisation-scoped key needs it', async () => {
    fetchMock.mockResolvedValueOnce(streamResponse(textTurn('ok')));
    const { runAssistant } = await import('../../apps/web/src/lib/assistant');
    await collect(runAssistant([{ role: 'user', content: 'hi' }], { apiKey: 'k', workspaceId: 'wrkspc_test', fetchImpl: fetchMock as never }));
    expect(fetchMock.mock.calls[0][1].headers['anthropic-workspace-id']).toBe('wrkspc_test');
  });

  it('keeps the server-side fallback only for models that document one', async () => {
    fetchMock.mockResolvedValueOnce(streamResponse(textTurn('ok')));
    const { runAssistant } = await import('../../apps/web/src/lib/assistant');
    await collect(runAssistant([{ role: 'user', content: 'hi' }], { apiKey: 'k', model: 'claude-opus-5-5', fetchImpl: fetchMock as never }));
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers['anthropic-beta']).toBe('server-side-fallback-2026-07-01');
    expect(JSON.parse(init.body).fallbacks).toBe('default');
  });

  it('runs the tool, replays the thinking block unchanged with the result, and emits product cards from validated data', async () => {
    fetchMock.mockResolvedValueOnce(streamResponse(toolTurn('search_products', { query: 'charger', limit: 3 })));
    fetchMock.mockResolvedValueOnce(streamResponse(textTurn('The GP-C11 is UGX 65,000.')));
    callTool.mockResolvedValueOnce({ content: [{ type: 'text', text: '1 product' }], structuredContent: { count: 1, products: [
      { name: 'GoldPlus Charger GP-C11', url: 'https://shopgoldplus.com/products/goldplus-charger-gp-c11', sku: 'GP-C11', price_ugx: 65000, availability: 'in_stock', images: ['https://shopgoldplus.com/uploads/a.webp'] },
      { name: 'Evil', url: 'https://evil.example/x', sku: null, price_ugx: 1, availability: 'in_stock', images: [] },
    ] } });
    const { runAssistant } = await import('../../apps/web/src/lib/assistant');
    const events = await collect(runAssistant([{ role: 'user', content: 'a charger?' }], { apiKey: 'k', fetchImpl: fetchMock as never }));
    expect(callTool).toHaveBeenCalledWith('search_products', { query: 'charger', limit: 3 });
    expect(events).toContainEqual({ type: 'tool', name: 'search_products' });
    const cards = (events as any[]).find((e) => e.type === 'products');
    expect(cards.items).toEqual([{ name: 'GoldPlus Charger GP-C11', url: 'https://shopgoldplus.com/products/goldplus-charger-gp-c11', sku: 'GP-C11', price_ugx: 65000, availability: 'in_stock', image: 'https://shopgoldplus.com/uploads/a.webp' }]);
    const second = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(second.messages[1].content[0]).toEqual({ type: 'thinking', thinking: '', signature: 'sig_think' });
    expect(second.messages[1].content[2]).toMatchObject({ type: 'tool_use', id: 'toolu_1', name: 'search_products', input: { query: 'charger', limit: 3 } });
    expect(second.messages[2]).toEqual({ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: '1 product' }] });
    const done = events.at(-1) as any;
    expect(done).toMatchObject({ type: 'done', outcome: 'ANSWERED', providerRequestId: 'msg_1' });
    expect(done.usage).toEqual({ inputTokens: 240, outputTokens: 29, cacheReadTokens: 1800, cacheWriteTokens: 0 });
  });

  it('a refusal hands over to WhatsApp; a 429 before output is not billed; an unreachable upstream says unavailable', async () => {
    const { runAssistant } = await import('../../apps/web/src/lib/assistant');
    fetchMock.mockResolvedValueOnce(streamResponse(textTurn('', 'refusal')));
    let events = await collect(runAssistant([{ role: 'user', content: 'x' }], { apiKey: 'k', fetchImpl: fetchMock as never }));
    expect((events as any[]).some((e) => e.type === 'text' && /WhatsApp/.test(e.text))).toBe(true);
    expect(events.at(-1)).toMatchObject({ type: 'done', outcome: 'REFUSAL' });
    fetchMock.mockResolvedValueOnce(new Response('rate limited', { status: 429 }));
    events = await collect(runAssistant([{ role: 'user', content: 'x' }], { apiKey: 'k', fetchImpl: fetchMock as never }));
    expect(events[0]).toMatchObject({ type: 'error', code: 'BUSY', billed: false });
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    events = await collect(runAssistant([{ role: 'user', content: 'x' }], { apiKey: 'k', fetchImpl: fetchMock as never }));
    expect(events[0]).toMatchObject({ type: 'error', code: 'UNAVAILABLE', billed: false });
  });

  it('a tool loop that never settles stops after the configured round cap', async () => {
    for (let i = 0; i < 4; i += 1) fetchMock.mockResolvedValueOnce(streamResponse(toolTurn('store_info', {})));
    callTool.mockResolvedValue({ content: [{ type: 'text', text: 'GoldPlus, Kampala.' }] });
    const { runAssistant } = await import('../../apps/web/src/lib/assistant');
    const events = await collect(runAssistant([{ role: 'user', content: 'x' }], { apiKey: 'k', maxToolRounds: 2, fetchImpl: fetchMock as never }));
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(events.at(-1)).toMatchObject({ type: 'done', outcome: 'TOOL_CAP' });
  });
});

describe('POST /api/assistant/chat', () => {
  const post = async (body: unknown, opts: { ip?: string; requestId?: string } = {}) => {
    const mod = await import('../../apps/web/src/pages/api/assistant/chat');
    const headers: Record<string, string> = { 'x-real-ip': opts.ip ?? '203.0.113.9', 'Content-Type': 'application/json' };
    if (opts.requestId) headers['X-Assistant-Request-Id'] = opts.requestId;
    const cookies = { get: () => undefined };
    return (mod.POST as any)({ request: new Request('https://shopgoldplus.com/api/assistant/chat', { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) }), clientAddress: '10.0.0.1', cookies, locals: {} }) as Promise<Response>;
  };
  const frames = async (res: Response) => (await res.text()).split('\n\n').filter(Boolean).map((f) => JSON.parse(f.replace(/^data: /, '')));

  it('answers 503 without an API key, so a host without one never calls out', async () => {
    const res = await post({ messages: [{ role: 'user', content: 'hi' }] });
    expect(res.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a deterministic question is answered from shop data with no admission reservation and no model call', async () => {
    process.env.ANTHROPIC_API_KEY = 'k';
    const { resetAssistantState } = await import('../../apps/web/src/pages/api/assistant/chat');
    resetAssistantState();
    admitMock.mockResolvedValueOnce(allow({ decision: 'ALLOW_DETERMINISTIC', reservationId: null }));
    callTool.mockResolvedValueOnce({ content: [{ type: 'text', text: 'GoldPlus, Zainab Aziza Building. Open Monday to Saturday.' }], structuredContent: { map: 'https://maps.google.com/?cid=1' } });
    const res = await post({ messages: [{ role: 'user', content: 'Where is the shop and when are you open?' }] });
    expect(res.status).toBe(200);
    expect(res.headers.get('x-assistant-route')).toBe('deterministic');
    expect(admitMock).toHaveBeenCalledWith(expect.objectContaining({ wantsAi: false }));
    expect(fetchMock).not.toHaveBeenCalled();
    const f = await frames(res);
    expect(f.find((x) => x.type === 'text').text).toMatch(/Zainab Aziza/);
    expect(f.at(-1)).toMatchObject({ type: 'done', outcome: 'ANSWERED' });
  });

  it('an interpretive question goes to the model against a reservation, and the usage is settled', async () => {
    process.env.ANTHROPIC_API_KEY = 'k';
    const { resetAssistantState } = await import('../../apps/web/src/pages/api/assistant/chat');
    resetAssistantState();
    admitMock.mockResolvedValueOnce(allow());
    fetchMock.mockResolvedValueOnce(streamResponse(textTurn('The 65W one suits a laptop.')));
    const res = await post({ messages: [{ role: 'user', content: 'Which power bank can charge my laptop?' }] });
    expect(res.headers.get('x-assistant-route')).toBe('ai');
    const f = await frames(res);
    expect(f.filter((x) => x.type === 'text').map((x) => x.text).join('')).toBe('The 65W one suits a laptop.');
    expect(settleMock).toHaveBeenCalledWith(expect.objectContaining({ reservationId: '11111111-1111-4111-8111-111111111111', model: 'claude-haiku-5-5', outcome: 'ANSWERED', usage: { inputTokens: 120, outputTokens: 9, cacheReadTokens: 900, cacheWriteTokens: 0 } }));
    expect(releaseMock).not.toHaveBeenCalled();
  });

  it('a soft limit or budget fallback still answers with a catalogue lookup and the honest sentence; a burst is a 429', async () => {
    process.env.ANTHROPIC_API_KEY = 'k';
    const { resetAssistantState } = await import('../../apps/web/src/pages/api/assistant/chat');
    resetAssistantState();
    admitMock.mockResolvedValueOnce(allow({ decision: 'GLOBAL_BUDGET_FALLBACK', tier: 'progressive', reservationId: null }));
    callTool.mockResolvedValueOnce({ content: [{ type: 'text', text: '1 product' }], structuredContent: { products: [{ name: 'GoldPlus Power Bank GP-P07', url: 'https://shopgoldplus.com/products/gp-p07', sku: 'GP-P07-PB', price_ugx: 120000, availability: 'in_stock', images: [] }] } });
    let res = await post({ messages: [{ role: 'user', content: 'Which power bank can charge my laptop?' }] });
    expect(res.headers.get('x-assistant-route')).toBe('fallback');
    expect(fetchMock).not.toHaveBeenCalled();
    let f = await frames(res);
    expect(f[0].text).toMatch(/I can still help you find products and check delivery/);
    expect(f.find((x) => x.type === 'products').items[0].name).toBe('GoldPlus Power Bank GP-P07');
    admitMock.mockResolvedValueOnce(allow({ decision: 'DENY_EXPENSIVE', retryAfterSeconds: 60, reservationId: null }));
    res = await post({ messages: [{ role: 'user', content: 'x' }] });
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('60');
  });

  it('a 429 from the provider before any output releases the reservation; an unreachable admission API fails closed for paid AI only', async () => {
    process.env.ANTHROPIC_API_KEY = 'k';
    const { resetAssistantState } = await import('../../apps/web/src/pages/api/assistant/chat');
    resetAssistantState();
    admitMock.mockResolvedValueOnce(allow());
    fetchMock.mockResolvedValueOnce(new Response('busy', { status: 429 }));
    await frames(await post({ messages: [{ role: 'user', content: 'Which charger is best for my phone?' }] }));
    expect(releaseMock).toHaveBeenCalledWith({ reservationId: '11111111-1111-4111-8111-111111111111', reason: 'BUSY' });
    expect(settleMock).not.toHaveBeenCalled();
    admitMock.mockResolvedValueOnce(null);
    const res = await post({ messages: [{ role: 'user', content: 'Which charger is best for my phone?' }] });
    expect(res.headers.get('x-assistant-route')).toBe('fallback');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('a retried send with the same request id is answered once', async () => {
    process.env.ANTHROPIC_API_KEY = 'k';
    const { resetAssistantState } = await import('../../apps/web/src/pages/api/assistant/chat');
    resetAssistantState();
    admitMock.mockResolvedValue(allow({ decision: 'ALLOW_DETERMINISTIC', reservationId: null }));
    callTool.mockResolvedValue({ content: [{ type: 'text', text: 'GoldPlus.' }], structuredContent: {} });
    expect((await post({ messages: [{ role: 'user', content: 'where are you?' }] }, { requestId: 'req-00000001' })).status).toBe(200);
    expect((await post({ messages: [{ role: 'user', content: 'where are you?' }] }, { requestId: 'req-00000001' })).status).toBe(409);
    expect((await post({ messages: [{ role: 'user', content: 'where are you?' }] }, { requestId: 'req-00000002' })).status).toBe(200);
  });

  it('GET is not a way in', async () => {
    const mod = await import('../../apps/web/src/pages/api/assistant/chat');
    const res = await (mod.GET as any)({ request: new Request('https://shopgoldplus.com/api/assistant/chat') });
    expect(res.status).toBe(405);
  });
});
