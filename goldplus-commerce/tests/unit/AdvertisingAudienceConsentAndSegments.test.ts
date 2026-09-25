import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AudienceGateway, AudienceRunRecord, OfflineConversionRepository, PlatformCredentials } from '../../apps/api/src/application/ports/Advertising';
import { AudienceSyncUseCases, membersFromHashed, type AudienceSyncExtras } from '../../apps/api/src/application/use-cases/advertising/AudienceSyncUseCases';
import { OfflineConversionUseCases } from '../../apps/api/src/application/use-cases/advertising/OfflineConversionUseCases';
import { capabilityDef, capabilityGap, AdCapabilityUseCases } from '../../apps/api/src/application/use-cases/advertising/AdCapabilities';
import { groupBuyers } from '../../apps/api/src/domain/advertising/AudienceSegments';
import { hashedContactFor } from '../../apps/api/src/domain/advertising/ContactNormalisation';
import { hashForAdPlatforms } from '../../apps/api/src/domain/first-party/AudienceHashing';
import { HttpAudienceGateway, googleUserListId } from '../../apps/api/src/infrastructure/advertising/AdvertisingGateways';
import { isWhatsAppChatWithUs } from '../../apps/web/src/lib/leadSignalRules';
import { tagWhatsAppHref } from '../../apps/web/src/lib/whatsappRef';

/**
 * Advertising fixes after the growth check (docs/advertising/README.md):
 * guest buyers' refusals through the identity graph, Google Customer Match on
 * the Data Manager API with no invented consent, owner segments through the
 * first-party port, audit inside the use case, one hashing rule, one WhatsApp
 * link rule, and the WhatsApp tap handler off the every-page script.
 */

