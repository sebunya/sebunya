import type {
  AudienceGateway, AudienceListRepository, AudienceRunLock, AudienceRunRecord, AudienceSourcePort, HashedAudienceMember, PlatformCredentials,
} from '../../ports/Advertising';
import { combineOutcomes, nextConfirmationStep } from '../../../domain/advertising/AudienceConfirmation';
import type { ISegmentAudienceSource, SegmentRecord } from '../../ports/first-party/FirstPartyPorts';
import { hashesForPlatform, type PlatformHashedIdentifiers } from '../../../domain/first-party/AudienceHashing';
import { AUDIENCE_SEGMENTS, SEGMENT_INFO, groupBuyers, parseSegmentPolicy, selectSegment, type AudienceSegment, type Buyer } from '../../../domain/advertising/AudienceSegments';
import { hashedContactFor, type AudiencePlatform } from '../../../domain/advertising/ContactNormalisation';
import type { CreateAuditLogUseCase } from '../audit/CreateAuditLogUseCase';
import type { CapabilityView } from './AdCapabilities';

/**
 * Audience sync (docs/advertising/README.md, "Audiences").
 *
 *   orders → people (domain) → segment → consent gate → hashed per platform
 *   → full replace of the platform list.
 *
 * Two kinds of list:
 *  - the three built-in lists (past buyers, recent buyers for exclusion,
 *    high-value seed) computed here from real orders;
 *  - owner-defined segments from the first-party module, read ONLY through its
 *    segment → audience port (ISegmentAudienceSource.advertisingAudience),
 *    which applies consent per member and returns hashes only. The owner picks
 *    them per platform (`customSegments`, comma-separated segment keys).
 *
 * Consent: a person is left out when ANY of their accounts or browsers —
 * including the browsers the first-party identity graph links to their orders
 * and the browsers linked to their account — carries a stored advertising
 * refusal: the same predicate as every other ad send (AdvertisingConsentGate,
 * D-002). A failed consent read uploads nobody.
 *
 * Dry run = the same computation with no platform call: the counts shown in
 * admin are what a sync would upload. A capability that is not LIVE answers
 * "Not configured" and makes no network call.
 *
 * One SYNC per platform at a time (a leased lock): a run that cannot take it
 * logs BUSY and calls nothing, so two runs can never both create a list and
 * orphan one.
 *
 * Google confirms uploads later (Data Manager is asynchronous): such a run is
 * logged SUBMITTED with its request ids, and confirmPending() (the 5-minute
 * tick) records Google's answer, then removes the people no longer eligible
 * only once every upload of the run succeeded (domain/AudienceConfirmation).
 */
export const AUDIENCE_PLATFORMS: AudiencePlatform[] = ['google_ads', 'meta', 'tiktok'];

/** TikTok refuses customer files with fewer entries than this (Ads Manager help: customer file requirements). */
export const TIKTOK_MIN_FILE_ENTRIES = 1000;

/** The list slot of an owner-defined segment (ad_audience_lists.segment). */
export const CUSTOM_SLOT_PREFIX = 'seg:';
const CUSTOM_MEMBERSHIP_DAYS = 540;
const CUSTOM_SEGMENT_LIMIT = 100_000;
/** A SYNC holds its platform's lock at most this long (then it expires on its own). */
export const AUDIENCE_LOCK_LEASE_MS = 30 * 60_000;
export const audienceLockKey = (platform: string) => `ad-audience:${platform}`;

export interface AudiencePreview {
  platform: string;
  /** A built-in segment key, or `seg:<key>` for an owner-defined segment. */
  segment: string;
  label: string;
  /** People in the segment before consent and identifiers. */
  inSegment: number;
  excludedConsent: number;
  excludedNoIdentifier: number;
  /** People that would be uploaded. */
  eligible: number;
  withEmail: number;
  withPhone: number;
  blocker: string | null;
}

