import { randomUUID } from 'node:crypto';
import { sql, type SQL } from 'drizzle-orm';
import { db } from '../client';
import { pgInTextList, pgJsonb } from '../PgParams';
import type {
  AdCapability, AdCapabilityRepository, AdCapabilityRow, AudienceListRepository, AudienceRunRecord, AudienceSourcePort,
  JobClaimPort, OfflineContext, OfflineConversionRepository, OfflineConversionRow, OfflineSaleRecord, PendingAudienceRun,
  SpendFactRepository, SpendImportRecord, SpendReportRow,
} from '../../../application/ports/Advertising';
import type { Confirmation, RemoteRequests } from '../../../domain/advertising/AudienceConfirmation';
import type { BuyerOrder } from '../../../domain/advertising/AudienceSegments';
import type { SpendFact } from '../../../domain/advertising/SpendFacts';
import { normaliseEmail, offlineSaleHashes, phoneSpellings } from '../../../domain/advertising/ContactNormalisation';
import { environmentOf } from '../../../domain/measurement/BusinessEvents';
import { isStoredAdvertisingRefusal } from '../../measurement/AdvertisingConsentGate';
import { ORDER_KEY_PREFIX, VISITOR_FP_PREFIX } from '../../../domain/customer-dna/IdentityStitching';

/**
 * Persistence for advertising operations (0154). Raw SQL like the 0138
 * destination repository: the tables are advertising-only and never joined
 * by drizzle's query builder. Contact details are read just in time, hashed
 * here, and never returned in plaintext.
 */
const rowsOf = (r: unknown): any[] => (Array.isArray(r) ? r : ((r as { rows?: any[] })?.rows ?? []));
const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidOrNull = (v: string | null | undefined): SQL => (v && UUID.test(v) ? sql`${v}::uuid` : sql`null`);
const obj = (v: unknown) => (typeof v === 'string' ? (() => { try { return JSON.parse(v); } catch { return null; } })() : v);

// ── Capabilities ─────────────────────────────────────────────────────────────

const mapCap = (r: any): AdCapabilityRow => ({
  platform: r.platform, capability: r.capability, enabled: !!r.enabled, config: obj(r.config) ?? {},
  hasSecret: !!r.secret_enc, secretMask: r.secret_mask ?? null, updatedAt: iso(r.updated_at),
  lastRunAt: iso(r.last_run_at), lastStatus: r.last_status ?? null, lastError: r.last_error ?? null,
});

export class DrizzleAdCapabilityRepository implements AdCapabilityRepository {
  async list() { return rowsOf(await db.execute(sql`select * from ad_destination_capabilities order by platform, capability`)).map(mapCap); }
  async get(platform: string, capability: AdCapability) {
    const r = rowsOf(await db.execute(sql`select * from ad_destination_capabilities where platform = ${platform} and capability = ${capability}`))[0];
    return r ? mapCap(r) : null;
  }
  async save(platform: string, capability: AdCapability, p: { enabled?: boolean; config?: Record<string, string>; secretEnc?: string | null; secretMask?: string | null; updatedBy: string | null }) {
    const by = uuidOrNull(p.updatedBy);
    const r = rowsOf(await db.execute(sql`
      insert into ad_destination_capabilities (platform, capability, enabled, config, secret_enc, secret_mask, updated_by, updated_at)
      values (${platform}, ${capability}, ${p.enabled ?? false}, ${pgJsonb(p.config ?? {})}, ${p.secretEnc ?? null}, ${p.secretMask ?? null}, ${by}, now())
      on conflict (platform, capability) do update set
        enabled = ${p.enabled === undefined ? sql`ad_destination_capabilities.enabled` : sql`${p.enabled}`},
        config = ${p.config === undefined ? sql`ad_destination_capabilities.config` : pgJsonb(p.config)},
        secret_enc = ${p.secretEnc === undefined ? sql`ad_destination_capabilities.secret_enc` : sql`${p.secretEnc}`},
        secret_mask = ${p.secretMask === undefined ? sql`ad_destination_capabilities.secret_mask` : sql`${p.secretMask}`},
        updated_by = ${by}, updated_at = now()
      returning *`))[0];
    return mapCap(r);
  }
  async recordRun(platform: string, capability: AdCapability, status: string, error: string | null) {
    await db.execute(sql`update ad_destination_capabilities set last_run_at = now(), last_status = ${status.slice(0, 24)}, last_error = ${error ? error.slice(0, 500) : null}
      where platform = ${platform} and capability = ${capability}`);
  }
  /** The encrypted secret of one capability (the secrets port decrypts it). */
  async secretEnc(platform: string, capability: AdCapability): Promise<string | null> {
    const r = rowsOf(await db.execute(sql`select secret_enc from ad_destination_capabilities where platform = ${platform} and capability = ${capability}`))[0];
    return r?.secret_enc ?? null;
  }
}

