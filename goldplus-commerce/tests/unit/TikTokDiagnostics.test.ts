import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { TikTokDiagnosticsUseCases, isTikTokTestEventCode } from '../../apps/api/src/application/use-cases/advertising/TikTokDiagnosticsUseCases';
import { HttpTikTokDiagnosticsGateway } from '../../apps/api/src/infrastructure/advertising/HttpTikTokDiagnosticsGateway';

const sha = (v: string) => createHash('sha256').update(v).digest('hex');
const input = (over: Record<string, unknown> = {}) => ({ config: { pixelCode: 'C0ABCDEFGH12345' }, token: 'TT-SECRET-TOKEN', testEventCode: 'TEST12345', kind: 'view' as const,
  origin: 'https://shopgoldplus.com', eventId: 'goldplus-connection-test-1', eventTime: 1790000000, ...over });
const fetchStub = (status: number, body: unknown, seen: any[] = []) => (async (url: string, init: any) => { seen.push({ url: String(url), init, body: JSON.parse(init.body) }); return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }); }) as never;

describe('TikTok test event: the gateway', () => {
  it('sends one event built as a real one is, in test mode, with the code — to TikTok\'s fixed address, token in the header only', async () => {
    const seen: any[] = [];
    const r = await new HttpTikTokDiagnosticsGateway(fetchStub(200, { code: 0, message: 'OK', request_id: 'req-1', data: {} }, seen)).sendTestEvent(input());
    expect(r).toEqual({ ok: true, requestId: 'req-1', sentValue: null });               // no rate saved: no amount
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe('https://business-api.tiktok.com/open_api/v1.3/event/track/');
    expect(seen[0].init.headers['Access-Token']).toBe('TT-SECRET-TOKEN');
    expect(seen[0].url).not.toContain('TT-SECRET-TOKEN');
    expect(seen[0].init.body).not.toContain('TT-SECRET-TOKEN');
    expect(seen[0].body).toMatchObject({ event_source: 'web', event_source_id: 'C0ABCDEFGH12345', test_event_code: 'TEST12345' });
    const ev = seen[0].body.data[0];
    expect(ev).toMatchObject({ event: 'ViewContent', event_id: 'goldplus-connection-test-1', page: { url: 'https://shopgoldplus.com/' } });
    expect(ev.user).toEqual({ external_id: sha('goldplus-connection-test'), user_agent: 'GoldPlus connection test (not a visitor)' });   // no real person
  });
  it('a test purchase carries an order number, and its amount in US dollars when a rate is saved', async () => {
    const seen: any[] = [];
    const r = await new HttpTikTokDiagnosticsGateway(fetchStub(200, { code: 0, request_id: 'req-2' }, seen)).sendTestEvent(input({ kind: 'purchase', config: { pixelCode: 'C0ABCDEFGH12345', ugxPerUsd: '4000' } }));
    expect(r).toEqual({ ok: true, requestId: 'req-2', sentValue: { value: 0.25, currency: 'USD' } });
    expect(seen[0].body.data[0]).toMatchObject({ event: 'Purchase', page: { url: 'https://shopgoldplus.com/checkout' }, properties: { currency: 'USD', value: 0.25 } });
    expect(seen[0].body.data[0].properties.order_id).toMatch(/^TEST-/);
  });
  it('TikTok\'s refusal is reported in its own words, whatever the HTTP status; a token problem is named as one', async () => {
    const bad = await new HttpTikTokDiagnosticsGateway(fetchStub(400, { code: 40002, message: 'Invalid value for event_source_id', request_id: 'r3' })).sendTestEvent(input());
    expect(bad).toEqual({ ok: false, message: 'TikTok error 40002: Invalid value for event_source_id (request_id r3)', credentials: false, transient: false });
    const inside200 = await new HttpTikTokDiagnosticsGateway(fetchStub(200, { code: 40105, message: 'Access token is incorrect or has been revoked' })).sendTestEvent(input());
    expect(inside200).toMatchObject({ ok: false, credentials: true });
    const limited = await new HttpTikTokDiagnosticsGateway(fetchStub(401, { code: 40100, message: 'Too many requests' })).sendTestEvent(input());
    expect(limited).toMatchObject({ ok: false, transient: true, credentials: false });
    expect(await new HttpTikTokDiagnosticsGateway(fetchStub(502, '<html>')).sendTestEvent(input())).toMatchObject({ ok: false, transient: true });
    expect(await new HttpTikTokDiagnosticsGateway(fetchStub(200, 'not json')).sendTestEvent(input())).toMatchObject({ ok: false });
    const down = await new HttpTikTokDiagnosticsGateway((async () => { throw new Error('boom TT-SECRET-TOKEN'); }) as never).sendTestEvent(input());
    expect(down).toMatchObject({ ok: false, transient: true });
    expect(JSON.stringify(down)).not.toContain('TT-SECRET-TOKEN');
  });
});

