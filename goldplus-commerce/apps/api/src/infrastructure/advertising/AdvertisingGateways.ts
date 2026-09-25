import { createHash, randomInt } from 'node:crypto';
import type {
  AudienceGateway, HashedAudienceMember, OfflineContext, OfflineConversionGateway, PlatformCredentials, SpendGateway,
} from '../../application/ports/Advertising';
import { googleChannel, decimalToMinor, microsToMinor, type SpendFact } from '../../domain/advertising/SpendFacts';
import { metaActionSource } from '../../domain/advertising/OfflineConversionPolicy';
import { asRemoteStatus, type RemoteRequestOutcome } from '../../domain/advertising/AudienceConfirmation';
import { META_GRAPH_VERSION, adPlatform } from './AdPlatforms';

/**
 * The platform calls behind audiences, spend import and offline conversions
 * (docs/advertising/README.md cites each endpoint). Every function is one
 * documented request shape; `fetchImpl` is injectable so tests assert the
 * exact request without any network. Tokens travel in headers or request
 * bodies, never in a logged URL, and every error message is scrubbed of them.
 */

type Fetch = typeof fetch;
const GRAPH = `https://graph.facebook.com/${META_GRAPH_VERSION}`;
const TIKTOK = 'https://business-api.tiktok.com/open_api/v1.3';

/** Removes anything token-shaped from a message before it is stored or shown. */
export function scrub(msg: string, secrets: string[] = []): string {
  let m = msg.replace(/access_token=[^&\s"]+/g, 'access_token=[redacted]').replace(/Bearer\s+[A-Za-z0-9._-]+/g, 'Bearer [redacted]');
  for (const s of secrets) if (s && s.length >= 8) m = m.split(s).join('[redacted]');
  return m.slice(0, 400);
}

class PlatformError extends Error { constructor(message: string, public readonly status: number | null) { super(message); } }

async function call(fetchImpl: Fetch, url: string, init: RequestInit, secrets: string[]): Promise<any> {
  let res: Response;
  try {
    res = await fetchImpl(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(30_000) });
  } catch (err) {
    throw new PlatformError(scrub(`network error: ${(err as Error).message}`, secrets), null);
  }
  const text = await res.text().catch(() => '');
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  if (!res.ok) {
    const detail = json?.error?.message ?? json?.message ?? json?.[0]?.error?.message ?? text.slice(0, 300);
    throw new PlatformError(scrub(`HTTP ${res.status}: ${detail}`, secrets), res.status);
  }
  return json;
}

// ── Google Ads (REST) ────────────────────────────────────────────────────────

async function googleHeaders(creds: PlatformCredentials): Promise<Record<string, string>> {
  const def = adPlatform('google_ads')!;
  const auth = await def.authorize!({ url: '', headers: {} }, creds.destinationConfig, creds.destinationSecret);
  const d = creds.destinationConfig;
  return { 'content-type': 'application/json', ...auth, ...(d.loginCustomerId ? { 'login-customer-id': d.loginCustomerId } : {}) };
}
const gBase = (c: PlatformCredentials) => `https://googleads.googleapis.com/${c.destinationConfig.apiVersion}/customers/${c.destinationConfig.customerId}`;
const googleSecrets = (c: PlatformCredentials) => { try { return Object.values(JSON.parse(c.destinationSecret)).map(String); } catch { return [c.destinationSecret]; } };

// ── Google Customer Match (Data Manager API) ────────────────────────────────
//
// Since 1 April 2026 Customer Match uploads through the Google Ads API
// (OfflineUserDataJobService / UserDataService) fail for any Google Cloud
// project that had not already been sending them; this shop never had. The
// supported path is the Data Manager API (datamanager.googleapis.com, OAuth
// scope https://www.googleapis.com/auth/datamanager). docs/advertising/README.md
// cites each endpoint. Spend import and offline click conversions stay on the
// Google Ads API, which is unaffected.

export const DATA_MANAGER = 'https://datamanager.googleapis.com/v1';
export const DATA_MANAGER_SCOPE = 'https://www.googleapis.com/auth/datamanager';
/** Data Manager accepts at most 10,000 audience members per ingest request. */
export const DATA_MANAGER_MAX_MEMBERS = 10_000;

const dmTokenCache = new Map<string, { token: string; until: number }>();

/** OAuth refresh-token exchange for the Data Manager scope, cached until shortly before expiry. */
async function dataManagerToken(fetchImpl: Fetch, clientId: string, clientSecret: string, refreshToken: string, secrets: string[]): Promise<string> {
  const key = createHash('sha256').update(`${clientId}:${refreshToken}`).digest('hex');
  const hit = dmTokenCache.get(key);
  if (hit && hit.until > Date.now()) return hit.token;
  const j = await call(fetchImpl, 'https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken }).toString(),
  }, secrets);
  if (!j?.access_token) throw new PlatformError('Google OAuth did not return an access token', null);
  dmTokenCache.set(key, { token: String(j.access_token), until: Date.now() + Math.max(60, Number(j.expires_in ?? 3600) - 300) * 1000 });
  return String(j.access_token);
}

