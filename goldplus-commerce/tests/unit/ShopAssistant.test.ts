import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The shop assistant (2026-10-12): the Messages API call, the streamed reply,
 * the tool round-trip, the stop reasons, and the endpoint's gates. The upstream
 * is a fake SSE stream; the shop tools are stubbed at the module boundary so
 * the loop's wiring is what is under test.
 */
const callTool = vi.fn();
vi.mock('../../apps/web/src/lib/agentTools', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../apps/web/src/lib/agentTools')>();
  return { ...actual, callTool: (...a: unknown[]) => callTool(...a) };
});
vi.mock('../../apps/web/src/lib/api', () => ({ apiBase: 'http://api.test' }));
vi.mock('../../apps/web/src/lib/businessInfo', () => ({ getBusinessInfo: async () => ({ whatsappUrl: 'https://wa.me/256705004545' }) }));
vi.mock('../../apps/web/src/lib/catalogue', () => ({ fetchApprovedCatalogueWithStatus: async () => ({ products: [], complete: true }) }));
vi.mock('../../apps/web/src/lib/storefrontDiscount', () => ({ getStorefrontDiscount: async () => null }));

const sse = (events: Array<Record<string, unknown>>): string => events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
const textTurn = (text: string, stop = 'end_turn') => sse([
  { type: 'message_start', message: { usage: { input_tokens: 120, cache_read_input_tokens: 900 } } },
  { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
  ...text.split(' ').map((w, i) => ({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: (i ? ' ' : '') + w } })),
  { type: 'content_block_stop', index: 0 },
  { type: 'message_delta', delta: { stop_reason: stop }, usage: { output_tokens: 9 } },
  { type: 'message_stop' },
]);
const toolTurn = (name: string, input: Record<string, unknown>) => sse([
  { type: 'message_start', message: { usage: { input_tokens: 100 } } },
  { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Let me check.' } },
  { type: 'content_block_stop', index: 0 },
  { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'toolu_1', name, input: {} } },
  { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: JSON.stringify(input).slice(0, 8) } },
  { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: JSON.stringify(input).slice(8) } },
  { type: 'content_block_stop', index: 1 },
  { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 20 } },
  { type: 'message_stop' },
]);
const streamResponse = (body: string, status = 200) => new Response(body, { status, headers: { 'Content-Type': 'text/event-stream' } });

const fetchMock = vi.fn();
const collect = async (gen: AsyncIterable<unknown>) => { const out: unknown[] = []; for await (const e of gen) out.push(e); return out; };

beforeEach(() => { fetchMock.mockReset(); callTool.mockReset(); vi.stubGlobal('fetch', fetchMock); });
afterEach(() => { vi.unstubAllGlobals(); delete process.env.ANTHROPIC_API_KEY; });

