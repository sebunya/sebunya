import { describe, expect, it } from 'vitest';
import { emqBand, isMetaTestEventCode, metaKeyLabel, parseDatasetQuality } from '../../apps/api/src/domain/advertising/MetaDiagnostics';
import { MetaDiagnosticsUseCases, type MetaDestination } from '../../apps/api/src/application/use-cases/advertising/MetaDiagnosticsUseCases';
import { HttpMetaDiagnosticsGateway } from '../../apps/api/src/infrastructure/advertising/HttpMetaDiagnosticsGateway';
import type { MetaAnswer, MetaDiagnosticsGateway } from '../../apps/api/src/application/ports/MetaDiagnostics';
import { explainOutcome } from '../../apps/api/src/domain/advertising/AdActivity';

/**
 * "Live" says the shop is sending. Whether Meta can use what arrives is Meta's
 * to say: these tests pin how its answer is read, and that nothing is made up
 * when it gives none.
 */
describe('Meta dataset quality: reading Meta\'s answer', () => {
  const answer = { web: [
    { event_name: 'ViewContent', event_match_quality: { composite_score: 3.94, match_key_feedback: [
      { identifier: 'user_agent', coverage: { percentage: 100 } }, { identifier: 'fbp', coverage: { percentage: 99.96 } }, { identifier: 'fbc', coverage: { percentage: 12.34 } } ] } },
    { event_name: 'Purchase', event_match_quality: { composite_score: 8.26, match_key_feedback: [
      { identifier: 'email', coverage: { percentage: 71 } }, { identifier: 'phone', coverage: { percentage: 100 } }, { identifier: 'some_new_key', coverage: {} } ] } },
    { event_name: 'AddToCart', event_match_quality: {} },
    { no_name: true },
  ] };
  it('orders the sale first, rounds to one decimal, and keeps "no score" apart from zero', () => {
    const q = parseDatasetQuality(answer);
    expect(q.map((e) => e.event)).toEqual(['Purchase', 'AddToCart', 'ViewContent']);
    expect(q[0]).toMatchObject({ score: 8.3, band: 'high' });
    expect(q[1]).toMatchObject({ score: null, band: 'none', keys: [] });
    expect(q[2]).toMatchObject({ score: 3.9, band: 'low' });
    // Keys are listed by coverage, named for a person; one Meta did not quantify is null, not 0.
    expect(q[0].keys).toEqual([
      { identifier: 'phone', label: 'Phone', percentage: 100 }, { identifier: 'email', label: 'Email', percentage: 71 }, { identifier: 'some_new_key', label: 'some_new_key', percentage: null },
    ]);
    expect(q[2].keys.map((k) => [k.label, k.percentage])).toEqual([['Browser (user agent)', 100], ['Browser ID (fbp)', 100], ['Click ID (fbc)', 12.3]]);
  });
  it('makes nothing of an answer that is not one', () => {
    for (const junk of [null, undefined, {}, { web: 'x' }, { web: [] }, 'text', 42]) expect(parseDatasetQuality(junk)).toEqual([]);
    expect(parseDatasetQuality({ web: [{ event_name: 'Purchase', event_match_quality: { composite_score: 42 } }] })[0].score).toBeNull();   // out of range is not a score
    expect([null, 0, 3.9, 4, 5.9, 6, 7.9, 8, 10].map(emqBand)).toEqual(['none', 'low', 'low', 'fair', 'fair', 'good', 'good', 'high', 'high']);
    expect(metaKeyLabel('fbc')).toBe('Click ID (fbc)');
  });
  it('recognises a test event code as Events Manager issues it', () => {
    for (const ok of ['TEST12345', 'TEST1', ' TEST98765 ']) expect(isMetaTestEventCode(ok), ok).toBe(true);
    for (const bad of ['', 'test12345', '12345', 'TEST', 'TEST 123', 'TEST<script>', null, 12345]) expect(isMetaTestEventCode(bad), String(bad)).toBe(false);
  });
});