/**
 * The OAuth client (clientId/clientSecret) is the one entered for Google Ads
 * conversions; the refresh token is the audience capability's own, granted for
 * the Data Manager scope. Nothing is sent without it.
 */
const dataManagerSecrets = (c: PlatformCredentials) => [...googleSecrets(c), c.secret];
async function dataManagerHeaders(fetchImpl: Fetch, creds: PlatformCredentials): Promise<Record<string, string>> {
  const secrets = dataManagerSecrets(creds);
  let client: Record<string, unknown>;
  try { client = JSON.parse(creds.destinationSecret); } catch { throw new PlatformError('Not configured: the Google Ads credentials are not valid JSON', null); }
  const clientId = typeof client.clientId === 'string' ? client.clientId : '';
  const clientSecret = typeof client.clientSecret === 'string' ? client.clientSecret : '';
  if (!clientId || !clientSecret) throw new PlatformError('Not configured: the Google Ads credentials have no OAuth clientId/clientSecret', null);
  if (!creds.secret) throw new PlatformError('Not configured: store the Data Manager API refresh token', null);
  const token = await dataManagerToken(fetchImpl, clientId, clientSecret, creds.secret, secrets);
  const login = creds.destinationConfig.loginCustomerId;
  return { 'content-type': 'application/json', Authorization: `Bearer ${token}`, ...(login ? { 'login-account': `accountTypes/GOOGLE_ADS/accounts/${login}` } : {}) };
}

/** The numeric user list id from a Data Manager or Google Ads resource name (or a bare id). */
export function googleUserListId(remote: string): string | null {
  const m = /userLists\/(\d+)$/.exec(remote);
  if (m) return m[1];
  return /^\d+$/.test(remote) ? remote : null;
}

/** The Data Manager destination for one Customer Match list of the owner's Google Ads account. */
export function dataManagerDestination(cfg: Record<string, string>, userListId: string) {
  return {
    operatingAccount: { accountType: 'GOOGLE_ADS', accountId: cfg.customerId },
    ...(cfg.loginCustomerId ? { loginAccount: { accountType: 'GOOGLE_ADS', accountId: cfg.loginCustomerId } } : {}),
    productDestinationId: userListId,
  };
}

/** Customer Match user identifiers for one person (already hashed the Google way, hex). */
export const googleUserIdentifiers = (m: HashedAudienceMember) =>
  [m.email ? { emailAddress: m.email } : null, m.phone ? { phoneNumber: m.phone } : null].filter(Boolean);