describe('assistant engine', () => {
  it('refuses a malformed conversation and keeps a sane one', async () => {
    const { validateTurns } = await import('../../apps/web/src/lib/assistant');
    expect(validateTurns(null)).toBeNull();
    expect(validateTurns([])).toBeNull();
    expect(validateTurns([{ role: 'assistant', content: 'hi' }])).toBeNull();
    expect(validateTurns([{ role: 'user', content: '  ' }])).toBeNull();
    expect(validateTurns([{ role: 'user', content: 'a' }, { role: 'user', content: 'b' }])).toBeNull();
    expect(validateTurns([{ role: 'system', content: 'x' }])).toBeNull();
    expect(validateTurns([{ role: 'user', content: 'hello\u0000there' }])).toEqual([{ role: 'user', content: 'hellothere' }]);
    const long = Array.from({ length: 31 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `t${i}` }));
    expect(validateTurns(long)?.length).toBeLessThanOrEqual(12);
    expect(validateTurns(long)?.[0].role).toBe('user');
  });

  it('streams the answer and sends the documented request: model, fallbacks, cached system prompt, the five shop tools', async () => {
    fetchMock.mockResolvedValueOnce(streamResponse(textTurn('Hello from the shop')));
    const { runAssistant } = await import('../../apps/web/src/lib/assistant');
    const events = await collect(runAssistant([{ role: 'user', content: 'hi' }], { apiKey: 'k', fetchImpl: fetchMock as never }));
    expect(events.filter((e: any) => e.type === 'text').map((e: any) => e.text).join('')).toBe('Hello from the shop');
    expect(events.at(-1)).toEqual({ type: 'done', usage: { input: 1020, output: 9 } });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(init.headers['x-api-key']).toBe('k');
    expect(init.headers['anthropic-version']).toBe('2023-06-01');
    expect(init.headers['anthropic-beta']).toBe('server-side-fallback-2026-07-01');
    const body = JSON.parse(init.body);
    expect(body.model).toBe('claude-opus-5-5');
    expect(body.stream).toBe(true);
    expect(body.fallbacks).toBe('default');
    expect(body.output_config).toEqual({ effort: 'low' });
    expect(body.system[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(body.tools.map((t: any) => t.name)).toEqual(['search_products', 'get_product', 'list_categories', 'find_battery', 'store_info']);
    expect(body.messages).toEqual([{ role: 'user', content: 'hi' }]);
  });

  it('runs the tool Claude asks for and feeds the result back as a tool_result', async () => {
    fetchMock.mockResolvedValueOnce(streamResponse(toolTurn('search_products', { query: 'charger', limit: 3 })));
    fetchMock.mockResolvedValueOnce(streamResponse(textTurn('The GP-C11 is UGX 65,000.')));
    callTool.mockResolvedValueOnce({ content: [{ type: 'text', text: '1 product for "charger":\n- GP-C11 — UGX 65,000' }], structuredContent: { count: 1 } });
    const { runAssistant } = await import('../../apps/web/src/lib/assistant');
    const events = await collect(runAssistant([{ role: 'user', content: 'a charger?' }], { apiKey: 'k', fetchImpl: fetchMock as never }));
    expect(callTool).toHaveBeenCalledWith('search_products', { query: 'charger', limit: 3 });
    expect(events).toContainEqual({ type: 'tool', name: 'search_products' });
    expect(events.filter((e: any) => e.type === 'text').map((e: any) => e.text).join('')).toBe('Let me check.The GP-C11 is UGX 65,000.');
    const second = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(second.messages[1]).toEqual({ role: 'assistant', content: [{ type: 'text', text: 'Let me check.' }, { type: 'tool_use', id: 'toolu_1', name: 'search_products', input: { query: 'charger', limit: 3 } }] });
    expect(second.messages[2]).toEqual({ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: '1 product for "charger":\n- GP-C11 — UGX 65,000' }] });
  });

  it('an unknown tool or a tool failure goes back as an error result, never a crash', async () => {
    fetchMock.mockResolvedValueOnce(streamResponse(toolTurn('delete_everything', {})));
    fetchMock.mockResolvedValueOnce(streamResponse(textTurn('Sorry, I cannot do that.')));
    const { runAssistant } = await import('../../apps/web/src/lib/assistant');
    await collect(runAssistant([{ role: 'user', content: 'x' }], { apiKey: 'k', fetchImpl: fetchMock as never }));
    expect(callTool).not.toHaveBeenCalled();
    const second = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(second.messages[2].content[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'toolu_1', is_error: true });
  });

  it('a refusal hands over to WhatsApp; a 429 upstream says busy; an unreachable upstream says unavailable', async () => {
    const { runAssistant } = await import('../../apps/web/src/lib/assistant');
    fetchMock.mockResolvedValueOnce(streamResponse(textTurn('', 'refusal')));
    let events = await collect(runAssistant([{ role: 'user', content: 'x' }], { apiKey: 'k', fetchImpl: fetchMock as never }));
    expect((events as any[]).some((e) => e.type === 'text' && /WhatsApp/.test(e.text))).toBe(true);
    expect(events.at(-1)).toMatchObject({ type: 'done' });
    fetchMock.mockResolvedValueOnce(new Response('rate limited', { status: 429 }));
    events = await collect(runAssistant([{ role: 'user', content: 'x' }], { apiKey: 'k', fetchImpl: fetchMock as never }));
    expect(events).toEqual([{ type: 'error', code: 'BUSY', message: expect.stringMatching(/busy/i) }]);
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    events = await collect(runAssistant([{ role: 'user', content: 'x' }], { apiKey: 'k', fetchImpl: fetchMock as never }));
    expect(events).toEqual([{ type: 'error', code: 'UNAVAILABLE', message: expect.stringMatching(/not available/i) }]);
  });

  it('a tool loop that never settles stops after the round cap', async () => {
    for (let i = 0; i < 6; i += 1) fetchMock.mockResolvedValueOnce(streamResponse(toolTurn('store_info', {})));
    callTool.mockResolvedValue({ content: [{ type: 'text', text: 'GoldPlus, Kampala.' }] });
    const { runAssistant, MAX_TOOL_ROUNDS } = await import('../../apps/web/src/lib/assistant');
    const events = await collect(runAssistant([{ role: 'user', content: 'x' }], { apiKey: 'k', fetchImpl: fetchMock as never }));
    expect(fetchMock).toHaveBeenCalledTimes(MAX_TOOL_ROUNDS + 1);
    expect(events.at(-1)).toMatchObject({ type: 'done' });
    expect((events as any[]).some((e) => e.type === 'text' && /could not finish/.test(e.text))).toBe(true);
  });
});

