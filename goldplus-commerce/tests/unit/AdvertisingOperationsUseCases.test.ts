import { describe, it, expect, vi } from 'vitest';
import type {
  AdCapabilityRow, AdDestinationRow, AudienceGateway, AudienceRunRecord, OfflineContext, OfflineConversionRepository, OfflineConversionRow,
  PlatformCredentials, SpendFactRepository, SpendGateway,
} from '../../apps/api/src/application/ports/Advertising';
import { AudienceSyncUseCases, TIKTOK_MIN_FILE_ENTRIES } from '../../apps/api/src/application/use-cases/advertising/AudienceSyncUseCases';
import { AdSpendUseCases, apiPlatformOf, spendTotals } from '../../apps/api/src/application/use-cases/advertising/AdSpendUseCases';
import { OfflineConversionUseCases } from '../../apps/api/src/application/use-cases/advertising/OfflineConversionUseCases';
import { AdCapabilityUseCases, capabilityGap, capabilityDef } from '../../apps/api/src/application/use-cases/advertising/AdCapabilities';
import { AdDestinationUseCases } from '../../apps/api/src/application/use-cases/advertising/AdDestinationUseCases';
import { buildChecklist } from '../../apps/api/src/application/use-cases/advertising/ConnectionChecklist';
import { buildMetaCatalogueCsv, buildTikTokCatalogueCsv, feedCsvCell, META_FEED_COLUMNS, TIKTOK_FEED_COLUMNS } from '../../apps/api/src/application/use-cases/advertising/CatalogueFeeds';
import {
  HttpAudienceGateway, HttpOfflineConversionGateway, HttpSpendGateway, dataManagerIngestBodies, googleSpendFacts, googleSpendQuery, metaSpendFacts, offlineRequest, scrub, tiktokFile,
} from '../../apps/api/src/infrastructure/advertising/AdvertisingGateways';
import { AD_PLATFORMS, buildAdRequest } from '../../apps/api/src/infrastructure/advertising/AdPlatforms';
import type { FeedProduct } from '../../apps/api/src/application/use-cases/seo-growth/MerchantFeedUseCase';

const audit = { execute: vi.fn(async () => ({ ok: true, id: 'a' })) } as any;
const creds = (over: Partial<PlatformCredentials> = {}): PlatformCredentials => ({ config: {}, secret: 'CAP_SECRET_TOKEN_123', destinationConfig: {}, destinationSecret: 'DEST_SECRET_TOKEN_456', testMode: false, ...over });
const liveCap = (platform: string, config: Record<string, string> = {}) => ({ platform, row: { config } } as any);

// ── Audiences ────────────────────────────────────────────────────────────────

function audienceHarness(opts: { orders?: any[]; refused?: { userIds?: string[]; fpClientIds?: string[] }; live?: boolean; remote?: Record<string, string>; consentThrows?: boolean; cfg?: Record<string, string> } = {}) {
  const runs: AudienceRunRecord[] = [];
  const remote = new Map(Object.entries(opts.remote ?? {}));
  const calls: string[] = [];
  const gateway: AudienceGateway = {
    createList: vi.fn(async (p, _i, members) => { calls.push(`create:${p}`); return { remoteId: `${p}-list`, uploaded: p === 'tiktok' ? members.length : null }; }),
    replaceMembers: vi.fn(async (p, id, members) => { calls.push(`replace:${p}:${id}:${members.length}`); return { uploaded: members.length }; }),
    clearList: vi.fn(async (p, id) => { calls.push(`clear:${p}:${id}`); return { forget: p !== 'google_ads' }; }),
  };
  const uc = new AudienceSyncUseCases(
    {
      buyerOrders: async () => opts.orders ?? [],
      refusedIdentities: async () => { if (opts.consentThrows) throw new Error('db down'); return { userIds: new Set(opts.refused?.userIds ?? []), fpClientIds: new Set(opts.refused?.fpClientIds ?? []) }; },
    },
    {
      remoteId: async (p, s) => remote.get(`${p}:${s}`) ?? null,
      saveRemoteId: async (p, s, id) => void remote.set(`${p}:${s}`, id),
      forgetRemoteId: async (p, s) => void remote.delete(`${p}:${s}`),
      storedSegments: async (p) => [...remote.keys()].filter((k) => k.startsWith(`${p}:`)).map((k) => k.slice(p.length + 1)),
      recordRun: async (r) => void runs.push(r),
      recentRuns: async () => runs,
    },
    gateway,
    async (p) => (opts.live === false ? null : liveCap(p, opts.cfg ?? {})),
    async () => creds(),
    () => new Date('2026-09-25T00:00:00Z'),
  );
  return { uc, runs, calls, gateway, remote };
}
const o = (i: number, extra: any = {}) => ({ orderId: `o${i}`, userId: null, email: `p${i}@x.co`, phone: `07000000${String(i).padStart(2, '0')}`, fpClientId: `fp.${i}`, totalUgx: 100_000 * i, purchasedAt: new Date('2026-09-20T00:00:00Z'), status: 'delivered', paymentStatus: 'paid', ...extra });