/** An owner-defined segment's list for one platform, or why it has none today. */
interface Slot {
  segment: string;
  label: string;
  purpose: string;
  membershipDays: number;
  preview: Omit<AudiencePreview, 'platform' | 'blocker'>;
  members: HashedAudienceMember[];
  /** Set when the segment cannot be read as a list today (not materialised, archived, gone). */
  unavailable?: { status: string; message: string };
}

export interface AudienceSyncExtras {
  /** Every admin-triggered run is audited here, inside the use case. */
  audit?: Pick<CreateAuditLogUseCase, 'execute'>;
  /** The capability's last-run status (worst outcome of a SYNC run). */
  recordCapabilityRun?: (platform: string, status: string, error: string | null) => Promise<void>;
  /** The per-platform run lock (absent only in tests that do not exercise it). */
  lock?: AudienceRunLock;
  /** The first-party module's segment → audience port and its segment list (absent = built-in lists only). */
  customSegments?: {
    source: Pick<ISegmentAudienceSource, 'advertisingAudience'>;
    list: () => Promise<Array<Pick<SegmentRecord, 'id' | 'key' | 'name' | 'status' | 'memberCount' | 'lastMaterialisedAt'>>>;
  };
}

/** The platform's hashes from the first-party port's identifiers (the same normalisation, ContactNormalisation). */
export function membersFromHashed(platform: AudiencePlatform, h: PlatformHashedIdentifiers): HashedAudienceMember {
  const m = hashesForPlatform(h, platform);
  // TikTok's customer file here is phone-only (one identifier type per file).
  return platform === 'tiktok' ? { email: null, phone: m.phone } : m;
}

export class AudienceSyncUseCases {
  constructor(
    private readonly source: AudienceSourcePort,
    private readonly lists: AudienceListRepository,
    private readonly gateway: AudienceGateway,
    private readonly capability: (platform: string) => Promise<CapabilityView | null>,
    private readonly credentials: (platform: string) => Promise<PlatformCredentials>,
    private readonly now: () => Date = () => new Date(),
    private readonly extras: AudienceSyncExtras = {},
  ) {}

  /** Members per segment for one platform, consent applied, hashed the platform's way. */
  private async load() {
    const buyers = groupBuyers(await this.source.buyerOrders());
    const refused = await this.source.refusedIdentities([...new Set(buyers.flatMap((b) => b.userIds))], [...new Set(buyers.flatMap((b) => b.fpClientIds))]);
    return { buyers, refused };
  }

  private compute(platform: AudiencePlatform, cfg: Record<string, string>, loaded: { buyers: Buyer[]; refused: { userIds: Set<string>; fpClientIds: Set<string> } }): Map<AudienceSegment, Slot> {
    const { buyers, refused } = loaded;
    const isRefused = (b: Buyer) => b.userIds.some((u) => refused.userIds.has(u)) || b.fpClientIds.some((f) => refused.fpClientIds.has(f));
    const policy = parseSegmentPolicy(cfg);
    const out = new Map<AudienceSegment, Slot>();
    for (const segment of AUDIENCE_SEGMENTS) {
      const people = selectSegment(buyers, segment, policy, this.now());
      const allowed = people.filter((b) => !isRefused(b));
      const members: HashedAudienceMember[] = [];
      let noId = 0;
      for (const b of allowed) {
        // One member per person: their first email and phone (a person with two
        // numbers is still one person to the platform's matcher).
        const h = hashedContactFor(platform, { email: b.emails[0], phone: b.phones[0] });
        // TikTok's customer file here is phone-only (one identifier type per file).
        const m: HashedAudienceMember = platform === 'tiktok' ? { email: null, phone: h.phone } : h;
        if (!m.email && !m.phone) { noId++; continue; }
        members.push(m);
      }
      const info = SEGMENT_INFO[segment];
      out.set(segment, {
        segment, label: info.label, purpose: info.purpose, membershipDays: info.membershipDays,
        preview: {
          segment, label: info.label, inSegment: people.length, excludedConsent: people.length - allowed.length,
          excludedNoIdentifier: noId, eligible: members.length, withEmail: members.filter((m) => m.email).length, withPhone: members.filter((m) => m.phone).length,
        },
        members,
      });
    }
    return out;
  }