// ── Who an order belongs to, for the consent check ──────────────────────────

/**
 * The browsers and account linked to the order's customer by the first-party
 * identity graph (customer_identity_links, 0155): the order's
 * ORDER_CUSTOMER_RELATIONSHIP link names its canonical customer, whose
 * `fp:` visitor links (plus its consent-only browser anchors, 0157) are every browser that customer used, and whose profile
 * may name an account the guest later opened. order_attribution keeps one
 * browser for a minority of orders only, so without this a guest who refused
 * advertising in their browser would still be uploaded. A LATERAL join on
 * `orderId` (an SQL expression for the order's uuid); yields `linked_fps` and
 * `linked_users` as JSON arrays (never NULL).
 */
export const linkedIdentitiesSql = (orderId: SQL): SQL => sql`left join lateral (
    select coalesce(to_json(array_agg(distinct substr(v.identifier_key, ${sql.raw(String(VISITOR_FP_PREFIX.length + 1))})) filter (where v.identifier_key like ${`${VISITOR_FP_PREFIX}%`})), '[]'::json) as linked_fps,
           coalesce(to_json(array_agg(distinct cp.account_user_id::text) filter (where cp.account_user_id is not null)), '[]'::json) as linked_users
    from customer_identity_links ol
    -- 0157: also the consent-only browser anchors (customer_consent_anchors): a
    -- browser that refused personalisation is never a behaviour link, but its
    -- stored advertising refusal must still keep this customer out.
    join (
      select canonical_customer_id, identifier_key from customer_identity_links
      union all
      select canonical_customer_id, ${VISITOR_FP_PREFIX} || fp_client_id from customer_consent_anchors
    ) v on v.canonical_customer_id = ol.canonical_customer_id
    left join customer_profiles cp on cp.canonical_customer_id = ol.canonical_customer_id
    where ol.signal_type = 'ORDER_CUSTOMER_RELATIONSHIP' and ol.identifier_key = ${ORDER_KEY_PREFIX} || ${orderId}::text
  ) lk on true`;

/** A JSON array column → its non-empty strings. */
export const stringsOf = (v: unknown): string[] => {
  const a = obj(v);
  return Array.isArray(a) ? a.filter((x): x is string => typeof x === 'string' && x.length > 0) : [];
};

// ── Consent (the AdvertisingConsentGate predicate, in bulk) ─────────────────

/**
 * Stored advertising refusals among these accounts and browsers, including
 * browsers linked to the accounts (identity_links). Returns the refusing
 * account ids and browser ids. THROWS on a failed read.
 */
export async function refusedAmong(userIds: string[], fpClientIds: string[]): Promise<{ userIds: Set<string>; fpClientIds: Set<string> }> {
  const users = [...new Set(userIds.filter((u) => UUID.test(u)))];
  const fps = [...new Set(fpClientIds.filter(Boolean))];
  const out = { userIds: new Set<string>(), fpClientIds: new Set<string>() };
  if (users.length === 0 && fps.length === 0) return out;
  const direct = rowsOf(await db.execute(sql`select user_id::text as user_id, fp_client_id, advertising_granted, last_grant_type from consent_current_state
    where ${pgInTextList(sql`user_id::text`, users)} or ${pgInTextList(sql`fp_client_id`, fps)}`));
  for (const r of direct) {
    if (!isStoredAdvertisingRefusal(r)) continue;
    if (r.user_id) out.userIds.add(String(r.user_id));
    if (r.fp_client_id) out.fpClientIds.add(String(r.fp_client_id));
  }
  if (users.length) {
    // A refusal given on a browser the account is linked to is the person's refusal.
    const linked = rowsOf(await db.execute(sql`select il.customer_id::text as user_id, cs.advertising_granted, cs.last_grant_type
      from identity_links il join consent_current_state cs on cs.fp_client_id = il.browser_id or cs.fp_client_id = il.anonymous_id
      where ${pgInTextList(sql`il.customer_id::text`, users)}`));
    for (const r of linked) if (isStoredAdvertisingRefusal(r) && r.user_id) out.userIds.add(String(r.user_id));
  }
  return out;
}

// ── Audiences ────────────────────────────────────────────────────────────────