const ROOT = join(__dirname, '../..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const NOW = new Date('2026-09-25T00:00:00Z');
const creds = (over: Partial<PlatformCredentials> = {}): PlatformCredentials => ({ config: {}, secret: 'CAP_SECRET_TOKEN_123', destinationConfig: {}, destinationSecret: 'DEST_SECRET_TOKEN_456', testMode: false, ...over });
const liveCap = (platform: string, config: Record<string, string> = {}) => ({ platform, row: { config } } as any);
const order = (i: number, extra: any = {}) => ({ orderId: `o${i}`, userId: null, email: `p${i}@x.co`, phone: `07000000${String(i).padStart(2, '0')}`, fpClientId: null, totalUgx: 100_000 * i, purchasedAt: new Date('2026-09-20T00:00:00Z'), status: 'delivered', paymentStatus: 'paid', ...extra });

function harness(opts: { orders?: any[]; refusedFps?: string[]; cfg?: Record<string, string>; remote?: Record<string, string>; extras?: AudienceSyncExtras; live?: boolean } = {}) {
  const runs: AudienceRunRecord[] = [];
  const remote = new Map(Object.entries(opts.remote ?? {}));
  const calls: string[] = [];
  const uploads: Record<string, any[]> = {};
  const gateway: AudienceGateway = {
    createList: vi.fn(async (p, i) => { calls.push(`create:${p}:${i.name}`); return { remoteId: `${p}-${i.name}`, uploaded: null }; }),
    replaceMembers: vi.fn(async (p, id, members) => { calls.push(`replace:${p}:${id}:${members.length}`); uploads[id] = members; return { uploaded: members.length }; }),
    clearList: vi.fn(async (p, id) => { calls.push(`clear:${p}:${id}`); return { forget: true }; }),
  };
  const seenSubjects: string[][] = [];
  const uc = new AudienceSyncUseCases(
    {
      buyerOrders: async () => opts.orders ?? [],
      refusedIdentities: async (_u, fps) => { seenSubjects.push(fps); return { userIds: new Set<string>(), fpClientIds: new Set(fps.filter((f) => (opts.refusedFps ?? []).includes(f))) }; },
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
    () => NOW,
    opts.extras ?? {},
  );
  return { uc, runs, calls, uploads, remote, seenSubjects };
}

describe('guest buyers: a refusal reachable only through the identity graph excludes them', () => {
  it('the linked browser of a guest order is a consent subject, and the refuser is left out of every list', async () => {
    // The guest's order kept no browser (order_attribution rarely has one); the
    // first-party identity graph links their order to the browser that refused.
    const guest = order(1, { linkedFpClientIds: ['fp.guest.refused'] });
    const h = harness({ orders: [guest, order(2)], refusedFps: ['fp.guest.refused'], cfg: { segments: 'past_buyers' } });
    const preview = (await h.uc.preview()).find((r) => r.platform === 'meta' && r.segment === 'past_buyers')!;
    expect(preview).toMatchObject({ inSegment: 2, excludedConsent: 1, eligible: 1 });
    expect(h.seenSubjects[0]).toContain('fp.guest.refused');
    await h.uc.run('meta', 'SYNC', 'ADMIN', null);
    const uploaded = Object.values(h.uploads)[0];
    expect(uploaded).toHaveLength(1);
    expect(uploaded[0]).toEqual(hashedContactFor('meta', { email: 'p2@x.co', phone: '0700000002' }));
  });
  it('linked accounts and browsers are consent subjects, never a reason to merge two people', () => {
    const buyers = groupBuyers([
      order(1, { linkedFpClientIds: ['fp.a'], linkedUserIds: ['11111111-1111-4111-8111-111111111111'] }),
      order(2, { linkedFpClientIds: ['fp.a'] }),
    ]);
    expect(buyers).toHaveLength(2);
    expect(buyers.find((b) => b.orderIds.includes('o1'))).toMatchObject({ fpClientIds: ['fp.a'], userIds: ['11111111-1111-4111-8111-111111111111'] });
  });
  it('an admin-recorded sale for a guest order carries the order\'s linked browsers for the send-time check', async () => {
    const repo = {
      findOrder: vi.fn(async () => ({ id: 'ord-1', orderNumber: 'GP-1', userId: null, fpClientId: null, linkedUserIds: [], linkedFpClientIds: ['fp.guest.1'] })),
      consentSubjectsForContact: vi.fn(async () => ({ userIds: [], fpClientIds: ['fp.contact'] })),
      recordSale: vi.fn(async () => 'sale-1'),
    } as unknown as OfflineConversionRepository;
    const uc = new OfflineConversionUseCases(repo, { send: vi.fn() } as any, async () => null, async () => creds(), { execute: vi.fn(async () => ({})) } as any, () => NOW);
    const r = await uc.recordSale(null, { channel: 'PHONE', occurredAt: '2026-09-24T10:00:00Z', valueUgx: 145000, phone: '0772123456', orderNumber: 'GP-1' });
    expect(r.ok).toBe(true);
    expect((repo.recordSale as any).mock.calls[0][0].subjects).toEqual({ userIds: [], fpClientIds: ['fp.contact', 'fp.guest.1'] });
  });
  it('every advertising read of an order joins the identity graph (buyers, order lookup, send-time context, contact lookup)', () => {
    const src = read('apps/api/src/infrastructure/db/repositories/DrizzleAdvertisingOpsRepository.ts');
    expect(src).toMatch(/from customer_identity_links ol/);
    expect(src).toMatch(/ORDER_CUSTOMER_RELATIONSHIP/);
    // buyerOrders, findOrder, consentSubjectsForContact and context's order load.
    expect(src.match(/\$\{linkedIdentitiesSql\(sql`o\.id`\)\}/g)?.length).toBe(4);
  });
});

describe('Google Customer Match on the Data Manager API', () => {
  const google = (over: Partial<PlatformCredentials> = {}) => creds({
    destinationConfig: { customerId: '1234567890', conversionActionId: '777', apiVersion: 'v25', loginCustomerId: '9876543210' },
    destinationSecret: JSON.stringify({ developerToken: 'DEVTOKEN_zzzzzzzz', clientId: 'c2.apps.googleusercontent.com', clientSecret: 'CSECRET_zzzzzzzz', refreshToken: 'ADS_ONLY_TOKEN_zz' }),
    secret: 'DM_REFRESH_TOKEN_second', config: { customerMatchTerms: 'accepted' }, ...over,
  });
  function fetchWith(replies: unknown[]) {
    const calls: Array<{ url: string; init: any }> = [];
    const f = vi.fn(async (url: string, init: any) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(replies.length ? replies.shift() : {}), { status: 200 });
    });
    return { f: f as unknown as typeof fetch, calls };
  }
  it('a manager account is the login account (header and destination); emptying a list removes everyone', async () => {
    const { f, calls } = fetchWith([{ access_token: 'ACCESS_second', expires_in: 3600 }, { requestId: 'x' }]);
    const r = await new HttpAudienceGateway(f).clearList('google_ads', 'accountTypes/GOOGLE_ADS/accounts/1234567890/userLists/77', google());
    // The request id comes back so the emptying is confirmed later, not assumed.
    expect(r).toEqual({ forget: false, requestIds: ['x'] });
    expect(calls[1].url).toBe('https://datamanager.googleapis.com/v1/audienceMembers:removeAll');
    expect(calls[1].init.headers['login-account']).toBe('accountTypes/GOOGLE_ADS/accounts/9876543210');
    expect(JSON.parse(calls[1].init.body)).toEqual({ destinations: [{
      operatingAccount: { accountType: 'GOOGLE_ADS', accountId: '1234567890' }, loginAccount: { accountType: 'GOOGLE_ADS', accountId: '9876543210' }, productDestinationId: '77',
    }] });
  });
  it('no terms confirmation or no Data Manager token: "Not configured", and no network call at all', async () => {
    const { f, calls } = fetchWith([]);
    const g = new HttpAudienceGateway(f);
    await expect(g.replaceMembers('google_ads', '55', [{ email: 'e', phone: null }], google({ config: {} }))).rejects.toThrow(/^Not configured/);
    await expect(g.createList('google_ads', { name: 'n', description: 'd', membershipDays: 30 }, [], google({ secret: '' }))).rejects.toThrow(/^Not configured/);
    expect(calls).toHaveLength(0);
  });
  it('a list id stored by the old Google Ads route still resolves to the same user list', () => {
    expect(googleUserListId('customers/1234567890/userLists/55')).toBe('55');
    expect(googleUserListId('accountTypes/GOOGLE_ADS/accounts/1/userLists/56')).toBe('56');
    expect(googleUserListId('nonsense')).toBeNull();
  });
  it('the capability needs the terms ticked and its own Data Manager token before it can go live', () => {
    const def = capabilityDef('google_ads', 'audiences')!;
    expect(def.secretLabel).toMatch(/Data Manager/);
    const gap = capabilityGap(def, null, false, true);
    expect(gap).toMatch(/tick "Customer Match terms accepted in Google Ads"/);
    expect(gap).toMatch(/store the Data Manager API refresh token/);
    const row = { platform: 'google_ads', capability: 'audiences' as const, enabled: false, config: { customerMatchTerms: 'accepted' }, hasSecret: true, secretMask: null, updatedAt: null, lastRunAt: null, lastStatus: null, lastError: null };
    expect(capabilityGap(def, row, false, true)).toBe('');
  });
  it('saving without the tick is allowed; a blank tick clears it', async () => {
    let saved: any = null;
    const repo = { list: async () => [], get: async () => saved, save: async (_p: string, _c: any, patch: any) => (saved = { ...(saved ?? {}), config: patch.config ?? saved?.config, enabled: false, hasSecret: false }), recordRun: async () => undefined };
    const uc = new AdCapabilityUseCases(repo as any, async () => [], null, { execute: vi.fn(async () => ({})) } as any);
    expect((await uc.configure(null, 'google_ads', 'audiences', { config: { customerMatchTerms: 'accepted' } })).ok).toBe(true);
    expect(saved.config.customerMatchTerms).toBe('accepted');
    expect((await uc.configure(null, 'google_ads', 'audiences', { config: { customerMatchTerms: '' } })).ok).toBe(true);
    expect(saved.config.customerMatchTerms).toBeUndefined();
  });
  it('the Google Ads API Customer Match route is gone from the code', () => {
    const src = read('apps/api/src/infrastructure/advertising/AdvertisingGateways.ts');
    expect(src).not.toMatch(/offlineUserDataJobs|CUSTOMER_MATCH_USER_LIST|userLists:mutate/);
    expect(src).not.toMatch(/adUserData:\s*'GRANTED'/);
  });
});