  private selectedSegments(cfg: Record<string, string>): AudienceSegment[] {
    const raw = (cfg.segments ?? '').split(',').filter(Boolean) as AudienceSegment[];
    return raw.length ? AUDIENCE_SEGMENTS.filter((s) => raw.includes(s)) : [...AUDIENCE_SEGMENTS];
  }

  private selectedCustomKeys(cfg: Record<string, string>): string[] {
    return [...new Set((cfg.customSegments ?? '').split(',').map((s) => s.trim()).filter(Boolean))];
  }

  /** Owner-defined segments the audience forms can offer (active ones). Empty when the first-party module is absent. */
  async availableCustomSegments(): Promise<Array<{ key: string; name: string; memberCount: number | null; materialisedAt: string | null }>> {
    if (!this.extras.customSegments) return [];
    return (await this.extras.customSegments.list())
      .filter((s) => s.status === 'ACTIVE')
      .map((s) => ({ key: s.key, name: s.name, memberCount: s.memberCount, materialisedAt: s.lastMaterialisedAt ? s.lastMaterialisedAt.toISOString() : null }));
  }

  /**
   * One list per selected owner-defined segment, read through the first-party
   * port. The port has already applied consent per member (refused or
   * unreadable = left out) and returns hashes only. THROWS when the segment
   * list itself cannot be read (the caller uploads nothing).
   */
  private async customSlots(platform: AudiencePlatform, keys: string[], cache = new Map<string, Promise<unknown>>()): Promise<Slot[]> {
    const cs = this.extras.customSegments;
    if (!cs || keys.length === 0) return [];
    // One read per segment even when several platforms are previewed together.
    const once = <T>(k: string, f: () => Promise<T>): Promise<T> => { if (!cache.has(k)) cache.set(k, f()); return cache.get(k) as Promise<T>; };
    const byKey = new Map((await once('list', () => cs.list())).map((s) => [s.key, s]));
    const out: Slot[] = [];
    for (const key of keys) {
      const segment = `${CUSTOM_SLOT_PREFIX}${key}`;
      const s = byKey.get(key);
      const empty = { segment, label: s?.name ?? key, inSegment: 0, excludedConsent: 0, excludedNoIdentifier: 0, eligible: 0, withEmail: 0, withPhone: 0 };
      const base = { segment, label: s?.name ?? key, purpose: `Owner-defined segment "${s?.name ?? key}" (first-party segments).`, membershipDays: CUSTOM_MEMBERSHIP_DAYS };
      if (!s || s.status !== 'ACTIVE') {
        out.push({ ...base, preview: empty, members: [], unavailable: { status: 'SEGMENT_UNAVAILABLE', message: `The segment "${key}" no longer exists or was archived.` } });
        continue;
      }
      const r = await once(`audience:${s.id}`, () => cs.source.advertisingAudience(s.id, { limit: CUSTOM_SEGMENT_LIMIT }));
      if (r.status !== 'OK') {
        const why = r.status === 'NOT_MATERIALISED' ? 'has not been computed yet (the nightly segment run fills it)' : 'cannot be read as a list';
        out.push({ ...base, preview: empty, members: [], unavailable: { status: r.status === 'NOT_MATERIALISED' ? 'NOT_MATERIALISED' : 'SEGMENT_UNAVAILABLE', message: `The segment "${s.name}" ${why}.` } });
        continue;
      }
      const members: HashedAudienceMember[] = [];
      let noId = r.excludedNoIdentifier;
      for (const m of r.members) {
        const h = membersFromHashed(platform, m.hashed);
        if (!h.email && !h.phone) { noId++; continue; }
        members.push(h);
      }
      const excludedConsent = r.excludedAdvertisingRefused + r.excludedConsentUnknown;
      out.push({
        ...base, members,
        preview: {
          segment, label: s.name, inSegment: r.members.length + excludedConsent + r.excludedNoIdentifier, excludedConsent,
          excludedNoIdentifier: noId, eligible: members.length, withEmail: members.filter((m) => m.email).length, withPhone: members.filter((m) => m.phone).length,
        },
      });
    }
    return out;
  }