describe('audience sync', () => {
  it('leaves out anyone with a stored advertising refusal (account or browser) and says how many', async () => {
    const { uc } = audienceHarness({ orders: [o(1, { userId: '11111111-1111-4111-8111-111111111111' }), o(2), o(3)], refused: { userIds: ['11111111-1111-4111-8111-111111111111'], fpClientIds: ['fp.2'] } });
    const past = (await uc.preview()).find((r) => r.platform === 'meta' && r.segment === 'past_buyers')!;
    expect(past).toMatchObject({ inSegment: 3, excludedConsent: 2, eligible: 1 });
  });
  it('a dry run never calls a platform; a sync that is not configured says so and calls nothing', async () => {
    const h = audienceHarness({ orders: [o(1)] });
    const dry = await h.uc.run('meta', 'DRY_RUN', 'ADMIN', null);
    expect(dry.every((r) => r.status === 'DRY_RUN')).toBe(true);
    expect(h.calls).toEqual([]);
    const off = audienceHarness({ orders: [o(1)], live: false });
    const r = await off.uc.run('meta', 'SYNC', 'ADMIN', null);
    expect(r[0]).toMatchObject({ status: 'NOT_CONFIGURED' });
    expect(r[0].message).toMatch(/^Not configured/);
    expect(off.calls).toEqual([]);
  });
  it('a sync creates the list once, then replaces its members; runs are logged', async () => {
    const h = audienceHarness({ orders: [o(1), o(2)], cfg: { segments: 'past_buyers' } });
    await h.uc.run('google_ads', 'SYNC', 'ADMIN', null);
    expect(h.calls).toEqual(['create:google_ads', 'replace:google_ads:google_ads-list:2']);
    await h.uc.run('google_ads', 'SYNC', 'SCHEDULE', null);
    expect(h.calls.slice(2)).toEqual(['replace:google_ads:google_ads-list:2']);
    expect(h.runs.filter((r) => r.status === 'SYNCED')).toHaveLength(2);
  });
  it('TikTok below its 1,000-entry minimum is reported, not sent', async () => {
    const h = audienceHarness({ orders: [o(1), o(2)], cfg: { segments: 'past_buyers' } });
    const r = await h.uc.run('tiktok', 'SYNC', 'ADMIN', null);
    expect(r[0].status).toBe('TOO_SMALL');
    expect(h.calls).toEqual([]);
    expect(TIKTOK_MIN_FILE_ENTRIES).toBe(1000);
  });
  it('a list with nobody eligible left, or no longer selected, is emptied so it cannot keep a refuser', async () => {
    const h = audienceHarness({ orders: [o(1)], refused: { fpClientIds: ['fp.1'] }, cfg: { segments: 'past_buyers' }, remote: { 'meta:past_buyers': 'A1', 'meta:high_value': 'A2' } });
    const r = await h.uc.run('meta', 'SYNC', 'ADMIN', null);
    expect(h.calls).toEqual(['clear:meta:A1', 'clear:meta:A2']);
    expect(r.map((x) => x.status)).toEqual(['CLEARED', 'CLEARED']);
    expect(h.remote.size).toBe(0);
  });
  it('an unreadable consent state uploads nobody', async () => {
    const h = audienceHarness({ orders: [o(1)], consentThrows: true });
    const r = await h.uc.run('meta', 'SYNC', 'ADMIN', null);
    expect(r[0].status).toBe('CONSENT_UNREADABLE');
    expect(h.calls).toEqual([]);
  });
  it('an empty shop previews "0 in segment" and sends nothing', async () => {
    const h = audienceHarness({ orders: [] });
    const p = await h.uc.preview();
    expect(p.every((r) => r.inSegment === 0 && r.eligible === 0)).toBe(true);
    const r = await h.uc.run('google_ads', 'SYNC', 'ADMIN', null);
    expect(r.every((x) => x.status === 'EMPTY')).toBe(true);
    expect(h.calls).toEqual([]);
  });
});

// ── Spend ────────────────────────────────────────────────────────────────────

function spendHarness(opts: { live?: string[]; currencies?: string[]; facts?: any[]; throws?: boolean } = {}) {
  const written: any[] = [];
  const imports: any[] = [];
  const repo: SpendFactRepository = {
    ingestedCurrencies: async () => opts.currencies ?? [],
    preview: async (f) => ({ added: f.length, changed: 0, unchanged: 0 }),
    upsert: async (f) => { written.push(...f); return { written: f.length }; },
    report: async () => [],
    recordImport: async (r) => void imports.push(r),
    recentImports: async () => imports,
  };
  const gateway: SpendGateway = { fetchDaily: vi.fn(async () => { if (opts.throws) throw new Error('HTTP 401: bad token'); return opts.facts ?? []; }) };
  const uc = new AdSpendUseCases(repo, gateway, async (p) => ((opts.live ?? []).includes(p) ? liveCap(p) : null), async () => creds(), audit, () => new Date('2026-09-25T10:00:00Z'));
  return { uc, written, imports, gateway };
}
const fact = (over: any = {}) => ({ spendDate: '2026-09-20', channel: 'paid_social', platform: 'Meta', account: 'act_1', campaign: 'id:9', campaignLabel: 'Sept', currency: 'UGX', spendMinor: 50000, clicks: 10, impressions: 900, source: 'meta_marketing_api', ...over });

