import type { AdCapability, AdCapabilityRepository, AdCapabilityRow, AdDestinationRow, SecretCipher } from '../../ports/Advertising';
import type { CreateAuditLogUseCase } from '../audit/CreateAuditLogUseCase';
import { AUDIENCE_SEGMENTS } from '../../../domain/advertising/AudienceSegments';

/**
 * Per-platform capabilities beyond browser conversions (0154): audience sync,
 * spend import and offline conversions. Each has the owner's ids, an optional
 * write-only token, and an on/off switch. A capability is LIVE only when its
 * ids are valid, its token (or the one it borrows) is stored, the conversions
 * destination it builds on is complete where it needs one, and a person
 * switched it on. Nothing is ever sent for a capability that is not LIVE.
 */

export interface CapabilityField {
  key: string; label: string; pattern: RegExp; where: string; optional?: boolean;
  /**
   * A tick box the owner confirms (stored as 'accepted'; blank = not yet).
   * Saving without it is allowed; the capability cannot go LIVE until it is ticked.
   */
  confirm?: boolean;
}
export interface CapabilityDef {
  platform: string;
  capability: AdCapability;
  name: string;
  fields: CapabilityField[];
  /** '' = no token of its own. */
  secretLabel: string;
  secretWhere?: string;
  /** The token may be left blank: another stored token is used (named in secretWhere). */
  secretOptional?: boolean;
  /** Borrow the token of this sibling capability when this one has none. */
  secretFallback?: AdCapability;
  /** Needs the platform's conversions destination (ids + token) to be complete. */
  requiresDestination: boolean;
  what: string;
}

const SEGMENT_LIST = new RegExp(`^(${AUDIENCE_SEGMENTS.join('|')})(,(${AUDIENCE_SEGMENTS.join('|')}))*$`);
const audienceFields: CapabilityField[] = [
  { key: 'segments', label: 'Lists to sync', pattern: SEGMENT_LIST, where: 'Tick the lists below; blank = all three.', optional: true },
  { key: 'recentDays', label: 'Recent-buyer window (days)', pattern: /^([1-9]\d{0,2})$/, where: 'How recent a purchase keeps someone on the exclusion list. Blank = 30.', optional: true },
  { key: 'highValueMinUgx', label: 'High-value threshold (UGX lifetime spend)', pattern: /^[1-9]\d{3,11}$/, where: 'Blank = the top 20% of buyers by lifetime spend.', optional: true },
  // Owner-defined segments (first-party module, /admin/segments), by key. Read
  // through the segment → audience port, which applies consent per member.
  { key: 'customSegments', label: 'Your segments to sync', pattern: /^[a-z0-9-]{3,64}(,[a-z0-9-]{3,64}){0,9}$/, where: 'Tick segments defined under Segments; each becomes its own list. Blank = none.', optional: true },
];