describe('Meta: deleting an audience never puts the token in the URL', () => {
  it('sends the token in the Authorization header', async () => {
    const calls: Array<{ url: string; init: any }> = [];
    const f = vi.fn(async (url: string, init: any) => { calls.push({ url, init }); return new Response('{"success":true}', { status: 200 }); }) as unknown as typeof fetch;
    const r = await new HttpAudienceGateway(f).clearList('meta', '2385', creds({ secret: 'EAAB_META_TOKEN_123456' }));
    expect(r).toEqual({ forget: true });
    expect(calls[0].init.method).toBe('DELETE');
    expect(calls[0].url).not.toContain('EAAB_META_TOKEN');
    expect(calls[0].url).not.toContain('access_token');
    expect(calls[0].init.body).toBeUndefined();
    expect(calls[0].init.headers.Authorization).toBe('Bearer EAAB_META_TOKEN_123456');
  });
});

describe('owner-defined segments reach ad platforms only through the first-party port', () => {
  const hashed = hashForAdPlatforms({ email: 'Jane.Doe@gmail.com', phone: '0772123456' });
  const extras = (over: Partial<{ status: string; members: any[] }> = {}, segStatus = 'ACTIVE'): AudienceSyncExtras => ({
    customSegments: {
      list: async () => [{ id: 'seg-1', key: 'vip-buyers', name: 'VIP buyers', status: segStatus as any, memberCount: 3, lastMaterialisedAt: NOW }],
      source: {
        advertisingAudience: vi.fn(async () => ({
          status: (over.status ?? 'OK') as any, segment: null,
          members: over.members ?? [{ canonicalCustomerId: 'c1', hashed }, { canonicalCustomerId: 'c2', hashed: hashForAdPlatforms({ email: null, phone: null }) }],
          excludedAdvertisingRefused: 2, excludedNoIdentifier: 1, excludedConsentUnknown: 1,
        })),
      },
    },
  });
  it('a ticked segment becomes its own list with the platform\'s hashes; the port\'s consent exclusions are counted', async () => {
    const h = harness({ orders: [], cfg: { segments: 'past_buyers', customSegments: 'vip-buyers' }, extras: extras() });
    const runs = await h.uc.run('google_ads', 'SYNC', 'SCHEDULE', null);
    const seg = runs.find((r) => r.segment === 'seg:vip-buyers')!;
    expect(seg).toMatchObject({ status: 'SYNCED', eligibleCount: 1, excludedConsent: 3, excludedNoIdentifier: 2, uploadedCount: 1 });
    expect(h.calls).toContain('create:google_ads:GoldPlus: VIP buyers');
    expect(h.uploads['google_ads-GoldPlus: VIP buyers']).toEqual([hashedContactFor('google_ads', { email: 'Jane.Doe@gmail.com', phone: '0772123456' })]);
    expect(h.remote.get('google_ads:seg:vip-buyers')).toBe('google_ads-GoldPlus: VIP buyers');
  });
  it('TikTok gets the phone only; Meta gets digits-only phones', () => {
    expect(membersFromHashed('tiktok', hashed)).toEqual({ email: null, phone: hashedContactFor('tiktok', { phone: '0772123456' }).phone });
    expect(membersFromHashed('meta', hashed)).toEqual(hashedContactFor('meta', { email: 'Jane.Doe@gmail.com', phone: '0772123456' }));
  });
  it('a segment not computed yet says so and sends nothing', async () => {
    const h = harness({ cfg: { segments: 'past_buyers', customSegments: 'vip-buyers' }, extras: extras({ status: 'NOT_MATERIALISED', members: [] }) });
    const runs = await h.uc.run('meta', 'SYNC', 'ADMIN', null);
    expect(runs.find((r) => r.segment === 'seg:vip-buyers')).toMatchObject({ status: 'NOT_MATERIALISED' });
    expect(h.calls).toEqual([]);
  });
  it('an archived segment, or one no longer ticked, has the list uploaded earlier emptied', async () => {
    const archived = harness({ cfg: { segments: 'past_buyers', customSegments: 'vip-buyers' }, extras: extras({}, 'ARCHIVED'), remote: { 'meta:seg:vip-buyers': 'M1' } });
    const r1 = await archived.uc.run('meta', 'SYNC', 'SCHEDULE', null);
    expect(archived.calls).toEqual(['clear:meta:M1']);
    expect(r1.find((r) => r.segment === 'seg:vip-buyers')!.status).toBe('CLEARED');
    const unticked = harness({ cfg: { segments: 'past_buyers' }, extras: extras(), remote: { 'meta:seg:vip-buyers': 'M2' } });
    await unticked.uc.run('meta', 'SYNC', 'SCHEDULE', null);
    expect(unticked.calls).toEqual(['clear:meta:M2']);
    expect(unticked.remote.size).toBe(0);
  });
  it('a segment list that cannot be read uploads nobody', async () => {
    const broken: AudienceSyncExtras = { customSegments: { list: async () => { throw new Error('db down'); }, source: { advertisingAudience: vi.fn() } } };
    const h = harness({ orders: [order(1)], cfg: { customSegments: 'vip-buyers' }, extras: broken });
    const runs = await h.uc.run('meta', 'SYNC', 'ADMIN', null);
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe('CONSENT_UNREADABLE');
    expect(h.calls).toEqual([]);
  });
  it('the admin preview reads each segment once for all three platforms', async () => {
    const x = extras();
    const h = harness({ cfg: { customSegments: 'vip-buyers' }, extras: x });
    const rows = (await h.uc.preview()).filter((r) => r.segment === 'seg:vip-buyers');
    expect(rows.map((r) => r.platform)).toEqual(['google_ads', 'meta', 'tiktok']);
    expect(x.customSegments!.source.advertisingAudience).toHaveBeenCalledTimes(1);
    expect(rows.find((r) => r.platform === 'tiktok')!.blocker).toMatch(/at least 1,000/);
  });
  it('the owner is offered only active segments', async () => {
    const h = harness({ extras: extras() });
    expect(await h.uc.availableCustomSegments()).toEqual([{ key: 'vip-buyers', name: 'VIP buyers', memberCount: 3, materialisedAt: NOW.toISOString() }]);
    expect(await harness().uc.availableCustomSegments()).toEqual([]);
  });
});