describe('spend import', () => {
  it('not configured: no API call, the import log says so', async () => {
    const h = spendHarness();
    const r = await h.uc.importFromApi('meta', 'ADMIN', null);
    expect(r.status).toBe('NOT_CONFIGURED');
    expect(h.gateway.fetchDaily).not.toHaveBeenCalled();
    expect(h.imports).toHaveLength(1);
  });
  it('defaults to the last 7 full days and writes what the platform returned', async () => {
    const h = spendHarness({ live: ['meta'], facts: [fact()] });
    const r = await h.uc.importFromApi('meta', 'SCHEDULE', null);
    expect(r).toMatchObject({ status: 'IMPORTED', rowsWritten: 1, dateFrom: '2026-09-18', dateTo: '2026-09-24' });
    expect(h.written).toHaveLength(1);
  });
  it('refuses a currency that differs from spend already held, and platform errors are recorded', async () => {
    const h = spendHarness({ live: ['meta'], facts: [fact({ currency: 'USD' })], currencies: ['UGX'] });
    expect((await h.uc.importFromApi('meta', 'ADMIN', null)).status).toBe('REFUSED');
    expect(h.written).toEqual([]);
    const e = spendHarness({ live: ['meta'], throws: true });
    expect(await e.uc.importFromApi('meta', 'ADMIN', null)).toMatchObject({ status: 'FAILED', message: 'HTTP 401: bad token' });
  });
  it('no activity is "No data", not zero spend', async () => {
    const h = spendHarness({ live: ['google_ads'], facts: [] });
    expect((await h.uc.importFromApi('google_ads', 'ADMIN', null)).status).toBe('NO_DATA');
  });
  it('CSV: a dry run writes nothing; rows for a platform imported by API are refused (double counting)', async () => {
    const csv = 'date,platform,campaign,spend,currency\n2026-09-20,Opera Ads,Sept,85000,UGX\n';
    const h = spendHarness();
    const dry = await h.uc.importCsv(null, csv, true);
    expect(dry).toMatchObject({ ok: true, dryRun: true, rows: 1, added: 1 });
    expect(h.written).toEqual([]);
    const applied = await h.uc.importCsv(null, csv, false);
    expect(applied.ok).toBe(true);
    expect(h.written).toHaveLength(1);
    const api = spendHarness({ live: ['meta'] });
    const r = await api.uc.importCsv(null, 'date,platform,campaign,spend,currency\n2026-09-20,Meta,Sept,85000,UGX\n', false);
    expect(r.ok).toBe(false);
    expect(r.errors[0].errors[0]).toMatch(/imported by API/);
    expect(apiPlatformOf('Facebook Ads')).toBe('meta');
    expect(apiPlatformOf('Opera Ads')).toBeNull();
  });
  it('totals are per currency, and a count total is unknown when any row lacks it', () => {
    const t = spendTotals([
      { ...fact(), clicks: 10 }, { ...fact({ campaign: 'id:2' }), clicks: null }, { ...fact({ currency: 'USD', spendMinor: 1234 }), clicks: 3 },
    ] as any);
    expect(t).toEqual([
      { currency: 'UGX', spendMinor: 100000, clicks: null, impressions: 1800 },
      { currency: 'USD', spendMinor: 1234, clicks: 3, impressions: 900 },
    ]);
  });
});

// ── Offline conversions ──────────────────────────────────────────────────────

const convRow = (over: Partial<OfflineConversionRow> = {}): OfflineConversionRow => ({
  id: 'c1', platform: 'meta', source: 'COD_DELIVERED', sourceRef: '22222222-2222-4222-8222-222222222222', eventId: '33333333-3333-4333-8333-333333333333',
  occurredAt: '2026-09-24T10:00:00.000Z', state: 'PENDING', reason: null, attemptCount: 0, sentAt: null, ...over,
});
const ctxOf = (row: OfflineConversionRow, over: Partial<OfflineContext> = {}): OfflineContext => ({
  row, valueUgx: 150000, orderId: row.source === 'COD_DELIVERED' ? row.sourceRef : null, orderNumber: 'GP-100', channel: null,
  hashes: { emailSha256: 'e'.repeat(64), emailGoogleSha256: 'g'.repeat(64), phoneDigitsSha256: 'd'.repeat(64), phonePlusSha256: 'p'.repeat(64) },
  clickIds: {}, subjects: { userIds: [], fpClientIds: ['fp.1'] }, ...over,
});

function offlineHarness(opts: { rows?: OfflineConversionRow[]; online?: string | null; refused?: boolean | 'throw'; send?: { status: number | null; error: string | null }; ctx?: Partial<OfflineContext>; live?: boolean } = {}) {
  const finished: Array<{ id: string; state: string; reason: string | null; extra?: any }> = [];
  const sent: OfflineContext[] = [];
  const repo = {
    findOrder: async (n: string) => (n === 'GP-100' ? { id: '22222222-2222-4222-8222-222222222222', orderNumber: 'GP-100', userId: null, fpClientId: 'fp.9' } : null),
    consentSubjectsForContact: async () => ({ userIds: ['44444444-4444-4444-8444-444444444444'], fpClientIds: [] }),
    recordSale: vi.fn(async () => '55555555-5555-4555-8555-555555555555'),
    listSales: async () => [], enqueue: vi.fn(async () => 2), due: async () => opts.rows ?? [convRow()],
    context: async (row: OfflineConversionRow) => ctxOf(row, opts.ctx),
    onlinePurchaseState: async () => opts.online ?? null,
    refused: async () => { if (opts.refused === 'throw') throw new Error('x'); return !!opts.refused; },
    finish: async (id: string, state: string, reason: string | null, extra?: any) => void finished.push({ id, state, reason, extra }),
    list: async () => [], counts: async () => ({}),
  } as unknown as OfflineConversionRepository;
  const gateway = { send: vi.fn(async (ctx: OfflineContext) => { sent.push(ctx); return opts.send ?? { status: 200, error: null }; }) };
  const uc = new OfflineConversionUseCases(repo, gateway, async (p) => (opts.live === false ? null : liveCap(p)), async () => creds(), audit, () => new Date('2026-09-25T10:00:00Z'));
  return { uc, finished, sent, repo, gateway };
}