export class DrizzleAudienceRepository implements AudienceSourcePort, AudienceListRepository {
  async buyerOrders(): Promise<BuyerOrder[]> {
    const rows = rowsOf(await db.execute(sql`
      select o.id, o.user_id, o.customer_email, o.customer_phone, o.total_amount, o.status, o.payment_status, o.created_at, a.fp_client_id, lk.linked_fps, lk.linked_users
      from orders o left join order_attribution a on a.order_id = o.id
      ${linkedIdentitiesSql(sql`o.id`)}
      where o.status in ('delivered', 'completed') or (o.payment_status = 'paid' and o.status not in ('cancelled', 'failed'))
      order by o.created_at limit 200000`));
    return rows.map((r) => ({
      orderId: String(r.id), userId: r.user_id ? String(r.user_id) : null, email: r.customer_email ?? null, phone: r.customer_phone ?? null,
      fpClientId: r.fp_client_id ?? null, totalUgx: Number(r.total_amount ?? 0), purchasedAt: new Date(r.created_at), status: String(r.status), paymentStatus: String(r.payment_status),
      linkedFpClientIds: stringsOf(r.linked_fps), linkedUserIds: stringsOf(r.linked_users),
    }));
  }
  refusedIdentities(userIds: string[], fpClientIds: string[]) { return refusedAmong(userIds, fpClientIds); }

  async remoteId(platform: string, segment: string) {
    const r = rowsOf(await db.execute(sql`select remote_list_id from ad_audience_lists where platform = ${platform} and segment = ${segment}`))[0];
    return r?.remote_list_id ?? null;
  }
  async saveRemoteId(platform: string, segment: string, remoteId: string) {
    await db.execute(sql`insert into ad_audience_lists (platform, segment, remote_list_id) values (${platform}, ${segment}, ${remoteId.slice(0, 200)})
      on conflict (platform, segment) do update set remote_list_id = excluded.remote_list_id`);
  }
  async forgetRemoteId(platform: string, segment: string) {
    await db.execute(sql`delete from ad_audience_lists where platform = ${platform} and segment = ${segment}`);
  }
  async storedSegments(platform: string) {
    return rowsOf(await db.execute(sql`select segment from ad_audience_lists where platform = ${platform} order by segment`)).map((r) => String(r.segment));
  }
  async recordRun(r: AudienceRunRecord) {
    const requests = r.remoteRequests ? pgJsonb(r.remoteRequests) : sql`null`;
    await db.execute(sql`insert into ad_audience_runs (platform, segment, mode, trigger, status, eligible_count, excluded_consent, excluded_no_identifier, uploaded_count, message, remote_list_id, actor_id, started_at, remote_requests, confirmation, next_check_at)
      values (${r.platform}, ${r.segment}, ${r.mode}, ${r.trigger}, ${r.status.slice(0, 24)}, ${r.eligibleCount}, ${r.excludedConsent}, ${r.excludedNoIdentifier}, ${r.uploadedCount},
        ${r.message ? r.message.slice(0, 1000) : null}, ${r.remoteListId}, ${uuidOrNull(r.actorId)}, ${r.startedAt.toISOString()}::timestamptz,
        ${requests}, ${r.confirmation ?? null}, ${r.confirmation ? sql`now() + interval '2 minutes'` : sql`null`})`);
  }
  async recentRuns(limit: number): Promise<AudienceRunRecord[]> {
    return rowsOf(await db.execute(sql`select * from ad_audience_runs order by finished_at desc limit ${Math.min(200, Math.max(1, limit))}`)).map((r) => ({
      id: String(r.id), platform: r.platform, segment: r.segment, mode: r.mode, trigger: r.trigger, status: r.status, eligibleCount: Number(r.eligible_count), excludedConsent: Number(r.excluded_consent),
      excludedNoIdentifier: Number(r.excluded_no_identifier), uploadedCount: r.uploaded_count == null ? null : Number(r.uploaded_count), message: r.message ?? null,
      remoteListId: r.remote_list_id ?? null, actorId: r.actor_id ?? null, startedAt: new Date(r.started_at), finishedAt: iso(r.finished_at) ?? undefined,
      remoteRequests: remoteRequestsOf(r.remote_requests), confirmation: (r.confirmation ?? null) as Confirmation | null,
      confirmationDetail: r.confirmation_detail ?? null, confirmedAt: iso(r.confirmed_at),
    }));
  }
  async pendingConfirmations(limit: number): Promise<PendingAudienceRun[]> {
    // Claimed with a 4-minute lease: an overlapping tick or a second instance skips these runs.
    const rows = rowsOf(await db.execute(sql`update ad_audience_runs set next_check_at = now() + interval '4 minutes', confirmation_checks = confirmation_checks + 1
      where id in (select id from ad_audience_runs where confirmation in ('WAITING', 'SWEEPING') and (next_check_at is null or next_check_at <= now())
        order by started_at limit ${Math.min(100, Math.max(1, limit))} for update skip locked)
      returning id, platform, segment, remote_list_id, started_at, remote_requests, confirmation`));
    const out: PendingAudienceRun[] = [];
    for (const r of rows) {
      const req = remoteRequestsOf(r.remote_requests);
      if (!req) continue;
      out.push({ id: String(r.id), platform: r.platform, segment: r.segment, remoteListId: r.remote_list_id ?? null, startedAt: new Date(r.started_at), remoteRequests: req, confirmation: r.confirmation });
    }
    return out;
  }
  async updateConfirmation(id: string, patch: { confirmation: Confirmation; detail: string | null; sweepRequestId?: string | null }) {
    if (!UUID.test(id)) return;
    const done = patch.confirmation !== 'WAITING' && patch.confirmation !== 'SWEEPING';
    await db.execute(sql`update ad_audience_runs set confirmation = ${patch.confirmation}, confirmation_detail = ${patch.detail ? patch.detail.slice(0, 1000) : null},
      confirmed_at = ${done ? sql`now()` : sql`null`},
      next_check_at = ${done ? sql`null` : sql`now() + interval '2 minutes'`},
      remote_requests = ${patch.sweepRequestId ? sql`jsonb_set(coalesce(remote_requests, '{}'::jsonb), '{sweep}', to_jsonb(${patch.sweepRequestId.slice(0, 200)}::text))` : sql`remote_requests`}
      where id = ${id}::uuid`);
  }
}