export const AD_CAPABILITIES: CapabilityDef[] = [
  {
    platform: 'google_ads', capability: 'audiences', name: 'Customer Match audiences', requiresDestination: true,
    fields: [
      { key: 'customerMatchTerms', label: 'Customer Match terms accepted in Google Ads', pattern: /^accepted$/, confirm: true,
        where: 'Google Ads > Tools > Shared library > Audience manager > + > Customer list: read and accept the Customer Match terms once, then tick here. Each upload tells Google they were accepted, so tick only after you have.' },
      ...audienceFields,
    ],
    secretLabel: 'Data Manager API refresh token',
    secretWhere: 'Customer Match uploads now go through Google\'s Data Manager API (the Google Ads API route was turned off on 1 April 2026 for projects that had not used it). In the Google Cloud project of the OAuth client entered for conversions: APIs & Services > Library > "Data Manager API" > Enable. Then run one OAuth consent with that client for scope https://www.googleapis.com/auth/datamanager, signed in as a Google account that can open this Google Ads account, and paste the refresh token it returns.',
    what: 'Uploads hashed email and phone of past buyers, recent buyers (for exclusion) and a high-value seed to Customer Match lists through the Data Manager API, replacing each list daily. Uses the OAuth client, customer ID and manager ID entered for conversions.',
  },
  {
    platform: 'google_ads', capability: 'spend', name: 'Spend import', requiresDestination: true, secretLabel: '', fields: [],
    what: 'Reads daily cost, clicks and impressions per campaign with the Google Ads API (GoogleAdsService searchStream).',
  },
  {
    platform: 'google_ads', capability: 'offline', name: 'Offline conversions', requiresDestination: true, secretLabel: '',
    fields: [{ key: 'offlineConversionActionId', label: 'Offline conversion action ID', pattern: /^\d{4,20}$/, optional: true,
      where: 'Optional. Goals > Conversions > New conversion action > Import > "CRM, files or other data sources" > "Track conversions from clicks"; open it and copy the number after ctId= in the address bar. Blank = the conversions action above.' }],
    what: 'Uploads COD sales confirmed on delivery and admin-recorded phone/WhatsApp sales as click conversions (with the click id when the order kept one) or enhanced conversions for leads (hashed email/phone).',
  },
  {
    platform: 'meta', capability: 'audiences', name: 'Custom Audiences', requiresDestination: false,
    fields: [{ key: 'adAccountId', label: 'Ad account ID', pattern: /^\d{6,20}$/, where: 'Meta Business settings > Accounts > Ad accounts: the number under the account name (without "act_").' }, ...audienceFields],
    secretLabel: 'Marketing API system-user token',
    secretWhere: 'Business settings > Users > System users > Add (Admin) > Assign assets: the ad account with "Manage campaigns" > Generate new token for your Meta app with ads_management and ads_read. Accept the Custom Audience terms once in Ads Manager > Audiences > Create audience > Custom audience > Customer list.',
    what: 'Uploads hashed email and phone of each list to a customer-list Custom Audience, replacing its members daily (usersreplace).',
  },
  {
    platform: 'meta', capability: 'spend', name: 'Spend import', requiresDestination: false,
    fields: [{ key: 'adAccountId', label: 'Ad account ID', pattern: /^\d{6,20}$/, where: 'The same ad account number as for audiences (without "act_").' }],
    secretLabel: 'Marketing API system-user token (ads_read)', secretOptional: true, secretFallback: 'audiences',
    secretWhere: 'Leave blank to use the token entered for Custom Audiences (it must carry ads_read).',
    what: 'Reads daily spend, clicks and impressions per campaign from the Marketing API Insights edge.',
  },
  {
    platform: 'meta', capability: 'offline', name: 'Offline conversions', requiresDestination: true, secretLabel: '', fields: [],
    what: 'Sends COD sales confirmed on delivery (action_source physical_store) and admin-recorded phone (phone_call) and WhatsApp (chat) sales through the Conversions API, to the same dataset and with the same token as web conversions.',
  },
  {
    platform: 'tiktok', capability: 'audiences', name: 'Customer file audiences', requiresDestination: false,
    fields: [{ key: 'advertiserId', label: 'Advertiser ID', pattern: /^\d{8,25}$/, where: 'TikTok Ads Manager: the account menu at the top right shows the advertiser ID; also Business Center > Assets > Advertiser accounts.' }, ...audienceFields],
    secretLabel: 'Marketing API access token',
    secretWhere: 'TikTok API for Business (business-api.tiktok.com/portal) > My Apps > create an app with the Audience Management scope > authorise your advertiser account > the access_token returned by /oauth2/access_token/.',
    what: 'Uploads a hashed-phone customer file per list and replaces the audience daily. TikTok refuses a file with fewer than 1,000 entries, so a small list is reported, not sent.',
  },
  {
    platform: 'tiktok', capability: 'offline', name: 'Offline conversions', requiresDestination: true,
    fields: [{ key: 'offlineEventSetId', label: 'Offline event set ID', pattern: /^\d{6,25}$/, where: 'TikTok Ads Manager > Tools > Events > Offline events > create or open an event set: the ID under its name.' }],
    secretLabel: 'Events API token for the offline event set', secretOptional: true,
    secretWhere: 'The event set\'s settings > Generate access token. Leave blank to use the web pixel\'s Events API token.',
    what: 'Sends COD deliveries and phone/WhatsApp sales as CompletePayment events with event_source "offline".',
  },
];

export const capabilityDef = (platform: string, capability: string) => AD_CAPABILITIES.find((c) => c.platform === platform && c.capability === capability) ?? null;

export type CapabilityState = 'LIVE' | 'READY_OFF' | 'NOT_CONFIGURED';

/** Why a capability is not ready ('' = ready): shown as "Not configured: …". */
export function capabilityGap(def: CapabilityDef, row: AdCapabilityRow | null, siblingHasSecret: boolean, destinationComplete: boolean): string {
  const missing = def.fields.filter((f) => !f.optional && !f.confirm && !f.pattern.test(row?.config?.[f.key] ?? '')).map((f) => f.label);
  const unconfirmed = def.fields.filter((f) => f.confirm && !f.pattern.test(row?.config?.[f.key] ?? '')).map((f) => f.label);
  const bad = def.fields.filter((f) => f.optional && row?.config?.[f.key] && !f.pattern.test(row.config[f.key])).map((f) => f.label);
  const parts: string[] = [];
  if (missing.length) parts.push(`enter ${missing.join(', ')}`);
  if (unconfirmed.length) parts.push(`tick ${unconfirmed.map((l) => `"${l}"`).join(', ')}`);
  if (bad.length) parts.push(`correct ${bad.join(', ')}`);
  if (def.secretLabel && !def.secretOptional && !row?.hasSecret && !(def.secretFallback && siblingHasSecret)) parts.push(`store the ${def.secretLabel}`);
  if (def.secretLabel && def.secretOptional && def.secretFallback && !row?.hasSecret && !siblingHasSecret) parts.push(`store the ${def.secretLabel}`);
  if (def.requiresDestination && !destinationComplete) parts.push('complete the conversions settings for this platform first');
  return parts.join('; ');
}