describe('offline conversions', () => {
  it('a COD order whose online purchase already reached the platform is not sent again', async () => {
    const h = offlineHarness({ online: 'ACCEPTED' });
    const r = await h.uc.dispatch();
    expect(r.duplicate).toBe(1);
    expect(h.sent).toEqual([]);
    expect(h.finished[0].state).toBe('DUPLICATE_ONLINE');
  });
  it('sends when the online purchase never reached it (e.g. dead-lettered)', async () => {
    const h = offlineHarness({ online: 'DEAD_LETTER' });
    expect((await h.uc.dispatch()).sent).toBe(1);
    expect(h.finished[0]).toMatchObject({ state: 'SENT' });
  });
  it('consent: a refusal suppresses; an unreadable answer defers (never sends on a guess)', async () => {
    const r1 = offlineHarness({ refused: true });
    expect((await r1.uc.dispatch()).suppressed).toBe(1);
    expect(r1.sent).toEqual([]);
    const r2 = offlineHarness({ refused: 'throw' });
    expect((await r2.uc.dispatch()).retried).toBe(1);
    expect(r2.finished[0]).toMatchObject({ state: 'PENDING', reason: 'CONSENT_LOOKUP_FAILED' });
    expect(r2.sent).toEqual([]);
  });
  it('too old for the platform expires; nothing to match on is skipped; switched off is skipped', async () => {
    expect((await offlineHarness({ rows: [convRow({ occurredAt: '2026-09-01T00:00:00Z' })] }).uc.dispatch()).expired).toBe(1);
    const none = { emailSha256: null, emailGoogleSha256: null, phoneDigitsSha256: null, phonePlusSha256: null };
    expect((await offlineHarness({ ctx: { hashes: none } }).uc.dispatch()).skipped).toBe(1);
    const off = offlineHarness({ live: false });
    expect((await off.uc.dispatch()).skipped).toBe(1);
    expect(off.sent).toEqual([]);
  });
  it('a permanent refusal is FAILED; a server error retries', async () => {
    expect((await offlineHarness({ send: { status: 400, error: 'bad' } }).uc.dispatch()).failed).toBe(1);
    const h = offlineHarness({ send: { status: 503, error: 'busy' } });
    expect((await h.uc.dispatch()).retried).toBe(1);
    expect(h.finished[0].state).toBe('PENDING');
    expect(h.finished[0].extra.attempt).toBe(1);
  });
  it('nothing is queued while no platform is live', async () => {
    const h = offlineHarness({ live: false });
    expect(await h.uc.enqueue()).toBe(0);
    expect((h.repo as any).enqueue).not.toHaveBeenCalled();
  });
  it('records a phone sale with hashes only, and the consent subjects of that contact and order', async () => {
    const h = offlineHarness();
    const r = await h.uc.recordSale('66666666-6666-4666-8666-666666666666', { channel: 'WHATSAPP', occurredAt: '2026-09-25T08:00:00Z', valueUgx: 145000, phone: '0772 123 456', orderNumber: 'GP-100' });
    expect(r.ok).toBe(true);
    const saved = (h.repo as any).recordSale.mock.calls[0][0];
    expect(JSON.stringify(saved)).not.toContain('772 123 456');
    expect(saved.hashes.phonePlusSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(saved.subjects).toEqual({ userIds: ['44444444-4444-4444-8444-444444444444'], fpClientIds: ['fp.9'] });
    expect((await h.uc.recordSale(null, { channel: 'PHONE', occurredAt: '2026-09-25T08:00:00Z', valueUgx: 1000, orderNumber: 'NOPE' })).ok).toBe(false);
  });
});

// ── Gateways: the exact documented requests ─────────────────────────────────

function fakeFetch(replies: Array<unknown>) {
  const calls: Array<{ url: string; init: any }> = [];
  const f = vi.fn(async (url: string, init: any) => {
    calls.push({ url, init });
    const body = replies.length ? replies.shift() : {};
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  return { f: f as unknown as typeof fetch, calls };
}
const googleCreds = () => creds({
  destinationConfig: { customerId: '1234567890', conversionActionId: '777', apiVersion: 'v25', loginCustomerId: '' },
  destinationSecret: JSON.stringify({ developerToken: 'DEVTOKEN_abcdefgh', clientId: 'c.apps.googleusercontent.com', clientSecret: 'CSECRET_abcdefgh', refreshToken: 'RTOKEN_abcdefgh' }),
});

describe('platform requests', () => {
  it('Google Customer Match (Data Manager API): user list, then ingest without a consent claim; no removal in the same run', async () => {
    const { f, calls } = fakeFetch([
      { access_token: 'ACCESS_abcdefgh', expires_in: 3600 },
      { name: 'accountTypes/GOOGLE_ADS/accounts/1234567890/userLists/55', id: '55' },
      { requestId: 'r1' }, { requestId: 'r2' },
    ]);
    const now = new Date('2026-09-25T03:00:00Z');
    const g = new HttpAudienceGateway(f, () => now);
    const c = creds({ ...googleCreds(), secret: 'DM_REFRESH_TOKEN_abcdefgh', config: { customerMatchTerms: 'accepted' } });
    const created = await g.createList('google_ads', { name: 'GoldPlus: Past buyers', description: 'd', membershipDays: 540 }, [], c);
    expect(created).toEqual({ remoteId: 'accountTypes/GOOGLE_ADS/accounts/1234567890/userLists/55', uploaded: null });
    expect(calls[0].url).toBe('https://oauth2.googleapis.com/token');
    expect(String(calls[0].init.body)).toContain('refresh_token=DM_REFRESH_TOKEN_abcdefgh');
    expect(calls[1].url).toBe('https://datamanager.googleapis.com/v1/accountTypes/GOOGLE_ADS/accounts/1234567890/userLists');
    expect(JSON.parse(calls[1].init.body)).toEqual({
      displayName: 'GoldPlus: Past buyers', description: 'd', membershipDuration: `${540 * 86400}s`,
      ingestedUserListInfo: { uploadKeyTypes: ['CONTACT_ID'], contactIdInfo: { dataSourceType: 'DATA_SOURCE_TYPE_FIRST_PARTY' } },
    });
    expect(calls[1].init.headers.Authorization).toBe('Bearer ACCESS_abcdefgh');
    expect(calls[1].init.headers['developer-token']).toBeUndefined();
    const replaced = await g.replaceMembers('google_ads', created.remoteId, [{ email: 'e'.repeat(64), phone: 'p'.repeat(64) }], c);
    // Accepted, not confirmed: the request id is returned for requestStatus:retrieve.
    expect(replaced).toEqual({ uploaded: 1, requestIds: ['r1'] });
    expect(calls[2].url).toBe('https://datamanager.googleapis.com/v1/audienceMembers:ingest');
    const ingest = JSON.parse(calls[2].init.body);
    expect(ingest).toEqual({
      destinations: [{ operatingAccount: { accountType: 'GOOGLE_ADS', accountId: '1234567890' }, productDestinationId: '55' }],
      audienceMembers: [{ userData: { userIdentifiers: [{ emailAddress: 'e'.repeat(64) }, { phoneNumber: 'p'.repeat(64) }] } }],
      encoding: 'HEX', termsOfService: { customerMatchTermsOfServiceStatus: 'ACCEPTED' },
    });
    expect(JSON.stringify(ingest)).not.toMatch(/consent|GRANTED/i);
    // The stale-member sweep is NOT sent with the upload: only after Google confirms it (confirmPending).
    expect(calls.map((x) => x.url)).not.toContain('https://datamanager.googleapis.com/v1/audienceMembers:removeAll');
    expect(calls.length).toBe(3); // the access token is cached
    expect(dataManagerIngestBodies(Array.from({ length: 25 }, () => ({ email: 'e', phone: null })), {}, 10).map((b: any) => b.audienceMembers.length)).toEqual([10, 10, 5]);
  });
  it('Meta: customer-list audience, then usersreplace in one session with the EMAIL/PHONE schema', async () => {
    const { f, calls } = fakeFetch([{ id: '2385' }, {}, {}]);
    const g = new HttpAudienceGateway(f);
    const c = creds({ config: { adAccountId: '1010' } });
    await g.createList('meta', { name: 'GoldPlus: Past buyers', description: 'd', membershipDays: 540 }, [], c);
    expect(calls[0].url).toMatch(/\/act_1010\/customaudiences$/);
    expect(JSON.parse(calls[0].init.body)).toMatchObject({ subtype: 'CUSTOM', customer_file_source: 'USER_PROVIDED_ONLY' });
    const members = Array.from({ length: 10_001 }, (_, i) => ({ email: i % 2 ? 'e'.repeat(64) : null, phone: 'p'.repeat(64) }));
    await g.replaceMembers('meta', '2385', members, c);
    const b1 = JSON.parse(calls[1].init.body), b2 = JSON.parse(calls[2].init.body);
    expect(calls[1].url).toMatch(/\/2385\/usersreplace$/);
    expect(b1.payload.schema).toEqual(['EMAIL', 'PHONE']);
    expect(b1.payload.data[0]).toEqual(['', 'p'.repeat(64)]);
    expect([b1.session.batch_seq, b1.session.last_batch_flag, b2.session.batch_seq, b2.session.last_batch_flag]).toEqual([1, false, 2, true]);
    expect(b1.session.session_id).toBe(b2.session.session_id);
    expect(calls[1].url).not.toContain('CAP_SECRET');
  });
  it('TikTok: signed customer file upload, then an audience created from it', async () => {
    const { f, calls } = fakeFetch([{ code: 0, data: { file_path: 'fp-1' } }, { code: 0, data: { custom_audience_id: '99' } }]);
    const g = new HttpAudienceGateway(f);
    const r = await g.createList('tiktok', { name: 'GoldPlus: Past buyers', description: 'd', membershipDays: 540 }, [{ email: null, phone: 'p'.repeat(64) }], creds({ config: { advertiserId: '700000001' } }));
    expect(r).toEqual({ remoteId: '99', uploaded: 1 });
    expect(calls[0].url).toBe('https://business-api.tiktok.com/open_api/v1.3/dmp/custom_audience/file/upload/');
    const form = calls[0].init.body as FormData;
    expect(form.get('calculate_type')).toBe('PHONE_SHA256');
    expect(form.get('file_signature')).toMatch(/^[0-9a-f]{32}$/);
    expect(JSON.parse(calls[1].init.body)).toMatchObject({ advertiser_id: '700000001', file_paths: ['fp-1'], calculate_type: 'PHONE_SHA256' });
    expect(tiktokFile([{ email: null, phone: 'a' }, { email: 'x', phone: null }])).toBe('a\n');
  });
  it('a TikTok error code inside a 200 is a failure', async () => {
    const { f } = fakeFetch([{ code: 40001, message: 'no permission' }]);
    await expect(new HttpAudienceGateway(f).createList('tiktok', { name: 'n', description: 'd', membershipDays: 1 }, [{ email: null, phone: 'p' }], creds({ config: { advertiserId: '1' } }))).rejects.toThrow(/40001/);
  });
  it('spend: Google searchStream batches and Meta Insights rows become facts', async () => {
    expect(googleSpendQuery('2026-09-18', '2026-09-24')).toContain("segments.date BETWEEN '2026-09-18' AND '2026-09-24'");
    const g = googleSpendFacts([{ results: [
      { customer: { currencyCode: 'UGX' }, campaign: { id: '12', name: 'Brand', advertisingChannelType: 'SEARCH' }, segments: { date: '2026-09-20' }, metrics: { costMicros: '25000000000', clicks: '40', impressions: '1200' } },
      { customer: { currencyCode: 'UGX' }, campaign: { id: '13', name: 'Idle' }, segments: { date: '2026-09-20' }, metrics: { costMicros: '0', clicks: '0', impressions: '0' } },
    ] }], '1234567890');
    expect(g).toEqual([{ spendDate: '2026-09-20', channel: 'paid_search', platform: 'Google Ads', account: '1234567890', campaign: 'id:12', campaignLabel: 'Brand', currency: 'UGX', spendMinor: 25000, clicks: 40, impressions: 1200, source: 'google_ads_api' }]);
    const m = metaSpendFacts([{ campaign_id: '5', campaign_name: 'Sept', spend: '12.34', impressions: '900', clicks: '', account_currency: 'USD', date_start: '2026-09-20' }], '1010');
    expect(m[0]).toMatchObject({ spendMinor: 1234, currency: 'USD', clicks: null, impressions: 900, account: 'act_1010', campaign: 'id:5' });
    const { f, calls } = fakeFetch([{ data: [{ campaign_id: '5', spend: '1', account_currency: 'UGX', date_start: '2026-09-20' }], paging: { next: 'https://evil.example/steal' } }]);
    await new HttpSpendGateway(f).fetchDaily('meta', '2026-09-18', '2026-09-24', creds({ config: { adAccountId: '1010' } }));
    expect(calls).toHaveLength(1); // a paging link off the Graph host is never followed
    expect(calls[0].url).toMatch(/level=campaign/);
    expect(calls[0].url).toMatch(/time_increment=1/);
  });
  it('offline requests: Google click/enhanced conversion, Meta action_source, TikTok offline event set; test modes', () => {
    const row = convRow({ platform: 'google_ads' });
    const g = offlineRequest(ctxOf(row, { clickIds: { gclid: 'GCLID' } }), creds({ destinationConfig: { customerId: '1234567890', conversionActionId: '777', apiVersion: 'v25' }, config: { offlineConversionActionId: '888' }, testMode: true }))!;
    const gc = (g.body as any).conversions[0];
    expect(g.url).toBe('https://googleads.googleapis.com/v25/customers/1234567890:uploadClickConversions');
    expect((g.body as any).validateOnly).toBe(true);
    expect(gc).toMatchObject({ gclid: 'GCLID', conversionAction: 'customers/1234567890/conversionActions/888', conversionDateTime: '2026-09-24 10:00:00+00:00', orderId: 'GP-100', currencyCode: 'UGX' });
    expect(gc.userIdentifiers[0].hashedEmail).toBe('g'.repeat(64));

    const m = offlineRequest(ctxOf(convRow({ platform: 'meta', source: 'ADMIN_SALE' }), { channel: 'WHATSAPP' }), creds({ destinationConfig: { datasetId: '1234567890123' } }))!;
    const md = (m.body as any).data[0];
    expect(md).toMatchObject({ event_name: 'Purchase', action_source: 'chat', event_id: '33333333-3333-4333-8333-333333333333' });
    expect(md.user_data.ph[0]).toBe('d'.repeat(64));
    expect(m.url).not.toContain('access_token');
    expect(offlineRequest(ctxOf(convRow({ platform: 'meta' })), creds({ destinationConfig: { datasetId: '1' }, testMode: true }))).toBeNull();
    const mc = offlineRequest(ctxOf(convRow({ platform: 'meta' })), creds({ destinationConfig: { datasetId: '1' } }))!;
    expect((mc.body as any).data[0].action_source).toBe('physical_store');

    const t = offlineRequest(ctxOf(convRow({ platform: 'tiktok' })), creds({ config: { offlineEventSetId: '7001' }, secret: '' }))!;
    expect(t.body).toMatchObject({ event_source: 'offline', event_source_id: '7001' });
    expect((t.body as any).data[0]).toMatchObject({ event: 'CompletePayment', event_id: '33333333-3333-4333-8333-333333333333' });
    expect((t.body as any).data[0].user.phone).toBe('p'.repeat(64));
    expect(t.headers['Access-Token']).toBe('DEST_SECRET_TOKEN_456');
  });
  it('the offline gateway reports a platform refusal with the token scrubbed', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ error: { message: 'Invalid token DEST_SECRET_TOKEN_456' } }), { status: 400 })) as unknown as typeof fetch;
    const r = await new HttpOfflineConversionGateway(f).send(ctxOf(convRow({ platform: 'meta' })), creds({ destinationConfig: { datasetId: '1' } }));
    expect(r.status).toBe(400);
    expect(r.error).not.toContain('DEST_SECRET_TOKEN_456');
    expect(scrub('x?access_token=abc123&y=1 Bearer abc.def')).toBe('x?access_token=[redacted]&y=1 Bearer [redacted]');
  });
});