/** The stored request ids of an asynchronous upload, or null when absent or malformed. */
export function remoteRequestsOf(v: unknown): RemoteRequests | null {
  const o = obj(v) as Partial<RemoteRequests> | null;
  if (!o || typeof o !== 'object' || (o.kind !== 'REPLACE' && o.kind !== 'CLEAR') || !Array.isArray(o.ingest)) return null;
  return { kind: o.kind, ingest: o.ingest.filter((x): x is string => typeof x === 'string' && x.length > 0), sweep: typeof o.sweep === 'string' && o.sweep ? o.sweep : null };
}

// ── Spend (media_cost_facts, the one canonical spend table) ─────────────────

const factKey = (f: { spendDate: string; channel: string; platform: string; account: string; campaign: string; source: string }) =>
  [f.spendDate, f.channel, f.platform, f.account, f.campaign, f.source].join('|');

export class DrizzleSpendFactRepository implements SpendFactRepository {
  async ingestedCurrencies() { return rowsOf(await db.execute(sql`select distinct currency from media_cost_facts order by currency`)).map((r) => String(r.currency)); }

  private async existing(facts: SpendFact[]) {
    if (facts.length === 0) return new Map<string, any>();
    const days = facts.map((f) => f.spendDate).sort();
    const rows = rowsOf(await db.execute(sql`select spend_date::text as spend_date, channel, platform, account, campaign, source, spend_minor, clicks, impressions, currency
      from media_cost_facts where spend_date between ${days[0]}::date and ${days[days.length - 1]}::date
        and ad_set_or_group is null and ad_or_creative is null and ${pgInTextList(sql`source`, [...new Set(facts.map((f) => f.source))])}`));
    return new Map(rows.map((r) => [factKey({ spendDate: r.spend_date, channel: r.channel, platform: r.platform, account: r.account, campaign: r.campaign, source: r.source }), r]));
  }

  async preview(facts: SpendFact[]) {
    const have = await this.existing(facts);
    let added = 0, changed = 0, unchanged = 0;
    for (const f of facts) {
      const e = have.get(factKey(f));
      if (!e) added++;
      else if (Number(e.spend_minor) === f.spendMinor && (e.clicks == null ? null : Number(e.clicks)) === f.clicks && (e.impressions == null ? null : Number(e.impressions)) === f.impressions && e.currency === f.currency) unchanged++;
      else changed++;
    }
    return { added, changed, unchanged };
  }

  async upsert(facts: SpendFact[], actorId: string | null) {
    return db.transaction(async (tx) => {
      let written = 0;
      for (const f of facts) {
        const r = rowsOf(await tx.execute(sql`
          insert into media_cost_facts (spend_date, channel, platform, account, campaign, campaign_label, currency, spend_minor, tax_or_fee_minor, clicks, impressions, source, source_reference, ingested_by)
          values (${f.spendDate}::date, ${f.channel}, ${f.platform}, ${f.account}, ${f.campaign}, ${f.campaignLabel}, ${f.currency}, ${f.spendMinor}, 0, ${f.clicks}, ${f.impressions}, ${f.source}, ${null}, ${uuidOrNull(actorId)})
          on conflict (spend_date, channel, platform, account, campaign, (coalesce(ad_set_or_group, '')), (coalesce(ad_or_creative, '')), source) do update set
            spend_minor = excluded.spend_minor, clicks = excluded.clicks, impressions = excluded.impressions, currency = excluded.currency,
            campaign_label = excluded.campaign_label, ingested_by = excluded.ingested_by, ingested_at = now()
          where media_cost_facts.spend_minor is distinct from excluded.spend_minor or media_cost_facts.clicks is distinct from excluded.clicks
            or media_cost_facts.impressions is distinct from excluded.impressions or media_cost_facts.campaign_label is distinct from excluded.campaign_label
            or media_cost_facts.currency is distinct from excluded.currency
          returning id`));
        written += r.length;
      }
      return { written };
    });
  }