describe('Meta diagnostics: the use case', () => {
  const dest: MetaDestination = { datasetId: '1234567890123456', token: 'EAAB-secret-token', enabled: true, mode: 'live' };
  const audits: any[] = [];
  const audit = { execute: async (e: unknown) => { audits.push(e); } } as never;
  const gw = (over: Partial<MetaDiagnosticsGateway> = {}): MetaDiagnosticsGateway & { calls: string[] } => {
    const calls: string[] = [];
    return {
      calls,
      dataset: async () => { calls.push('dataset'); return { ok: true, value: { id: dest.datasetId, name: 'GoldPlus dataset' } }; },
      quality: async () => { calls.push('quality'); return { ok: true, value: { web: [{ event_name: 'Purchase', event_match_quality: { composite_score: 7.1 } }] } }; },
      sendTestEvent: async () => { calls.push('test'); return { ok: true, value: { eventsReceived: 1, fbtraceId: 'T1' } }; },
      ...over,
    };
  };

  it('reports the connection and Meta\'s scores, never the token, and asks Meta again only after ten minutes', async () => {
    let t = 1_800_000_000_000;
    const g = gw();
    const uc = new MetaDiagnosticsUseCases(g, async () => dest, audit, () => 'https://shopgoldplus.com', () => t);
    const v = await uc.overview();
    expect(v).toMatchObject({ configured: true, datasetId: dest.datasetId, connection: { state: 'ok', value: { name: 'GoldPlus dataset' } } });
    expect(v.quality).toEqual({ state: 'ok', value: { events: [{ event: 'Purchase', score: 7.1, band: 'good', keys: [] }] } });
    expect(JSON.stringify(v)).not.toContain('EAAB');
    expect(v.keysSent.map((k) => k.on)).toEqual(['Every event', 'When the visitor arrived from a Meta ad (last 30 days)', 'A customer signed in on this browser', 'A paid order']);
    await uc.overview(); t += 9 * 60_000; await uc.overview();
    expect(g.calls).toEqual(['dataset', 'quality']);                   // cached
    t += 2 * 60_000; await uc.overview();
    expect(g.calls).toHaveLength(4);                                    // ten minutes on: asked again
    await uc.overview(true);
    expect(g.calls).toHaveLength(6);                                    // "ask again" skips the cache
  });

  it('notices when Meta has retired the pinned version: the call succeeds on a version nobody chose', async () => {
    const mk = (served: string | null) => new MetaDiagnosticsUseCases(
      gw({ dataset: async () => ({ ok: true, value: { id: dest.datasetId, name: 'G' }, servedVersion: served }) }), async () => dest, audit, () => null, () => 1, 'v25.0');
    expect((await mk('v25.0').overview()).graph).toEqual({ pinned: 'v25.0', served: 'v25.0', retired: false });
    expect((await mk('v26.0').overview()).graph).toEqual({ pinned: 'v25.0', served: 'v26.0', retired: true });
    // No header is no evidence: it is not reported as retired.
    expect((await mk(null).overview()).graph).toEqual({ pinned: 'v25.0', served: null, retired: false });
  });

  it('a re-entered token is checked at once, not served from the old token\'s answer', async () => {
    const g = gw();
    let token = 'first';
    const uc = new MetaDiagnosticsUseCases(g, async () => ({ ...dest, token }), audit, () => 'https://shopgoldplus.com', () => 1);
    await uc.overview(); token = 'second'; await uc.overview();
    expect(g.calls).toHaveLength(4);
  });

  it('a token that may send events but not read the dataset is a working connection (as seen live, 2026-10-01); a revoked one never is', async () => {
    // What production's Events Manager token got back for GET /{dataset}?fields=id,name.
    const noRead: MetaAnswer<never> = { ok: false, message: 'Meta error 100: (#100) Missing Permission', credentials: false, transient: false };
    const v = await new MetaDiagnosticsUseCases(gw({ dataset: async () => noRead }), async () => dest, audit, () => null).overview();
    expect(v.connection).toEqual({ state: 'ok', value: { name: null, named: false } });
    expect(v.quality?.state).toBe('ok');
    // Neither call answered for this token: that is still a refusal, with Meta's words.
    const both = await new MetaDiagnosticsUseCases(gw({ dataset: async () => noRead, quality: async () => noRead }), async () => dest, audit, () => null).overview();
    expect(both.connection).toEqual({ state: 'refused', message: 'Meta error 100: (#100) Missing Permission', credentials: false });
    // A revoked token is never called working because another call happened to answer.
    const revoked: MetaAnswer<never> = { ok: false, message: 'Meta error 190: revoked', credentials: true, transient: false };
    expect((await new MetaDiagnosticsUseCases(gw({ dataset: async () => revoked }), async () => dest, audit, () => null).overview()).connection).toMatchObject({ state: 'refused', credentials: true });
    expect((await new MetaDiagnosticsUseCases(gw(), async () => dest, audit, () => null).overview()).connection).toEqual({ state: 'ok', value: { name: 'GoldPlus dataset', named: true } });
  });

  it('tells a refusal from a fault on Meta\'s side, and does not remember the fault', async () => {
    const refused: MetaAnswer<never> = { ok: false, message: 'Meta error 190/463: expired', credentials: true, transient: false };
    const v = await new MetaDiagnosticsUseCases(gw({ dataset: async () => refused, quality: async () => ({ ok: false, message: 'Meta error 200: needs ads_read', credentials: false, transient: false }) }), async () => dest, audit, () => null).overview();
    expect(v.connection).toEqual({ state: 'refused', message: 'Meta error 190/463: expired', credentials: true });
    expect(v.quality).toEqual({ state: 'refused', message: 'Meta error 200: needs ads_read', credentials: false });

    let n = 0;
    const flaky = gw({ dataset: async () => { n += 1; throw new Error('socket hang up'); } });
    const uc = new MetaDiagnosticsUseCases(flaky, async () => dest, audit, () => null, () => 1);
    expect((await uc.overview()).connection).toEqual({ state: 'unavailable', message: 'Meta could not be reached: socket hang up' });
    await uc.overview();
    expect(n).toBe(2);                                                  // asked again: an outage is not cached
  });

  it('asks Meta nothing when there is nothing to ask with, and says why', async () => {
    const g = gw();
    const v = await new MetaDiagnosticsUseCases(g, async () => { throw new Error('Not configured: enter the Meta dataset ID on the Advertising page.'); }, audit, () => null).overview();
    expect(v).toMatchObject({ configured: false, notConfigured: 'Not configured: enter the Meta dataset ID on the Advertising page.', connection: null, quality: null });
    expect(g.calls).toEqual([]);
  });

  it('a test event needs a real test code and the storefront address, describes no visitor, and is audited either way', async () => {
    audits.length = 0;
    const sent: any[] = [];
    const g = gw({ sendTestEvent: async (id, token, event, code) => { sent.push({ id, token, event, code }); return { ok: true, value: { eventsReceived: 1, fbtraceId: 'T1' } }; } });
    const uc = new MetaDiagnosticsUseCases(g, async () => dest, audit, () => 'https://shopgoldplus.com', () => 1_800_000_000_000);
    expect(await uc.sendTestEvent('admin-1', 'nope')).toMatchObject({ ok: false });
    expect(sent).toHaveLength(0);
    const r = await uc.sendTestEvent('admin-1', ' TEST12345 ');
    expect(r).toMatchObject({ ok: true, eventsReceived: 1, fbtraceId: 'T1' });
    expect(sent[0].code).toBe('TEST12345');
    expect(sent[0].event).toMatchObject({ event_name: 'ViewContent', action_source: 'website', event_source_url: 'https://shopgoldplus.com/', event_time: 1_800_000_000, data_processing_options: [] });
    expect(sent[0].event.event_id).toMatch(/^goldplus-connection-test-[0-9a-f-]{36}$/);
    // No email, phone, IP, click id: only a fixed, hashed label and a user agent that says what it is.
    expect(Object.keys(sent[0].event.user_data).sort()).toEqual(['client_user_agent', 'external_id']);
    expect(sent[0].event.user_data.client_user_agent).toMatch(/not a visitor/);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ actorId: 'admin-1', action: 'AD_TEST_EVENT_SENT', entityId: 'meta', newState: { accepted: true, eventsReceived: 1 } });
    expect(JSON.stringify(audits)).not.toContain('EAAB');

    const refusing = new MetaDiagnosticsUseCases(gw({ sendTestEvent: async () => ({ ok: false, message: 'Meta error 100/2804003: bad code', credentials: false, transient: false }) }), async () => dest, audit, () => 'https://shopgoldplus.com');
    expect(await refusing.sendTestEvent('admin-1', 'TEST99999')).toEqual({ ok: false, message: 'Meta error 100/2804003: bad code' });
    expect(audits[1]).toMatchObject({ newState: { accepted: false, refusal: 'Meta error 100/2804003: bad code' } });
    expect(await new MetaDiagnosticsUseCases(gw(), async () => dest, audit, () => null).sendTestEvent('a', 'TEST1')).toMatchObject({ ok: false, message: expect.stringMatching(/storefront address/) });
  });
});