// ── Catalogue feeds ──────────────────────────────────────────────────────────

const product = (over: Partial<FeedProduct> = {}): FeedProduct => ({
  sku: 'GP-PB10', slug: 'power-bank-10000', name: 'GoldPlus Power Bank 10000mAh', shortDescription: 'A 10000mAh power bank with USB-C in and out.',
  priceUgx: 145000, floorPriceUgx: 120000, stockStatus: 'in_stock', stockQuantity: 7, reservedQuantity: 0, isPreOrderEnabled: false,
  imageUrl: '/uploads/pb.jpg', imageUrls: ['/uploads/pb.jpg', '/uploads/pb-2.jpg'], modelNumber: 'PB10', isFeedEligible: true, active: true, approvalStatus: 'approved',
  categoryName: 'Power Banks', subcategory: null, longDescription: '', ...over,
});

describe('catalogue feeds', () => {
  it('Meta CSV: spec columns, public price only, availability as a word, sale price only with its window', () => {
    const csv = buildMetaCatalogueCsv([product(), product({ sku: 'X', isFeedEligible: false }), product({ sku: 'PRE', isPreOrderEnabled: true })], 'https://shopgoldplus.com',
      { percentBps: 1000, priceFloorUgx: 0, saleStartIso: '2026-09-20T00:00:00+03:00', saleEndIso: '2026-09-30T23:59:00+03:00' });
    const [head, ...rows] = csv.trim().split('\n');
    expect(head).toBe(META_FEED_COLUMNS.join(','));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain('in stock');
    expect(rows[0]).toContain('145000 UGX');
    expect(rows[0]).toContain('130500 UGX');
    expect(rows[0]).toContain('2026-09-20T00:00:00+03:00/2026-09-30T23:59:00+03:00');
    expect(rows[0]).toContain('https://shopgoldplus.com/uploads/pb-2.jpg');
    expect(rows[1]).toContain('out of stock'); // pre-order without a date
    expect(csv).not.toMatch(/120000/); // the floor never appears
    expect(csv).not.toMatch(/,7,|quantity/); // no stock count
  });
  it('TikTok CSV: sku_id, preorder stated as preorder, never a sale price', () => {
    const csv = buildTikTokCatalogueCsv([product(), product({ sku: 'PRE', isPreOrderEnabled: true }), product({ sku: 'NOIMG', imageUrl: null })]);
    const [head, ...rows] = csv.trim().split('\n');
    expect(head).toBe(TIKTOK_FEED_COLUMNS.join(','));
    expect(head.startsWith('sku_id,')).toBe(true);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toContain(',preorder,');
    expect(head).not.toContain('sale_price');
  });
  it('cells are RFC 4180 quoted and control characters dropped', () => {
    expect(feedCsvCell('a "b", c')).toBe('"a ""b"", c"');
    expect(feedCsvCell('line\nbreak\u0007')).toBe('line break');
  });
});