  async report(from: string, to: string): Promise<SpendReportRow[]> {
    return rowsOf(await db.execute(sql`select spend_date::text as spend_date, channel, platform, campaign, campaign_label, currency, spend_minor + tax_or_fee_minor as spend_minor, clicks, impressions, source
      from media_cost_facts where spend_date between ${from}::date and ${to}::date order by spend_date desc, platform, campaign limit 5000`)).map((r) => ({
      spendDate: r.spend_date, channel: r.channel, platform: r.platform, campaign: r.campaign, campaignLabel: r.campaign_label ?? null, currency: r.currency,
      spendMinor: Number(r.spend_minor), clicks: r.clicks == null ? null : Number(r.clicks), impressions: r.impressions == null ? null : Number(r.impressions), source: r.source,
    }));
  }

  async recordImport(r: SpendImportRecord) {
    await db.execute(sql`insert into ad_spend_imports (platform, trigger, status, date_from, date_to, rows_written, message, actor_id, started_at)
      values (${r.platform.slice(0, 32)}, ${r.trigger}, ${r.status.slice(0, 24)}, ${r.dateFrom ? sql`${r.dateFrom}::date` : sql`null`}, ${r.dateTo ? sql`${r.dateTo}::date` : sql`null`},
        ${r.rowsWritten}, ${r.message ? r.message.slice(0, 1000) : null}, ${uuidOrNull(r.actorId)}, ${r.startedAt.toISOString()}::timestamptz)`);
  }

  async recentImports(limit: number): Promise<SpendImportRecord[]> {
    return rowsOf(await db.execute(sql`select *, date_from::text as df, date_to::text as dt from ad_spend_imports order by finished_at desc limit ${Math.min(200, Math.max(1, limit))}`)).map((r) => ({
      platform: r.platform, trigger: r.trigger, status: r.status, dateFrom: r.df ?? null, dateTo: r.dt ?? null, rowsWritten: Number(r.rows_written), message: r.message ?? null,
      actorId: r.actor_id ?? null, startedAt: new Date(r.started_at), finishedAt: iso(r.finished_at) ?? undefined,
    }));
  }
}

// ── Offline conversions ──────────────────────────────────────────────────────

const mapConv = (r: any): OfflineConversionRow => ({
  id: String(r.id), platform: r.platform, source: r.source, sourceRef: r.source_ref, eventId: r.event_id, occurredAt: iso(r.occurred_at)!,
  state: r.state, reason: r.reason ?? null, attemptCount: Number(r.attempt_count ?? 0), sentAt: iso(r.sent_at),
});
const clickIdsOf = (v: unknown): Record<string, string> => {
  const o = obj(v);
  if (!o || typeof o !== 'object') return {};
  return Object.fromEntries(Object.entries(o as Record<string, unknown>).filter(([, x]) => typeof x === 'string' && x).map(([k, x]) => [k, String(x)]));
};

/** Sends only from production, unless measurement delivery is explicitly allowed elsewhere (the DeliveryService rule). */
export function offlineSendsAllowed(env: Record<string, string | undefined> = process.env): boolean {
  return environmentOf(env.NODE_ENV) === 'production' || env.MEASUREMENT_ALLOW_NONPROD_DELIVERY === 'true';
}

export class DrizzleOfflineConversionRepository implements OfflineConversionRepository {
  async findOrder(orderNumber: string) {
    const r = rowsOf(await db.execute(sql`select o.id, o.order_number, o.user_id, a.fp_client_id, lk.linked_fps, lk.linked_users
      from orders o left join order_attribution a on a.order_id = o.id ${linkedIdentitiesSql(sql`o.id`)} where o.order_number = ${orderNumber.slice(0, 20)}`))[0];
    return r ? {
      id: String(r.id), orderNumber: String(r.order_number), userId: r.user_id ? String(r.user_id) : null, fpClientId: r.fp_client_id ?? null,
      linkedUserIds: stringsOf(r.linked_users), linkedFpClientIds: stringsOf(r.linked_fps),
    } : null;
  }