/**
 * audienceMembers:ingest request bodies, at most 10,000 members each.
 *
 * Consent: no `consent` block is sent. This shop stores refusals (D-002: a
 * refuser is never uploaded) but no per-person grant for Google's
 * ad_user_data / ad_personalization, and the field is optional (Google
 * requires it for EEA users; the shop sells in Uganda). Declaring GRANTED for
 * people who never recorded a grant would tell Google something untrue.
 *
 * termsOfService ACCEPTED is sent only because the capability cannot be LIVE
 * until the owner confirms they accepted the Customer Match terms in Google Ads.
 */
export function dataManagerIngestBodies(members: HashedAudienceMember[], destination: unknown, perRequest = DATA_MANAGER_MAX_MEMBERS): unknown[] {
  const withIds = members.filter((m) => m.email || m.phone);
  const out: unknown[] = [];
  for (let i = 0; i < withIds.length; i += perRequest) {
    out.push({
      destinations: [destination],
      audienceMembers: withIds.slice(i, i + perRequest).map((m) => ({ userData: { userIdentifiers: googleUserIdentifiers(m) } })),
      encoding: 'HEX',
      termsOfService: { customerMatchTermsOfServiceStatus: 'ACCEPTED' },
    });
  }
  return out;
}

const requireGoogleTerms = (creds: PlatformCredentials) => {
  if (creds.config.customerMatchTerms !== 'accepted') throw new PlatformError('Not configured: confirm that the Customer Match terms were accepted in Google Ads', null);
};

// ── Meta (Graph API) ─────────────────────────────────────────────────────────

/**
 * Meta's token travels in the Authorization header (Graph accepts an OAuth
 * bearer token there), never in a URL or a logged body.
 */
export const metaHeaders = (token: string, json = true): Record<string, string> => ({ ...(json ? { 'content-type': 'application/json' } : {}), Authorization: `Bearer ${token}` });

/** A Graph paging URL with any access_token parameter removed (the header carries it). */
export function withoutAccessToken(url: string): string {
  try {
    const u = new URL(url);
    u.searchParams.delete('access_token');
    return u.toString();
  } catch { return url; }
}

/** Meta multi-key customer file rows: [EMAIL, PHONE], '' for a missing value. */
export const metaRows = (members: HashedAudienceMember[]) => members.map((m) => [m.email ?? '', m.phone ?? '']);

// ── TikTok (API for Business) ───────────────────────────────────────────────

const tiktokOk = (j: any, secrets: string[]) => {
  if (j?.code !== 0) throw new PlatformError(scrub(`TikTok code ${j?.code}: ${j?.message ?? 'unknown error'}`, secrets), 400);
  return j.data ?? {};
};

/** The customer file TikTok receives: one hashed phone per line. */
export const tiktokFile = (members: HashedAudienceMember[]) => `${members.map((m) => m.phone).filter(Boolean).join('\n')}\n`;

async function tiktokUpload(fetchImpl: Fetch, creds: PlatformCredentials, members: HashedAudienceMember[]): Promise<string> {
  const content = tiktokFile(members);
  const form = new FormData();
  form.set('advertiser_id', creds.config.advertiserId);
  form.set('calculate_type', 'PHONE_SHA256');
  form.set('file_signature', createHash('md5').update(content).digest('hex'));
  form.set('file', new Blob([content], { type: 'text/csv' }), 'goldplus-audience.csv');
  const j = tiktokOk(await call(fetchImpl, `${TIKTOK}/dmp/custom_audience/file/upload/`, { method: 'POST', headers: { 'Access-Token': creds.secret }, body: form }, [creds.secret]), [creds.secret]);
  if (!j.file_path) throw new PlatformError('TikTok did not return a file path', null);
  return String(j.file_path);
}

export class HttpAudienceGateway implements AudienceGateway {
  constructor(private readonly fetchImpl: Fetch = fetch, private readonly now: () => Date = () => new Date()) {}