describe('the audience use case audits and records its own runs (thin route)', () => {
  it('an admin sync is audited and sets the capability\'s last run; a scheduled one is not audited', async () => {
    const audit = { execute: vi.fn(async () => ({})) };
    const recordCapabilityRun = vi.fn(async () => undefined);
    const h = harness({ orders: [order(1)], cfg: { segments: 'past_buyers' }, extras: { audit, recordCapabilityRun } });
    await h.uc.run('meta', 'SYNC', 'ADMIN', 'actor-1');
    expect(audit.execute).toHaveBeenCalledWith(expect.objectContaining({ actorId: 'actor-1', action: 'AD_AUDIENCE_SYNC_RUN', entity: 'ad_audience', entityId: 'meta' }));
    expect(recordCapabilityRun).toHaveBeenCalledWith('meta', 'SYNCED', null);
    await h.uc.run('meta', 'DRY_RUN', 'ADMIN', 'actor-1');
    expect(audit.execute).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'AD_AUDIENCE_DRY_RUN' }));
    expect(recordCapabilityRun).toHaveBeenCalledTimes(1);
    audit.execute.mockClear();
    await h.uc.run('meta', 'SYNC', 'SCHEDULE', null);
    expect(audit.execute).not.toHaveBeenCalled();
    expect(recordCapabilityRun).toHaveBeenCalledTimes(2);
  });
  it('the route no longer writes the audit or the run status itself', () => {
    const route = read('apps/api/src/interfaces/http/routes/admin/advertising.ts');
    expect(route).not.toMatch(/AD_AUDIENCE_SYNC_RUN|createAuditLogUseCase\.execute|capabilities\.recordRun\([^)]*'audiences'/);
  });
});