  async consentSubjectsForContact(contact: { email?: string | null; phone?: string | null }) {
    const digits = phoneSpellings(contact.phone).filter((p) => !p.startsWith('+'));
    const email = normaliseEmail(contact.email);
    if (digits.length === 0 && !email) return { userIds: [], fpClientIds: [] };
    const phoneMatch = (col: SQL) => (digits.length ? pgInTextList(sql`regexp_replace(coalesce(${col}, ''), '\\D', '', 'g')`, digits) : sql`false`);
    const emailMatch = (col: SQL) => (email ? sql`lower(trim(coalesce(${col}, ''))) = ${email}` : sql`false`);
    const fromOrders = rowsOf(await db.execute(sql`select o.user_id::text as user_id, a.fp_client_id, lk.linked_fps, lk.linked_users
      from orders o left join order_attribution a on a.order_id = o.id ${linkedIdentitiesSql(sql`o.id`)}
      where ${phoneMatch(sql`o.customer_phone`)} or ${emailMatch(sql`o.customer_email`)} limit 500`));
    const fromUsers = rowsOf(await db.execute(sql`select id::text as user_id from users where ${phoneMatch(sql`phone`)} or ${emailMatch(sql`email`)} limit 50`));
    return {
      userIds: [...new Set([...[...fromOrders, ...fromUsers].map((r) => r.user_id).filter(Boolean).map(String), ...fromOrders.flatMap((r) => stringsOf(r.linked_users))])],
      fpClientIds: [...new Set([...fromOrders.map((r) => r.fp_client_id).filter(Boolean).map(String), ...fromOrders.flatMap((r) => stringsOf(r.linked_fps))])],
    };
  }

  async recordSale(s: Parameters<OfflineConversionRepository['recordSale']>[0]) {
    const r = rowsOf(await db.execute(sql`insert into ad_offline_sales (channel, occurred_at, value_ugx, order_id, email_sha256, email_google_sha256, phone_digits_sha256, phone_plus_sha256, consent_user_ids, consent_fp_client_ids, note, recorded_by)
      values (${s.channel}, ${s.occurredAt.toISOString()}::timestamptz, ${s.valueUgx}, ${uuidOrNull(s.orderId)}, ${s.hashes.emailSha256}, ${s.hashes.emailGoogleSha256}, ${s.hashes.phoneDigitsSha256}, ${s.hashes.phonePlusSha256},
        ${pgJsonb(s.subjects.userIds)}, ${pgJsonb(s.subjects.fpClientIds)}, ${s.note}, ${uuidOrNull(s.recordedBy)}) returning id`))[0];
    return String(r.id);
  }

  async listSales(limit: number): Promise<OfflineSaleRecord[]> {
    return rowsOf(await db.execute(sql`select s.*, o.order_number from ad_offline_sales s left join orders o on o.id = s.order_id order by s.recorded_at desc limit ${Math.min(200, Math.max(1, limit))}`)).map((r) => ({
      id: String(r.id), channel: r.channel, occurredAt: iso(r.occurred_at)!, valueUgx: Number(r.value_ugx), orderNumber: r.order_number ?? null,
      hasEmail: !!r.email_sha256, hasPhone: !!r.phone_digits_sha256, note: r.note ?? null, recordedAt: iso(r.recorded_at)!,
    }));
  }

  async enqueue(platforms: string[], sinceDays: number): Promise<number> {
    if (platforms.length === 0 || !offlineSendsAllowed()) return 0;
    const env = environmentOf(process.env.NODE_ENV);
    const plat = sql`(select jsonb_array_elements_text(${JSON.stringify(platforms)}::text::jsonb) as platform)`;
    const days = Math.max(1, Math.min(90, Math.floor(sinceDays)));
    // COD deliveries: the authoritative order_delivered event of a pay-on-delivery
    // order that was not cancelled. The event id is the order's CONFIRMATION
    // event id, the one its online purchase carries, so platforms dedupe too.
    const cod = rowsOf(await db.execute(sql`
      insert into ad_offline_conversions (platform, source, source_ref, event_id, occurred_at)
      select p.platform, 'COD_DELIVERED', o.id::text, coalesce(conf.event_id::text, 'cod-' || o.id::text), d.occurred_at
      from measurement.business_event d
      join orders o on o.id::text = d.aggregate_id
      left join measurement.business_event conf on conf.aggregate_type = 'order' and conf.aggregate_id = d.aggregate_id and conf.event_name = 'order_confirmed' and conf.environment = d.environment
      cross join ${plat} p
      where d.aggregate_type = 'order' and d.event_name = 'order_delivered' and d.environment = ${env}
        and o.payment_method = 'offline' and o.status in ('delivered', 'completed')
        and d.occurred_at >= now() - make_interval(days => ${days})
        and not exists (select 1 from measurement.business_event c where c.aggregate_type = 'order' and c.aggregate_id = d.aggregate_id and c.event_name = 'order_cancelled' and c.environment = d.environment)
      on conflict (platform, source, source_ref) do nothing
      returning id`));
    const sales = rowsOf(await db.execute(sql`
      insert into ad_offline_conversions (platform, source, source_ref, event_id, occurred_at)
      select p.platform, 'ADMIN_SALE', s.id::text, s.id::text, s.occurred_at
      from ad_offline_sales s cross join ${plat} p
      where s.occurred_at >= now() - make_interval(days => ${days})
      on conflict (platform, source, source_ref) do nothing
      returning id`));
    return cod.length + sales.length;
  }