// ── Destinations: Test mode and optimisation events ─────────────────────────

const destRow = (over: Partial<AdDestinationRow> = {}): AdDestinationRow => ({
  platform: 'meta', enabled: true, config: { datasetId: '1234567890123' }, hasSecret: true, secretMask: '••••', updatedAt: null, lastSuccessAt: null, lastError: null, lastErrorAt: null,
  sentCount: 0, failedCount: 0, mode: 'live', eventSelection: null, ...over,
});

describe('destinations: Test / Live and early signals', () => {
  const mk = (row: AdDestinationRow | null) => {
    const saved: any[] = [];
    const repo = { list: async () => (row ? [row] : []), get: async () => row, save: async (_k: string, p: any) => { saved.push(p); return { ...(row ?? destRow()), ...p, mode: p.mode ?? row?.mode ?? 'live', eventSelection: p.eventSelection === undefined ? row?.eventSelection ?? null : p.eventSelection }; }, active: async () => [] };
    return { uc: new AdDestinationUseCases(repo as any, AD_PLATFORMS, { encrypt: (s) => `enc:${s}`, decrypt: (s) => s, mask: () => '••••' }, audit), saved };
  };
  it('a platform switched on in test mode reads TEST and is still a recipient', async () => {
    const { uc } = mk(destRow({ mode: 'test', config: { datasetId: '1234567890123', testEventCode: 'TEST123' } }));
    expect((await uc.list()).find((p) => p.key === 'meta')!.state).toBe('TEST');
    expect(await uc.recipients()).toContain('Meta (Facebook, Instagram, WhatsApp ads)');
  });
  it('Test mode needs a documented test channel and, for Meta/TikTok, the test event code', async () => {
    expect((await mk(destRow()).uc.configure(null, 'meta', { mode: 'test' })).ok).toBe(false);
    expect((await mk(destRow({ platform: 'snapchat', config: { pixelId: '0a1b2c3d-0000-4000-8000-000000000000' } })).uc.configure(null, 'snapchat', { mode: 'test' })).ok).toBe(false);
    const ok = mk(destRow());
    expect((await ok.uc.configure(null, 'meta', { mode: 'test', config: { testEventCode: 'TEST123' } })).ok).toBe(true);
    expect(ok.saved[0].mode).toBe('test');
  });
  it('the optimisation selection keeps only supported early signals', async () => {
    const m = mk(destRow());
    await m.uc.configure(null, 'pinterest', { eventSelection: ['generate_lead', 'begin_checkout', 'purchase'] });
    expect(m.saved[0].eventSelection).toEqual(['generate_lead']); // Pinterest has no begin_checkout; purchase is not selectable
  });
  it('builders: lead mapping, test codes, validateOnly, Pinterest test flag', () => {
    const lead: any = { event_name: 'generate_lead', event_id: '11111111-1111-4111-8111-111111111111', event_time: 1790000000, source: 'browser', lead: { method: 'quote_request' }, user_data: {} };
    expect((buildAdRequest('meta', lead, { datasetId: '1' }, 't')!.body as any).data[0].event_name).toBe('Lead');
    // A WhatsApp chat tap is a Contact on Meta, not a Lead (no details were submitted).
    expect((buildAdRequest('meta', { ...lead, lead: { method: 'whatsapp' } }, { datasetId: '1' }, 't')!.body as any).data[0].event_name).toBe('Contact');
    expect((buildAdRequest('meta', { ...lead, lead: undefined }, { datasetId: '1' }, 't')!.body as any).data[0].event_name).toBe('Contact');
    expect((buildAdRequest('tiktok', lead, { pixelCode: 'C0ABCDEFGH12' }, 't')!.body as any).data[0].event).toBe('SubmitForm');
    expect((buildAdRequest('tiktok', { ...lead, lead: { method: 'whatsapp' } }, { pixelCode: 'C0ABCDEFGH12' }, 't')!.body as any).data[0].event).toBe('Contact');
    expect((buildAdRequest('pinterest', lead, { adAccountId: '549755885175' }, 't')!.body as any).data[0].event_name).toBe('lead');
    expect(buildAdRequest('meta', lead, { datasetId: '1', _test: '1' }, 't')).toBeNull(); // test without a code sends nothing
    expect((buildAdRequest('meta', lead, { datasetId: '1', _test: '1', testEventCode: 'TEST9' }, 't')!.body as any).test_event_code).toBe('TEST9');
    const purchase: any = { ...lead, event_name: 'purchase', user_data: { gclid: 'g' }, ecommerce: { value: 1, currency: 'UGX', transaction_id: 'GP-1' } };
    expect((buildAdRequest('google_ads', purchase, { customerId: '1234567890', conversionActionId: '777', apiVersion: 'v25', _test: '1' }, '')!.body as any).validateOnly).toBe(true);
    expect(buildAdRequest('pinterest', { ...purchase }, { adAccountId: '549755885175', _test: '1' }, 't')!.url).toMatch(/\?test=true$/);
    expect(buildAdRequest('pinterest', { ...purchase }, { adAccountId: '549755885175' }, 't')!.url).not.toContain('test=');
  });
});