describe('TikTok test event: the use case', () => {
  const make = (over: { gateway?: any; destination?: any; origin?: string | null } = {}) => {
    const audits: any[] = [];
    const calls: any[] = [];
    const gateway = over.gateway ?? { sendTestEvent: async (i: any) => { calls.push(i); return { ok: true, requestId: 'req-9', sentValue: null }; } };
    const uc = new TikTokDiagnosticsUseCases(gateway, over.destination ?? (async () => ({ config: { pixelCode: 'C0ABCDEFGH12345' }, token: 'TT-SECRET-TOKEN' })),
      { execute: async (a: any) => { audits.push(a); } } as never, () => (over.origin === undefined ? 'https://shopgoldplus.com' : over.origin), () => 1790000000000);
    return { uc, audits, calls };
  };
  it('refuses a code that is not one, a destination that is not set up and a missing storefront address — and sends nothing', async () => {
    expect(isTikTokTestEventCode('TEST12345')).toBe(true);
    expect(isTikTokTestEventCode('no spaces')).toBe(false);
    const a = make();
    expect(await a.uc.sendTestEvent('u1', 'x y')).toMatchObject({ ok: false });
    const b = make({ destination: async () => { throw new Error('Not configured: enter the TikTok pixel code on the Advertising page.'); } });
    expect(await b.uc.sendTestEvent('u1', 'TEST12345')).toEqual({ ok: false, message: 'Not configured: enter the TikTok pixel code on the Advertising page.' });
    const c = make({ origin: null });
    expect((await c.uc.sendTestEvent('u1', 'TEST12345') as any).message).toContain('PUBLIC_SITE_ORIGIN');
    expect([...a.calls, ...b.calls, ...c.calls]).toHaveLength(0);
    expect([...a.audits, ...b.audits, ...c.audits]).toHaveLength(0);
  });
  it('sends once, audits what happened without the token, and reports TikTok\'s answer', async () => {
    const ok = make();
    const r = await ok.uc.sendTestEvent('u1', ' TEST12345 ', 'purchase');
    expect(r).toMatchObject({ ok: true, eventName: 'Purchase', requestId: 'req-9', sentValue: null });
    expect(ok.calls).toHaveLength(1);
    expect(ok.calls[0]).toMatchObject({ testEventCode: 'TEST12345', kind: 'purchase', origin: 'https://shopgoldplus.com', eventTime: 1790000000 });
    expect(ok.audits).toHaveLength(1);
    expect(ok.audits[0]).toMatchObject({ actorId: 'u1', action: 'AD_TEST_EVENT_SENT', entityId: 'tiktok', newState: { accepted: true, eventName: 'Purchase', pixelCode: 'C0ABCDEFGH12345' } });
    expect(JSON.stringify(ok.audits)).not.toContain('TT-SECRET-TOKEN');
    const refused = make({ gateway: { sendTestEvent: async () => ({ ok: false, message: 'TikTok error 40002: bad', credentials: false, transient: false }) } });
    expect(await refused.uc.sendTestEvent('u1', 'TEST12345')).toEqual({ ok: false, message: 'TikTok error 40002: bad' });
    expect(refused.audits[0].newState).toMatchObject({ accepted: false, refusal: 'TikTok error 40002: bad' });
    const thrown = make({ gateway: { sendTestEvent: async () => { throw new Error('socket'); } } });
    expect((await thrown.uc.sendTestEvent('u1', 'TEST12345') as any).message).toContain('TikTok could not be reached');
  });
});