  async createList(platform: string, input: { name: string; description: string; membershipDays: number }, members: HashedAudienceMember[], creds: PlatformCredentials) {
    if (platform === 'google_ads') {
      requireGoogleTerms(creds);
      const cfg = creds.destinationConfig;
      const r = await call(this.fetchImpl, `${DATA_MANAGER}/accountTypes/GOOGLE_ADS/accounts/${cfg.customerId}/userLists`, { method: 'POST', headers: await dataManagerHeaders(this.fetchImpl, creds), body: JSON.stringify({
        displayName: input.name, description: input.description,
        membershipDuration: `${Math.min(540, Math.max(1, Math.round(input.membershipDays))) * 86_400}s`,
        ingestedUserListInfo: { uploadKeyTypes: ['CONTACT_ID'], contactIdInfo: { dataSourceType: 'DATA_SOURCE_TYPE_FIRST_PARTY' } },
      }) }, dataManagerSecrets(creds));
      const name = String(r?.name ?? '');
      if (!/^accountTypes\/GOOGLE_ADS\/accounts\/\d+\/userLists\/\d+$/.test(name)) throw new PlatformError('Google did not return a user list', null);
      return { remoteId: name, uploaded: null };
    }
    if (platform === 'meta') {
      const r = await call(this.fetchImpl, `${GRAPH}/act_${creds.config.adAccountId}/customaudiences`, { method: 'POST', headers: metaHeaders(creds.secret), body: JSON.stringify({
        name: input.name, description: input.description, subtype: 'CUSTOM', customer_file_source: 'USER_PROVIDED_ONLY',
      }) }, [creds.secret]);
      if (!/^\d+$/.test(String(r?.id ?? ''))) throw new PlatformError('Meta did not return an audience id', null);
      return { remoteId: String(r.id), uploaded: null };
    }
    if (platform === 'tiktok') {
      const filePath = await tiktokUpload(this.fetchImpl, creds, members);
      const j = tiktokOk(await call(this.fetchImpl, `${TIKTOK}/dmp/custom_audience/create/`, { method: 'POST', headers: { 'content-type': 'application/json', 'Access-Token': creds.secret }, body: JSON.stringify({
        advertiser_id: creds.config.advertiserId, custom_audience_name: input.name.slice(0, 128), file_paths: [filePath], calculate_type: 'PHONE_SHA256',
      }) }, [creds.secret]), [creds.secret]);
      if (!j.custom_audience_id) throw new PlatformError('TikTok did not return an audience id', null);
      return { remoteId: String(j.custom_audience_id), uploaded: members.length };
    }
    throw new PlatformError('Not configured: no audience upload for this platform', null);
  }