describe('Meta diagnostics: the Graph gateway', () => {
  const id = '1234567890123456';
  const stub = (status: number, body: unknown, headers: Record<string, string> = {}) => {
    const calls: Array<{ url: string; init: any }> = [];
    const f = (async (url: string, init: any) => { calls.push({ url: String(url), init }); return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers }); }) as never;
    return { calls, f };
  };
  it('keeps the token out of every URL, and asks the documented endpoints', async () => {
    const d = stub(200, { id, name: 'GoldPlus' }, { 'facebook-api-version': 'v25.0' });
    // The version Meta actually served travels with the answer.
    expect(await new HttpMetaDiagnosticsGateway(d.f).dataset(id, 'SECRET')).toEqual({ ok: true, value: { id, name: 'GoldPlus' }, servedVersion: 'v25.0' });
    expect(d.calls[0].url).toBe(`https://graph.facebook.com/v25.0/${id}?fields=id,name`);
    const q = stub(200, { web: [] });
    await new HttpMetaDiagnosticsGateway(q.f).quality(id, 'SECRET');
    expect(q.calls[0].url).toBe(`https://graph.facebook.com/v25.0/dataset_quality?dataset_id=${id}&fields=web%7Bevent_name%2Cevent_match_quality%7D`);
    const t = stub(200, { events_received: 1, fbtrace_id: 'Tr' });
    expect(await new HttpMetaDiagnosticsGateway(t.f).sendTestEvent(id, 'SECRET', { event_name: 'ViewContent' }, 'TEST1')).toEqual({ ok: true, value: { eventsReceived: 1, fbtraceId: 'Tr' }, servedVersion: null });
    expect(t.calls[0].url).toBe(`https://graph.facebook.com/v25.0/${id}/events`);
    expect(JSON.parse(t.calls[0].init.body)).toEqual({ test_event_code: 'TEST1', data: [{ event_name: 'ViewContent' }] });
    for (const c of [...d.calls, ...q.calls, ...t.calls]) {
      expect(c.url).not.toContain('SECRET');
      expect(c.init.headers.Authorization).toBe('Bearer SECRET');
      expect(c.init.redirect).toBe('manual');
    }
  });
  it('returns Meta\'s own account of a refusal, and treats silence or an outage as transient', async () => {
    const g = (s: number, b: unknown) => new HttpMetaDiagnosticsGateway(stub(s, b).f).dataset(id, 'T');
    expect(await g(400, { error: { message: 'Invalid OAuth access token', code: 190, fbtrace_id: 'X1' } })).toEqual({ ok: false, message: 'Meta error 190: Invalid OAuth access token (fbtrace_id X1)', credentials: true, transient: false });
    expect(await g(503, 'upstream down')).toMatchObject({ ok: false, transient: true, credentials: false });
    expect(await g(403, '')).toMatchObject({ ok: false, credentials: true, transient: false });
    expect(await g(200, 'not json')).toMatchObject({ ok: false, transient: true });
    const down = new HttpMetaDiagnosticsGateway((async () => { throw new Error('ECONNRESET'); }) as never);
    expect(await down.dataset(id, 'T')).toMatchObject({ ok: false, transient: true, message: expect.stringMatching(/could not be reached/) });
  });
  it('never builds a URL from something that is not a dataset ID', async () => {
    const s = stub(200, {});
    const gwy = new HttpMetaDiagnosticsGateway(s.f);
    for (const bad of ['', '123', '1234567890123/../me', 'abc']) await expect(gwy.dataset(bad, 'T')).rejects.toThrow(/dataset ID/);
    expect(s.calls).toHaveLength(0);
  });
});