  /** Counts for every platform and list; never calls a platform. */
  async preview(): Promise<AudiencePreview[]> {
    const rows: AudiencePreview[] = [];
    const loaded = await this.load();
    const cache = new Map<string, Promise<unknown>>();
    for (const platform of AUDIENCE_PLATFORMS) {
      const cap = await this.capability(platform);
      const cfg = cap?.row?.config ?? {};
      const customKeys = this.selectedCustomKeys(cfg);
      // A failed segment read is shown as a reason on each selected segment,
      // never as an empty page.
      const custom = await this.customSlots(platform, customKeys, cache).catch(() => customKeys.map((key): Slot => {
        const segment = `${CUSTOM_SLOT_PREFIX}${key}`;
        return {
          segment, label: key, purpose: '', membershipDays: CUSTOM_MEMBERSHIP_DAYS, members: [],
          preview: { segment, label: key, inSegment: 0, excludedConsent: 0, excludedNoIdentifier: 0, eligible: 0, withEmail: 0, withPhone: 0 },
          unavailable: { status: 'SEGMENT_UNREADABLE', message: 'Segments could not be read; nothing would be uploaded.' },
        };
      }));
      const slots = [...this.compute(platform, cfg, loaded).values(), ...custom];
      for (const { preview, unavailable } of slots) {
        const blocker = unavailable ? unavailable.message : !cap ? null : preview.eligible === 0 ? 'No eligible buyers yet.'
          : platform === 'tiktok' && preview.eligible < TIKTOK_MIN_FILE_ENTRIES ? `TikTok needs at least ${TIKTOK_MIN_FILE_ENTRIES.toLocaleString('en-GB')} entries per file; ${preview.eligible} are eligible.` : null;
        rows.push({ platform, ...preview, blocker });
      }
    }
    return rows;
  }

  /**
   * Dry run or sync of one platform's selected lists. Every outcome, including
   * "Not configured" and a refusal, is written to the insert-only run log; an
   * admin-triggered run is audited, and a SYNC run sets the capability's last
   * run status.
   */
  async run(platform: string, mode: 'DRY_RUN' | 'SYNC', trigger: 'ADMIN' | 'SCHEDULE', actorId: string | null): Promise<AudienceRunRecord[]> {
    const out = await this.runLists(platform, mode, trigger, actorId);
    if (mode === 'SYNC' && out.length && this.extras.recordCapabilityRun) {
      const failed = out.find((r) => r.status === 'FAILED');
      await this.extras.recordCapabilityRun(platform, failed ? 'FAILED' : out[0].status, failed?.message ?? null).catch(() => undefined);
    }
    if (trigger === 'ADMIN' && this.extras.audit) {
      await this.extras.audit.execute({
        actorId, action: mode === 'SYNC' ? 'AD_AUDIENCE_SYNC_RUN' : 'AD_AUDIENCE_DRY_RUN', entity: 'ad_audience', entityId: platform || '-',
        newState: out.map((r) => ({ segment: r.segment, status: r.status, eligible: r.eligibleCount, uploaded: r.uploadedCount })),
      });
    }
    return out;
  }