  async replaceMembers(platform: string, remoteListId: string, members: HashedAudienceMember[], creds: PlatformCredentials): Promise<{ uploaded: number; requestIds?: string[] }> {
    if (platform === 'google_ads') {
      // Ingest only. Data Manager processes it asynchronously and answers with
      // a requestId; the outcome comes from requestStatus:retrieve (see
      // requestStatus). Removing the people no longer eligible (sweepStale) is
      // sent only after Google confirms EVERY ingest of the run succeeded.
      requireGoogleTerms(creds);
      const listId = googleUserListId(remoteListId);
      if (!listId) throw new PlatformError('The stored Customer Match list id is not a Google user list', null);
      const destination = dataManagerDestination(creds.destinationConfig, listId);
      const headers = await dataManagerHeaders(this.fetchImpl, creds);
      const secrets = dataManagerSecrets(creds);
      let uploaded = 0;
      const requestIds: string[] = [];
      for (const body of dataManagerIngestBodies(members, destination)) {
        const r = await call(this.fetchImpl, `${DATA_MANAGER}/audienceMembers:ingest`, { method: 'POST', headers, body: JSON.stringify(body) }, secrets);
        const id = typeof r?.requestId === 'string' ? r.requestId : '';
        if (!id) throw new PlatformError('Google accepted an upload without a request id; its outcome cannot be confirmed', null);
        requestIds.push(id);
        uploaded += (body as { audienceMembers: unknown[] }).audienceMembers.length;
      }
      return { uploaded, requestIds };
    }
    if (platform === 'meta') {
      // usersreplace: one session, batches of at most 10,000; the last batch says so.
      const rows = metaRows(members);
      const sessionId = randomInt(1, 2 ** 47);
      const batches = Math.max(1, Math.ceil(rows.length / 10_000));
      for (let i = 0; i < batches; i++) {
        await call(this.fetchImpl, `${GRAPH}/${remoteListId}/usersreplace`, { method: 'POST', headers: metaHeaders(creds.secret), body: JSON.stringify({
          session: { session_id: sessionId, batch_seq: i + 1, last_batch_flag: i === batches - 1, estimated_num_total: rows.length },
          payload: { schema: ['EMAIL', 'PHONE'], data: rows.slice(i * 10_000, (i + 1) * 10_000) },
        }) }, [creds.secret]);
      }
      return { uploaded: members.length };
    }
    if (platform === 'tiktok') {
      const filePath = await tiktokUpload(this.fetchImpl, creds, members);
      tiktokOk(await call(this.fetchImpl, `${TIKTOK}/dmp/custom_audience/update/`, { method: 'POST', headers: { 'content-type': 'application/json', 'Access-Token': creds.secret }, body: JSON.stringify({
        advertiser_id: creds.config.advertiserId, custom_audience_id: remoteListId, action: 'REPLACE', file_paths: [filePath], calculate_type: 'PHONE_SHA256',
      }) }, [creds.secret]), [creds.secret]);
      return { uploaded: members.length };
    }
    throw new PlatformError('Not configured: no audience upload for this platform', null);
  }

  async clearList(platform: string, remoteListId: string, creds: PlatformCredentials) {
    if (platform === 'google_ads') {
      const listId = googleUserListId(remoteListId);
      if (!listId) throw new PlatformError('The stored Customer Match list id is not a Google user list', null);
      const r = await call(this.fetchImpl, `${DATA_MANAGER}/audienceMembers:removeAll`, { method: 'POST', headers: await dataManagerHeaders(this.fetchImpl, creds), body: JSON.stringify({
        destinations: [dataManagerDestination(creds.destinationConfig, listId)],
      }) }, dataManagerSecrets(creds));
      return { forget: false, ...(typeof r?.requestId === 'string' && r.requestId ? { requestIds: [r.requestId] } : {}) };
    }
    if (platform === 'meta') {
      // The token travels in the Authorization header, never in the URL (proxy logs keep URLs).
      await call(this.fetchImpl, `${GRAPH}/${remoteListId}`, { method: 'DELETE', headers: metaHeaders(creds.secret, false) }, [creds.secret]);
      return { forget: true };
    }
    if (platform === 'tiktok') {
      tiktokOk(await call(this.fetchImpl, `${TIKTOK}/dmp/custom_audience/delete/`, { method: 'POST', headers: { 'content-type': 'application/json', 'Access-Token': creds.secret }, body: JSON.stringify({
        advertiser_id: creds.config.advertiserId, custom_audience_ids: [remoteListId],
      }) }, [creds.secret]), [creds.secret]);
      return { forget: true };
    }
    throw new PlatformError('Not configured: no audience upload for this platform', null);
  }

  /**
   * Google: GET requestStatus:retrieve?requestId=… for each request of a run.
   * Other platforms confirm synchronously and never reach this.
   */
  async requestStatus(platform: string, requestIds: string[], creds: PlatformCredentials): Promise<RemoteRequestOutcome[]> {
    if (platform !== 'google_ads') throw new PlatformError('Not configured: this platform confirms uploads immediately', null);
    const headers = await dataManagerHeaders(this.fetchImpl, creds);
    const secrets = dataManagerSecrets(creds);
    const out: RemoteRequestOutcome[] = [];
    for (const id of requestIds) {
      const j = await call(this.fetchImpl, `${DATA_MANAGER}/requestStatus:retrieve?requestId=${encodeURIComponent(id)}`, { method: 'GET', headers }, secrets);
      out.push(dataManagerOutcome(id, j, secrets));
    }
    return out;
  }