describe('activity page sentences for Meta\'s refusals', () => {
  const m = { platformName: 'Meta (Facebook, Instagram, WhatsApp ads)' };
  it('says what the code means and keeps Meta\'s words', () => {
    const token = explainOutcome({ ...m, outcome: 'failed', raw: 'CREDENTIALS: Meta error 190/460: Error validating access token (fbtrace_id AbC)' });
    expect(token).toMatch(/rejected the access token.*Generate a new one in Events Manager/);
    expect(token).toContain('Meta error 190/460');
    expect(token).toContain('fbtrace_id AbC');
    expect(explainOutcome({ ...m, outcome: 'failed', raw: 'meta HTTP 400: Meta error 100/2804019: Server Side Api Parameter Error: bad (fbtrace_id Z)' })).toMatch(/refused the event as invalid.*2804019/);
    expect(explainOutcome({ ...m, outcome: 'failed', raw: 'meta HTTP 403: Meta error 200: Permissions error' })).toMatch(/not allowed to send to this dataset/);
    expect(explainOutcome({ ...m, outcome: 'failed', raw: 'HTTP_400: Meta error 803: Some of the aliases you requested do not exist' })).toMatch(/does not recognise the dataset ID/);
    expect(explainOutcome({ ...m, outcome: 'failed', raw: 'meta HTTP 400: Meta error 1357045: something new' })).toMatch(/^Meta refused it\. Meta error 1357045/);
    expect(explainOutcome({ ...m, outcome: 'waiting', raw: 'PROVIDER_TRANSIENT: Meta error 17: (#17) User request limit reached' })).toMatch(/Waiting to retry.*request limit reached/);
    expect(explainOutcome({ ...m, outcome: 'not_sent', raw: 'NO_TEST_CODE' })).toMatch(/Test mode but no test event code/);
    expect(explainOutcome({ platformName: 'X (Twitter) Ads', outcome: 'failed', raw: 'CREDENTIALS' })).toMatch(/rejected the keys/);
  });
});