  private async runLists(platform: string, mode: 'DRY_RUN' | 'SYNC', trigger: 'ADMIN' | 'SCHEDULE', actorId: string | null): Promise<AudienceRunRecord[]> {
    const startedAt = this.now();
    const base = { platform, mode, trigger, actorId, startedAt, uploadedCount: null, remoteListId: null } as const;
    if (!(AUDIENCE_PLATFORMS as string[]).includes(platform)) {
      return [await this.log({ ...base, segment: '-', status: 'NOT_AVAILABLE', eligibleCount: 0, excludedConsent: 0, excludedNoIdentifier: 0, message: 'This platform has no documented customer-list upload here.' })];
    }
    const cap = await this.capability(platform);
    if (mode === 'SYNC' && !cap) {
      return [await this.log({ ...base, segment: '-', status: 'NOT_CONFIGURED', eligibleCount: 0, excludedConsent: 0, excludedNoIdentifier: 0, message: 'Not configured: audience sync for this platform is not set up and switched on.' })];
    }
    if (mode === 'SYNC') {
      // One SYNC per platform at a time. Without the lock, an admin click
      // during the scheduled run (or two clicks) could both create a list and
      // orphan one with its members, never emptied again.
      let token: string | null = null;
      try { token = this.extras.lock ? await this.extras.lock.acquireLock(audienceLockKey(platform), AUDIENCE_LOCK_LEASE_MS) : 'unlocked'; } catch { token = null; }
      if (!token) {
        return [await this.log({ ...base, segment: '-', status: 'BUSY', eligibleCount: 0, excludedConsent: 0, excludedNoIdentifier: 0, message: 'Another sync of this platform is running; nothing was sent. Try again in a few minutes.' })];
      }
      try {
        return await this.syncOrDry(platform, mode, base, cap);
      } finally {
        if (this.extras.lock && token !== 'unlocked') await this.extras.lock.releaseLock(audienceLockKey(platform), token).catch(() => undefined);
      }
    }
    return this.syncOrDry(platform, mode, base, cap);
  }