  /**
   * Google: removeAll with removeAsOfTime — removes the members last added
   * before the run began, i.e. the people the run did not re-add (no longer
   * eligible, such as someone who since refused). Sent only after every
   * ingest of the run was confirmed. See docs/advertising/README.md: whether a
   * re-ingest refreshes a member's "last added" time is not documented by
   * Google; check it on a test list before relying on it.
   */
  async sweepStale(platform: string, remoteListId: string, asOf: Date, creds: PlatformCredentials): Promise<{ requestId: string | null }> {
    if (platform !== 'google_ads') throw new PlatformError('Not configured: this platform replaces lists in one call', null);
    requireGoogleTerms(creds);
    const listId = googleUserListId(remoteListId);
    if (!listId) throw new PlatformError('The stored Customer Match list id is not a Google user list', null);
    const r = await call(this.fetchImpl, `${DATA_MANAGER}/audienceMembers:removeAll`, { method: 'POST', headers: await dataManagerHeaders(this.fetchImpl, creds), body: JSON.stringify({
      destinations: [dataManagerDestination(creds.destinationConfig, listId)], removeAsOfTime: asOf.toISOString(),
    }) }, dataManagerSecrets(creds));
    return { requestId: typeof r?.requestId === 'string' && r.requestId ? r.requestId : null };
  }
}

/** One requestStatus:retrieve reply → statuses per destination and short, token-free error counts. */
export function dataManagerOutcome(requestId: string, reply: any, secrets: string[] = []): RemoteRequestOutcome {
  const per: any[] = Array.isArray(reply?.requestStatusPerDestination) ? reply.requestStatusPerDestination : [];
  const errors: string[] = [];
  for (const d of per) {
    for (const e of (Array.isArray(d?.errorInfo?.errorCounts) ? d.errorInfo.errorCounts : [])) {
      errors.push(scrub(`${String(e?.reason ?? 'UNKNOWN_ERROR')}: ${String(e?.recordCount ?? '?')} records`, secrets).slice(0, 120));
    }
  }
  return { requestId, statuses: per.map((d) => asRemoteStatus(d?.requestStatus)), errors };
}

// ── Spend ────────────────────────────────────────────────────────────────────

export const googleSpendQuery = (from: string, to: string) =>
  `SELECT customer.currency_code, campaign.id, campaign.name, campaign.advertising_channel_type, segments.date, metrics.cost_micros, metrics.clicks, metrics.impressions FROM campaign WHERE segments.date BETWEEN '${from}' AND '${to}'`;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Google searchStream reply (an array of batches) → spend facts. */
export function googleSpendFacts(reply: unknown, customerId: string): SpendFact[] {
  const batches = Array.isArray(reply) ? reply : [reply];
  const out: SpendFact[] = [];
  for (const b of batches) for (const r of ((b as any)?.results ?? [])) {
    const currency = String(r?.customer?.currencyCode ?? '').toUpperCase();
    const cost = String(r?.metrics?.costMicros ?? '0');
    const clicks = Number(r?.metrics?.clicks ?? 0), impressions = Number(r?.metrics?.impressions ?? 0);
    if (cost === '0' && clicks === 0 && impressions === 0) continue; // no activity is not a spend fact
    out.push({
      spendDate: String(r?.segments?.date ?? ''), channel: googleChannel(r?.campaign?.advertisingChannelType), platform: 'Google Ads', account: customerId,
      campaign: `id:${r?.campaign?.id ?? ''}`, campaignLabel: r?.campaign?.name ? String(r.campaign.name).slice(0, 150) : null,
      currency, spendMinor: /^\d+$/.test(cost) ? microsToMinor(cost, currency) : -1, clicks, impressions, source: 'google_ads_api',
    });
  }
  return out;
}