  async due(limit: number): Promise<OfflineConversionRow[]> {
    // Claimed with a 5-minute lease: an overlapping tick or a second instance skips these rows.
    return rowsOf(await db.execute(sql`update ad_offline_conversions set next_attempt_at = now() + interval '5 minutes', updated_at = now()
      where id in (select id from ad_offline_conversions where state = 'PENDING' and next_attempt_at <= now() order by next_attempt_at limit ${Math.min(100, Math.max(1, limit))} for update skip locked)
      returning *`)).map(mapConv);
  }

  async context(row: OfflineConversionRow): Promise<OfflineContext | null> {
    const loadOrder = async (orderId: string) => rowsOf(await db.execute(sql`
      select o.id, o.order_number, o.user_id, o.customer_email, o.customer_phone, o.total_amount, a.fp_client_id, a.click_ids, lk.linked_fps, lk.linked_users,
        (select payload from measurement.business_event be where be.aggregate_type = 'order' and be.aggregate_id = o.id::text and be.event_name = 'order_confirmed' limit 1) as confirmed
      from orders o left join order_attribution a on a.order_id = o.id ${linkedIdentitiesSql(sql`o.id`)} where o.id = ${orderId}::uuid`))[0];
    const orderSubjects = (o: any) => ({
      userIds: [...(o.user_id ? [String(o.user_id)] : []), ...stringsOf(o.linked_users)],
      fpClientIds: [...(o.fp_client_id ? [String(o.fp_client_id)] : []), ...stringsOf(o.linked_fps)],
    });
    if (row.source === 'COD_DELIVERED') {
      if (!UUID.test(row.sourceRef)) return null;
      const o = await loadOrder(row.sourceRef);
      if (!o) return null;
      const p = obj(o.confirmed) as Record<string, unknown> | null;
      // The confirmed value (merchandise + delivery + tax), as the online purchase states it.
      const value = p ? Number(p.netMerchandiseUGX ?? 0) + Number(p.collectedDeliveryUGX ?? 0) + Number(p.taxUGX ?? 0) : Number(o.total_amount ?? 0);
      return {
        row, valueUgx: value, orderId: String(o.id), orderNumber: String(o.order_number), channel: null,
        hashes: offlineSaleHashes({ email: o.customer_email, phone: o.customer_phone }), clickIds: clickIdsOf(o.click_ids),
        subjects: { userIds: [...new Set(orderSubjects(o).userIds)], fpClientIds: [...new Set(orderSubjects(o).fpClientIds)] },
      };
    }
    if (!UUID.test(row.sourceRef)) return null;
    const s = rowsOf(await db.execute(sql`select * from ad_offline_sales where id = ${row.sourceRef}::uuid`))[0];
    if (!s) return null;
    const o = s.order_id ? await loadOrder(String(s.order_id)) : null;
    const orderHashes = o ? offlineSaleHashes({ email: o.customer_email, phone: o.customer_phone }) : null;
    const pick = (a: string | null, b: string | null | undefined) => a ?? b ?? null;
    const subjUsers = [...stringsOf(s.consent_user_ids), ...(o ? orderSubjects(o).userIds : [])];
    const subjFps = [...stringsOf(s.consent_fp_client_ids), ...(o ? orderSubjects(o).fpClientIds : [])];
    return {
      row, valueUgx: Number(s.value_ugx), orderId: s.order_id ? String(s.order_id) : null, orderNumber: o ? String(o.order_number) : null, channel: s.channel,
      hashes: {
        emailSha256: pick(s.email_sha256, orderHashes?.emailSha256), emailGoogleSha256: pick(s.email_google_sha256, orderHashes?.emailGoogleSha256),
        phoneDigitsSha256: pick(s.phone_digits_sha256, orderHashes?.phoneDigitsSha256), phonePlusSha256: pick(s.phone_plus_sha256, orderHashes?.phonePlusSha256),
      },
      clickIds: o ? clickIdsOf(o.click_ids) : {},
      subjects: { userIds: [...new Set(subjUsers)], fpClientIds: [...new Set(subjFps)] },
    };
  }