describe('POST /api/assistant/chat', () => {
  const post = async (body: unknown, ip = '203.0.113.9') => {
    const mod = await import('../../apps/web/src/pages/api/assistant/chat');
    return (mod.POST as any)({ request: new Request('https://shopgoldplus.com/api/assistant/chat', { method: 'POST', headers: { 'x-real-ip': ip, 'Content-Type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) }), clientAddress: '10.0.0.1' }) as Promise<Response>;
  };

  it('answers 503 without an API key, so a host without one never calls out', async () => {
    const res = await post({ messages: [{ role: 'user', content: 'hi' }] });
    expect(res.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a bad body and streams a good one as data: frames ending with done', async () => {
    process.env.ANTHROPIC_API_KEY = 'k';
    const { resetAssistantBudgets } = await import('../../apps/web/src/pages/api/assistant/chat');
    resetAssistantBudgets();
    expect((await post('not json')).status).toBe(400);
    expect((await post({ messages: [{ role: 'assistant', content: 'x' }] })).status).toBe(400);
    fetchMock.mockResolvedValueOnce(streamResponse(textTurn('Open Monday to Saturday.')));
    const res = await post({ messages: [{ role: 'user', content: 'when are you open?' }] });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const text = await res.text();
    const frames = text.split('\n\n').filter(Boolean).map((f) => JSON.parse(f.replace(/^data: /, '')));
    expect(frames.filter((f) => f.type === 'text').map((f) => f.text).join('')).toBe('Open Monday to Saturday.');
    expect(frames.at(-1)).toMatchObject({ type: 'done' });
  });

  it('budgets a visitor to 30 questions per window and keeps other visitors unaffected', async () => {
    process.env.ANTHROPIC_API_KEY = 'k';
    const { resetAssistantBudgets } = await import('../../apps/web/src/pages/api/assistant/chat');
    resetAssistantBudgets();
    fetchMock.mockImplementation(async () => streamResponse(textTurn('ok')));
    for (let i = 0; i < 30; i += 1) expect((await post({ messages: [{ role: 'user', content: 'q' }] }, '198.51.100.4')).status).toBe(200);
    const blocked = await post({ messages: [{ role: 'user', content: 'q' }] }, '198.51.100.4');
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('retry-after')).toBe('600');
    expect((await post({ messages: [{ role: 'user', content: 'q' }] }, '198.51.100.5')).status).toBe(200);
  });

  it('GET is not a way in', async () => {
    const mod = await import('../../apps/web/src/pages/api/assistant/chat');
    const res = await (mod.GET as any)({ request: new Request('https://shopgoldplus.com/api/assistant/chat') });
    expect(res.status).toBe(405);
  });
});