  private async syncOrDry(
    platform: string, mode: 'DRY_RUN' | 'SYNC', base: Pick<AudienceRunRecord, 'platform' | 'mode' | 'trigger' | 'actorId' | 'startedAt' | 'uploadedCount' | 'remoteListId'>,
    cap: CapabilityView | null,
  ): Promise<AudienceRunRecord[]> {
    const cfg = cap?.row?.config ?? {};
    const customKeys = this.selectedCustomKeys(cfg);
    let slots: Slot[];
    try {
      const builtIn = this.compute(platform as AudiencePlatform, cfg, await this.load());
      slots = [...this.selectedSegments(cfg).map((s) => builtIn.get(s)!), ...await this.customSlots(platform as AudiencePlatform, customKeys)];
    } catch {
      return [await this.log({ ...base, segment: '-', status: 'CONSENT_UNREADABLE', eligibleCount: 0, excludedConsent: 0, excludedNoIdentifier: 0, message: 'Buyers, segments or consent could not be read; nobody was uploaded.' })];
    }
    const out: AudienceRunRecord[] = [];
    for (const slot of slots) {
      const { preview, members, segment } = slot;
      const counts = { eligibleCount: preview.eligible, excludedConsent: preview.excludedConsent, excludedNoIdentifier: preview.excludedNoIdentifier };
      if (slot.unavailable && mode === 'DRY_RUN') { out.push(await this.log({ ...base, segment, status: slot.unavailable.status, ...counts, message: slot.unavailable.message })); continue; }
      if (mode === 'DRY_RUN') { out.push(await this.log({ ...base, segment, status: 'DRY_RUN', ...counts, message: 'No platform was called.' })); continue; }
      const tooSmall = platform === 'tiktok' && members.length > 0 && members.length < TIKTOK_MIN_FILE_ENTRIES;
      if (members.length === 0 || tooSmall) {
        // Nothing (or too little) to upload. A list uploaded earlier may still
        // hold people who have since refused advertising: it is emptied.
        const existing = await this.lists.remoteId(platform, segment);
        const why = slot.unavailable ? slot.unavailable.message : tooSmall ? `TikTok refuses customer files under ${TIKTOK_MIN_FILE_ENTRIES} entries; nothing was sent.` : 'No eligible buyers.';
        const quietStatus = slot.unavailable ? slot.unavailable.status : tooSmall ? 'TOO_SMALL' : 'EMPTY';
        if (!existing) { out.push(await this.log({ ...base, segment, status: quietStatus, ...counts, message: why })); continue; }
        out.push(await this.clear(base, segment, existing, counts, why));
        continue;
      }
      try {
        const creds = await this.credentials(platform);
        let remote = await this.lists.remoteId(platform, segment);
        let uploaded: number | null = null;
        if (!remote) {
          const created = await this.gateway.createList(platform, { name: `GoldPlus: ${slot.label}`.slice(0, 120), description: slot.purpose, membershipDays: slot.membershipDays }, members, creds);
          remote = created.remoteId;
          uploaded = created.uploaded;
          await this.lists.saveRemoteId(platform, segment, remote);
        }
        let requestIds: string[] | undefined;
        if (uploaded === null) ({ uploaded, requestIds } = await this.gateway.replaceMembers(platform, remote, members, creds));
        if (requestIds && requestIds.length) {
          // Accepted, not yet confirmed: Google answers later (confirmPending).
          out.push(await this.log({
            ...base, segment, status: 'SUBMITTED', ...counts, uploadedCount: uploaded, remoteListId: remote,
            message: 'Sent, waiting for Google to confirm. People no longer eligible are removed once Google confirms the upload.',
            remoteRequests: { kind: 'REPLACE', ingest: requestIds, sweep: null }, confirmation: 'WAITING',
          }));
        } else {
          out.push(await this.log({ ...base, segment, status: 'SYNCED', ...counts, uploadedCount: uploaded, remoteListId: remote, message: null }));
        }
      } catch (err) {
        out.push(await this.log({ ...base, segment, status: 'FAILED', ...counts, message: String((err as Error).message ?? err).slice(0, 400) }));
      }
    }
    // A list the owner stopped syncing is emptied rather than left to go
    // stale: it would keep people who refuse advertising after today.
    if (mode === 'SYNC') {
      const selected = new Set(slots.map((s) => s.segment));
      const stored = await this.lists.storedSegments(platform);
      const stale = [...new Set([...AUDIENCE_SEGMENTS, ...stored])].filter((s) => !selected.has(s));
      for (const segment of stale) {
        const existing = await this.lists.remoteId(platform, segment);
        if (!existing) continue;
        out.push(await this.clear(base, segment, existing, { eligibleCount: 0, excludedConsent: 0, excludedNoIdentifier: 0 }, 'This list is no longer selected;'));
      }
    }
    return out;
  }

  private async clear(
    base: Pick<AudienceRunRecord, 'platform' | 'mode' | 'trigger' | 'actorId' | 'startedAt'>, segment: string, existing: string,
    counts: { eligibleCount: number; excludedConsent: number; excludedNoIdentifier: number }, why: string,
  ): Promise<AudienceRunRecord> {
    const lead = why.endsWith(';') ? `${why} the list uploaded earlier was emptied.` : `${why} The list uploaded earlier was emptied.`;
    try {
      const r = await this.gateway.clearList(base.platform, existing, await this.credentials(base.platform));
      if (r.forget) await this.lists.forgetRemoteId(base.platform, segment);
      if (r.requestIds && r.requestIds.length) {
        return this.log({
          ...base, segment, status: 'SUBMITTED', ...counts, uploadedCount: 0, remoteListId: existing, message: `${lead.replace(/ was emptied\.$/, ' is being emptied.')} Sent, waiting for Google to confirm.`,
          remoteRequests: { kind: 'CLEAR', ingest: r.requestIds, sweep: null }, confirmation: 'WAITING',
        });
      }
      return this.log({ ...base, segment, status: 'CLEARED', ...counts, uploadedCount: 0, remoteListId: existing, message: lead });
    } catch (err) {
      return this.log({ ...base, segment, status: 'FAILED', ...counts, uploadedCount: null, remoteListId: existing, message: `${why.replace(/;$/, '.')} Emptying the earlier list failed: ${String((err as Error).message ?? err).slice(0, 300)}` });
    }
  }