describe('one hashing rule for every audience path', () => {
  it('the first-party port hashes exactly as the advertising sends do, foreign numbers included', () => {
    for (const c of [{ email: ' Jane.Doe+x@GoogleMail.com ', phone: '0772 123 456' }, { email: 'a.b@example.co.uk', phone: '+44 20 7946 0958' }]) {
      const fp = hashForAdPlatforms(c);
      expect({ email: fp.emailSha256Google, phone: fp.phoneSha256E164 }).toEqual(hashedContactFor('google_ads', c));
      expect({ email: fp.emailSha256, phone: fp.phoneSha256Digits }).toEqual(hashedContactFor('meta', c));
    }
  });
});

describe('WhatsApp taps', () => {
  it('a tap counted as a lead is exactly a tap that gets a reference code', () => {
    const hrefs = [
      'https://wa.me/256700000000', 'https://wa.me/256700000000?text=Hi', 'https://wa.me/+256700000000', 'https://wa.me/?text=look',
      'https://api.whatsapp.com/send?phone=256700000000&text=x', 'https://api.whatsapp.com/send?phone=+256700000000', 'https://wa.me/256700000000/extra', 'not a url',
    ];
    for (const h of hrefs) expect(isWhatsAppChatWithUs(h), h).toBe(tagWhatsAppHref(h, 'GP-7K3Q9X') !== null);
    expect(isWhatsAppChatWithUs('https://wa.me/+256700000000')).toBe(false);
  });
  it('the tap handler is not in the every-page telemetry script: only pages with a WhatsApp call to action register it', () => {
    const telemetry = read('apps/web/src/lib/telemetry.ts');
    expect(telemetry).not.toMatch(/from '\.\/whatsappRef'|from '\.\/leadSignalRules'/);
    expect(telemetry).not.toMatch(/export function (tagWhatsAppLinks|trackWhatsAppLeads)/);
    // Not even a lazy loader: the pages with a WhatsApp call to action register it.
    expect(telemetry).not.toMatch(/whatsappClicks'|WA_LINK|loadWhatsAppClicks/);
    expect(read('apps/web/src/layouts/BaseLayout.astro')).not.toMatch(/whatsappClicks/);
    expect(read('apps/web/src/components/GpNav.astro')).not.toMatch(/whatsappClicks/);
    for (const page of ['apps/web/src/pages/products/[slug].astro', 'apps/web/src/pages/bulk/submitted.astro']) {
      expect(read(page), page).toMatch(/import \{ installWhatsAppClicks \} from '\.\.\/\.\.\/lib\/whatsappClicks';\s*installWhatsAppClicks\(\);/);
    }
    const lazy = read('apps/web/src/lib/whatsappClicks.ts');
    // One listener for both jobs (reference tag + lead).
    expect(lazy.match(/addEventListener\('click'/g)?.length).toBe(1);
    expect(lazy).toMatch(/tagWhatsAppHref/);
    expect(lazy).toMatch(/generate_lead/);
  });
});