/** Meta Insights rows (level=campaign, time_increment=1) → spend facts. */
export function metaSpendFacts(rows: any[], adAccountId: string): SpendFact[] {
  return rows.map((r) => {
    const currency = String(r?.account_currency ?? '').toUpperCase();
    const spend = decimalToMinor(String(r?.spend ?? ''), currency);
    const n = (v: unknown) => (v == null || v === '' ? null : /^\d+$/.test(String(v)) ? Number(v) : null);
    return {
      spendDate: String(r?.date_start ?? ''), channel: 'paid_social', platform: 'Meta', account: `act_${adAccountId}`,
      campaign: `id:${r?.campaign_id ?? ''}`, campaignLabel: r?.campaign_name ? String(r.campaign_name).slice(0, 150) : null,
      currency, spendMinor: spend ?? -1, clicks: n(r?.clicks), impressions: n(r?.impressions), source: 'meta_marketing_api',
    };
  }).filter((f) => DATE.test(f.spendDate));
}

export class HttpSpendGateway implements SpendGateway {
  constructor(private readonly fetchImpl: Fetch = fetch) {}

  async fetchDaily(platform: string, from: string, to: string, creds: PlatformCredentials): Promise<SpendFact[]> {
    if (!DATE.test(from) || !DATE.test(to)) throw new PlatformError('bad date range', 400);
    if (platform === 'google_ads') {
      const reply = await call(this.fetchImpl, `${gBase(creds)}/googleAds:searchStream`, { method: 'POST', headers: await googleHeaders(creds), body: JSON.stringify({ query: googleSpendQuery(from, to) }) }, googleSecrets(creds));
      return googleSpendFacts(reply, creds.destinationConfig.customerId);
    }
    if (platform === 'meta') {
      const q = new URLSearchParams({
        level: 'campaign', time_increment: '1', time_range: JSON.stringify({ since: from, until: to }),
        fields: 'campaign_id,campaign_name,spend,impressions,clicks,account_currency,date_start', limit: '500',
      });
      let url: string | null = `${GRAPH}/act_${creds.config.adAccountId}/insights?${q.toString()}`;
      const rows: any[] = [];
      for (let page = 0; url && page < 50; page++) {
        const j: any = await call(this.fetchImpl, url, { method: 'GET', headers: metaHeaders(creds.secret, false) }, [creds.secret]);
        rows.push(...(j?.data ?? []));
        // Graph's paging `next` URL can carry the token: it is stripped, the header carries it.
        const next: unknown = j?.paging?.next;
        url = typeof next === 'string' && next.startsWith(`${GRAPH}/`) ? withoutAccessToken(next) : null;
      }
      return metaSpendFacts(rows, creds.config.adAccountId);
    }
    throw new PlatformError('Not configured: no spend API for this platform', null);
  }
}

// ── Offline conversions ──────────────────────────────────────────────────────

const googleTime = (iso: string) => new Date(iso).toISOString().replace('T', ' ').slice(0, 19) + '+00:00';