// ── Capabilities + checklist ─────────────────────────────────────────────────

const capRow = (over: Partial<AdCapabilityRow> = {}): AdCapabilityRow => ({ platform: 'meta', capability: 'audiences', enabled: false, config: {}, hasSecret: false, secretMask: null, updatedAt: null, lastRunAt: null, lastStatus: null, lastError: null, ...over });

describe('capabilities', () => {
  it('names exactly what is missing; a borrowed token counts', () => {
    const aud = capabilityDef('meta', 'audiences')!;
    expect(capabilityGap(aud, null, false, false)).toMatch(/enter Ad account ID; store the Marketing API system-user token/);
    expect(capabilityGap(aud, capRow({ config: { adAccountId: '1010101010101' }, hasSecret: true }), false, false)).toBe('');
    const spend = capabilityDef('meta', 'spend')!;
    expect(capabilityGap(spend, capRow({ capability: 'spend', config: { adAccountId: '1010101010101' } }), true, false)).toBe('');
    expect(capabilityGap(spend, capRow({ capability: 'spend', config: { adAccountId: '1010101010101' } }), false, false)).toMatch(/store/);
    expect(capabilityGap(capabilityDef('google_ads', 'audiences')!, null, false, false)).toMatch(/conversions settings/);
  });
  it('cannot be switched on while incomplete; tokens are stored encrypted and never returned', async () => {
    let row: AdCapabilityRow | null = null;
    const repo = { list: async () => (row ? [row] : []), get: async () => row, save: async (_p: string, c: any, patch: any) => { row = { ...(row ?? capRow({ capability: c })), ...(patch.config ? { config: patch.config } : {}), ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}), ...(patch.secretEnc !== undefined ? { hasSecret: !!patch.secretEnc, secretMask: patch.secretMask } : {}) }; return row!; }, recordRun: async () => undefined };
    const uc = new AdCapabilityUseCases(repo as any, async () => [], { encrypt: (s) => `enc:${s}`, decrypt: (s) => s, mask: () => '••••abcd' }, audit);
    const r1 = await uc.configure(null, 'meta', 'audiences', { enabled: true });
    expect(r1.ok).toBe(false);
    const r2 = await uc.configure(null, 'meta', 'audiences', { config: { adAccountId: '1010101010101' }, secret: 'EAAB-system-user-token-000000', enabled: true });
    expect(r2.ok).toBe(true);
    expect(JSON.stringify(r2)).not.toContain('EAAB-system-user-token');
    expect((await uc.live('meta', 'audiences'))?.state).toBe('LIVE');
    expect((await uc.configure(null, 'meta', 'audiences', { config: { adAccountId: 'act_x' } })).ok).toBe(false);
    const noVault = new AdCapabilityUseCases(repo as any, async () => [], null, audit);
    expect(await noVault.configure(null, 'meta', 'audiences', { secret: 'EAAB-system-user-token-000000' })).toMatchObject({ ok: false, code: 'NOT_CONFIGURED' });
  });
  it('the checklist reads real state and never ticks what it cannot see', () => {
    const meta = AD_PLATFORMS.find((p) => p.key === 'meta')!;
    const list = buildChecklist({
      destinations: [{ ...meta, state: 'NOT_CONFIGURED', row: null }, { ...AD_PLATFORMS.find((p) => p.key === 'spotify')!, state: 'NOT_AVAILABLE', row: null } as any],
      capabilities: [],
      feedProducts: null,
      feedUrls: { google: 'g', meta: 'https://api.shopgoldplus.com/advertising/feeds/meta-catalogue.csv', tiktok: 't' },
    });
    const m = list.find((p) => p.platform === 'meta')!;
    expect(m.status).toBe('NOT_CONFIGURED');
    const conv = m.items.find((i) => i.key === 'conversions')!;
    expect(conv.steps.find((s) => s.secret)!.done).toBe(false);
    expect(conv.steps[0].where).toMatch(/Events Manager/);
    const feed = m.items.find((i) => i.key === 'catalogue')!;
    expect(feed.detail).toMatch(/could not be read/);
    expect(feed.steps[0]).toMatchObject({ done: false, unverifiable: true });
    expect(list.find((p) => p.platform === 'spotify')!.status).toBe('NOT_AVAILABLE');
  });
});