  /** Scheduled daily sync of every LIVE audience capability. */
  async runScheduled(): Promise<AudienceRunRecord[]> {
    const all: AudienceRunRecord[] = [];
    for (const p of AUDIENCE_PLATFORMS) if (await this.capability(p)) all.push(...await this.run(p, 'SYNC', 'SCHEDULE', null));
    return all;
  }

  /** True when a scheduled run of one platform must be retried (it did not complete). */
  static runNeedsRetry(records: AudienceRunRecord[]): boolean {
    return records.some((r) => r.status === 'FAILED' || r.status === 'CONSENT_UNREADABLE' || r.status === 'BUSY');
  }

  /**
   * Confirms SUBMITTED runs (the 5-minute tick): reads Google's per-request
   * outcome and records it; once EVERY ingest of a run succeeded, sends the
   * stale-member sweep (removeAsOfTime = the run's start) and confirms that
   * too. A run still processing waits; after 48 hours it is UNCONFIRMED.
   * Never reports a success Google did not confirm.
   */
  async confirmPending(limit = 20): Promise<{ checked: number; confirmed: number; failed: number; waiting: number }> {
    const out = { checked: 0, confirmed: 0, failed: 0, waiting: 0 };
    const pending = await this.lists.pendingConfirmations(limit);
    for (const run of pending) {
      out.checked++;
      const gw = this.gateway;
      if (!gw.requestStatus || !gw.sweepStale) { out.waiting++; continue; }
      try {
        const creds = await this.credentials(run.platform);
        const ids = run.confirmation === 'SWEEPING' ? (run.remoteRequests.sweep ? [run.remoteRequests.sweep] : []) : run.remoteRequests.ingest;
        const outcome = combineOutcomes(ids.length ? await gw.requestStatus(run.platform, ids, creds) : []);
        const step = nextConfirmationStep({ confirmation: run.confirmation, kind: run.remoteRequests.kind, outcome, ageMs: this.now().getTime() - run.startedAt.getTime() });
        if (step.action === 'WAIT') { out.waiting++; continue; }
        if (step.action === 'SWEEP') {
          if (!run.remoteListId) {
            await this.lists.updateConfirmation(run.id, { confirmation: 'FAILED', detail: 'Google confirmed the upload, but the list id is missing, so people no longer eligible could not be removed.' });
            out.failed++; continue;
          }
          const sweep = await gw.sweepStale(run.platform, run.remoteListId, run.startedAt, creds);
          if (!sweep.requestId) {
            await this.lists.updateConfirmation(run.id, { confirmation: 'FAILED', detail: 'Google confirmed the upload, but did not accept the removal of people no longer eligible.' });
            out.failed++; continue;
          }
          await this.lists.updateConfirmation(run.id, { confirmation: 'SWEEPING', detail: 'Google confirmed the upload; removing the people no longer eligible.', sweepRequestId: sweep.requestId });
          out.waiting++; continue;
        }
        await this.lists.updateConfirmation(run.id, { confirmation: step.confirmation, detail: step.detail });
        if (step.confirmation === 'CONFIRMED') out.confirmed++;
        else out.failed++;
        // The capability's last status is Google's answer, not our submission.
        if (this.extras.recordCapabilityRun) {
          await this.extras.recordCapabilityRun(run.platform, step.confirmation, step.confirmation === 'CONFIRMED' ? null : step.detail).catch(() => undefined);
        }
      } catch (err) {
        // A failed read is retried on a later tick (the claim lease expires); nothing is concluded from it.
        out.waiting++;
        void err;
      }
    }
    return out;
  }

  recentRuns(limit = 30) { return this.lists.recentRuns(limit); }

  private async log(r: AudienceRunRecord): Promise<AudienceRunRecord> {
    await this.lists.recordRun(r);
    return r;
  }
}