type R<T> = { ok: true; value: T } | { ok: false; code: 'NOT_FOUND' | 'BAD_INPUT' | 'NOT_CONFIGURED'; message: string };

export interface CapabilityView extends CapabilityDef { state: CapabilityState; gap: string; row: AdCapabilityRow | null }

export class AdCapabilityUseCases {
  constructor(
    private readonly repo: AdCapabilityRepository,
    private readonly destinations: () => Promise<Array<{ key: string; state: string; row: AdDestinationRow | null }>>,
    private readonly cipher: SecretCipher | null,
    private readonly audit: CreateAuditLogUseCase,
  ) {}

  async list(): Promise<CapabilityView[]> {
    const rows = await this.repo.list();
    const byKey = new Map(rows.map((r) => [`${r.platform}:${r.capability}`, r]));
    const dest = new Map((await this.destinations()).map((d) => [d.key, d]));
    return AD_CAPABILITIES.map((def) => {
      const row = byKey.get(`${def.platform}:${def.capability}`) ?? null;
      const sibling = def.secretFallback ? byKey.get(`${def.platform}:${def.secretFallback}`) : undefined;
      const d = dest.get(def.platform);
      const destinationComplete = !!d && d.state !== 'NOT_CONFIGURED' && d.state !== 'NOT_AVAILABLE';
      const gap = capabilityGap(def, row, !!sibling?.hasSecret, destinationComplete);
      const state: CapabilityState = gap ? 'NOT_CONFIGURED' : row?.enabled ? 'LIVE' : 'READY_OFF';
      return { ...def, state, gap, row };
    });
  }

  async live(platform: string, capability: AdCapability): Promise<CapabilityView | null> {
    const v = (await this.list()).find((c) => c.platform === platform && c.capability === capability) ?? null;
    return v && v.state === 'LIVE' ? v : null;
  }

  recordRun(platform: string, capability: AdCapability, status: string, error: string | null) { return this.repo.recordRun(platform, capability, status, error); }

  async configure(actorId: string | null, platform: string, capability: string, input: { config?: Record<string, unknown>; secret?: string; enabled?: boolean; removeSecret?: boolean }): Promise<R<AdCapabilityRow>> {
    const def = capabilityDef(platform, capability);
    if (!def) return { ok: false, code: 'NOT_FOUND', message: 'Unknown platform capability.' };
    const current = await this.repo.get(platform, def.capability);
    const config: Record<string, string> = { ...(current?.config ?? {}) };
    for (const f of def.fields) {
      const v = input.config?.[f.key];
      if (v === undefined) continue;
      const s = String(v).trim();
      if ((f.optional || f.confirm) && s === '') { delete config[f.key]; continue; }
      if (!f.pattern.test(s)) return { ok: false, code: 'BAD_INPUT', message: `${f.label} does not look right (${f.where})` };
      config[f.key] = s;
    }
    let secretEnc: string | null | undefined;
    let secretMask: string | null | undefined;
    if (typeof input.secret === 'string' && input.secret.trim() && def.secretLabel) {
      if (!this.cipher) return { ok: false, code: 'NOT_CONFIGURED', message: 'Not configured: the credential vault key is not set on the server.' };
      const s = input.secret.trim();
      if (s.length < 20 || s.length > 4000) return { ok: false, code: 'BAD_INPUT', message: `${def.secretLabel} does not look right.` };
      secretEnc = this.cipher.encrypt(s);
      secretMask = this.cipher.mask(s);
    }
    if (input.removeSecret) {
      const row = await this.repo.save(platform, def.capability, { enabled: false, config, secretEnc: null, secretMask: null, updatedBy: actorId });
      await this.audit.execute({ actorId, action: 'AD_CAPABILITY_TOKEN_REMOVED', entity: 'ad_capability', entityId: `${platform}:${def.capability}`, newState: { enabled: false } });
      return { ok: true, value: row };
    }
    const saved = await this.repo.save(platform, def.capability, { enabled: input.enabled === true ? current?.enabled ?? false : input.enabled, config, secretEnc, secretMask, updatedBy: actorId });
    if (input.enabled === true) {
      const view = (await this.list()).find((c) => c.platform === platform && c.capability === def.capability)!;
      if (view.gap) return { ok: false, code: 'BAD_INPUT', message: `Saved, but not switched on: ${view.gap}.` };
      const on = await this.repo.save(platform, def.capability, { enabled: true, updatedBy: actorId });
      await this.audit.execute({ actorId, action: 'AD_CAPABILITY_CONFIGURED', entity: 'ad_capability', entityId: `${platform}:${def.capability}`, newState: { enabled: true, config, secretChanged: secretEnc !== undefined } });
      return { ok: true, value: on };
    }
    await this.audit.execute({ actorId, action: 'AD_CAPABILITY_CONFIGURED', entity: 'ad_capability', entityId: `${platform}:${def.capability}`, newState: { enabled: saved.enabled, config, secretChanged: secretEnc !== undefined } });
    return { ok: true, value: saved };
  }
}