  async onlinePurchaseState(orderId: string, platform: string): Promise<string | null> {
    const r = rowsOf(await db.execute(sql`select di.state from measurement.delivery_intent di join measurement.business_event be on be.event_id = di.event_id
      where be.aggregate_type = 'order' and be.aggregate_id = ${orderId} and be.event_name = 'order_confirmed' and di.sink_key = ${`ad:${platform}:purchase`}
      order by di.created_at desc limit 1`))[0];
    return r?.state ?? null;
  }

  async refused(subjects: OfflineContext['subjects']): Promise<boolean> {
    const r = await refusedAmong(subjects.userIds, subjects.fpClientIds);
    return r.userIds.size > 0 || r.fpClientIds.size > 0;
  }

  async finish(id: string, state: string, reason: string | null, extra: { attempt?: number; nextAttemptAt?: Date; sent?: boolean } = {}) {
    await db.execute(sql`update ad_offline_conversions set state = ${state}, reason = ${reason ? reason.slice(0, 300) : null}, updated_at = now(),
      attempt_count = ${extra.attempt === undefined ? sql`attempt_count` : sql`${extra.attempt}`},
      next_attempt_at = ${extra.nextAttemptAt ? sql`${extra.nextAttemptAt.toISOString()}::timestamptz` : sql`next_attempt_at`},
      sent_at = ${extra.sent ? sql`now()` : sql`sent_at`}
      where id = ${id}::uuid`);
  }

  async list(limit: number) {
    return rowsOf(await db.execute(sql`select * from ad_offline_conversions order by created_at desc limit ${Math.min(200, Math.max(1, limit))}`)).map(mapConv);
  }

  async counts() {
    const rows = rowsOf(await db.execute(sql`select state, count(*)::int as n from ad_offline_conversions group by state`));
    return Object.fromEntries(rows.map((r) => [String(r.state), Number(r.n)]));
  }
}

const leaseSql = (ms: number) => sql`now() + make_interval(secs => ${Math.max(1, Math.round(ms / 1000))})`;

export class DrizzleJobClaims implements JobClaimPort {
  async claim(key: string): Promise<boolean> {
    const r = rowsOf(await db.execute(sql`insert into ad_job_claims (job_key) values (${key.slice(0, 120)}) on conflict do nothing returning job_key`));
    return r.length > 0;
  }

  /**
   * One attempt at a job that must succeed once: a new key, or an existing one
   * that is not done, not leased (or its lease expired, including a failed
   * attempt's retry wait) and under the attempt cap. Atomic: two callers can
   * never both get a token.
   */
  async claimAttempt(key: string, opts: { maxAttempts: number; leaseMs: number }): Promise<string | null> {
    const token = randomUUID();
    const r = rowsOf(await db.execute(sql`insert into ad_job_claims (job_key, attempts, lease_until, holder) values (${key.slice(0, 120)}, 1, ${leaseSql(opts.leaseMs)}, ${token})
      on conflict (job_key) do update set attempts = ad_job_claims.attempts + 1, lease_until = excluded.lease_until, holder = excluded.holder
      where ad_job_claims.done_at is null and ad_job_claims.attempts < ${Math.max(1, opts.maxAttempts)}
        and ad_job_claims.lease_until is not null and ad_job_claims.lease_until <= now()
      returning holder`));
    return r[0]?.holder === token ? token : null;
  }

  async settleAttempt(key: string, token: string, ok: boolean, retryAfterMs: number): Promise<void> {
    await db.execute(sql`update ad_job_claims set
        done_at = ${ok ? sql`now()` : sql`null`},
        lease_until = ${ok ? sql`now()` : leaseSql(retryAfterMs)}
      where job_key = ${key.slice(0, 120)} and holder = ${token}`);
  }

  async acquireLock(key: string, leaseMs: number): Promise<string | null> {
    const token = randomUUID();
    const r = rowsOf(await db.execute(sql`insert into ad_job_claims (job_key, lease_until, holder) values (${key.slice(0, 120)}, ${leaseSql(leaseMs)}, ${token})
      on conflict (job_key) do update set lease_until = excluded.lease_until, holder = excluded.holder
      where ad_job_claims.lease_until is not null and ad_job_claims.lease_until <= now()
      returning holder`));
    return r[0]?.holder === token ? token : null;
  }

  async releaseLock(key: string, token: string): Promise<void> {
    await db.execute(sql`update ad_job_claims set lease_until = now() where job_key = ${key.slice(0, 120)} and holder = ${token}`);
  }
}