/** The exact request for one offline conversion (pure; the gateway sends it). */
export function offlineRequest(ctx: OfflineContext, creds: PlatformCredentials): { url: string; headers: Record<string, string>; body: unknown } | null {
  const h = ctx.hashes, c = ctx.clickIds, d = creds.destinationConfig;
  const t = Math.floor(new Date(ctx.row.occurredAt).getTime() / 1000);
  const orderId = ctx.orderNumber ?? `OFFLINE-${ctx.row.sourceRef.slice(0, 8).toUpperCase()}`;
  if (ctx.row.platform === 'google_ads') {
    const action = creds.config.offlineConversionActionId || d.conversionActionId;
    const ids = [h.emailGoogleSha256 ? { hashedEmail: h.emailGoogleSha256 } : null, h.phonePlusSha256 ? { hashedPhoneNumber: h.phonePlusSha256 } : null].filter(Boolean);
    return {
      url: `https://googleads.googleapis.com/${d.apiVersion}/customers/${d.customerId}:uploadClickConversions`, headers: {},
      body: { partialFailure: true, ...(creds.testMode ? { validateOnly: true } : {}), conversions: [{
        ...(c.gclid ? { gclid: c.gclid } : c.gbraid ? { gbraid: c.gbraid } : c.wbraid ? { wbraid: c.wbraid } : {}),
        conversionAction: `customers/${d.customerId}/conversionActions/${action}`, conversionDateTime: googleTime(ctx.row.occurredAt),
        conversionValue: ctx.valueUgx, currencyCode: 'UGX', orderId, ...(ids.length ? { userIdentifiers: ids } : {}),
      }] },
    };
  }
  if (ctx.row.platform === 'meta') {
    if (creds.testMode && !d.testEventCode) return null;
    return {
      url: `${GRAPH}/${d.datasetId}/events`, headers: metaHeaders(creds.destinationSecret),
      body: {
        ...(creds.testMode ? { test_event_code: d.testEventCode } : {}),
        data: [{ event_name: 'Purchase', event_time: t, event_id: ctx.row.eventId, action_source: metaActionSource(ctx.row.source, ctx.channel),
          user_data: { em: h.emailSha256 ? [h.emailSha256] : undefined, ph: h.phoneDigitsSha256 ? [h.phoneDigitsSha256] : undefined, fbc: c.fbc },
          custom_data: { currency: 'UGX', value: ctx.valueUgx, order_id: orderId } }],
      },
    };
  }
  if (ctx.row.platform === 'tiktok') {
    if (creds.testMode && !d.testEventCode) return null;
    return {
      url: `${TIKTOK}/event/track/`, headers: { 'content-type': 'application/json', 'Access-Token': creds.secret || creds.destinationSecret },
      body: { event_source: 'offline', event_source_id: creds.config.offlineEventSetId, ...(creds.testMode ? { test_event_code: d.testEventCode } : {}),
        data: [{ event: 'CompletePayment', event_time: t, event_id: ctx.row.eventId,
          user: { email: h.emailSha256 ?? undefined, phone: h.phonePlusSha256 ?? undefined, ttclid: c.ttclid },
          properties: { currency: 'UGX', value: ctx.valueUgx, order_id: orderId } }] },
    };
  }
  return null;
}

export class HttpOfflineConversionGateway implements OfflineConversionGateway {
  constructor(private readonly fetchImpl: Fetch = fetch) {}

  async send(ctx: OfflineContext, creds: PlatformCredentials): Promise<{ status: number | null; error: string | null }> {
    const req = offlineRequest(ctx, creds);
    if (!req) return { status: 400, error: 'Test mode needs the test event code; nothing was sent.' };
    const secrets = ctx.row.platform === 'google_ads' ? googleSecrets(creds) : [creds.secret, creds.destinationSecret];
    const headers = ctx.row.platform === 'google_ads' ? { ...(await googleHeaders(creds)), ...req.headers } : req.headers;
    try {
      const j = await call(this.fetchImpl, req.url, { method: 'POST', headers, body: JSON.stringify(req.body) }, secrets);
      if (ctx.row.platform === 'google_ads' && j?.partialFailureError?.message) return { status: 400, error: scrub(`partial failure: ${j.partialFailureError.message}`, secrets) };
      if (ctx.row.platform === 'tiktok' && j?.code !== 0) return { status: 400, error: scrub(`TikTok code ${j?.code}: ${j?.message ?? ''}`, secrets) };
      return { status: 200, error: null };
    } catch (err) {
      return { status: err instanceof PlatformError ? err.status : null, error: scrub(String((err as Error).message), secrets) };
    }
  }
}
